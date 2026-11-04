import type { GameState } from '../types'
import { BAL } from '../data/balance'
import { fmtCompact } from '../core/money'
import { cityName } from '../data/cities'
import { modelNeedsHp } from '../data/busModels'
import { ownerPaysService, serviceDueKm } from './maintenance'
import { spanMeters, DESK_UNIT } from './span'
import { DESK_LABEL, deskHead } from './staffing'

export type AdvisorSeverity = 'critical' | 'warn' | 'info'

/** One actionable item: what is wrong, how bad, and the page where it gets fixed. */
export interface AdvisorTask {
  id: string
  severity: AdvisorSeverity
  text: string
  /** Route to open to fix it. */
  to: string
  /** Short button label for the destination. */
  cta: string
}

const RANK: Record<AdvisorSeverity, number> = { critical: 0, warn: 1, info: 2 }

/** Everything that needs the player's attention, most urgent first. Pure: reads state only. */
export function computeAdvisor(s: GameState): AdvisorTask[] {
  const out: AdvisorTask[] = []
  const add = (id: string, severity: AdvisorSeverity, text: string, to: string, cta: string) =>
    out.push({ id, severity, text, to, cta })
  const buses = Object.values(s.buses)
  const staff = Object.values(s.staff)

  if (buses.length === 0) add('no-buses', 'critical', 'No buses yet — buy, lease or attach one to start earning.', '/market', 'Market')

  // Money first: cash problems end the game.
  for (const loan of Object.values(s.loans)) {
    if (loan.status === 'active' && loan.consecutiveMissed > 0) {
      add(`loan-${loan.id}`, 'critical', `${loan.lender}: ${loan.consecutiveMissed} missed EMI(s) — repossession at ${BAL.repoAfterConsecutiveMissed}.`, '/money', 'Money')
    }
  }
  const recent = s.kpis.slice(-14)
  const avgBurn = recent.length > 3 ? recent.reduce((a, k) => a + k.profit, 0) / recent.length : 0
  const runway = avgBurn < 0 ? Math.floor((s.company.cash + (s.od.limit - s.od.drawn)) / -avgBurn) : null
  if (runway !== null && runway < 21) add('runway', 'critical', `Cash runway ~${runway} days at recent burn.`, '/money', 'Money')
  if (s.od.drawn > 0) add('od', 'warn', `Overdraft drawn ${fmtCompact(s.od.drawn)} — daily interest running.`, '/money', 'Money')
  const c = s.company
  if (c.gstDueDay !== undefined && c.gstDueDay >= s.day && c.gstDueDay - s.day <= 3 && (c.gstPayable ?? 0) > 0) {
    add('gst', 'warn', `GST remittance due in ${c.gstDueDay - s.day}d — remit to avoid the 1% monthly penalty.`, '/money', 'Money')
  }
  if (c.tdsDueDay !== undefined && c.tdsDueDay >= s.day && c.tdsDueDay - s.day <= 3 && (c.tdsPayable ?? 0) > 0) {
    add('tds', 'warn', `Quarterly TDS return due in ${c.tdsDueDay - s.day}d — file to avoid statutory interest.`, '/money', 'Money')
  }

  // Papers and compliance.
  const expiredDocs = buses.filter((b) => b.insuranceExpiryDay < s.day || b.fitnessExpiryDay < s.day || !!b.fitnessFailed)
  if (expiredDocs.length) add('docs', 'critical', `${expiredDocs.length} bus(es) have expired insurance or fitness papers — grounded, and barred from charters.`, '/fleet', 'Fleet')
  const pucExpired = buses.filter((b) => b.status === 'active' && b.pucExpiryDay !== undefined && b.pucExpiryDay < s.day)
  if (pucExpired.length) add('puc', 'warn', `${pucExpired.length} bus(es) have an expired PUC — RTO fine ₹10,000.`, '/fleet', 'Fleet')
  const impounded = buses.filter((b) => b.impoundUntilDay !== undefined && b.impoundUntilDay > s.day)
  if (impounded.length) add('impound', 'critical', `${impounded.length} bus(es) impounded at an RTO checkpost.`, '/fleet', 'Fleet')
  const missingGps = buses.filter((b) => !b.gpsDeviceFitted && b.status === 'active' && !ownerPaysService(b))
  if (missingGps.length) add('gps', 'warn', `${missingGps.length} bus(es) lack AIS-140 GPS — delays +18% and ₹5,000 expressway fines.`, '/workshop', 'Workshop')

  // Crew.
  const hpMismatch = buses.filter((b) => {
    if (b.status !== 'active' || !modelNeedsHp(b.modelId)) return false
    return staff.filter((st) => st.busId === b.id && (st.role === 'driver' || st.role === 'co_driver')).some((d) => d.licenceClass !== 'HMV_HP')
  })
  if (hpMismatch.length) add('hp', 'warn', `${hpMismatch.length} Volvo/Scania coach(es) have a driver without the HMV_HP endorsement.`, '/staff', 'Staff')
  const uncrewed = buses.filter((b) => b.scheduleId && b.ownership !== 'attached' && !staff.some((st) => st.busId === b.id && st.role === 'driver'))
  if (uncrewed.length) add('no-driver', 'critical', `${uncrewed.length} scheduled bus(es) have no driver — trips will cancel.`, '/staff', 'Staff')
  const noCond = buses.filter((b) => b.scheduleId && b.ownership !== 'attached' && !staff.some((st) => st.busId === b.id && st.role === 'conductor'))
  if (noCond.length) add('no-cond', 'warn', `${noCond.length} scheduled bus(es) have no conductor — trips run but ratings suffer.`, '/staff', 'Staff')
  const nightRest = buses.filter((b) => {
    if (b.status !== 'active' || !b.scheduleId) return false
    const sch = s.schedules[b.scheduleId]
    if (!sch || sch.depHour >= 10) return false
    return staff.filter((st) => st.busId === b.id && (st.role === 'driver' || st.role === 'co_driver')).some(
      (d) => d.nightRestUntilDay && (s.day < d.nightRestUntilDay || (s.day === d.nightRestUntilDay && (d.nightRestUntilHour ?? 10) > sch.depHour)),
    )
  })
  if (nightRest.length) add('night-rest', 'warn', `${nightRest.length} morning departure(s) have a driver on mandatory CMVR night rest.`, '/schedules', 'Schedules')
  const drivers = staff.filter((st) => st.role === 'driver' || st.role === 'co_driver')
  if (drivers.length >= 3) {
    const lowMorale = drivers.filter((d) => d.morale < 35).length
    if (lowMorale / drivers.length >= 0.3) add('morale', 'warn', `${lowMorale} of ${drivers.length} drivers have low morale — strike and resignation risk.`, '/staff', 'Staff')
  }

  // Fleet condition and service.
  const overdue = buses.filter((b) => !ownerPaysService(b) && serviceDueKm(b) > 0)
  if (overdue.length) add('service', 'warn', `${overdue.length} bus(es) overdue for service — breakdown risk is rising.`, '/workshop', 'Workshop')
  const charterNeglect = buses.filter((b) => b.duty === 'charter' && !ownerPaysService(b) && serviceDueKm(b) > 0)
  if (charterNeglect.length) add('charter-service', 'warn', `${charterNeglect.length} charter coach(es) are overdue for service — a breakdown mid-tour cuts the fee and the client's rating.`, '/workshop', 'Workshop')
  const grounded = buses.filter((b) => b.status === 'grounded' || b.status === 'workshop')
  if (grounded.length) add('grounded', 'info', `${grounded.length} bus(es) grounded or in the workshop.`, '/workshop', 'Workshop')
  const dirty = buses.filter((b) => b.status === 'active' && (b.busCleanliness ?? 100) < 30)
  if (dirty.length) add('dirty', 'warn', `${dirty.length} bus(es) critically dirty (<30) — deep clean or ratings drop.`, '/workshop', 'Workshop')
  const idle = buses.filter((b) => !b.scheduleId && b.status === 'active' && b.duty !== 'charter')
  if (idle.length) add('idle', 'info', `${idle.length} bus(es) idle without a schedule.`, '/schedules', 'Schedules')

  // Depot and yards.
  const home = buses.filter((b) => (b.parkedCityId ?? c.homeCityId) === c.homeCityId && (b.status === 'active' || b.status === 'workshop' || b.status === 'grounded')).length
  const cap = s.depotSlots ?? BAL.depot.baseSlots
  if (home > cap) add('depot', 'warn', `${home - cap} bus(es) parked on the road at home — ₹300/bus nightly and RTO fine risk.`, '/workshop', 'Workshop')
  const leased = new Set((s.yards ?? []).map((y) => y.cityId))
  const away = new Set(buses.filter((b) => (b.status === 'active' || b.status === 'workshop' || b.status === 'grounded') && (b.parkedCityId ?? c.homeCityId) !== c.homeCityId && !leased.has(b.parkedCityId!)).map((b) => b.parkedCityId!))
  for (const city of away) add(`yard-${city}`, 'info', `Overnight fees at ${cityName(city)} — lease a yard to avoid them.`, '/workshop', 'Workshop')

  // Customers and other businesses.
  const grievances = (c.grievances ?? []).filter((g) => g.status === 'open').length
  if (grievances >= 10) add('grievances', 'warn', `${grievances} open passenger grievances — RedBus rating warning active.`, '/', 'Complaints')
  const inquiries = (s.charterInquiries ?? []).length
  if (inquiries > 0) add('charter-inq', 'info', `${inquiries} charter inquir${inquiries === 1 ? 'y' : 'ies'} waiting for a coach.`, '/charters', 'Charters')

  for (const m of Object.values(spanMeters(s))) {
    const unattended = Math.max(0, m.demand - m.capacity)
    if (unattended > 0 && deskHead(s, m.desk)) {
      add(`span-${m.desk}`, 'warn', `${DESK_LABEL[m.desk]} desk over capacity (${m.demand}/${m.capacity} ${DESK_UNIT[m.desk]}, ${unattended} unattended) — appoint ${m.assistantsToCover} assistant(s).`, '/staff?tab=desks', 'Desks')
    }
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity])
}

/** Count badges shown on navigation tabs, keyed by route path. */
export function tabBadges(s: GameState, tasks: AdvisorTask[] = computeAdvisor(s)): Record<string, number> {
  const n = (to: string, sev?: AdvisorSeverity) => tasks.filter((t) => t.to.split('?')[0] === to && (!sev || t.severity === sev)).length
  return {
    '/fleet': n('/fleet'),
    '/workshop': n('/workshop', 'warn') + n('/workshop', 'critical'),
    '/staff': n('/staff'),
    '/charters': (s.charterInquiries ?? []).length,
    '/money': n('/money'),
    '/schedules': n('/schedules', 'warn') + n('/schedules', 'critical'),
  }
}
