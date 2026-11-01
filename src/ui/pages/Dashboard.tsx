import { useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useGame } from '../../store/gameStore'
import { BAL } from '../../engine/data/balance'
import { fmtDateShort } from '../../engine/core/calendar'
import { fmtCompact, toRupees } from '../../engine/core/money'
import { cityName } from '../../engine/data/cities'
import { routeName } from '../../engine/data/routes'
import { modelNeedsHp } from '../../engine/data/busModels'
import { ownerPaysService, serviceDueKm } from '../../engine/sim/maintenance'
import { spanMeters, DESK_UNIT } from '../../engine/sim/span'
import { DESK_LABEL, deskHead } from '../../engine/sim/staffing'
import { Panel } from '../bits'
import { FleetHealthPanel, CargoTrendPanel, ChannelMixPanel } from '../opsPanels'

export function Dashboard() {
  const s = useGame((g) => g.state)!
  const g = useGame()
  const [logOpen, setLogOpen] = useState(false)

  const problems: string[] = []
  const buses = Object.values(s.buses)

  // 1. Missing GPS
  const missingGps = buses.filter((b) => !b.gpsDeviceFitted && b.status === 'active' && !ownerPaysService(b))
  if (missingGps.length > 0) {
    problems.push(`${missingGps.length} bus(es) missing AIS-140 GPS — delays +18%, risks ₹5,000 expressway fines.`)
  }

  // 2. Driver licence vs HP coach
  const hpMismatches = buses.filter((b) => {
    if (b.status !== 'active' || !modelNeedsHp(b.modelId)) return false
    const drivers = Object.values(s.staff).filter(
      (st) => st.busId === b.id && (st.role === 'driver' || st.role === 'co_driver'),
    )
    return drivers.some((d) => d.licenceClass !== 'HMV_HP')
  })
  if (hpMismatches.length > 0) {
    problems.push(`${hpMismatches.length} Volvo/Scania HP coach(es) assigned driver lacking HMV_HP licence endorsement.`)
  }

  // 3. PUC expired
  const pucExpired = buses.filter((b) => b.status === 'active' && b.pucExpiryDay !== undefined && b.pucExpiryDay < s.day)
  if (pucExpired.length > 0) {
    problems.push(`${pucExpired.length} bus(es) have expired PUC emission certificates — RTO fine ₹10,000.`)
  }

  // 4. Home depot overflow
  const homeBusesCount = buses.filter(
    (b) => (b.parkedCityId ?? s.company.homeCityId) === s.company.homeCityId &&
           (b.status === 'active' || b.status === 'workshop' || b.status === 'grounded'),
  ).length
  const depotCap = s.depotSlots ?? BAL.depot.baseSlots
  if (homeBusesCount > depotCap) {
    problems.push(`${homeBusesCount - depotCap} buses parked on the road at home — ₹300/bus nightly overflow + RTO fine risk.`)
  }

  // 5. Night-rest driver still assigned before 10:00
  const nightRestBlocked = buses.filter((b) => {
    if (b.status !== 'active' || !b.scheduleId) return false
    const sch = s.schedules[b.scheduleId]
    if (!sch || sch.depHour >= 10) return false
    const drivers = Object.values(s.staff).filter(
      (st) => st.busId === b.id && (st.role === 'driver' || st.role === 'co_driver'),
    )
    return drivers.some(
      (d) =>
        d.nightRestUntilDay &&
        (s.day < d.nightRestUntilDay ||
          (s.day === d.nightRestUntilDay && (d.nightRestUntilHour ?? 10) > sch.depHour)),
    )
  })
  if (nightRestBlocked.length > 0) {
    problems.push(`${nightRestBlocked.length} morning departure(s) (<10:00) assigned a driver undergoing mandatory CMVR night rest.`)
  }

  // Cleanliness under 30
  const dirtyBuses = buses.filter((b) => b.status === 'active' && (b.busCleanliness ?? 100) < 30)
  if (dirtyBuses.length > 0) {
    problems.push(`${dirtyBuses.length} bus(es) critically dirty (<30 cleanliness) — deep clean in Workshop or ratings drop.`)
  }

  // 8. Open grievances >= 10
  const openGrievances = (s.company.grievances ?? []).filter((g) => g.status === 'open').length
  if (openGrievances >= 10) {
    problems.push(`${openGrievances} open passenger grievances — RedBus rating warning active.`)
  }

  // 9. GST due within 3 days
  if (
    s.company.gstDueDay !== undefined &&
    s.company.gstDueDay >= s.day &&
    s.company.gstDueDay - s.day <= 3 &&
    (s.company.gstPayable ?? 0) > 0
  ) {
    problems.push(`GST remittance due in ${s.company.gstDueDay - s.day}d (Day ${s.company.gstDueDay}) — remit in Money to avoid 1% monthly penalty.`)
  }

  // 10. TDS due
  if (
    s.company.tdsDueDay !== undefined &&
    s.company.tdsDueDay >= s.day &&
    s.company.tdsDueDay - s.day <= 3 &&
    (s.company.tdsPayable ?? 0) > 0
  ) {
    problems.push(`Quarterly TDS return due in ${s.company.tdsDueDay - s.day}d — file in Money to avoid statutory interest.`)
  }

  // Other general problems
  if (buses.length === 0) problems.push('No buses. Visit the Market (3) to buy, lease or attach one.')
  const idle = buses.filter((b) => !b.scheduleId && b.status === 'active')
  if (idle.length > 0) problems.push(`${idle.length} bus(es) idle without a schedule.`)
  const uncrewed = buses.filter((b) => {
    if (!b.scheduleId || b.ownership === 'attached') return false
    const drivers = Object.values(s.staff).filter((st) => st.busId === b.id && st.role === 'driver')
    return drivers.length === 0
  })
  if (uncrewed.length > 0) problems.push(`${uncrewed.length} scheduled bus(es) have NO drivers — trips will cancel.`)
  const noCond = buses.filter((b) => {
    if (!b.scheduleId || b.ownership === 'attached') return false
    return Object.values(s.staff).filter((st) => st.busId === b.id && st.role === 'conductor').length === 0
  })
  if (noCond.length > 0) problems.push(`${noCond.length} scheduled bus(es) have no conductor — trips still run, ratings will suffer.`)
  const overdue = buses.filter((b) => !ownerPaysService(b) && serviceDueKm(b) > 0)
  if (overdue.length > 0) problems.push(`${overdue.length} bus(es) overdue for service (breakdown risk rising).`)
  const grounded = buses.filter((b) => b.status === 'grounded' || b.status === 'workshop')
  if (grounded.length > 0) problems.push(`${grounded.length} bus(es) grounded / in workshop.`)
  const impoundedBuses = buses.filter((b) => b.impoundUntilDay !== undefined && b.impoundUntilDay > s.day)
  if (impoundedBuses.length > 0) problems.push(`${impoundedBuses.length} bus(es) impounded at RTO checkpost.`)
  const expiredDocs = buses.filter((b) => b.insuranceExpiryDay < s.day || b.fitnessExpiryDay < s.day || !!b.fitnessFailed)
  if (expiredDocs.length > 0) problems.push(`${expiredDocs.length} bus(es) have expired insurance or fitness papers.`)

  const leasedSet = new Set((s.yards ?? []).map((y) => y.cityId))
  const unleasedCities = Array.from(new Set(
    buses
      .filter((b) => (b.status === 'active' || b.status === 'workshop' || b.status === 'grounded') &&
                     (b.parkedCityId ?? s.company.homeCityId) !== s.company.homeCityId &&
                     !leasedSet.has(b.parkedCityId!))
      .map((b) => b.parkedCityId!),
  ))
  for (const c of unleasedCities) {
    problems.push(`Overnight fee at ${cityName(c)} — lease a yard in Workshop to avoid fees.`)
  }
  for (const loan of Object.values(s.loans)) {
    if (loan.status === 'active' && loan.consecutiveMissed > 0) {
      problems.push(`${loan.lender}: ${loan.consecutiveMissed} missed EMI(s) — repossession at ${BAL.repoAfterConsecutiveMissed}.`)
    }
  }
  if (s.od.drawn > 0) problems.push(`Overdraft drawn ${fmtCompact(s.od.drawn)} — daily interest running.`)

  const recent = s.kpis.slice(-14)
  const avgBurn = recent.length > 3 ? recent.reduce((a, k) => a + k.profit, 0) / recent.length : 0
  const runway = avgBurn < 0 ? Math.floor((s.company.cash + (s.od.limit - s.od.drawn)) / -avgBurn) : null
  if (runway !== null && runway < 21) problems.push(`Cash runway ~${runway}d at recent burn — check Money.`)

  const meters = spanMeters(s)
  for (const m of Object.values(meters)) {
    const unattended = Math.max(0, m.demand - m.capacity)
    if (unattended > 0 && deskHead(s, m.desk)) {
      problems.push(`${DESK_LABEL[m.desk]} manager span exceeded (${m.demand}/${m.capacity} ${DESK_UNIT[m.desk]} · ${unattended} unattended) — appoint ${m.assistantsToCover} assistant(s).`)
    }
  }

  const chartData = s.kpis.slice(-30).map((k) => ({
    d: fmtDateShort(k.day),
    profit: Math.round(toRupees(k.profit)),
  }))

  const recentLog = [...s.inbox].slice(-8).reverse()

  return (
    <>
      <div className="page-title">
        Dashboard
        <span className="sub">Problems and cash pulse — tonight’s board is on Trips</span>
        <span className="spacer" />
        <button className="small" onClick={() => setLogOpen((v) => !v)}>{logOpen ? 'Hide log' : 'Log'}</button>
      </div>

      {/* Active Operational & Quality Badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <span className="dim small" style={{ fontWeight: 600 }}>OPERATOR BADGES:</span>
        {s.company.primo ? (
          <span className="pill accent" title="RedBus Primo Operator (+28% search visibility)">★ RedBus Primo</span>
        ) : (
          <span className="pill dim small">Primo: Ineligible (needs 4.2★ & 88% on-time)</span>
        )}
        {s.company.certifications?.womenFriendly ? (
          <span className="pill good" title="Women-Friendly & Safe Coach (+12% female passenger bookings)">🛡️ Women-Friendly & Safe Coach</span>
        ) : (
          <span className="pill dim small">Women-Friendly: Needs 4.0★ & 50%+ CCTV</span>
        )}
        {s.company.certifications?.cleanCertified ? (
          <span className="pill info" title="Clean Coach Certified (+8% organic OTA demand boost)">✨ Clean Coach Certified</span>
        ) : (
          <span className="pill dim small">Clean Certified: Needs 4.2★ & 75+ clean</span>
        )}
        {s.company.fuelContract?.active && s.company.fuelContract.partner !== 'none' && (
          <span className="pill good" title="2.5% fuel cashback rebate + pure fuel adulteration immunity">⛽ {s.company.fuelContract.partner.toUpperCase()} Fleet Card</span>
        )}
        {s.company.depotFuelTank?.installed && (
          <span className="pill" title="10,000L bulk fuel storage at home depot (-₹4/L wholesale discount)">🛢️ 10,000L Bulk Yard Tank ({Math.round(s.company.depotFuelTank.currentLitres).toLocaleString('en-IN')}L)</span>
        )}
        {s.company.ecoIncentiveActive && (
          <span className="pill accent" title="₹250/trip mileage incentive active (+8% km/l, -15% tyre wear)">🌱 Eco-Driving Bonus</span>
        )}
      </div>

      <div className="grid-2">
        <Panel title="Top problems">
          {problems.length === 0 ? (
            <span className="good">All clear. Grow something.</span>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {problems.slice(0, 8).map((p, i) => <li key={i} className={i === 0 ? 'bad' : 'warn'}>{p}</li>)}
            </ul>
          )}
          {runway !== null ? (
            <div className="dim small" style={{ marginTop: 8 }}>
              Runway {runway}d · rating {s.company.rating.toFixed(2)}★ · diesel {fmtCompact(s.world.dieselPaise)}/L
            </div>
          ) : (
            <div className="dim small" style={{ marginTop: 8 }}>
              Cash-positive · rating {s.company.rating.toFixed(2)}★ · diesel {fmtCompact(s.world.dieselPaise)}/L
            </div>
          )}
        </Panel>

        <Panel title="30-day daily P&L (₹)">
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
              <XAxis dataKey="d" tick={{ fontSize: 9, fill: '#4d5966' }} interval={6} />
              <YAxis tick={{ fontSize: 9, fill: '#4d5966' }} width={52} />
              <Tooltip content={({ payload, label }) => (
                <div className="chart-tooltip">
                  {label}: {payload?.map((p) => `${p.name} ₹${Number(p.value).toLocaleString('en-IN')}`).join(' · ')}
                </div>
              )} />
              <Area type="monotone" dataKey="profit" stroke="#e8a33d" fill="#e8a33d22" name="profit" />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="grid-2" style={{ gap: 16, marginTop: 16 }}>
        <FleetHealthPanel />
        <CargoTrendPanel />
      </div>

      <div className="grid-2" style={{ gap: 16, marginTop: 16 }}>
        <ChannelMixPanel />
        {(() => {
          const openComplaints = (s.company.grievances ?? []).filter((g) => g.status === 'open').slice(0, 8)
          return (
            <Panel
              title={`Open complaints (${s.company.grievanceCount ?? openComplaints.length})`}
              info="Passenger complaints unresolved. 10 open triggers a RedBus warning; 25 triggers an RTO inspection with fines. Appoint a CRM manager to auto-handle."
            >
              {openComplaints.length === 0 ? (
                <span className="good">No open complaints. Customer satisfaction is steady.</span>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Bus / Route</th>
                      <th>Cause</th>
                      <th className="num">Suggested refund</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {openComplaints.map((grv) => {
                      const b = s.buses[grv.busId]
                      return (
                        <tr key={grv.id}>
                          <td>Day {grv.day}</td>
                          <td>
                            <span className="accent">{b?.reg ?? grv.busId}</span>
                            <span className="dim small"> · {routeName(grv.routeId)}</span>
                          </td>
                          <td>
                            <span className="pill warn">{grv.cause.toUpperCase()}</span>
                          </td>
                          <td className="num">{fmtCompact(grv.amount)}</td>
                          <td className="num nowrap">
                            <button
                              className="small"
                              title="Issue refund and gain reputation (+0.2)"
                              onClick={() => g.resolveGrievance(grv.id, 'refund')}
                            >
                              Refund
                            </button>
                            <button
                              className="small danger"
                              title="Dispute complaint (60% dismiss, 40% escalate with ₹2,000 fine)"
                              onClick={() => g.resolveGrievance(grv.id, 'dispute')}
                            >
                              Dispute
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </Panel>
          )
        })()}
      </div>

      {logOpen && (
        <Panel title="Latest" flat>
          <div style={{ padding: '6px 10px' }}>
            {recentLog.length === 0 && <span className="dim">No messages yet.</span>}
            {recentLog.map((m) => (
              <div key={m.id} className="log-line">
                <span className="d">{fmtDateShort(m.day)}</span>
                <span className={`log-cat-${m.cat}`}>{m.text}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  )
}
