/**
 * Dispatch pass: run today's departures. Fuel, tolls, crew bata, border
 * tax; rolls for delay, breakdown and accident; wear, fatigue, reviews,
 * cargo & on-board revenue; per-trip contribution.
 */
import { BAL, driverBataForKm } from '../data/balance'
import { BUS_MODELS, layoutKeyForZone, layoutShares, isCargoModel } from '../data/busModels'
import { ROUTES, routeName } from '../data/routes'
import { cityName } from '../data/cities'
import { seasonInfo } from '../core/calendar'
import { fmtCompact, rs } from '../core/money'
import { tonnesText } from '../core/units'
import { rngFor, rChance, rInt, rJitter } from '../core/rng'
import { SUBSYSTEMS, type Bus, type GameState, type Staff } from '../types'
import { earn, spend, todayRouteDay, settleAttachOwnerCash, reverseAttachOwnerShare, brandKeyForService } from './finance'
import { cancelTrip } from './booking'
import { pushLog } from './log'
import { coveringSpare, tryCoverBus } from './cover'
import { driverOnDuty, pickSpareConductor, pickSpareDriver, hrOnDuty, opsOnDuty, isStaffResting, driverRestIllegal, isDriverEligibleForTrip, cmvrDutyHoursForTrip } from './staffing'
import { recordScheduleOcc } from './schedules'
import { recordTripGrievanceOrCompliment } from './crm'
import { allocateCargoForTrip, cargoLaneKey, makeCorridorCargoPool, recordCargoLane, type CargoDepartureRef, type CorridorCargoPool } from './cargo'
import { ownerPaysService, conductorCleanlinessTarget } from './maintenance'
import { hybridClassStats } from './seatmap'
import { fileAccidentClaim } from './insurance'
import { applyOutboundDelayToPair, buildPairIndex, cancelPairedReturn, clearTripBookings } from './pairing'
import { isSeasonalTrip, recordSeasonalTripRun } from './festival'
import { clockMinutes } from '../core/calendar'
import { resolvedAmenities } from './groups'
import {
  tripAmenityCost,
  tripAmenityPssBonus,
  missingBeddingPenalty,
  busFittingsPssBonus,
} from '../data/amenitiesCatalog'

type CrewIndex = Map<string, { drivers: Staff[]; conductor?: Staff }>

/** Build once per dispatch pass — avoids scanning all staff per departure. */
function buildCrewIndex(s: GameState): CrewIndex {
  const idx: CrewIndex = new Map()
  for (const st of Object.values(s.staff)) {
    if (!st.busId) continue
    if (st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day) continue
    let row = idx.get(st.busId)
    if (!row) { row = { drivers: [] }; idx.set(st.busId, row) }
    if (st.role === 'driver' || st.role === 'co_driver') row.drivers.push(st)
    else if (st.role === 'conductor') row.conductor = st
  }
  return idx
}

function crewFor(s: GameState, busId: string, index?: CrewIndex): { drivers: Staff[]; conductor?: Staff } {
  const bus = s.buses[busId]
  const ids = [busId]
  if (bus?.coveringBusId) ids.push(bus.coveringBusId)
  if (!index) {
    const drivers: Staff[] = []
    let conductor: Staff | undefined
    for (const st of Object.values(s.staff)) {
      if (!st.busId || !ids.includes(st.busId)) continue
      if (st.onLeaveUntilDay && st.onLeaveUntilDay >= s.day) continue
      if (st.role === 'driver' || st.role === 'co_driver') drivers.push(st)
      else if (st.role === 'conductor') conductor = st
    }
    return { drivers, conductor }
  }
  const drivers: Staff[] = []
  let conductor: Staff | undefined
  for (const id of ids) {
    const row = index.get(id)
    if (!row) continue
    drivers.push(...row.drivers)
    if (!conductor && row.conductor) conductor = row.conductor
  }
  return { drivers, conductor }
}

/** Line crew plus spare-bench cover for missing seats and high fatigue. */
function resolveTripCrew(
  s: GameState,
  busId: string,
  driversNeeded: number,
  usedSpares: Set<string>,
  usedConductors: Set<string>,
  index?: CrewIndex,
  depHour?: number,
  routeHours?: number,
): { drivers: Staff[]; conductor?: Staff; notes: string[] } {
  const posted = crewFor(s, busId, index)
  const notes: string[] = []
  const drivers: Staff[] = []
  const rHours = routeHours ?? 0

  // 1. Separate eligible posted drivers from ineligible
  const eligiblePosted: Staff[] = []
  const ineligiblePosted: Staff[] = []

  for (const d of posted.drivers) {
    if (isDriverEligibleForTrip(s, d, s.day, depHour ?? 0, rHours, driversNeeded)) {
      eligiblePosted.push(d)
    } else {
      ineligiblePosted.push(d)
    }
  }

  // 2. Assign eligible posted drivers up to driversNeeded
  for (const d of eligiblePosted) {
    if (drivers.length < driversNeeded) {
      drivers.push(d)
    }
  }

  // 3. If short, pick spare drivers from payroll bench
  while (drivers.length < driversNeeded) {
    const spare = pickSpareDriver(s, usedSpares, true, true, busId, depHour)
    if (!spare) break
    if (!isDriverEligibleForTrip(s, spare, s.day, depHour ?? 0, rHours, driversNeeded)) {
      usedSpares.add(spare.id)
      continue
    }
    usedSpares.add(spare.id)
    drivers.push(spare)
    notes.push(`${spare.name} (spare) covered duty for the trip`)
  }

  // 4. If still short, fall back to ineligible posted drivers (triggers CMVR block / warnings)
  for (const d of ineligiblePosted) {
    if (drivers.length < driversNeeded) {
      drivers.push(d)
      if (driverRestIllegal(d, s.day)) notes.push(`${d.name} on illegal consecutive duty`)
      else if (isStaffResting(s, d, depHour)) notes.push(`${d.name} on duty while in mandatory rest`)
      else if (rHours > 0 && (d.cmvrHoursToday ?? 0) + cmvrDutyHoursForTrip(rHours, driversNeeded) > BAL.cmvrDailyHours) {
        notes.push(`${d.name} exceeds CMVR daily hours`)
      }
    }
  }

  // 5. Conductor assignment (dedicated cargo vehicles require no conductor)
  const bus = s.buses[busId]
  if (bus && isCargoModel(bus.modelId)) {
    return { drivers, conductor: undefined, notes }
  }

  let conductor = posted.conductor
  if (conductor && isStaffResting(s, conductor, depHour)) {
    const bus = s.buses[busId]
    const busConds = Object.values(s.staff).filter(
      (st) => (st.busId === busId || (bus?.coveringBusId && st.busId === bus.coveringBusId)) &&
        st.role === 'conductor' &&
        !isStaffResting(s, st, depHour),
    )
    if (busConds.length > 0) {
      conductor = busConds[0]
    } else {
      notes.push(`${conductor.name} (conductor) in rest`)
      conductor = undefined
    }
  }
  if (conductor) usedConductors.add(conductor.id)
  if (!conductor) {
    const spare = pickSpareConductor(s, usedConductors, depHour)
    if (spare) {
      usedConductors.add(spare.id)
      conductor = spare
      notes.push(`${spare.name} (spare conductor) joined — tickets and cabin`)
    }
  }

  return { drivers, conductor, notes }
}

function applyWear(s: GameState, bus: Bus, km: number): void {
  const overdue = bus.odometer - bus.lastServiceOdo > BAL.serviceIntervalKm
  let mult = overdue ? BAL.overdueWearMult : BAL.servicedWearMult
  const ecoActive = s.company.ecoIncentiveActive || s.config?.ecoIncentiveActive
  if (ecoActive) {
    mult *= BAL.ecoDriving.wearReductionMult
  }
  const summer = seasonInfo(s.day).name === 'Summer holidays'
  for (const sub of SUBSYSTEMS) {
    let wear = (BAL.wearPerKKm[sub] * km) / 1000
    if (sub === 'ac' && summer) wear *= 1.5
    bus.condition[sub] = Math.max(5, bus.condition[sub] - wear * mult)
  }
  bus.odometer += km
  const tyreWearRate = ecoActive ? BAL.ecoDriving.wearReductionMult : 1.0
  bus.frontTyreKm = (bus.frontTyreKm ?? 0) + Math.round(km * BAL.tyres.frontWearMult * tyreWearRate)
  bus.rearTyreKm = (bus.rearTyreKm ?? 0) + Math.round(km * BAL.tyres.rearWearMult * tyreWearRate)
  bus.tyreKm = Math.max(bus.frontTyreKm, bus.rearTyreKm)
}

function breakdownChance(bus: Bus, drivers?: Staff[]): number {
  let p = BAL.breakdownBase
  const overdueKm = bus.odometer - bus.lastServiceOdo - BAL.serviceIntervalKm
  if (overdueKm > 0) p += (overdueKm / 10_000) * BAL.breakdownOverduePer10kKm
  for (const sub of SUBSYSTEMS) {
    const c = bus.condition[sub]
    if (c < 60) p += BAL.breakdownPerBadSubsystem * ((60 - c) / 60)
  }
  const frontLife = BAL.tyres[bus.frontBrand ?? 'oem']?.frontLifeKm ?? BAL.tyreLifeKm
  const rearLife = BAL.tyres[bus.rearBrand ?? 'oem']?.rearLifeKm ?? BAL.tyreLifeKm
  if ((bus.frontTyreKm ?? 0) > frontLife || (bus.rearTyreKm ?? 0) > rearLife) p += 0.02
  if (drivers?.some((d) => d.drivingStyle === 'aggressive')) p *= 1.15
  return Math.min(0.35, p)
}

/** Bay the desk will actually load: weight, or the cube, whichever binds first. */
function effectiveCargoCapKg(s: GameState, model: { cargoCapKg: number; cargoVolumeCbm?: number; seats: number }, bus: Bus, isCargo: boolean): number {
  const capWeight = model.cargoCapKg || (isCargo ? 0 : 400)
  const capVolume = bus.cargoVolumeCbm ?? model.cargoVolumeCbm ?? (model.seats < 30 ? 4 : model.seats < 45 ? 8 : 12)
  const cargoType = s.company.cargoCargoType ?? 'mixed'
  const density = BAL.cargoDensity[cargoType] ?? 167
  return Math.min(capWeight, Math.round(capVolume * density))
}

/**
 * Litres for one run.
 * Coach `mileage` is the loaded, air-conditioned highway figure for a cautious driver
 * (a BharatBenz 1824HD sleeper is 3.5 km/l). Driving style scales `kmplFactor`:
 * cautious 1.0, aggressive 0.857 (3.0 km/l on that same coach). Passenger load only
 * nudges a few percent around a typical 70% fill. Cargo still drinks more as the bay fills.
 */
export function fuelLitresForRun(
  mileage: number,
  km: number,
  _ac: boolean,
  isCargo: boolean,
  loadFactor: number,
  kmplFactor = 1,
): number {
  const book = Math.max(1.5, mileage * kmplFactor)
  const lf = Math.max(0, Math.min(1, loadFactor))
  const load = isCargo
    ? 1 + BAL.cargoLoadFuelPenalty * lf
    : 1 + BAL.loadFuelPenalty * (lf - 0.7)
  return (km / book) * Math.max(0.94, load)
}

export function dispatchPass(s: GameState): { departed: number; pax: number; seats: number } {
  let departed = 0
  let paxTotal = 0
  let seatsTotal = 0
  const usedSpares = new Set<string>()
  const usedConductors = new Set<string>()
  const crewIndex = buildCrewIndex(s)
  const corridorCargoMap = new Map<string, CorridorCargoPool>()

  // Due departures: today's open trips, plus any past-due opens that were
  // never dispatched (e.g. trips generated on the starting day before the
  // first advance). Catch them up so Run History is not stuck empty.
  const todayIds = s.openTripIds
    .filter((id) => {
      const t = s.trips[id]
      return t && t.status === 'open' && t.day <= s.day
    })
    .sort((a, b) => {
      const ta = s.trips[a]!
      const tb = s.trips[b]!
      if (ta.day !== tb.day) return ta.day - tb.day
      // On same corridor and day: cargo vehicles load priority freight before passenger buses
      if (ta.routeId === tb.routeId && ta.direction === tb.direction) {
        const ba = s.buses[ta.busId]
        const bb = s.buses[tb.busId]
        const cargoA = ba ? isCargoModel(ba.modelId) : false
        const cargoB = bb ? isCargoModel(bb.modelId) : false
        if (cargoA !== cargoB) return cargoA ? -1 : 1
      }
      const ca = clockMinutes(ta) - clockMinutes(tb)
      if (ca !== 0) return ca
      if (ta.direction !== tb.direction) return ta.direction === 'AB' ? -1 : 1
      return a.localeCompare(b)
    })

  const departuresByLane = new Map<string, CargoDepartureRef[]>()
  for (const id of todayIds) {
    const trip = s.trips[id]
    if (!trip) continue
    const route = ROUTES[trip.routeId]
    const depBus = s.buses[trip.busId]
    if (!route || !depBus || depBus.ownership === 'attached') continue
    const depModel = BUS_MODELS[depBus.modelId]
    if (!depModel) continue
    const cargoOnly = isCargoModel(depBus.modelId)
    const lane = cargoLaneKey(route, trip.direction)
    const arr = departuresByLane.get(lane) ?? []
    arr.push({
      tripId: trip.id,
      routeId: trip.routeId,
      capKg: effectiveCargoCapKg(s, depModel, depBus, cargoOnly),
      depHour: trip.depHour,
      depMin: trip.depMin ?? 0,
      isCargo: cargoOnly,
    })
    departuresByLane.set(lane, arr)
  }

  // Relief coaches: one pool scanned in fleet order, plus the set of coaches
  // already committed to a departure today. The old search re-walked every trip
  // in the save for every breakdown (O(buses × trips)), which was the hottest
  // loop of the whole day on a large fleet.
  const committedToday = new Set<string>()
  for (const id of todayIds) {
    const t = s.trips[id]
    if (t) committedToday.add(t.busId)
  }
  const reliefPool = Object.values(s.buses).filter(
    (b) => b.status === 'active' && (b.condition?.engine ?? 100) >= 65 && !b.outsideGarage,
  )
  const pairIndex = buildPairIndex(s)

  for (const id of todayIds) {
    const trip = s.trips[id]
    if (!trip || trip.status !== 'open' || trip.day > s.day) continue

    const route = ROUTES[trip.routeId]
    let bus = s.buses[trip.busId]
    const rng = rngFor(s.seed, 'dispatch', trip.id)

    // ---- pre-departure checks ----
    if (!route) { cancelTrip(s, id, 'route retired'); continue }
    if (!bus) { cancelTrip(s, id, 'bus no longer in fleet'); continue }
    if (s.company.cmvrSuspendUntilDay !== undefined && s.company.cmvrSuspendUntilDay > s.day) {
      cancelTrip(s, id, 'operations suspended')
      pushLog(s, 'alert', `Trip cancelled on ${routeName(route.id)}: Company operations suspended by RTO for CMVR offences until Day ${s.company.cmvrSuspendUntilDay}.`)
      continue
    }
    const closure = s.world.closures[route.id]
    const hasDetour = Boolean(s.world.detour?.[route.id] && s.world.detour[route.id] >= s.day)
    if (closure && closure.untilDay >= s.day && !hasDetour) {
      cancelTrip(s, id, `route closed (${closure.reason})`)
      pushLog(s, 'alert', `Trip cancelled on ${routeName(route.id)}: ${closure.reason}. Full refunds issued.`)
      continue
    }
    if (s.world.strikeUntilDay >= s.day) {
      cancelTrip(s, id, 'staff strike')
      continue
    }
    if (bus.status === 'workshop') {
      const cover = tryCoverBus(s, bus.id) ?? coveringSpare(s, bus.id)
      if (cover) {
        trip.busId = cover.id
        bus = cover
      } else {
        cancelTrip(s, id, 'bus in workshop')
        pushLog(s, 'alert', `${s.buses[trip.busId]?.reg ?? 'Bus'} is still in the workshop - trip on ${routeName(route.id)} cancelled with refunds.`)
        continue
      }
    }
    if (bus.status === 'grounded' || (bus.transferReadyDay !== undefined && bus.transferReadyDay > s.day) || (bus.impoundUntilDay !== undefined && bus.impoundUntilDay > s.day)) {
      const reason = bus.impoundUntilDay !== undefined && bus.impoundUntilDay > s.day
        ? 'bus impounded'
        : bus.status === 'grounded' ? 'bus grounded' : 'papers transfer pending'
      cancelTrip(s, id, reason)
      pushLog(s, 'alert', `${bus.reg}: ${reason} — trip cancelled.`)
      continue
    }
    if (bus.insuranceExpiryDay < s.day || bus.fitnessExpiryDay < s.day || (bus.pucExpiryDay !== undefined && bus.pucExpiryDay < s.day) || !!bus.fitnessFailed) {
      bus.status = 'grounded'
      cancelTrip(s, id, 'documents expired')
      pushLog(s, 'alert', `${bus.reg} GROUNDED until documents (${bus.insuranceExpiryDay < s.day ? 'insurance' : bus.fitnessExpiryDay < s.day || bus.fitnessFailed ? 'fitness' : 'PUC'}) renewed/passed.`)
      continue
    }
    const attached = bus.ownership === 'attached'
    const isCargo = isCargoModel(bus.modelId)
    const busGroup = bus.groupId && s.groups ? s.groups[bus.groupId] : undefined
    const postedCrew = crewFor(s, bus.id, crewIndex)
    const skilledCond = !isCargo && Boolean(postedCrew.conductor && postedCrew.conductor.skill >= 5)
    const driversNeeded = route.hours > BAL.maxDrivingHoursSingleDriver && !skilledCond ? 2 : 1
    const crew = attached
      ? { ...postedCrew, notes: [] as string[] }
      : resolveTripCrew(s, bus.id, driversNeeded, usedSpares, usedConductors, crewIndex, trip.depHour, route.hours)
    if (!attached && crew.drivers.length === 0) {
      cancelTrip(s, id, 'no driver')
      pushLog(s, 'alert', `Trip cancelled on ${routeName(route.id)}: ${bus.reg} has no driver. Hire or appoint a driver.`)
      continue
    }
    // Rest law: illegal consecutive duty without spare → challan or ground the trip.
    if (!attached) {
      const illegal = crew.drivers.filter((d) => driverRestIllegal(d, s.day))
      if (illegal.length > 0 && illegal.length === crew.drivers.length) {
        if (rChance(rng, BAL.restLaw.violateChallanChance)) {
          spend(s, 'fine', BAL.restLaw.challanFine, { busId: bus.id, tripId: trip.id, note: 'rest-law challan' })
          pushLog(s, 'alert', `Rest-law challan ${fmtCompact(BAL.restLaw.challanFine)} — ${illegal.map((d) => d.name).join(', ')} on ${bus.reg}.`)
        } else {
          cancelTrip(s, id, 'crew rest law')
          pushLog(s, 'alert', `Trip cancelled on ${routeName(route.id)}: ${bus.reg} crew needs a rest day (no legal spare).`)
          continue
        }
      }
    }
    if (crew.notes.length > 0) {
      pushLog(s, 'info', `${bus.reg} on ${routeName(route.id)}: ${crew.notes.join('; ')}.`)
    }

    // Shared by the CMVR gate and post-trip hour accrual.
    const numQualified = crew.drivers.length + (crew.conductor && crew.conductor.skill >= 5 ? 1 : 0)
    const hoursPerDriver = cmvrDutyHoursForTrip(route.hours, Math.max(1, numQualified))

    // CMVR driving hours, night rest, and 2nd qualified crew check.
    // Attached coaches bring the owner's crew — company payroll rules do not apply.
    // Fitness / insurance / PUC expiry already grounds the bus above.
    if (attached) {
      delete trip.cmvrBlocked
      delete trip.cmvrRunAnyway
    } else {
      const hasPrimary = crew.drivers.some((d) => d.role === 'driver')
      const needsSecond = route.hours > BAL.maxDrivingHoursSingleDriver
      const hasSecondQualified = crew.drivers.length >= 2 || (crew.conductor && crew.conductor.skill >= 5)
      const inNightRest = crew.drivers.some(
        (d) => d.nightRestUntilDay && (s.day < d.nightRestUntilDay || (s.day === d.nightRestUntilDay && trip.depHour < (d.nightRestUntilHour ?? BAL.cmvrNightRestUntilHour))),
      )
      const inDutyWait = crew.drivers.some((d) => d.nextDutyNotBeforeHour !== undefined && trip.depHour < d.nextDutyNotBeforeHour)
      const hoursOver = crew.drivers.some((d) => (d.cmvrHoursToday ?? 0) + hoursPerDriver > BAL.cmvrDailyHours)

      const isCmvrBlocked = !hasPrimary || inNightRest || inDutyWait || hoursOver || (needsSecond && !hasSecondQualified)
      if (isCmvrBlocked) {
        trip.cmvrBlocked = true
        if (trip.cmvrRunAnyway) {
          s.company.cmvrOffenceCount = (s.company.cmvrOffenceCount ?? 0) + 1
          const fine = rs(5_000)
          spend(s, 'fine', fine, { busId: bus.id, tripId: trip.id, note: `CMVR violation (${s.company.cmvrOffenceCount === 1 ? '1st' : '2nd+'} offence)` })
          if (s.company.cmvrOffenceCount >= 2) {
            s.company.cmvrSuspendUntilDay = s.day + 5
            pushLog(s, 'alert', `CMVR VIOLATION (${s.company.cmvrOffenceCount === 2 ? '2nd' : 'repeat'} offence): ${bus.reg} on ${routeName(route.id)}. Fined ${fmtCompact(fine)} and operations suspended for 5 days.`)
          } else {
            pushLog(s, 'alert', `CMVR VIOLATION (1st offence): ${bus.reg} on ${routeName(route.id)} ran over the duty limit. Fined ${fmtCompact(fine)}. A 2nd offence suspends operations for 5 days.`)
          }
        } else {
          cancelTrip(s, id, 'CMVR violation')
          pushLog(s, 'alert', `Trip cancelled on ${routeName(route.id)}: CMVR driver rest / crew hours violation on ${bus.reg}. Full refunds issued.`)
          continue
        }
      }
    }

    // ---- run the trip ----
    const model = BUS_MODELS[bus.modelId]
    const ecoActive = Boolean(s.company.ecoIncentiveActive || s.config?.ecoIncentiveActive)
    const refs = { busId: bus.id, routeId: route.id, tripId: trip.id }
    const season = seasonInfo(s.day)
    const monsoon = season.weatherRisk > 0

    if (trip.pairEmptyDepart && trip.sold > 0) {
      clearTripBookings(s, trip, 'paired return empty depart')
    }
    const pax = trip.pairEmptyDepart
      ? 0
      : Math.max(0, trip.sold - Math.round(trip.sold * BAL.noShowRate * rJitter(rng, 1, 0.5)))
    const cap = trip.seatCount || trip.seats.length
    paxTotal += pax
    seatsTotal += cap
    departed++

    // Cargo is known before diesel so a loaded truck burns more than an empty one.
    let cargoRevenue = 0
    let cargoKg = 0
    let cargoContractKg = 0
    let cargoSpotKg = 0
    let cargoWalkupKg = 0
    let cargoContractRevenue = 0
    let cargoSpotRevenue = 0
    let cargoWalkupRevenue = 0
    let cargoLoading = 0
    let cargoUnloading = 0
    let cargoLiability = 0
    let effectiveCapKg = 0
    let cargoPool: CorridorCargoPool | undefined
    if (!attached) {
      effectiveCapKg = effectiveCargoCapKg(s, model, bus, isCargo)
      const lane = cargoLaneKey(route, trip.direction)
      let pool = corridorCargoMap.get(lane)
      if (!pool) {
        pool = makeCorridorCargoPool(s, route, trip.direction, departuresByLane.get(lane) ?? [])
        corridorCargoMap.set(lane, pool)
      }
      cargoPool = pool
      const alloc = allocateCargoForTrip(s, pool, route, trip.id, effectiveCapKg, isCargo)
      cargoKg = alloc.kg
      cargoRevenue = alloc.revenue
      cargoContractKg = alloc.contractKg
      cargoSpotKg = alloc.spotKg
      cargoWalkupKg = alloc.walkupKg
      cargoContractRevenue = alloc.contractRevenue
      cargoSpotRevenue = alloc.spotRevenue
      cargoWalkupRevenue = alloc.walkupRevenue
      if (s.world.cargoPilferageRouteId === route.id && s.world.cargoPilferageUntilDay && s.world.cargoPilferageUntilDay >= s.day) {
        cargoRevenue = Math.round(cargoRevenue * 0.5)
        cargoContractRevenue = Math.round(cargoContractRevenue * 0.5)
        cargoSpotRevenue = Math.round(cargoSpotRevenue * 0.5)
        cargoWalkupRevenue = Math.round(cargoWalkupRevenue * 0.5)
        pushLog(s, 'alert', `PILFERAGE: Parcels tampered at terminal on ${routeName(route.id)}. 50% cargo revenue lost today.`)
      }
      if (cargoRevenue > 0) {
        const mix = [
          cargoContractKg > 0 ? `${tonnesText(cargoContractKg)} contract` : '',
          cargoSpotKg > 0 ? `${tonnesText(cargoSpotKg)} spot` : '',
          cargoWalkupKg > 0 ? `${tonnesText(cargoWalkupKg)} walk-up` : '',
        ].filter(Boolean).join(', ')
        const carrier = isCargo ? 'cargo vehicle' : 'coach belly'
        earn(s, 'cargo', cargoRevenue, { ...refs, note: `Freight on ${carrier}${mix ? ` (${mix})` : ''}` })
      }
      if (cargoKg > 0) {
        const kgText = tonnesText(cargoKg)
        cargoLoading = Math.round(cargoKg * (BAL.cargoLoadingPaisePerKg ?? 12))
        cargoUnloading = Math.round(cargoKg * (BAL.cargoUnloadingPaisePerKg ?? 8))
        spend(s, 'loading_unloading', cargoLoading, {
          ...refs,
          note: `Loading charges at ${routeName(route.id)} origin (${kgText})`,
        })
        spend(s, 'loading_unloading', cargoUnloading, {
          ...refs,
          note: `Unloading charges at ${routeName(route.id)} destination (${kgText})`,
        })
        s.curMonth.cargoKgMtd = (s.curMonth.cargoKgMtd ?? 0) + cargoKg
      }
      // Split freight by what actually carried it: a coach belly or a cargo truck.
      if (cargoRevenue > 0) {
        if (isCargo) {
          s.curMonth.cargoTruckRevenue = (s.curMonth.cargoTruckRevenue ?? 0) + cargoRevenue
          s.curMonth.cargoTruckKg = (s.curMonth.cargoTruckKg ?? 0) + cargoKg
        } else {
          s.curMonth.cargoCoachRevenue = (s.curMonth.cargoCoachRevenue ?? 0) + cargoRevenue
          s.curMonth.cargoCoachKg = (s.curMonth.cargoCoachKg ?? 0) + cargoKg
        }
      }
    }

    // costs (attached buses: the owner bears fuel, tolls, crew and upkeep -
    // we pay the owner their revenue share and keep the channel margin)
    let fuelCost = 0
    let tollCost = 0
    let bata = 0
    let fuelNote = ''
    if (!attached) {
      if (model.electric) {
        fuelCost = Math.round(route.km * BAL.electricCostPerKm)
      } else {
        const skill = crew.drivers.length > 0
          ? crew.drivers.reduce((a, d) => a + d.skill, 0) / crew.drivers.length
          : 5
        const fv = BAL.fuelVariance
        const style = crew.drivers.some((d) => d.drivingStyle === 'aggressive')
          ? fv.aggressiveKmpl
          : crew.drivers.some((d) => d.drivingStyle === 'cautious')
            ? fv.cautiousKmpl
            : fv.normalKmpl
        const skillNudge = 1 + (skill - 5) * fv.skillSoft
        const govFactor = s.config?.speedGovernor === 'eco' ? 1.06 : s.config?.speedGovernor === 'express' ? 0.92 : 1.0
        const ecoKmplMult = ecoActive ? BAL.ecoDriving.mileageBonusMult : 1.0
        const kmplFactor = rJitter(rng, style * skillNudge * govFactor * ecoKmplMult, fv.jitter)
        const loadFactor = isCargo
          ? cargoKg / Math.max(1, model.cargoCapKg || 1)
          : pax / Math.max(1, cap)
        let litres = fuelLitresForRun(model.mileage, route.km, Boolean(model.ac), isCargo, loadFactor, kmplFactor)
        if (kmplFactor < fv.bunkBelow && rChance(rng, fv.shortfallBunkChance)) {
          litres *= 1 + fv.bunkSurcharge
          fuelNote = 'Fuel shortfall — roadside bunk. '
        }
        if (hasDetour) {
          litres *= 1.12
          fuelNote += 'Bridge detour (+12% fuel). '
        }

        // Commercial Fuel: Depot Yard Tank vs OMC Fleet Card
        const originCity = trip.direction === 'AB' ? route.from : route.to
        const busAtHome = originCity === s.company.homeCityId || (bus.parkedCityId ?? originCity) === s.company.homeCityId
        const hasYardTank = busAtHome && s.company.depotFuelTank?.installed && (s.company.depotFuelTank.litres ?? 0) > 0
        let drawnFromDepot = 0
        if (hasYardTank && s.company.depotFuelTank) {
          drawnFromDepot = Math.min(litres, s.company.depotFuelTank.litres)
          s.company.depotFuelTank.litres = Math.max(0, Math.round((s.company.depotFuelTank.litres - drawnFromDepot) * 10) / 10)
        }
        const wholesalePaise = Math.max(rs(70), s.world.dieselPaise - BAL.fuelCommercial.wholesaleDiscountPerLitre)
        const depotCost = Math.round(drawnFromDepot * wholesalePaise)
        const roadsideLitres = Math.max(0, litres - drawnFromDepot)
        const roadsideCost = Math.round(roadsideLitres * s.world.dieselPaise)
        fuelCost = depotCost + roadsideCost

        const realised = litres > 0 ? route.km / litres : model.mileage
        fuelNote = `${realised.toFixed(1)} km/l · ${Math.round(litres)} L. ` + fuelNote
        if (drawnFromDepot > 0) {
          fuelNote += `[Depot Tank: ${Math.round(drawnFromDepot)}L @ wholesale -₹4/L] `
        }

        // OMC Fleet Card Partner (cashback + adulteration immunity)
        const partner = s.company.fuelContract?.active ? s.company.fuelContract.partner : 'none'
        const hasFleetCard = partner !== 'none'
        if (hasFleetCard && roadsideCost > 0) {
          const rebate = Math.round((roadsideCost * BAL.fuelCommercial.fleetCardRebateBps) / 10000)
          s.company.fuelCashbackAccrued = (s.company.fuelCashbackAccrued ?? 0) + rebate
          fuelNote += `[${partner.toUpperCase()} Fleet Card -2.5% Rebate] `
        }

        // Adulteration roll (only applies if roadside fuel was bought without an OMC fleet card partner)
        if (roadsideLitres > 0 && !hasFleetCard && s.world.adulterationUntilDay && s.world.adulterationUntilDay >= s.day) {
          if (rChance(rng, 0.40)) {
            bus.condition.engine = Math.max(5, bus.condition.engine - 5)
            pushLog(s, 'alert', `ADULTERATED DIESEL: ${bus.reg} fueled at ${s.world.adulterationBunk ?? 'local highway bunk'} — engine condition degraded -5 pts.`)
          }
        }
        spend(s, 'adblue', Math.round(fuelCost * BAL.adbluePctOfFuel), refs)
      }
      spend(s, 'fuel', fuelCost, refs)
      tollCost = Math.round(route.km * route.tollPerKm)
      spend(s, 'toll', tollCost, refs)
      if (route.interstate) spend(s, 'border_tax', route.borderTaxPerTrip, refs)
      const driversOnTrip = crew.drivers.filter((d) => driverOnDuty(s, d))
      const conductorOnTrip = crew.conductor && driverOnDuty(s, crew.conductor) ? crew.conductor : undefined
      bata = driverBataForKm(route.km) * driversOnTrip.length + (conductorOnTrip ? BAL.conductorBata : 0)
      if (!s.config?.mealAllowance) {
        spend(s, 'bata', bata, refs)
      } else {
        bata = 0
      }
      if (ecoActive && driversOnTrip.length > 0) {
        const ecoBonus = BAL.ecoDriving.bataBonusPerDriver * driversOnTrip.length
        spend(s, 'driver_incentive', ecoBonus, { ...refs, note: 'Eco-driving & safety mileage bonus' })
      }
      spend(s, 'parking_cleaning', BAL.parkingCleaningPerTrip, refs)
    }

    // In-cabin passenger amenities direct cost
    let tripAmenitiesCost = 0
    const sch = s.schedules[trip.scheduleId]
    const amenities = sch ? resolvedAmenities(s, sch) : (s.company.defaultAmenities ?? {})
    if (!isCargo && pax > 0) {
      tripAmenitiesCost = tripAmenityCost(amenities as Record<string, boolean>, pax, trip.depHour)
      if (tripAmenitiesCost > 0) {
        spend(s, 'passenger_amenities', tripAmenitiesCost, { ...refs, note: 'In-cabin passenger amenities' })
      }
    }
    trip.amenitiesCost = tripAmenitiesCost
    // Attached owner cash settles after risk rolls (breakdown may refund tickets).

    // ---- risk rolls ----
    const avgDriverSkill = crew.drivers.length > 0 ? crew.drivers.reduce((a, d) => a + (d.skill ?? 5), 0) / crew.drivers.length : 5
    const avgSafety = crew.drivers.length > 0 ? crew.drivers.reduce((a, d) => a + (d.safety ?? 5), 0) / crew.drivers.length : 5
    const maxFatigue = crew.drivers.length > 0 ? Math.max(...crew.drivers.map((d) => d.fatigue)) : 30

    let delay = Math.max(0, rJitter(rng, BAL.delayBaseMin, 1))
    if (monsoon) delay += rJitter(rng, BAL.delayMonsoonExtra, 0.8)
    if (route.ghat) delay += rJitter(rng, BAL.delayGhatExtra, 0.8)
    delay += Math.max(0, (60 - bus.condition.engine) * 0.6)
    delay *= 1 - (avgDriverSkill - 5) * 0.03
    if (s.world.roadWidened?.includes(route.id)) {
      delay = Math.max(0, delay - 15)
    }
    if (hasDetour) {
      delay += 45
    }
    if (bus.gpsDeviceFitted) {
      delay *= 0.85
    } else if (s.world.expressways?.includes(route.id)) {
      spend(s, 'fine', BAL.gpsMissingExpresswayFine, { ...refs, note: 'Expressway AIS-140 GPS missing fine' })
      pushLog(s, 'alert', `HIGHWAY PATROL FINE: ${bus.reg} intercepted on ${routeName(route.id)} expressway without mandatory AIS-140 GPS. Fined ${fmtCompact(BAL.gpsMissingExpresswayFine)}.`)
    }

    // Interstate check-post: delay / challan / settle / cargo hold.
    let checkNote = ''
    if (!attached && route.interstate && rChance(rng, BAL.checkPost.stopChance)) {
      const cp = BAL.checkPost
      delay += rInt(rng, cp.delayMin[0], cp.delayMin[1])
      if (rChance(rng, cp.challanChance)) {
        spend(s, 'fine', cp.challanFine, { ...refs, note: 'check-post challan' })
        checkNote = `Check-post challan ${fmtCompact(cp.challanFine)}. `
      } else if (rChance(rng, cp.settleChance)) {
        spend(s, 'fine', cp.settleCost, { ...refs, note: 'check-post settle' })
        checkNote = 'Check-post settle. '
      } else {
        checkNote = 'Check-post stop. '
      }
      if (cargoRevenue > 0 && rChance(rng, cp.cargoHoldChance)) {
        const lost = Math.round(cargoRevenue * cp.cargoHoldShare)
        spend(s, 'fine', lost, { ...refs, note: 'cargo hold at check-post' })
        const keep = cargoRevenue > 0 ? Math.max(0, cargoRevenue - lost) / cargoRevenue : 0
        cargoRevenue = Math.max(0, cargoRevenue - lost)
        cargoContractRevenue = Math.round(cargoContractRevenue * keep)
        cargoSpotRevenue = Math.round(cargoSpotRevenue * keep)
        cargoWalkupRevenue = Math.round(cargoWalkupRevenue * keep)
        checkNote += 'Cargo held. '
      }
    }

    // Road tax check at checkpost / RTO inspection: unpaid road tax past grace period risks impoundment
    const roadTaxDelinquent = !attached && (bus.roadTaxPayableDay !== undefined) && (s.day > bus.roadTaxPayableDay + BAL.roadTaxGraceDays)
    if (roadTaxDelinquent && (route.interstate || rChance(rng, 0.2))) {
      if (rChance(rng, 0.35)) {
        bus.status = 'grounded'
        spend(s, 'fine', BAL.challanFine, { ...refs, note: 'RTO checkpost impound fine' })
        pushLog(s, 'alert', `CHECKPOST IMPOUND: ${bus.reg} was SEIZED & IMPOUNDED at the RTO checkpost for unpaid annual road tax! A ₹12,000 challan was issued. Bus is grounded until road tax is paid.`)
        delay += 360
        checkNote += 'Bus seized & impounded for tax default! '
      } else {
        spend(s, 'fine', BAL.checkPost.challanFine, { ...refs, note: 'RTO checkpost tax default challan' })
        checkNote += 'RTO tax default challan. '
      }
    }

    const breakdown = rChance(rng, breakdownChance(bus, crew.drivers))
    let accidentP = BAL.accidentBase
    const night = trip.depHour >= 19 || trip.depHour <= 4
    if (night) accidentP *= BAL.accidentNightMult
    if (monsoon) accidentP *= BAL.accidentMonsoonMult
    if (route.ghat) accidentP *= BAL.accidentGhatMult
    accidentP *= 1 + Math.max(0, (6 - avgSafety)) * 0.25
    if (maxFatigue > BAL.fatigueAccidentThreshold) accidentP *= 2.2
    if (bus.condition.brakes < 50) accidentP *= 1.8
    if (crew.drivers.some((d) => d.drivingStyle === 'aggressive')) accidentP *= 1.20
    else if (crew.drivers.some((d) => d.drivingStyle === 'cautious')) accidentP *= 0.60
    const accident = rChance(rng, accidentP)

    let note = fuelNote + checkNote
    let reliefDispatched = false
    if (breakdown) {
      // the weakest subsystem is the one that failed
      let worst: (typeof SUBSYSTEMS)[number] = 'engine'
      for (const sub of SUBSYSTEMS) if (bus.condition[sub] < bus.condition[worst]) worst = sub

      // Relief Coach Dispatch: check for idle spare bus located nearby or at depot
      const originCity = trip.direction === 'AB' ? route.from : route.to
      const destCity = trip.direction === 'AB' ? route.to : route.from
      const targetCities = new Set([bus.parkedCityId ?? s.company.homeCityId, originCity, destCity, s.company.homeCityId])
      const reliefBus = reliefPool.find(
        (b) => b.id !== bus.id
          && b.status === 'active'
          && b.condition.engine >= 65
          && !b.outsideGarage
          && !committedToday.has(b.id)
          && targetCities.has(b.parkedCityId ?? s.company.homeCityId),
      )

      if (reliefBus) {
        reliefDispatched = true
        delay += rInt(rng, 45, 75)
        if (!ownerPaysService(bus)) spend(s, 'maintenance', Math.round(BAL.breakdownRescueCost * 0.6), refs)
        const refund = Math.round(trip.revenue * 0.15)
        if (refund > 0) {
          spend(s, 'refund', refund, { ...refs, note: `breakdown relief partial refund (${worst})`, refundCategory: 'busCancel' })
          if (attached && bus.attach) {
            reverseAttachOwnerShare(s, refund, bus.attach.ownerShare, refs)
          }
        }
        bus.condition[worst] = Math.max(5, bus.condition[worst] - 18)
        bus.status = 'workshop'
        bus.workshopUntilDay = s.day + rInt(rng, 1, 3)
        bus.workshopJob = `breakdown: ${worst}`
        tryCoverBus(s, bus.id)
        note = `BREAKDOWN en route (${worst}). Relief coach ${reliefBus.reg} dispatched from ${cityName(reliefBus.parkedCityId ?? s.company.homeCityId)}! Delay limited to ${Math.round(delay)}m, ${fmtCompact(refund)} partial refund.`
        pushLog(s, 'good', `RELIEF COACH DISPATCHED: Idle bus ${reliefBus.reg} rescued stranded passengers on ${routeName(route.id)} (${bus.reg}). Delay contained to ${Math.round(delay)}m!`)
      } else {
        delay += rInt(rng, 120, 400)
        if (!ownerPaysService(bus)) spend(s, 'maintenance', BAL.breakdownRescueCost, refs)
        const refund = Math.round(trip.revenue * BAL.breakdownRefundShare)
        spend(s, 'refund', refund, { ...refs, note: `breakdown refund (${worst})`, refundCategory: 'busCancel' })
        if (attached && bus.attach && refund > 0) {
          reverseAttachOwnerShare(s, refund, bus.attach.ownerShare, refs)
        }
        bus.condition[worst] = Math.max(5, bus.condition[worst] - 18)
        bus.status = 'workshop'
        bus.workshopUntilDay = s.day + rInt(rng, 1, 3)
        bus.workshopJob = `breakdown: ${worst}`
        tryCoverBus(s, bus.id)
        note = `BREAKDOWN en route (${worst}). Rescue ${fmtCompact(BAL.breakdownRescueCost)}, ${fmtCompact(refund)} refunded.`
        pushLog(s, 'alert', `${bus.reg} broke down on ${routeName(route.id)} - ${note}`)
      }

      // Fragile cargo damage liability claim during breakdown
      if (cargoKg > 0 && s.company.cargoAcceptFragile && rChance(rng, 0.4)) {
        const claimCost = rInt(rng, BAL.fragileLiabilityMin, BAL.fragileLiabilityMax)
        cargoLiability += claimCost
        spend(s, 'cargo_liability', claimCost, { ...refs, note: 'fragile cargo damage during breakdown' })
        note += ` Fragile cargo damaged (${fmtCompact(claimCost)} liability).`
      }
    }

    // Pay attached owner cash for tickets still on the trip (P&L accrued at sale;
    // breakdown refunds above already reversed that slice of the payable).
    if (attached && bus.attach) {
      const refunded = breakdown ? Math.round(trip.revenue * BAL.breakdownRefundShare) : 0
      settleAttachOwnerCash(s, Math.max(0, trip.revenue - refunded), bus.attach.ownerShare, refs)
    }

    if (accident) {
      s.company.safeTripStreak = 0
      if (!ownerPaysService(bus)) spend(s, 'maintenance', BAL.accidentDeductible, { ...refs, note: 'accident insurance deductible' })
      let downtime = rInt(rng, BAL.accidentDowntimeDays[0], BAL.accidentDowntimeDays[1])
      if (s.config?.healthCoverage) {
        downtime = Math.max(1, Math.round(downtime * 0.70))
      }
      bus.status = 'workshop'
      bus.workshopUntilDay = s.day + downtime
      bus.workshopJob = 'accident repair (insurance claim)'
      tryCoverBus(s, bus.id)
      bus.accidentHistory = true
      bus.condition.body = Math.max(10, bus.condition.body - 30)
      for (const d of crew.drivers) {
        if (!d.safetyRecord) d.safetyRecord = { accidents: 0, hardBrakes: 0, violations: 0 }
        d.safetyRecord.accidents += 1
      }
      if (!ownerPaysService(bus)) {
        const estimate = Math.round(BAL.accidentDeductible * 3.5 + downtime * 8_000)
        fileAccidentClaim(s, bus.id, estimate, trip.id)
      }
      const hr = hrOnDuty(s)
      const ops = opsOnDuty(s)
      const accidentMoraleHit = hr && ops ? 6 : hr || ops ? 12 : 20
      for (const d of crew.drivers) d.morale = Math.max(0, d.morale - accidentMoraleHit)
      note += ` ACCIDENT - ${downtime} days in body shop, rating hit.`
      // Fragile cargo damage liability claim during accident
      if (cargoKg > 0 && s.company.cargoAcceptFragile && rChance(rng, 0.75)) {
        const claimCost = rInt(rng, BAL.fragileLiabilityMin, BAL.fragileLiabilityMax)
        cargoLiability += claimCost
        spend(s, 'cargo_liability', claimCost, { ...refs, note: 'fragile cargo destroyed in accident' })
        note += ` Fragile cargo destroyed (${fmtCompact(claimCost)} liability).`
      }
      pushLog(s, 'alert', `ACCIDENT: ${bus.reg} on ${routeName(route.id)}. Deductible ${fmtCompact(BAL.accidentDeductible)}, ${downtime} days downtime. Company rating -${BAL.accidentRatingHit.toFixed(2)}.`)
    } else {
      s.company.safeTripStreak = (s.company.safeTripStreak ?? 0) + 1
    }

    // wear & fatigue + rest-law streak
    applyWear(s, bus, route.km)
    const nDrv = Math.max(1, crew.drivers.length)
    const isNightDep = trip.depHour >= 21 || trip.depHour < 6
    for (const d of crew.drivers) {
      const cur = Number(d.fatigue) || 0
      d.fatigue = Math.min(100, cur + (BAL.fatiguePerTripHour * route.hours) / nDrv)
      if (d.lastTripDay === s.day - 1) d.consecutiveDutyDays = (d.consecutiveDutyDays ?? 1) + 1
      else d.consecutiveDutyDays = 1
      d.lastTripDay = s.day

      if (!d.safetyRecord) d.safetyRecord = { accidents: 0, hardBrakes: 0, violations: 0 }
      d.cmvrHoursToday = (d.cmvrHoursToday ?? 0) + hoursPerDriver
      d.tripsDriven = (d.tripsDriven ?? 0) + 1

      if (isNightDep) {
        d.nightRestUntilDay = s.day + 1
        d.nightRestUntilHour = BAL.cmvrNightRestUntilHour
      }

      const hardBrakeChance = d.drivingStyle === 'aggressive' ? 0.08 : d.drivingStyle === 'cautious' ? 0.005 : 0.02
      if (rChance(rng, hardBrakeChance)) {
        d.safetyRecord.hardBrakes += 1
      }
    }

    if (crew.conductor) {
      const cond = crew.conductor
      const curC = Number(cond.fatigue) || 0
      cond.fatigue = Math.min(100, curC + (BAL.fatiguePerTripHour * route.hours) * 0.7)
      if (cond.lastTripDay === s.day - 1) cond.consecutiveDutyDays = (cond.consecutiveDutyDays ?? 1) + 1
      else cond.consecutiveDutyDays = 1
      cond.lastTripDay = s.day

      // Conductors also undergo rest periods, but not as often as drivers
      // Triggers on: demanding night haul (>=10h), high fatigue (>=60%), or ~35% chance on night departure
      const condNeedsRest = isNightDep && (route.hours >= 10 || cond.fatigue >= 60 || rChance(rng, 0.35))
      if (condNeedsRest) {
        cond.nightRestUntilDay = s.day + 1
        cond.nightRestUntilHour = BAL.cmvrNightRestUntilHour
      }
    }

    let tripPss = 10
    let review = 0

    if (!isCargo) {
      // Cleanliness degradation per trip (5-15 points depending on trip length & load)
      if (bus.busCleanliness === undefined) bus.busCleanliness = 85
      const cleanLoss = Math.round(5 + (route.km / 200) * 1.5 + (pax / cap) * 3)
      bus.busCleanliness = Math.max(0, bus.busCleanliness - cleanLoss)

      // Terminus turnaround cleaning (supervised by assigned conductor)
      const condSkill = crew.conductor ? crew.conductor.skill : 0
      const condTarget = conductorCleanlinessTarget(condSkill)
      if (condSkill >= 5) {
        // Skilled conductor ensures turnaround cleaning restores cabin towards their maintained standard
        if (bus.busCleanliness < condTarget) {
          spend(s, 'cleaning', BAL.terminusCleanCost, { busId: bus.id, tripId: trip.id, note: 'terminus turnaround cleaning' })
          bus.busCleanliness = Math.min(condTarget, bus.busCleanliness + 30)
        }
      } else {
        // Conductor skill <= 4 or no conductor: poor/sloppy turnaround upkeep, cleanliness drops
        if (bus.busCleanliness < 45) {
          spend(s, 'cleaning', BAL.terminusCleanCost, { busId: bus.id, tripId: trip.id, note: 'basic terminal broom sweep' })
          bus.busCleanliness = Math.min(45, bus.busCleanliness + 10)
        }
      }

      // Low cleanliness penalty: rating -0.1 per trip if < 40
      if (bus.busCleanliness < 40) {
        s.company.rating = Math.max(1, s.company.rating - 0.1)
        if (busGroup) busGroup.rating = Math.max(1, busGroup.rating - 0.1)
        pushLog(s, 'alert', `${bus.reg}: Cabin cleanliness critically low (${bus.busCleanliness}/100) — RedBus marked coach "Review Needed". Rating hit -0.1.`)
      }

      // PSS (Passenger Satisfaction Score 0-10) Calculation
      // Parts sum to exactly 1.0 (100%):
      // 1. On-time departure & arrival (20%): Full score (10) if delay <= 10m
      const onTimeScore = (delay <= 10 ? 10 : Math.max(0, 10 - (delay - 10) / 6)) * 0.20
      // 2. Journey time vs scheduled duration (15%): actual vs route.hours
      const schedHours = route.hours * (s.world.roadWidened?.includes(route.id) ? 0.95 : 1.0)
      const actualHours = schedHours + delay / 60
      const journeyRatio = actualHours / schedHours
      const journeyScore = (journeyRatio <= 1.05 ? 10 : Math.max(0, 10 - (journeyRatio - 1.05) * 20)) * 0.15
      // 3. AC working condition (15%): from condition.ac
      const acScore = (model.ac ? Math.min(10, bus.condition.ac / 10) : 10) * 0.15
      // 4. Cleanliness (10%): from busCleanliness
      const cleanScore = (Math.min(10, (bus.busCleanliness ?? 85) / 10)) * 0.10
      // 5. Driver behaviour & safety (15%): style + staff safety record
      let drvScore = avgSafety
      for (const d of crew.drivers) {
        if (d.drivingStyle === 'aggressive') drvScore -= 2.0
        else if (d.drivingStyle === 'cautious') drvScore += 1.0
      }
      const driverScore = Math.max(0, Math.min(10, drvScore)) * 0.15
      // 6. Boarding points (10%): min(10, boardingPoints) / 10
      const sch = s.schedules[trip.scheduleId]
      const boardingPoints = sch?.boardingPoints ?? 3
      const boardingScore = (Math.min(10, boardingPoints) / 10) * 10 * 0.10
      // 7. Conductor service (15%): conductor skill
      const condScore = (crew.conductor ? crew.conductor.skill : 3.0) * 0.15

      tripPss = Math.max(1, Math.min(10, onTimeScore + journeyScore + acScore + cleanScore + driverScore + boardingScore + condScore))
      // 8. Seat refurbishment (FM-03): cushions, armrests and footrests lift the cabin
      const seatBonus = ((bus.comfortBonus ?? 0) / BAL.refurb.seatRefurbComfortBonus) * BAL.refurb.seatRefurbPssMax
      if (seatBonus > 0) tripPss = Math.min(10, tripPss + seatBonus)

      // 9. In-cabin passenger amenities & tech retrofits
      let amenitiesBonus =
        tripAmenityPssBonus(amenities as Record<string, boolean>, trip.depHour)
        + missingBeddingPenalty(amenities as Record<string, boolean>, trip.depHour, !!model.sleeper)
        + busFittingsPssBonus(bus)
      if (amenitiesBonus !== 0) tripPss = Math.max(1, Math.min(10, tripPss + amenitiesBonus))

      if (breakdown) tripPss = reliefDispatched ? Math.max(1, tripPss - 1.2) : Math.max(1, tripPss - 3.5)
      if (accident) tripPss = Math.max(1, tripPss - 4.5)
      tripPss = Math.round(tripPss * 10) / 10

      // Directly blend trip PSS into overall company rating (tripPss / 2 = 1-5 scale) without holding 30-day history arrays
      const targetRating = tripPss / 2
      s.company.rating = Math.max(1, Math.min(5, Math.round((s.company.rating * 0.95 + targetRating * 0.05) * 100) / 100))

      if (busGroup) {
        busGroup.rating = Math.max(1, Math.min(5, Math.round((busGroup.rating * 0.95 + targetRating * 0.05) * 100) / 100))
      }

      // Celebrity passenger event check: sleeper trip completed on time with no breakdown
      if (s.world.celebrityDay === s.day && model.sleeper && !breakdown && delay < 15) {
        s.company.reputation = Math.min(100, (s.company.reputation ?? 0) + 5)
        s.world.celebrityDay = undefined
        pushLog(s, 'good', `CELEBRITY PASSENGER on ${bus.reg} (${routeName(route.id)}) praised your sleeper coach on social media! Company Reputation +5.`)
      }

      // Roll 0-3 grievance or compliment events for this completed trip
      recordTripGrievanceOrCompliment(
        s,
        trip,
        bus,
        route,
        tripPss,
        delay,
        cleanScore,
        acScore,
        driverScore,
        condScore,
        crew,
        rng,
      )

      review = tripPss / 2
      review = Math.max(0.5, Math.min(5, rJitter(rng, review, 0.08)))

      const reviewers = Math.round(pax * BAL.reviewShare)
      if (reviewers > 0) {
        s.company.ratingCount += reviewers
        if (busGroup) {
          busGroup.ratingCount = (busGroup.ratingCount ?? 0) + reviewers
        }
      }
      bus.qualityScore = Math.max(1, Math.min(5, bus.qualityScore * 0.98 + review * 0.02))

      // reputation & brand
      s.company.reputation = Math.min(100, s.company.reputation + BAL.reputationPerTrip + Math.max(0, s.company.rating - 3.5) * BAL.reputationPerTrip * 2)
      s.company.brandAwareness = Math.min(1, s.company.brandAwareness + pax / 400_000)
    }

    // punctuality
    const onTime = delay <= BAL.punctualityThresholdMin && !breakdown
    s.company.punctuality = s.company.punctuality * 0.97 + (onTime ? 1 : 0) * 0.03
    s.company.cancelRate = s.company.cancelRate * 0.995
    if (busGroup) {
      busGroup.cancelRate = (busGroup.cancelRate ?? 0) * 0.995
    }

    // stats (skip corridors already discontinued)
    const seatKm = cap * route.km
    const paxKm = pax * route.km
    s.curMonth.trips++
    s.curMonth.seatKm += seatKm
    s.curMonth.paxKm += paxKm
    if (s.permits[route.id]) {
      const rst = (s.routeStats[route.id] ??= { revenue: 0, cost: 0, trips: 0, paxKm: 0, seatKm: 0, byLayout: {}, byBrand: {} })
      if (!rst.byLayout) rst.byLayout = {}
      if (!rst.byBrand) rst.byBrand = {}
      rst.trips++
      rst.paxKm += paxKm
      rst.seatKm += seatKm
      const day = todayRouteDay(s, route.id)
      if (!day.byLayout) day.byLayout = {}
      if (!day.byBrand) day.byBrand = {}
      day.trips++
      day.paxKm += paxKm
      day.seatKm += seatKm
      const brandKey = brandKeyForService(s, { busId: trip.busId, tripId: trip.id, scheduleId: trip.scheduleId })
      const brandLife = (rst.byBrand[brandKey] ??= { revenue: 0, cost: 0, trips: 0, paxKm: 0, seatKm: 0 })
      brandLife.trips++
      brandLife.paxKm += paxKm
      brandLife.seatKm += seatKm
      const brandDay = (day.byBrand[brandKey] ??= { revenue: 0, cost: 0, trips: 0, paxKm: 0, seatKm: 0 })
      brandDay.trips++
      brandDay.paxKm += paxKm
      brandDay.seatKm += seatKm
      const addLay = (key: string, trips: number, pax: number, seats: number) => {
        const lay = (rst.byLayout[key] ??= { revenue: 0, cost: 0, trips: 0, paxKm: 0, seatKm: 0 })
        lay.trips += trips
        lay.paxKm += pax
        lay.seatKm += seats
        const dLay = (day.byLayout[key] ??= { revenue: 0, cost: 0, trips: 0, paxKm: 0, seatKm: 0 })
        dLay.trips += trips
        dLay.paxKm += pax
        dLay.seatKm += seats
      }
      const hybrid = hybridClassStats(trip, model)
      if (hybrid) {
        trip.hybridSnapshot = {
          sleeper: { cap: hybrid.sleeper.cap, sold: hybrid.sleeper.sold, listed: hybrid.sleeper.listed, paidAvg: hybrid.sleeper.paidAvg },
          seater: { cap: hybrid.seater.cap, sold: hybrid.seater.sold, listed: hybrid.seater.listed, paidAvg: hybrid.seater.paidAvg },
        }
        addLay(layoutKeyForZone(bus.modelId, 'sleeper'), 1, hybrid.sleeper.sold * route.km, hybrid.sleeper.cap * route.km)
        addLay(layoutKeyForZone(bus.modelId, 'semi'), 1, hybrid.seater.sold * route.km, hybrid.seater.cap * route.km)
      } else {
        const parts = layoutShares(bus.modelId)
        if (parts.length > 1) {
          let leftPax = paxKm
          let leftSeat = seatKm
          for (let i = 0; i < parts.length; i++) {
            const last = i === parts.length - 1
            const p = last ? leftPax : Math.round(paxKm * parts[i]!.share)
            const sk = last ? leftSeat : Math.round(seatKm * parts[i]!.share)
            leftPax -= p
            leftSeat -= sk
            addLay(parts[i]!.key, 1, p, sk)
          }
        } else {
          addLay(parts[0]!.key, 1, paxKm, seatKm)
        }
      }
    }

    if (!attached && cargoPool) {
      recordCargoLane(s, route.id, trip.direction, s.day, {
        trips: 1,
        cargoOnlyTrips: isCargo ? 1 : 0,
        kg: cargoKg,
        cargoOnlyKg: isCargo ? cargoKg : 0,
        capKg: effectiveCapKg,
        marketKg: cargoPool.state.parcelMarketKg + cargoPool.state.bulkMarketKg,
        bookKg: cargoPool.state.parcelBookKg + cargoPool.state.bulkBookKg,
        revenue: cargoRevenue,
        contractKg: cargoContractKg,
        spotKg: cargoSpotKg,
        walkupKg: cargoWalkupKg,
        contractRevenue: cargoContractRevenue,
        spotRevenue: cargoSpotRevenue,
        walkupRevenue: cargoWalkupRevenue,
        loading: cargoLoading,
        unloading: cargoUnloading,
        liability: cargoLiability,
        fuel: isCargo ? fuelCost : 0,
        toll: isCargo ? tollCost : 0,
        bata: isCargo ? bata : 0,
      })
    }

    bus.lifeTrips++
    {
      const destCity = trip.direction === 'AB' ? route.to : route.from
      const originCity = trip.direction === 'AB' ? route.from : route.to
      const depAbs = trip.day * 1440 + trip.depHour * 60 + (trip.depMin ?? 0)
      const arrAbs = depAbs + Math.round(route.hours * 60) + Math.round(delay)
      const arrDay = Math.floor(arrAbs / 1440)
      // Only true long hauls (still on the road a full calendar day after departure).
      // Overnight short/mid trips park at the destination immediately.
      const longHaul = route.hours > 18 && arrDay >= trip.day + 2
      if (longHaul && arrDay > s.day) {
        bus.inTransitFromCityId = originCity
        bus.inTransitToCityId = destCity
        bus.inTransitUntilDay = arrDay
        if (!bus.parkedCityId) bus.parkedCityId = originCity
      } else {
        bus.parkedCityId = destCity
        bus.inTransitUntilDay = undefined
        bus.inTransitToCityId = undefined
        bus.inTransitFromCityId = undefined
      }
    }
    trip.status = 'completed'
    trip.outcome = {
      delayMin: Math.round(delay),
      breakdown,
      accident,
      fuelCost,
      tollCost,
      tripCosts: fuelCost + tollCost + bata + tripAmenitiesCost,
      amenitiesCost: tripAmenitiesCost > 0 ? tripAmenitiesCost : undefined,
      reliefDispatched: reliefDispatched || undefined,
      ecoBonusPaid: ecoActive || undefined,
      cargoRevenue,
      cargoKg,
      cargoCapKg: effectiveCapKg,
      cargoContractKg,
      cargoSpotKg,
      cargoWalkupKg,
      reviewScore: Math.round(review * 10) / 10,
      pss: tripPss,
      note: note
        || (trip.pairEmptyDepart ? 'Departed empty (1st trip late — passengers stranded).'
          : isCargo ? (onTime ? 'Cargo delivery on time.' : `Cargo reached ${Math.round(delay)} min late.`)
          : onTime ? 'On time.' : `Reached ${Math.round(delay)} min late.`),
    }
    const occCap = isCargo ? (BUS_MODELS[bus.modelId]?.cargoCapKg ?? 0) : cap
    const occSold = isCargo ? cargoKg : trip.sold
    recordScheduleOcc(s, trip.scheduleId, trip.day, occSold, occCap, trip.direction, trip.depHour, trip.depMin)

    if (isSeasonalTrip(s, trip)) {
      const adblueCost = attached ? 0 : Math.round(fuelCost * BAL.adbluePctOfFuel)
      const borderTaxCost = (!attached && route.interstate) ? route.borderTaxPerTrip : 0
      const parkingCleaning = attached ? 0 : BAL.parkingCleaningPerTrip
      const attachedOwnerShare = attached ? Math.round(trip.revenue * (bus.attach?.ownerShare ?? 0)) : 0
      recordSeasonalTripRun(
        s,
        trip,
        bus,
        route,
        pax,
        cap,
        fuelCost,
        tollCost,
        bata,
        cargoRevenue,
        adblueCost,
        borderTaxCost,
        parkingCleaning,
        attachedOwnerShare,
      )
    }

    // Pair coupling: slip or strand the 2nd trip after 1st-trip delay is known.
    if (s.schedules[trip.scheduleId]?.paired) {
      if (breakdown || accident) {
        cancelPairedReturn(s, trip, breakdown ? '1st trip breakdown' : '1st trip accident', pairIndex)
      } else {
        applyOutboundDelayToPair(s, trip, route, delay, pairIndex)
      }
    }
  }

  // retire past trips from the open list; keep a short history for the UI
  s.openTripIds = s.openTripIds.filter((id) => {
    const t = s.trips[id]
    return t !== undefined && (t.status === 'open' || t.day >= s.day - BAL.completedTripKeepDays)
  })
  const cutoff = s.day - BAL.completedTripKeepDays
  for (const [id, t] of Object.entries(s.trips)) {
    if (t.status === 'open') continue
    if (t.day < cutoff) {
      delete s.trips[id]
      continue
    }
    // drop seat maps on finished trips — they dominate save size at 30+ buses
    if (t.seats.length > 0 || t.seatSales?.length) {
      if (!t.seatCount) t.seatCount = t.seats.length
      if (!t.hybridSnapshot) {
        const b = s.buses[t.busId]
        const m = b ? BUS_MODELS[b.modelId] : undefined
        const h = hybridClassStats(t, m)
        if (h) {
          t.hybridSnapshot = {
            sleeper: { cap: h.sleeper.cap, sold: h.sleeper.sold, listed: h.sleeper.listed, paidAvg: h.sleeper.paidAvg },
            seater: { cap: h.seater.cap, sold: h.seater.sold, listed: h.seater.listed, paidAvg: h.seater.paidAvg },
          }
        }
      }
      t.seats = []
      delete t.seatSales
    }
  }

  return { departed, pax: paxTotal, seats: seatsTotal }
}
