/**
 * Spare-bus cover: when a line bus is in the shop, any idle same-class bus
 * (active, unscheduled) with at least as many seats stands in automatically.
 * No separate "designate as spare" step — idle fleet is the reserve pool.
 * Line-bus crew shifts onto the spare when it is unstaffed / understaffed,
 * then returns when cover ends.
 */
import { BAL } from '../data/balance'
import { BUS_MODELS, isCharterModel } from '../data/busModels'
import { ROUTES } from '../data/routes'
import type { Bus, BusDuty, GameState, ID, Staff, Trip } from '../types'
import { spend } from './finance'
import { buildSeats } from './seatmap'
import { hydrateTripSeats } from './seatstate'
import { assignStaff, fleetManagerOnDuty } from './staffing'
import { pushLog } from './log'

function coverDriverNeed(s: GameState, bus: Bus): number {
  const sch = bus.scheduleId ? s.schedules[bus.scheduleId] : undefined
  if (!sch) return 1
  const route = ROUTES[sch.routeId]
  if (!route) return 1
  return route.hours > BAL.maxDrivingHoursSingleDriver ? 2 : 1
}

function crewOnBusRole(s: GameState, busId: ID, role: 'driver' | 'conductor'): Staff[] {
  return Object.values(s.staff).filter(
    (st) =>
      st.busId === busId
      && st.role === role
      && !(st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day),
  )
}

/** Fill spare shortfalls from the line bus's posted drivers / conductor. */
function shiftCrewOntoCover(s: GameState, lineId: ID, spareId: ID): number {
  const spare = s.buses[spareId]
  if (!spare) return 0
  const needDrv = coverDriverNeed(s, spare)
  let moved = 0

  const onSpareDrv = crewOnBusRole(s, spareId, 'driver')
  const onLineDrv = crewOnBusRole(s, lineId, 'driver')
  while (onSpareDrv.length < needDrv && onLineDrv.length > 0) {
    const st = onLineDrv.pop()!
    if (assignStaff(s, st.id, spareId) === null) {
      onSpareDrv.push(st)
      moved++
    } else break
  }

  const onSpareCond = crewOnBusRole(s, spareId, 'conductor')
  const onLineCond = crewOnBusRole(s, lineId, 'conductor')
  while (onSpareCond.length < 1 && onLineCond.length > 0) {
    const st = onLineCond.pop()!
    if (assignStaff(s, st.id, spareId) === null) {
      onSpareCond.push(st)
      moved++
    } else break
  }

  return moved
}

/** Move cover crew back onto the line bus; leftover spare crew go to the bench. */
function restoreCrewFromCover(s: GameState, lineId: ID, spareId: ID): number {
  const line = s.buses[lineId]
  let moved = 0

  if (line) {
    const needDrv = coverDriverNeed(s, line)
    const onLineDrv = crewOnBusRole(s, lineId, 'driver')
    const onSpareDrv = crewOnBusRole(s, spareId, 'driver')
    while (onLineDrv.length < needDrv && onSpareDrv.length > 0) {
      const st = onSpareDrv.pop()!
      if (assignStaff(s, st.id, lineId) === null) {
        onLineDrv.push(st)
        moved++
      } else break
    }

    const onLineCond = crewOnBusRole(s, lineId, 'conductor')
    const onSpareCond = crewOnBusRole(s, spareId, 'conductor')
    while (onLineCond.length < 1 && onSpareCond.length > 0) {
      const st = onSpareCond.pop()!
      if (assignStaff(s, st.id, lineId) === null) {
        onLineCond.push(st)
        moved++
      } else break
    }
  }

  // Spare is going idle — anyone still posted there returns to the bench
  for (const st of Object.values(s.staff)) {
    if (st.busId !== spareId) continue
    if (st.role !== 'driver' && st.role !== 'conductor') continue
    assignStaff(s, st.id, undefined)
  }

  return moved
}

export function coveringSpare(s: GameState, lineBusId: ID): Bus | undefined {
  return Object.values(s.buses).find((b) => b.coveringBusId === lineBusId && b.status === 'active')
}

/** Idle = active owned/leased bus with no schedule and not already covering. */
export function isIdleCoverCandidate(b: Bus): boolean {
  if (b.status !== 'active') return false
  if (b.ownership === 'attached') return false
  if (b.coveringBusId) return false
  if (b.scheduleId) return false
  return true
}

/** Resize open-trip inventory to a bus model's seat count; refund overflow sales. */
export function adaptTripSeats(s: GameState, trip: Trip, modelId: string): { refunded: number; seats: number } {
  const model = BUS_MODELS[modelId]
  if (!model || trip.status !== 'open') return { refunded: 0, seats: 0 }
  const refs = { busId: trip.busId, routeId: trip.routeId, tripId: trip.id }
  let refunded = 0
  // A cold trip keeps only its sold-seat rows; materialise the map before
  // resizing, otherwise the sale rows would be silently dropped.
  hydrateTripSeats(s, trip)

  // Rebuild the layout from the new coach's own template instead of patching
  // the old map. The rebuilt map is byte-for-byte what the seat hydrator
  // produces from the seed, so a cold trip can be packed and restored later
  // without diverging from the live map.
  const next = buildSeats(model, s.seed, trip.id)
  const byId = new Map(next.map((seat) => [seat.id, seat]))
  for (const seat of trip.seats) {
    if (!seat.sale) continue
    const keep = byId.get(seat.id)
    if (keep) {
      keep.sale = seat.sale
      continue
    }
    refunded += seat.sale.price
    trip.revenue -= seat.sale.price
    trip.channelSold[seat.sale.channel]--
    trip.sold--
  }
  if (refunded > 0) spend(s, 'refund', refunded, { ...refs, note: 'bus change seat overflow refund', refundCategory: 'busCancel' })

  trip.seats = next
  trip.seatCount = next.length
  trip.seatModelId = model.id
  return { refunded, seats: next.length }
}

function adaptOpenTripsForBus(s: GameState, busId: ID, modelId: string): { trips: number; refunded: number } {
  let trips = 0
  let refunded = 0
  for (const id of s.openTripIds) {
    const t = s.trips[id]
    if (!t || t.status !== 'open' || t.busId !== busId) continue
    const r = adaptTripSeats(s, t, modelId)
    refunded += r.refunded
    trips++
  }
  return { trips, refunded }
}

export function remapOpenTrips(s: GameState, fromId: ID, toId: ID): number {
  let n = 0
  for (const id of s.openTripIds) {
    const t = s.trips[id]
    if (t && t.status === 'open' && t.busId === fromId) {
      t.busId = toId
      n++
    }
  }
  return n
}

export function releaseCoverFor(s: GameState, lineBusId: ID): void {
  const spare = Object.values(s.buses).find((b) => b.coveringBusId === lineBusId)
  if (!spare) return
  const line = s.buses[lineBusId]
  restoreCrewFromCover(s, lineBusId, spare.id)
  remapOpenTrips(s, spare.id, lineBusId)
  if (line) adaptOpenTripsForBus(s, lineBusId, line.modelId)
  spare.coveringBusId = undefined
  spare.scheduleId = undefined // back to idle
  spare.duty = 'line'
}

/** Drop any cover this bus is giving or receiving (sale, lease return, etc.). */
export function clearCoverRefs(s: GameState, busId: ID): void {
  releaseCoverFor(s, busId)
  const bus = s.buses[busId]
  if (bus?.coveringBusId) {
    const lineId = bus.coveringBusId
    const line = s.buses[lineId]
    restoreCrewFromCover(s, lineId, busId)
    remapOpenTrips(s, busId, lineId)
    if (line) adaptOpenTripsForBus(s, lineId, line.modelId)
    bus.coveringBusId = undefined
    bus.scheduleId = undefined
    bus.duty = 'line'
  }
}

function pickIdleClassMatched(s: GameState, down: Bus): Bus | undefined {
  const downModel = BUS_MODELS[down.modelId]
  if (!downModel) return undefined
  const need = downModel.seats
  const cls = downModel.cls
  const downBrand = down.groupId ?? null
  const candidates = Object.values(s.buses).filter((b) => {
    if (b.id === down.id) return false
    if (!isIdleCoverCandidate(b)) return false
    // Never pull a spare from another subsidiary brand.
    if (s.config?.autoCoverPolicy !== 'any' && (b.groupId ?? null) !== downBrand) return false
    const m = BUS_MODELS[b.modelId]
    return m?.cls === cls && m.seats >= need
  })
  if (candidates.length === 0) return undefined
  candidates.sort((a, b) => {
    const sa = BUS_MODELS[a.modelId].seats
    const sb = BUS_MODELS[b.modelId].seats
    return (sa - need) - (sb - need)
  })
  return candidates[0]
}

export function tryCoverBus(s: GameState, downId: ID): Bus | undefined {
  if (!fleetManagerOnDuty(s)) return undefined
  if (s.config?.autoCoverPolicy === 'off') return undefined
  const down = s.buses[downId]
  if (!down || down.ownership === 'attached') return undefined
  if (down.coveringBusId) return undefined // this bus is itself covering someone
  const existing = coveringSpare(s, downId)
  if (existing) {
    shiftCrewOntoCover(s, downId, existing.id)
    return existing
  }
  const spare = pickIdleClassMatched(s, down)
  if (!spare) return undefined
  spare.coveringBusId = downId
  spare.scheduleId = down.scheduleId
  spare.duty = 'line'
  remapOpenTrips(s, downId, spare.id)
  adaptOpenTripsForBus(s, spare.id, spare.modelId)
  shiftCrewOntoCover(s, downId, spare.id)
  return spare
}

/** Switch bus duty between regular line and dedicated charter operations. */
export function setBusDuty(s: GameState, busId: ID, duty: BusDuty): string | null {
  const bus = s.buses[busId]
  if (!bus) return 'No such bus.'
  if (duty === 'spare') {
    return 'No need — any idle line coach covers automatically when another is in the workshop.'
  }
  if (bus.coveringBusId) return 'Wait until this bus is finished covering.'

  if (duty === 'charter') {
    if (bus.scheduleId) {
      return 'Cannot switch to charter duty while bus is assigned to a schedule. Unassign from timetable first.'
    }
    bus.duty = 'charter'
    return null
  }

  // duty === 'line'
  if (bus.duty === 'charter') {
    if (isCharterModel(bus.modelId)) {
      return 'This vehicle is a dedicated charter van/coach and cannot be assigned to line service.'
    }
    const hasContract = (s.charterContracts ?? []).some(
      (c) => c.busId === busId && (c.status === 'booked' || c.status === 'active'),
    )
    if (hasContract) {
      return 'Cannot return to line duty while an active or booked charter contract is assigned.'
    }
    bus.duty = 'line'
    return null
  }

  bus.duty = 'line'
  return null
}

export function releaseFinishedCovers(s: GameState): void {
  for (const spare of Object.values(s.buses)) {
    if (!spare.coveringBusId) continue
    const line = s.buses[spare.coveringBusId]
    if (!line || line.status === 'active') {
      releaseCoverFor(s, spare.coveringBusId)
      continue
    }
    const spareM = BUS_MODELS[spare.modelId]
    const lineM = BUS_MODELS[line.modelId]
    if (!spareM || !lineM || spareM.cls !== lineM.cls || spareM.seats < lineM.seats) {
      const lineId = spare.coveringBusId
      pushLog(
        s,
        'alert',
        `${spare.reg} cannot cover ${line.reg} — need same class and at least ${lineM?.seats ?? '?'} seats. Cover released.`,
      )
      releaseCoverFor(s, lineId)
      tryCoverBus(s, lineId)
    }
  }
}
