/**
 * State RTO Checkpost enforcement: random inspections of coaches operating trips.
 * Flags expired insurance, failed/expired fitness, expired PUC, or delinquent road tax.
 */
import { BAL } from '../data/balance'
import { fmtCompact, rs } from '../core/money'
import { rngFor, rChance, rInt } from '../core/rng'
import { modelNeedsHp } from '../data/busModels'
import type { GameState } from '../types'
import { spend } from './finance'
import { pushLog } from './log'

export function dailyCheckpostPass(s: GameState): void {
  const rng = rngFor(s.seed, 'checkpost', s.day)
  if (!rChance(rng, BAL.checkpostDailyChance)) return

  // Collect buses that completed trips today
  const activeBusIds: string[] = []
  for (const t of Object.values(s.trips)) {
    if (t.day === s.day && t.status === 'completed' && !activeBusIds.includes(t.busId)) {
      activeBusIds.push(t.busId)
    }
  }

  if (activeBusIds.length === 0) return

  // Pick 1 to 3 buses (or activeBusIds.length if fewer)
  const countToPick = Math.min(activeBusIds.length, rInt(rng, 1, 3))
  const shuffled = [...activeBusIds].sort(() => rng() - 0.5)
  const pickedBusIds = shuffled.slice(0, countToPick)

  for (const busId of pickedBusIds) {
    const bus = s.buses[busId]
    if (!bus) continue

    const badDocs: string[] = []
    if (bus.insuranceExpiryDay < s.day) badDocs.push('Insurance')
    if (bus.fitnessExpiryDay < s.day || bus.fitnessFailed) badDocs.push('Fitness')
    if (bus.pucExpiryDay !== undefined && bus.pucExpiryDay < s.day) badDocs.push('PUC')
    if (bus.ownership === 'owned' && bus.roadTaxPayableDay !== undefined && s.day > bus.roadTaxPayableDay + BAL.roadTaxGraceDays) {
      badDocs.push('Road Tax')
    }

    if (badDocs.length > 0) {
      const fine = rInt(rng, BAL.checkpostFineMin, BAL.checkpostFineMax)
      const impoundDays = rInt(rng, BAL.checkpostImpoundDaysMin, BAL.checkpostImpoundDaysMax)
      spend(s, 'fine', fine, { busId: bus.id, note: `RTO checkpost fine (${badDocs.join(', ')})` })
      bus.status = 'grounded'
      bus.impoundUntilDay = s.day + impoundDays
      pushLog(s, 'alert', `CHECKPOST RAID: ${bus.reg} intercepted at state checkpost with expired/failed ${badDocs.join(', ')}. Fined ${fmtCompact(fine)} and impounded for ${impoundDays} days!`)
    }

    // Attached coaches run with the owner's crew — company HP licence rules do not apply.
    if (bus.ownership !== 'attached' && modelNeedsHp(bus.modelId)) {
      const drivers = Object.values(s.staff).filter(
        (st) => st.busId === bus.id && (st.role === 'driver' || st.role === 'co_driver'),
      )
      const nonHpDrivers = drivers.filter((d) => d.licenceClass !== 'HMV_HP')
      if (nonHpDrivers.length > 0) {
        const fine = rs(10_000)
        spend(s, 'fine', fine, { busId: bus.id, note: 'RTO checkpost fine: Non-HP driver on heavy coach' })
        for (const d of nonHpDrivers) {
          if (!d.safetyRecord) d.safetyRecord = { accidents: 0, hardBrakes: 0, violations: 0 }
          d.safetyRecord.violations = (d.safetyRecord.violations ?? 0) + 1
        }
        pushLog(
          s,
          'alert',
          `CHECKPOST: ${bus.reg} (${bus.modelId}) intercepted with non-HP endorsed driver ${nonHpDrivers.map((d) => d.name).join(', ')}. Fined ${fmtCompact(fine)} and RTO violations logged.`,
        )
      }
    }
  }
}
