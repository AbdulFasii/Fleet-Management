/**
 * World dynamics (diesel walk, competitor fare drift) and the random
 * event deck: shocks, crackdowns, closures, price wars, windfalls.
 * Also resolves player decisions raised by any system.
 */
import { BAL } from '../data/balance'
import { ROUTE_LIST, ROUTES, routeName, RIVALS } from '../data/routes'
import { BUS_MODELS, modelTitle } from '../data/busModels'
import { seasonInfo } from '../core/calendar'
import { fmtCompact, rs } from '../core/money'
import { nextId } from '../core/ids'
import { rngFor, rChance, rInt, rPick, rJitter, type Rng } from '../core/rng'
import type { GameState, ID } from '../types'
import { spend, earn, canAfford } from './finance'
import { dailyCheckpostPass } from './checkpost'
import { buyLot } from './eventFleet'
import { DISTRESS_EVENTS, applyDistressDecision } from './eventsDistress'
import { pushLog } from './log'
import { ownerPaysService, serviceDueKm } from './maintenance'
import { accountantOnDuty, hrOnDuty, scheduleManagerOnDuty } from './staffing'
import { acceptSpotCargoOffer } from './cargo'
import { createCharterInquiry, calculateCharterQuote, executeCharterContract } from './festival'

/** Daily drift of the outside world. */
import { dailyRivalPass } from './rivals'

export function dailyWorldPass(s: GameState): void {
  const rng = rngFor(s.seed, 'world', s.day)
  const w = s.world

  // diesel random walk
  w.dieselPaise = Math.round(
    Math.max(BAL.dieselMin, Math.min(BAL.dieselMax, w.dieselPaise * (1 + (rng() * 2 - 1) * BAL.dieselWalkSd))),
  )

  // competitor fare drift per route
  for (const r of ROUTE_LIST) {
    const cur = w.fareIndex[r.id] ?? 1
    w.fareIndex[r.id] = Math.max(
      BAL.fareIndexMin,
      Math.min(BAL.fareIndexMax, cur * (1 + (rng() * 2 - 1) * BAL.fareIndexWalkSd)),
    )
  }

  // Daily rival share drift & exit event roll
  dailyRivalPass(s, rng)

  // cleanup expired effects
  for (const [rid, shock] of Object.entries(w.demandShock)) {
    if (shock.untilDay < s.day) delete w.demandShock[rid]
  }
  for (const [rid, c] of Object.entries(w.closures)) {
    if (c.untilDay < s.day) {
      delete w.closures[rid]
      pushLog(s, 'event', `${routeName(rid)} has reopened.`)
    }
  }
  for (const [rid, pw] of Object.entries(w.priceWars)) {
    if (pw.untilDay < s.day) {
      delete w.priceWars[rid]
      pushLog(s, 'event', `The price war on ${routeName(rid)} has fizzled out. Fares are recovering.`)
    }
  }

  // Expressway inauguration countdowns
  if (w.expresswayProposals) {
    for (const [rid, readyDay] of Object.entries(w.expresswayProposals)) {
      if (s.day >= readyDay) {
        if (!w.expressways.includes(rid)) w.expressways.push(rid)
        delete w.expresswayProposals[rid]
        pushLog(s, 'event', `EXPRESSWAY INAUGURATED on ${routeName(rid)}! Faster transit times now live; mandatory AIS-140 GPS in effect.`)
      }
    }
  }
}

function myActiveRoutes(s: GameState): string[] {
  const set = new Set<string>()
  for (const sch of Object.values(s.schedules)) {
    if (sch.active && sch.busIds.length > 0) set.add(sch.routeId)
  }
  return [...set]
}

export interface EventDef {
  id: string
  weight: number
  canFire: (s: GameState) => boolean
  fire: (s: GameState, rng: Rng) => void
}

export const EVENTS: EventDef[] = [
  {
    id: 'diesel_spike', weight: 10, canFire: () => true,
    fire: (s, rng) => {
      const pct = rInt(rng, 6, 14)
      s.world.dieselPaise = Math.min(BAL.dieselMax, Math.round(s.world.dieselPaise * (1 + pct / 100)))
      pushLog(s, 'event', `OMCs hike diesel ${pct}% after crude rally. Now ${fmtCompact(s.world.dieselPaise)}/litre. Fuel is your biggest cost - consider fares.`)
    },
  },
  {
    id: 'diesel_relief', weight: 6, canFire: () => true,
    fire: (s, rng) => {
      const pct = rInt(rng, 4, 9)
      s.world.dieselPaise = Math.max(BAL.dieselMin, Math.round(s.world.dieselPaise * (1 - pct / 100)))
      pushLog(s, 'event', `Excise duty cut: diesel down ${pct}% to ${fmtCompact(s.world.dieselPaise)}/litre.`)
    },
  },
  {
    id: 'redbus_commission_hike', weight: 4,
    canFire: (s) => s.world.redbusCommissionBps < 1400,
    fire: (s, rng) => {
      const bump = rInt(rng, 50, 150)
      s.world.redbusCommissionBps += bump
      pushLog(s, 'event', `RedBus revises operator terms: commission now ${(s.world.redbusCommissionBps / 100).toFixed(1)}%. Your own app just got more valuable.`)
    },
  },
  {
    id: 'price_war', weight: 8,
    canFire: (s) => myActiveRoutes(s).length > 0,
    fire: (s, rng) => {
      const rid = rPick(rng, myActiveRoutes(s))
      const depth = rInt(rng, 20, 35) / 100
      const days = rInt(rng, 15, 30)
      s.world.priceWars[rid] = { untilDay: s.day + days, depth }
      const rival = rPick(rng, RIVALS[rid] ?? ['A rival'])
      pushLog(s, 'event', `PRICE WAR: ${rival} slashes fares ${Math.round(depth * 100)}% on ${routeName(rid)} for ~${days} days. Match and bleed, or hold fares and lose share.`)
    },
  },
  {
    id: 'rto_crackdown', weight: 6, canFire: (s) => Object.keys(s.buses).length > 0,
    fire: (s, rng) => {
      s.world.rtoCrackdownUntilDay = s.day + 10
      let fines = 0
      for (const bus of Object.values(s.buses)) {
        const lapsed = bus.insuranceExpiryDay < s.day || bus.fitnessExpiryDay < s.day
          || (!ownerPaysService(bus) && serviceDueKm(bus) > 15_000)
        if (lapsed && rChance(rng, 0.7)) {
          spend(s, 'fine', BAL.challanFine, { busId: bus.id, note: 'RTO challan' })
          fines++
        }
      }
      pushLog(s, 'event', `RTO CRACKDOWN on the highways for 10 days.${fines > 0 ? ` ${fines} challan(s) of ${fmtCompact(BAL.challanFine)} issued against your lapsed buses.` : ' Your papers were in order - no fines.'}`)
    },
  },
  {
    id: 'landslide', weight: 7,
    canFire: (s) => seasonInfo(s.day).weatherRisk > 0 && ROUTE_LIST.some((r) => r.ghat),
    fire: (s, rng) => {
      const ghats = ROUTE_LIST.filter((r) => r.ghat)
      const r = rPick(rng, ghats)
      const days = rInt(rng, 3, 7)
      s.world.closures[r.id] = { untilDay: s.day + days, reason: 'monsoon landslide on the ghat section' }
      pushLog(s, 'event', `LANDSLIDE closes ${routeName(r.id)} for ~${days} days. Booked trips will be cancelled with refunds.`)
    },
  },
  {
    id: 'bandh', weight: 5, canFire: () => true,
    fire: (s, rng) => {
      const r = rPick(rng, ROUTE_LIST)
      const days = rInt(rng, 1, 2)
      s.world.closures[r.id] = { untilDay: s.day + days, reason: 'bandh / political shutdown' }
      pushLog(s, 'event', `Bandh called along ${routeName(r.id)} - road traffic suspended ${days} day(s).`)
    },
  },
  {
    id: 'rtc_strike', weight: 6, canFire: (s) => myActiveRoutes(s).length > 0,
    fire: (s, rng) => {
      const rid = rPick(rng, myActiveRoutes(s))
      const days = rInt(rng, 3, 5)
      s.world.demandShock[rid] = { mult: rJitter(rng, 1.55, 0.1), untilDay: s.day + days, reason: 'state RTC strike' }
      pushLog(s, 'event', `STATE RTC ON STRIKE: private demand explodes on ${routeName(rid)} for ~${days} days. Surge while it lasts.`)
    },
  },
  {
    id: 'exam_travel', weight: 5, canFire: (s) => myActiveRoutes(s).length > 0,
    fire: (s, rng) => {
      const rid = rPick(rng, myActiveRoutes(s))
      const days = rInt(rng, 4, 8)
      s.world.demandShock[rid] = { mult: rJitter(rng, 1.35, 0.08), untilDay: s.day + days, reason: 'exam / result travel' }
      pushLog(s, 'event', `EXAM / RESULT WEEK on ${routeName(rid)}: hometown buses fill, but only if the slot and price are right. ~${days} days.`)
    },
  },
  {
    id: 'midweek_slump', weight: 6, canFire: (s) => myActiveRoutes(s).length > 0,
    fire: (s, rng) => {
      const rid = rPick(rng, myActiveRoutes(s))
      const days = rInt(rng, 3, 6)
      s.world.demandShock[rid] = { mult: rJitter(rng, 0.62, 0.08), untilDay: s.day + days, reason: 'midweek slump' }
      pushLog(s, 'event', `DEAD MIDWEEK on ${routeName(rid)} for ~${days} days — office traffic stayed on the train. Cut fares or sit on empty seats.`)
    },
  },
  {
    id: 'ipl_night', weight: 4, canFire: (s) => myActiveRoutes(s).length > 0,
    fire: (s, rng) => {
      const rid = rPick(rng, myActiveRoutes(s))
      const days = rInt(rng, 2, 4)
      s.world.demandShock[rid] = { mult: rJitter(rng, 0.78, 0.06), untilDay: s.day + days, reason: 'IPL night' }
      pushLog(s, 'event', `IPL night(s) empty the ${routeName(rid)} sleeper for ~${days} days. Overnight occupancy will look ugly unless you reprice.`)
    },
  },
  {
    id: 'expressway', weight: 2,
    canFire: (s) => ROUTE_LIST.some((r) => !s.world.expressways.includes(r.id) && r.km > 400),
    fire: (s, rng) => {
      const candidates = ROUTE_LIST.filter((r) => !s.world.expressways.includes(r.id) && r.km > 400)
      const r = rPick(rng, candidates)
      s.world.expressways.push(r.id)
      s.world.demandShock[r.id] = { mult: 1.2, untilDay: s.day + 3650, reason: 'new expressway' }
      pushLog(s, 'event', `NEW EXPRESSWAY inaugurated on ${routeName(r.id)}! Faster trips, permanently higher demand.`)
    },
  },
  {
    id: 'ev_subsidy', weight: 3, canFire: (s) => s.world.evSubsidyUntilDay < s.day,
    fire: (s, rng) => {
      const days = rInt(rng, 60, 90)
      s.world.evSubsidyUntilDay = s.day + days
      pushLog(s, 'event', `FAME-style EV SUBSIDY window open for ~${days} days: 20% off electric buses. ${modelTitle(BUS_MODELS['evolectra']!)} at ${fmtCompact(Math.round(BUS_MODELS['evolectra']!.priceNew * 0.8))}.`)
    },
  },
  {
    id: 'viral_complaint', weight: 5, canFire: (s) => myActiveRoutes(s).length > 0 && s.company.ratingCount > 50,
    fire: (s, rng) => {
      if (s.company.rating >= 4.4 && rChance(rng, 0.5)) {
        s.company.rating = Math.min(5, s.company.rating + 0.1)
        s.company.brandAwareness = Math.min(1, s.company.brandAwareness + 0.05)
        pushLog(s, 'event', `A passenger's thread praising your service went VIRAL. Rating +0.1, brand awareness up.`)
      } else {
        const rid = rPick(rng, myActiveRoutes(s))
        s.company.rating = Math.max(1, s.company.rating - 0.3)
        s.world.demandShock[rid] = { mult: 0.8, untilDay: s.day + 10, reason: 'viral complaint' }
        pushLog(s, 'event', `VIRAL COMPLAINT: video of a rude conductor on ${routeName(rid)} is everywhere. Rating -0.3, demand hit for 10 days. Consider staff training.`)
      }
    },
  },
  {
    id: 'checkpost_inspection',
    weight: 5,
    canFire: () => true,
    fire: (s) => {
      dailyCheckpostPass(s)
      pushLog(s, 'event', 'RTO CHECKPOST INSPECTION: Random inspection blitz conducted across state borders today.')
    },
  },
  {
    id: 'road_widening',
    weight: 4,
    canFire: (s) => ROUTE_LIST.some((r) => !(s.world.roadWidened ?? []).includes(r.id)),
    fire: (s, rng) => {
      const candidates = ROUTE_LIST.filter((r) => !(s.world.roadWidened ?? []).includes(r.id))
      const r = rPick(rng, candidates)
      if (!s.world.roadWidened) s.world.roadWidened = []
      s.world.roadWidened.push(r.id)
      pushLog(s, 'event', `ROAD WIDENING: 4-laning completed on ${routeName(r.id)}. Journey time -5% and highway delays -15 mins permanently.`)
    },
  },
  {
    id: 'bridge_closure',
    weight: 5,
    canFire: (s) => myActiveRoutes(s).length > 0,
    fire: (s, rng) => {
      const rid = rPick(rng, myActiveRoutes(s))
      const days = rInt(rng, 7, 21)
      if (!s.world.detour) s.world.detour = {}
      s.world.detour[rid] = s.day + days
      s.world.closures[rid] = { untilDay: s.day + days, reason: 'river bridge repair (detour active)' }
      pushLog(s, 'event', `BRIDGE CLOSURE: Major bridge repair on ${routeName(rid)} for ~${days} days. Detour active: +45 min journey time and +12% fuel.`)
    },
  },
  {
    id: 'fuel_adulteration',
    weight: 4,
    canFire: (s) => (s.world.adulterationUntilDay ?? 0) < s.day,
    fire: (s, rng) => {
      const bunk = rPick(rng, ['Sri Balaji Highway Bunk', 'Kaveri Fuel Stop', 'NH-44 Highway Petrol', 'Om Sai Petroleum'])
      s.world.adulterationUntilDay = s.day + 3
      s.world.adulterationBunk = bunk
      pushLog(s, 'event', `FUEL ADULTERATION: Contaminated diesel batches reported at ${bunk} for 3 days. 40% chance of engine wear (-5 pts) on diesel departures.`)
    },
  },
  {
    id: 'labour_inspection',
    weight: 5,
    canFire: (s) => Object.keys(s.staff).length > 0,
    fire: (s) => {
      const n = Object.keys(s.staff).length
      if (!s.config?.mealAllowance && n > 8) {
        spend(s, 'fine', rs(8_000), { note: 'Labour inspection challan' })
        pushLog(s, 'alert', `LABOUR INSPECTION: Department of Labour inspected depot. Fined ₹8,000 for missing staff meal allowances (${n} employees). Enable under Settings.`)
      } else if (!s.config?.healthCoverage) {
        pushLog(s, 'event', 'LABOUR INSPECTION: Routine labour inspection completed. Notice issued recommending group health insurance for garage and line crew.')
      } else {
        pushLog(s, 'event', 'LABOUR INSPECTION: Perfect compliance verified! Staff welfare policies and allowances in full order.')
      }
    },
  },
  {
    id: 'festival_charter',
    weight: 2,
    canFire: (s) =>
      Boolean(scheduleManagerOnDuty(s)) &&
      (!s.world.lastCharterDay || s.day - s.world.lastCharterDay >= 6) &&
      s.decisions.filter((d) => d.kind === 'festival_charter').length < 1 &&
      Object.values(s.buses).some(
        (b) =>
          b.status === 'active' &&
          !b.scheduleId &&
          !b.coveringBusId &&
          b.ownership !== 'attached' &&
          (BUS_MODELS[b.modelId]?.seats ?? 0) > 0,
      ),
    fire: (s, rng) => {
      s.world.lastCharterDay = s.day
      createCharterInquiry(s, rng)
    },
  },
  {
    id: 'cheque_bounce',
    weight: 5,
    canFire: (s) => !s.decisions.some((d) => d.kind === 'cheque_bounce') && s.receivables.some((r) => r.settleDay <= s.day + 5 && r.amount >= rs(5_000)),
    fire: (s, rng) => {
      const eligibleRcvs = s.receivables.filter((r) => r.settleDay <= s.day + 5 && r.amount >= rs(5_000))
      const rcv = rPick(rng, eligibleRcvs)
      rcv.bounced = true
      s.decisions.push({
        id: nextId(s.ids, 'dec'),
        day: s.day,
        expiresDay: s.day + 4,
        kind: 'cheque_bounce',
        title: `Receivable Default / Cheque Bounce (${fmtCompact(rcv.amount)})`,
        body: `An offline booking agent's settlement cheque of ${fmtCompact(rcv.amount)} due on Day ${rcv.settleDay} has bounced with insufficient funds. You can write off the bad debt or hire a collection agent for ₹2,000 (70% recovery chance in 10 days). An appointed Accounts Manager clears this decision for you.`,
        options: [
          { id: 'collector', key: 'collector', label: 'Send recovery agent (Fee ₹2,000 — 70% chance of recovery)' },
          { id: 'cancel', key: 'cancel', label: `Write off receivable (Lose ${fmtCompact(rcv.amount)})` },
        ],
        data: { rcvId: rcv.id, amount: rcv.amount },
      })
      pushLog(s, 'alert', `CHEQUE BOUNCE: Agent settlement of ${fmtCompact(rcv.amount)} bounced! Review recovery options in Decisions.`)
    },
  },
  {
    id: 'new_expressway_proposal',
    weight: 3,
    canFire: (s) => ROUTE_LIST.some((r) => !s.world.expressways.includes(r.id) && !(s.world.expresswayProposals ?? {})[r.id] && r.km > 350),
    fire: (s, rng) => {
      const candidates = ROUTE_LIST.filter((r) => !s.world.expressways.includes(r.id) && !(s.world.expresswayProposals ?? {})[r.id] && r.km > 350)
      const r = rPick(rng, candidates)
      if (!s.world.expresswayProposals) s.world.expresswayProposals = {}
      s.world.expresswayProposals[r.id] = s.day + 60
      pushLog(s, 'event', `EXPRESSWAY GAZETTE: NHAI announced greenfield expressway on ${routeName(r.id)}. Slated to open in 60 days (Day ${s.day + 60}). AIS-140 GPS will be mandatory on opening.`)
    },
  },
  {
    id: 'driver_union_demand',
    weight: 1,
    canFire: (s) => {
      // 180-day (6-month) cooldown between union demands
      const lastDay = s.world.lastUnionDemandDay ?? -999
      if (s.day - lastDay < 180) return false
      if (s.decisions.some((d) => d.kind === 'driver_union_demand')) return false
      const drivers = Object.values(s.staff).filter((st) => st.role === 'driver' || st.role === 'co_driver')
      if (drivers.length < 2) return false
      // Only fires if fleet driver morale is below 60 (labor dissatisfaction)
      const avgMorale = drivers.reduce((a, d) => a + d.morale, 0) / drivers.length
      return avgMorale < 60
    },
    fire: (s) => {
      s.world.lastUnionDemandDay = s.day
      const drivers = Object.values(s.staff).filter((st) => st.role === 'driver' || st.role === 'co_driver')
      const avgMorale = drivers.length > 0 ? drivers.reduce((a, d) => a + d.morale, 0) / drivers.length : 100
      if (s.config?.hrAutoRaise && hrOnDuty(s)) {
        for (const st of drivers) {
          st.salary = Math.round(st.salary * 1.10)
        }
        pushLog(s, 'good', 'HR Auto-Action: Matched driver union 10% restructuring demand under collective agreement.')
        return
      }
      s.decisions.push({
        id: nextId(s.ids, 'dec'),
        day: s.day,
        expiresDay: s.day + 3,
        kind: 'driver_union_demand',
        title: 'Driver Union Wage Restructuring Demand',
        body: 'The motor transport workers union has submitted a memorandum demanding an immediate 10% across-the-board wage hike for all line drivers. Refusing will trigger an immediate 2-day wildcat strike and damage driver morale (-15 pts).',
        options: [
          { id: 'accept', key: 'accept', label: 'Agree to union demand (+10% driver salaries)' },
          { id: 'refuse', key: 'refuse', label: 'Refuse demand (2-day strike, driver morale -15)' },
        ],
        data: {},
      })
      pushLog(s, 'alert', 'UNION DEMAND: Drivers union demanded a 10% wage hike. Check Decisions.')
    },
  },
  {
    id: 'flood_disruption',
    weight: 5,
    canFire: (s) => ROUTE_LIST.some((r) => r.ghat),
    fire: (s, rng) => {
      const ghats = ROUTE_LIST.filter((r) => r.ghat)
      const count = rInt(rng, 2, Math.min(4, ghats.length))
      const shuffled = [...ghats].sort(() => rng() - 0.5).slice(0, count)
      const days = rInt(rng, 3, 10)
      for (const r of shuffled) {
        s.world.closures[r.id] = { untilDay: s.day + days, reason: 'flash floods and waterlogging' }
      }
      const names = shuffled.map((r) => routeName(r.id)).join(', ')
      pushLog(s, 'event', `FLASH FLOOD DISRUPTION: Monsoon flooding closed ghat routes: ${names} for ~${days} days. Booked trips cancelled with refunds.`)
    },
  },
  {
    id: 'quota_travel_surge',
    weight: 6,
    canFire: (s) => myActiveRoutes(s).length > 0,
    fire: (s, rng) => {
      const rid = rPick(rng, myActiveRoutes(s))
      s.world.demandShock[rid] = { mult: 1.8, untilDay: s.day + 7, reason: 'quota admission & counseling surge' }
      pushLog(s, 'event', `TRAVEL SURGE: College admission and quota counseling rush on ${routeName(rid)}! Demand +80% for 7 days.`)
    },
  },
  {
    id: 'celebrity_travel',
    weight: 4,
    canFire: (s) => Object.values(s.buses).some((b) => b.modelId && BUS_MODELS[b.modelId]?.sleeper),
    fire: (s) => {
      s.world.celebrityDay = s.day
      pushLog(s, 'event', 'CELEBRITY PASSENGER SPOTTED: A well-known VIP has booked a berth on your overnight sleeper service tonight! Ensure an on-time arrival with zero breakdowns to earn +5 Company Reputation.')
    },
  },
  {
    id: 'pilferage_at_terminal',
    weight: 4,
    canFire: (s) => myActiveRoutes(s).length > 0,
    fire: (s, rng) => {
      const rid = rPick(rng, myActiveRoutes(s))
      s.world.cargoPilferageRouteId = rid
      s.world.cargoPilferageUntilDay = s.day + 1
      pushLog(s, 'event', `PILFERAGE AT TERMINAL: Tampered cargo parcels reported at ${routeName(rid)} transit hub. 50% cargo revenues lost today.`)
    },
  },
  {
    id: 'tyre_recall',
    weight: 4,
    canFire: (s) => Object.values(s.buses).some((b) => b.frontBrand === 'tier2' || b.rearBrand === 'tier2' || b.rearBrand === 'retread'),
    fire: (s, rng) => {
      const brand = rPick(rng, ['tier2', 'retread']) as 'tier2' | 'retread'
      let affectedBuses = 0
      for (const b of Object.values(s.buses)) {
        let hit = false
        if (b.frontBrand === brand) {
          b.frontTyreKm = BAL.tyres[brand]?.frontLifeKm ?? BAL.tyreLifeKm
          hit = true
        }
        if (b.rearBrand === brand) {
          b.rearTyreKm = BAL.tyres[brand]?.rearLifeKm ?? BAL.tyreLifeKm
          hit = true
        }
        if (hit) {
          b.tyreKm = Math.max(b.frontTyreKm ?? 0, b.rearTyreKm ?? 0)
          affectedBuses++
        }
      }
      pushLog(s, 'alert', `SAFETY RECALL: Ministry issued urgent recall advisory for ${brand.toUpperCase()} tyres due to tread separation defect. Axles on ${affectedBuses} bus(es) are due for replacement immediately.`)
    },
  },
  ...DISTRESS_EVENTS,
]

export function forceEvent(s: GameState, eventId: string): boolean {
  const e = EVENTS.find((x) => x.id === eventId)
  if (!e) return false
  e.fire(s, rngFor(s.seed, 'forced', eventId, s.day))
  return true
}

export function dailyEventRoll(s: GameState): void {
  if (s.forcedEventId) {
    const id = s.forcedEventId
    s.forcedEventId = undefined
    forceEvent(s, id)
    return
  }
  const rng = rngFor(s.seed, 'evt', s.day)
  if (!rChance(rng, BAL.eventChancePerDay)) return
  const eligible = EVENTS.filter((e) => e.canFire(s))
  const totalW = eligible.reduce((a, e) => a + e.weight, 0)
  let roll = rng() * totalW
  for (const e of eligible) {
    roll -= e.weight
    if (roll <= 0) {
      e.fire(s, rngFor(s.seed, 'evtfire', e.id, s.day))
      return
    }
  }
}

/** Resolve a pending decision by option id. Returns an error string or null. */
export function applyDecision(s: GameState, decisionId: ID, optionId: string): string | null {
  const idx = s.decisions.findIndex((d) => d.id === decisionId)
  if (idx < 0) return 'Decision no longer pending.'
  const d = s.decisions[idx]

  const distress = applyDistressDecision(s, d, optionId)
  if (distress.error) return distress.error
  if (distress.handled) {
    s.decisions.splice(idx, 1)
    return null
  }

  switch (d.kind) {
    case 'festival_charter': {
      if (optionId === 'accept') {
        const busId = d.data?.busId as ID | undefined
        const routeId = (d.data?.routeId as string) || ROUTE_LIST[0].id
        const bus = busId ? s.buses[busId] : undefined
        const route = ROUTES[routeId] ?? ROUTE_LIST[0]
        if (bus && route) {
          const q = calculateCharterQuote(s, bus, route)
          executeCharterContract(s, bus, route, q)
          pushLog(
            s,
            'good',
            `Charter completed on ${routeName(route.id)}! Earned ${fmtCompact(q.fee)} revenue (+${fmtCompact(q.profit)} net profit after fuel & tolls).`,
          )
        }
      } else {
        pushLog(s, 'info', 'Declined private festival tour charter.')
      }
      break
    }
    case 'cheque_bounce': {
      const rcvId = d.data?.rcvId as string
      if (optionId === 'collector') {
        spend(s, 'office_admin', rs(2_000), { note: 'Collection agency fee' })
        const rcv = s.receivables.find((r) => r.id === rcvId)
        if (rcv && Math.random() < 0.70) {
          rcv.settleDay = s.day + 10
          rcv.bounced = false
          pushLog(s, 'good', 'Collection agency recovered bounced payment — settlement will arrive in 10 days.')
        } else if (rcv) {
          s.receivables = s.receivables.filter((r) => r.id !== rcvId)
          pushLog(s, 'alert', 'Collection agency failed to recover the defaulted funds; receivable written off.')
        }
      } else {
        s.receivables = s.receivables.filter((r) => r.id !== rcvId)
        pushLog(s, 'alert', 'Bounced receivable written off.')
      }
      break
    }
    case 'driver_union_demand': {
      s.world.lastUnionDemandDay = s.day
      if (optionId === 'accept') {
        for (const st of Object.values(s.staff)) {
          if (st.role === 'driver' || st.role === 'co_driver') {
            st.salary = Math.round(st.salary * 1.10)
          }
        }
        pushLog(s, 'good', 'Union agreement ratified: Driver salaries raised by 10% across all drivers.')
      } else {
        for (const st of Object.values(s.staff)) {
          if (st.role === 'driver' || st.role === 'co_driver') {
            st.morale = Math.max(0, st.morale - 15)
          }
        }
        s.world.strikeUntilDay = s.day + 2
        pushLog(s, 'alert', 'Union wage demands rejected! Drivers launched a 2-day wildcat strike; morale fell by -15 pts.')
      }
      break
    }
    case 'spot_cargo': {
      if (optionId.startsWith('accept_') || optionId === 'accept') {
        const offerId = (d.data?.offerId as string) || optionId.replace('accept_', '')
        if (offerId) acceptSpotCargoOffer(s, offerId)
      } else {
        const offerId = d.data?.offerId as string | undefined
        const offer = offerId ? s.company.spotOffers?.find((o) => o.id === offerId) : undefined
        if (offer && offer.status !== 'shipped') offer.status = 'expired'
        pushLog(s, 'info', 'Declined spot cargo offer.')
      }
      break
    }
    case 'poach': {
      const staffId = d.data?.staffId as ID
      const offer = d.data?.offer as number
      const st = s.staff[staffId]
      if (optionId === 'match' && st) {
        st.salary = offer
        st.morale = Math.min(100, st.morale + 10)
        st.loyalty = Math.min(100, st.loyalty + 12)
        pushLog(s, 'info', `${st.name} stays - salary matched at ${fmtCompact(offer)}/month.`)
      } else if (st) {
        if (s.workshop.managerId === staffId) s.workshop.managerId = undefined
        if (s.company.hrId === staffId) s.company.hrId = undefined
        if (s.company.opsId === staffId) s.company.opsId = undefined
        if (s.workshop.mechanicIds) {
          for (let i = 0; i < s.workshop.mechanicIds.length; i++) {
            if (s.workshop.mechanicIds[i] === staffId) s.workshop.mechanicIds[i] = null
          }
        }
        delete s.staff[staffId]
        pushLog(s, 'alert', `${st.name} left for the rival. Their bus needs new crew.`)
      }
      break
    }
    case 'primo': {
      const gid = d.groupId ?? (d.data?.groupId as string | undefined)
      if (gid && s.groups?.[gid]) {
        const grp = s.groups[gid]
        if (optionId === 'accept') {
          grp.primo = true
          grp.primoOffered = true
          grp.primoSinceDay = s.day
          grp.primoNextEligibleDay = undefined
          pushLog(s, 'good', `${grp.name} is now a RedBus PRIMO brand. Visibility up, standards up.`)
        } else {
          grp.primoOffered = false
          grp.primoNextEligibleDay = s.day + BAL.primoDeclineCooldownDays
          pushLog(s, 'info', `Primo declined for ${grp.name}. RedBus will not ask again for ${BAL.primoDeclineCooldownDays} days.`)
        }
      } else {
        if (optionId === 'accept') {
          s.company.primo = true
          s.company.primoOffered = true
          s.company.primoSinceDay = s.day
          s.company.primoNextEligibleDay = undefined
          pushLog(s, 'good', 'You are now a RedBus PRIMO operator. Visibility up, standards up.')
        } else {
          s.company.primoOffered = false
          s.company.primoNextEligibleDay = s.day + BAL.primoDeclineCooldownDays
          pushLog(s, 'info', `Primo declined. RedBus will not ask again for ${BAL.primoDeclineCooldownDays} days.`)
        }
      }
      break
    }
    case 'redbus_warning': {
      pushLog(s, 'info', 'RedBus quality warning acknowledged. Open complaints should be resolved promptly.')
      break
    }
    case 'rto_inspection': {
      spend(s, 'fine', BAL.challanFine, { note: 'RTO quality crackdown fine' })
      const dirtiest = Object.values(s.buses)
        .filter((b) => b.status === 'active')
        .sort((a, b) => (a.busCleanliness ?? 100) - (b.busCleanliness ?? 100))[0]
      if (dirtiest) {
        dirtiest.status = 'grounded'
        pushLog(s, 'alert', `RTO inspection fine ₹12,000 paid. ${dirtiest.reg} (cleanliness ${dirtiest.busCleanliness}/100) grounded for inspection.`)
      } else {
        pushLog(s, 'alert', 'RTO inspection fine ₹12,000 paid.')
      }
      break
    }
    case 'crew': {
      if (optionId.startsWith('pay_fest_bonus')) {
        const year = Number(optionId.split(':')[1]) || 0
        s.company.festivalBonusDecidedYear = year
        const totalSal = Object.values(s.staff).reduce((a, st) => a + (st.salary || (st as any).wagePaise || 0), 0)
        spend(s, 'staff_welfare', totalSal, { note: 'festival bonus payout' })
        for (const st of Object.values(s.staff)) {
          st.morale = Math.min(100, st.morale + 15)
        }
        pushLog(s, 'good', `Festival bonus paid (${fmtCompact(totalSal)} to ${Object.keys(s.staff).length} staff). Morale +15.`)
      } else if (optionId.startsWith('skip_fest_bonus')) {
        const year = Number(optionId.split(':')[1]) || 0
        s.company.festivalBonusDecidedYear = year
        for (const st of Object.values(s.staff)) {
          st.morale = Math.max(0, st.morale - 20)
        }
        pushLog(s, 'alert', 'Festival bonus skipped. Staff morale dropped by 20 points.')
      }
      break
    }
    // Pre-distress saves can still carry one of these pending.
    case 'acquisition': {
      if (optionId === 'buy') {
        const err = buyLot(s, {
          dealKey: `legacy${d.id}`,
          modelId: d.data?.modelId as string,
          count: d.data?.count as number,
          age: d.data?.age as number,
          total: d.data?.total as number,
          odoMult: 1,
          conditionBias: 0,
          accidentChance: 0.25,
        })
        if (err) return err
      } else {
        pushLog(s, 'info', 'Passed on the fleet package.')
      }
      break
    }
    default:
      break
  }
  s.decisions.splice(idx, 1)
  return null
}

/**
 * Accounts Manager clears finance decisions on the player's behalf. A bounced
 * agent settlement is chased through a collection agency whenever the expected
 * recovery (70%) beats the ₹2,000 fee and there is cash to pay it; otherwise
 * the bad debt is written off.
 */
export function accountantDecisionPass(s: GameState): void {
  const acct = accountantOnDuty(s)
  if (!acct) return
  const pending = s.decisions.filter((d) => d.kind === 'cheque_bounce').slice(0, 2)
  for (const d of pending) {
    const amount = Number(d.data?.amount) || 0
    const fee = rs(2_000)
    const chase = amount * 0.7 > fee && canAfford(s, fee)
    const err = applyDecision(s, d.id, chase ? 'collector' : 'cancel')
    if (err) continue
    pushLog(
      s,
      'finance',
      `Accounts Manager ${acct.name} handled the bounced settlement of ${fmtCompact(amount)} — ${chase ? 'collection agent engaged' : 'written off as bad debt'}.`,
    )
  }
}

// re-export for tick convenience
export { ROUTES }
