/**
 * Depot & outstation yard operations:
 * - Home depot overflow fees & RTO street parking raid risk
 * - Outstation overnight parking and leased yards
 * - Daily time decay on coach condition (AC, electrical, body)
 */
import { BAL } from '../data/balance'
import { CITIES, cityName } from '../data/cities'
import { rngFor } from '../core/rng'
import { fmtCompact, rs, toRupees } from '../core/money'
import type { Bus, FuelPartner, GameState } from '../types'
import { canAfford, spend } from './finance'
import { pushLog } from './log'
import { busAgeYears } from './fleet'

/** Monthly lease rent for an outstation yard by city metro tier (in paise). */
export function yardMonthlyRent(cityId: string): number {
  const metro = CITIES[cityId]?.metro ?? 0.3
  if (metro >= 0.8) return rs(25_000)
  if (metro >= 0.4) return rs(15_000)
  return rs(8_000)
}

/** Lease a covered parking yard in an outstation city. */
export function leaseYard(s: GameState, cityId: string): string | null {
  if (cityId === s.company.homeCityId) return 'Home depot is already owned.'
  if (!s.yards) s.yards = []
  if (s.yards.some((y) => y.cityId === cityId)) return 'Yard already leased in this city.'
  const rent = yardMonthlyRent(cityId)
  s.yards.push({
    cityId,
    monthlyRent: rent,
    covered: true,
  })
  pushLog(s, 'good', `Leased covered parking yard in ${cityName(cityId)} for ₹${toRupees(rent).toLocaleString('en-IN')}/month.`)
  return null
}

/** Cancel a leased yard. */
export function cancelYard(s: GameState, cityId: string): string | null {
  if (!s.yards) return 'No leased yards.'
  const idx = s.yards.findIndex((y) => y.cityId === cityId)
  if (idx < 0) return 'No leased yard in this city.'
  s.yards.splice(idx, 1)
  pushLog(s, 'info', `Cancelled yard lease in ${cityName(cityId)}.`)
  return null
}

/** Nightly public-parking fee per bus in an unleased outstation city (in paise). */
export function outstationNightlyFee(cityId: string): number {
  const metro = CITIES[cityId]?.metro ?? 0.3
  return rs(Math.min(500, Math.max(200, 200 + Math.round(metro * 300))))
}

/** True while a multi-day haul has not yet reached its arrival calendar day. */
export function isBusInTransit(s: GameState, bus: Bus): boolean {
  return bus.inTransitUntilDay !== undefined && bus.inTransitUntilDay > s.day
}

/** Clear finished hauls and park coaches at their destination city. */
export function settleBusArrivals(s: GameState): number {
  let n = 0
  for (const bus of Object.values(s.buses)) {
    if (bus.inTransitUntilDay === undefined) continue
    if (bus.inTransitUntilDay > s.day) continue
    if (bus.inTransitToCityId) bus.parkedCityId = bus.inTransitToCityId
    bus.inTransitUntilDay = undefined
    bus.inTransitToCityId = undefined
    bus.inTransitFromCityId = undefined
    n++
  }
  return n
}

/** Buses that physically sit overnight in a city — the fleet a yard has to hold. */
export function busesParkedInCity(s: GameState, cityId: string): Bus[] {
  const home = s.company.homeCityId
  return Object.values(s.buses).filter(
    (b) =>
      (b.status === 'active' || b.status === 'workshop' || b.status === 'grounded')
      && !isBusInTransit(s, b)
      && (b.parkedCityId ?? home) === cityId,
  )
}

/** Parked-bus count for every city in use today (home city included). */
export function parkedBusCounts(s: GameState): Record<string, number> {
  const home = s.company.homeCityId
  const counts: Record<string, number> = {}
  for (const b of Object.values(s.buses)) {
    if (b.status === 'delivery') continue
    if (isBusInTransit(s, b)) continue
    const city = b.parkedCityId ?? home
    counts[city] = (counts[city] ?? 0) + 1
  }
  return counts
}

/** Nightly depot pass: parking fees, overflow penalty, time decay. */
export function dailyDepotPass(s: GameState): void {
  const homeCity = s.company.homeCityId
  const depotCap = s.depotSlots ?? BAL.depot.baseSlots
  const leasedCitySet = new Set((s.yards ?? []).map((y) => y.cityId))

  const activeBuses = Object.values(s.buses).filter(
    (b) =>
      (b.status === 'active' || b.status === 'workshop' || b.status === 'grounded')
      && !isBusInTransit(s, b),
  )

  let homeParkedCount = 0
  const outstationCounts: Record<string, number> = {}

  for (const b of activeBuses) {
    const parked = b.parkedCityId ?? homeCity
    if (parked === homeCity) {
      homeParkedCount++
    } else if (!leasedCitySet.has(parked)) {
      outstationCounts[parked] = (outstationCounts[parked] ?? 0) + 1
    }
  }

  // 1. Home depot overflow
  const overflow = Math.max(0, homeParkedCount - depotCap)
  if (overflow > 0) {
    const feePerBus = BAL.depot?.overflowFeePerBusNight ?? rs(300)
    spend(s, 'depot_rent', overflow * feePerBus, {
      note: `home yard overflow ×${overflow} buses on street`,
    })

    // 5% chance of a ₹5,000 RTO fine once per overflow night (not per bus)
    const fineRoll = rngFor(s.seed, 'depot_overflow_fine', s.day)()
    if (fineRoll < 0.05) {
      spend(s, 'fine', rs(5_000), {
        note: 'RTO fine: unauthorized street parking overnight at home depot',
      })
      pushLog(s, 'alert', 'RTO raid: ₹5,000 fine for overnight street parking outside home depot.')
    }
  }

  // 2. Outstation unleased parking — one summed txn per city per night
  for (const [cityId, count] of Object.entries(outstationCounts)) {
    if (count <= 0) continue
    const perBus = outstationNightlyFee(cityId)
    const cityTotal = count * perBus
    spend(s, 'parking_cleaning', cityTotal, {
      note: `outstation overnight parking (${cityName(cityId)} ×${count})`,
    })
  }

  // 3. Time decay for owned and leased buses (not in delivery)
  for (const b of Object.values(s.buses)) {
    if (b.status === 'delivery') continue
    if (b.ownership === 'attached') continue // attached bus upkeep is borne by owner
    if (!b.condition) continue

    const parked = b.parkedCityId ?? homeCity
    const isCovered = parked === homeCity || leasedCitySet.has(parked)

    const decayRng = rngFor(s.seed, 'time_decay', s.day, b.id)
    const baseLoss = 0.1 + decayRng() * 0.2 // 0.1 to 0.3 points

    let mult = isCovered ? 0.6 : 1.0
    if (busAgeYears(s, b) > 8) {
      mult *= 1.5
    }

    const loss = baseLoss * mult
    for (const sub of ['ac', 'electrical', 'body'] as const) {
      b.condition[sub] = Math.max(0, Math.round((b.condition[sub] - loss) * 100) / 100)
    }
  }

  // 4. Auto-refill depot bulk fuel tank if low: as many full tanker loads as fit.
  const tank = s.company.depotFuelTank
  if (tank?.installed && tank.autoRefill) {
    if (tank.litres <= autoRefillThreshold(tank.capacityLitres)) {
      orderDepotFuelRefill(s, tankerLoadsThatFit(tank.capacityLitres - tank.litres))
    }
  }
}

/** Level at which auto-refill orders a tanker: 20% of capacity, never below 2,000 L. */
export function autoRefillThreshold(capacityLitres: number): number {
  return Math.max(2_000, Math.round(capacityLitres * BAL.fuelCommercial.autoRefillAtShare))
}

/** Whole tanker loads that fit in the free space (at least one load). */
export function tankerLoadsThatFit(freeLitres: number): number {
  const load = BAL.fuelCommercial.tankerLoadLitres
  return Math.max(1, Math.floor(freeLitres / load)) * load
}

/** The next bigger tank, if any. */
export function nextDepotTankUpgrade(s: GameState): { capacityLitres: number; cost: number } | undefined {
  const cap = s.company.depotFuelTank?.capacityLitres ?? 0
  return BAL.fuelCommercial.depotTankUpgrades.find((u) => u.capacityLitres > cap)
}

/** Replace the depot tank with the next size up. Fuel already in it stays. */
export function upgradeDepotFuelTank(s: GameState): string | null {
  const tank = s.company.depotFuelTank
  if (!tank?.installed) return 'Install a depot fuel tank first.'
  const next = nextDepotTankUpgrade(s)
  if (!next) return 'The depot tank is already the largest size.'
  if (!canAfford(s, next.cost)) return `Upgrading to ${next.capacityLitres.toLocaleString('en-IN')} L costs ${fmtCompact(next.cost)}.`
  spend(s, 'depot_fuel_capex', next.cost, { note: `Depot fuel tank upgrade to ${next.capacityLitres.toLocaleString('en-IN')} L` })
  const from = tank.capacityLitres
  tank.capacityLitres = next.capacityLitres
  pushLog(
    s,
    'good',
    `Depot fuel tank upgraded from ${from.toLocaleString('en-IN')} L to ${next.capacityLitres.toLocaleString('en-IN')} L. More litres at the ₹4/L wholesale saving between tankers.`,
  )
  return null
}

/** Install a 10,000L underground diesel yard tank at the home depot. */
export function installDepotFuelTank(s: GameState): string | null {
  if (s.company.depotFuelTank?.installed) {
    return 'Depot bulk fuel tank is already installed.'
  }
  const cost = BAL.fuelCommercial.depotTankInstallCost
  if (!canAfford(s, cost)) {
    return `Depot fuel tank installation costs ${fmtCompact(cost)}.`
  }
  spend(s, 'depot_fuel_capex', cost, { note: '10,000L depot bulk fuel tank installation' })
  s.company.depotFuelTank = {
    installed: true,
    capacityLitres: BAL.fuelCommercial.depotTankCapLitres,
    litres: 0,
    autoRefill: true,
  }
  pushLog(s, 'good', '10,000L bulk fuel tank installed at home depot! Wholesale bulk tanker refills now available at ₹4/L discount.')
  return null
}

/** Order a wholesale bulk tanker load (defaults to 8,000L) into the home depot tank. */
export function orderDepotFuelRefill(s: GameState, litres: number = BAL.fuelCommercial.tankerLoadLitres): string | null {
  const tank = s.company.depotFuelTank
  if (!tank?.installed) {
    return 'Home depot does not have a bulk fuel tank installed.'
  }
  const availableSpace = tank.capacityLitres - tank.litres
  const refillLitres = Math.min(litres, availableSpace)
  if (refillLitres <= 100) {
    return 'Depot fuel tank is already full.'
  }

  const wholesalePaisePerLitre = Math.max(rs(70), s.world.dieselPaise - BAL.fuelCommercial.wholesaleDiscountPerLitre)
  const totalCost = Math.round(refillLitres * wholesalePaisePerLitre)
  if (!canAfford(s, totalCost)) {
    return `Bulk fuel delivery (${Math.round(refillLitres).toLocaleString('en-IN')} L) costs ${fmtCompact(totalCost)}.`
  }

  spend(s, 'fuel', totalCost, { note: `Bulk tanker delivery (${Math.round(refillLitres)} L @ ${fmtCompact(wholesalePaisePerLitre)}/L)` })
  tank.litres = Math.min(tank.capacityLitres, tank.litres + refillLitres)
  pushLog(
    s,
    'good',
    `Bulk fuel tanker delivered: ${Math.round(refillLitres).toLocaleString('en-IN')} L pumped into home depot tank. Saved ₹${Math.round((refillLitres * BAL.fuelCommercial.wholesaleDiscountPerLitre) / 100).toLocaleString('en-IN')} vs highway pump price!`,
  )
  return null
}

/** Toggle auto-refill of home depot fuel tank when level drops below 2,000L. */
export function toggleAutoRefillDepotTank(s: GameState, enabled?: boolean): string | null {
  const tank = s.company.depotFuelTank
  if (!tank?.installed) return 'No depot fuel tank installed.'
  tank.autoRefill = enabled !== undefined ? enabled : !tank.autoRefill
  pushLog(
    s,
    'info',
    `Depot fuel tank auto-refill ${tank.autoRefill ? `ENABLED (orders tanker loads when the level drops to ${autoRefillThreshold(tank.capacityLitres).toLocaleString('en-IN')} L)` : 'DISABLED'}.`,
  )
  return null
}

/** Sign or switch an OMC Fleet Card partnership (IndianOil XtraPower, BPCL SmartFleet, HPCL DriveTrack Plus). */
export function setFuelContract(s: GameState, partner: FuelPartner): string | null {
  if (partner === 'none') {
    s.company.fuelContract = { partner: 'none', active: false, signedDay: s.day }
    pushLog(s, 'info', 'OMC Fleet Card partnership cancelled.')
    return null
  }

  const partnerNames: Record<Exclude<FuelPartner, 'none'>, string> = {
    indianoil: 'IndianOil XtraPower Fleet Card',
    bpcl: 'BPCL SmartFleet Card',
    hpcl: 'HPCL DriveTrack Plus Card',
  }

  s.company.fuelContract = {
    partner,
    active: true,
    signedDay: s.day,
    cashbackBps: BAL.fuelCommercial.fleetCardRebateBps,
  }

  pushLog(
    s,
    'good',
    `Signed commercial fleet agreement with ${partnerNames[partner]}! 2.5% monthly cashback rebate and adulteration-free fuel network activated.`,
  )
  return null
}
