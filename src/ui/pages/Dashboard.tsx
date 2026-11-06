import { useState } from 'react'
import { Link } from 'react-router-dom'
import { computeAdvisor } from '../../engine/sim/advisor'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useGameActions, useDeferredGameState } from '../../store/gameStore'
import { fmtDateShort } from '../../engine/core/calendar'
import { fmtCompact, toRupees } from '../../engine/core/money'
import { routeName } from '../../engine/data/routes'
import { activeObjectives, OBJECTIVES, objectiveDone } from '../../engine/sim/objectives'
import { Bar, BusLink, Panel, PageHeader } from '../bits'
import { FleetHealthPanel, CargoTrendPanel, ChannelMixPanel } from '../opsPanels'

export function Dashboard() {
  const s = useDeferredGameState()!
  const g = useGameActions()
  const [logOpen, setLogOpen] = useState(false)

  const tasks = computeAdvisor(s)
  const recent = s.kpis.slice(-14)
  const avgBurn = recent.length > 3 ? recent.reduce((a, k) => a + k.profit, 0) / recent.length : 0
  const runway = avgBurn < 0 ? Math.floor((s.company.cash + (s.od.limit - s.od.drawn)) / -avgBurn) : null

  const chartData = s.kpis.slice(-30).map((k) => ({
    d: fmtDateShort(k.day),
    profit: Math.round(toRupees(k.profit)),
  }))

  const recentLog = [...s.inbox].slice(-8).reverse()

  return (
    <>
      <PageHeader title="Dashboard" facts={<>day {s.day - s.startDay + 1} · fleet {Object.values(s.buses).filter((b) => b.status === 'active').length}</>}>
        <button className="small" onClick={() => setLogOpen((v) => !v)}>{logOpen ? 'Hide log' : 'Log'}</button>
      </PageHeader>

      <div className="row gap" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        {s.company.primo
          ? <span className="pill accent" title="RedBus Primo: +28% search visibility">Primo</span>
          : <span className="pill dim" title="Primo needs 4.2★ and 88% on-time">Primo</span>}
        {s.company.certifications?.womenFriendly
          ? <span className="pill good" title="Women-Friendly: +12% female bookings">Women-Friendly</span>
          : <span className="pill dim" title="Needs 4.0★ and 50%+ CCTV coverage">Women-Friendly</span>}
        {s.company.certifications?.cleanCertified
          ? <span className="pill info" title="Clean Coach: +8% organic OTA demand">Clean Coach</span>
          : <span className="pill dim" title="Needs 4.2★ and 75+ cleanliness">Clean Coach</span>}
        {s.company.fuelContract?.active && s.company.fuelContract.partner !== 'none' && (
          <span className="pill good" title="2.5% fuel cashback, adulteration immunity">{s.company.fuelContract.partner.toUpperCase()} card</span>
        )}
        {s.company.depotFuelTank?.installed && (
          <span className="pill" title="Bulk depot tank: -₹4/L wholesale">Tank {Math.round(s.company.depotFuelTank.litres).toLocaleString('en-IN')}L</span>
        )}
        {s.company.ecoIncentiveActive && (
          <span className="pill accent" title="₹250/trip incentive: +8% km/l, -15% tyre wear">Eco bonus</span>
        )}
      </div>

      <div className="grid-2">
        <Panel title="Top problems">
          {tasks.length === 0 ? (
            <span className="good">All clear. Grow something.</span>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
              {tasks.slice(0, 8).map((t) => (
                <li key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 3 }}>
                  <span className={t.severity === 'critical' ? 'bad' : t.severity === 'warn' ? 'warn' : 'dim'} style={{ flex: 1 }}>{t.text}</span>
                  <Link to={t.to} className="small">{t.cta} ›</Link>
                </li>
              ))}
              {tasks.length > 8 && <li className="dim small">+{tasks.length - 8} more</li>}
            </ul>
          )}
          <div className="muted" style={{ marginTop: 8 }}>
            {runway !== null ? `runway ${runway}d` : 'cash-positive'} · diesel {fmtCompact(s.world.dieselPaise)}/L
          </div>
        </Panel>

        <Panel title={`Company goals (${OBJECTIVES.filter((o) => objectiveDone(s, o.id)).length}/${OBJECTIVES.length})`}>
          {activeObjectives(s).map((o) => {
            const p = o.progress(s)
            const f = p.fmt ?? ((v: number) => String(Math.round(v * 100) / 100))
            return (
              <div key={o.id} className="mb8">
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <b title={o.hint} className="grow">{o.label}</b>
                  <Link to={o.to} className="small">Go ›</Link>
                </div>
                <div className="small">
                  <Bar value={p.target > 0 ? p.current / p.target : 0} width={14} tone="auto" />{' '}
                  <span className="dim">{f(p.current)} / {f(p.target)}</span>
                </div>
              </div>
            )
          })}
          {activeObjectives(s).length === 0 && <span className="good">Every goal reached.</span>}
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
                          <td>{fmtDateShort(grv.day)}</td>
                          <td>
                            {b ? <BusLink id={b.id} reg={b.reg} /> : <span className="accent">{grv.busId}</span>}
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
