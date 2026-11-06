import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { useGameActions, useDeferredGameState } from '../../store/gameStore'
import { fmtDate, fmtDateShort } from '../../engine/core/calendar'
import { fmtCompact } from '../../engine/core/money'
import { Bar, BusLink, CoachCell, Empty, M, PageHeader, Panel, StatRow, Tabs } from '../bits'
import { BUS_MODELS, coachKind, isCharterModel, modelTitle } from '../../engine/data/busModels'
import { CHARTER_CATEGORIES } from '../../engine/data/charterRoutes'
import {
  busHealthScore,
  charterDriverShortfall,
  charterWinChance,
  quoteCharterForBus,
  canBusTakeContract,
  getCharterConfig,
  getCharterFleet,
  getEligibleCharterBaseCities,
  isBusBusyOnCharter,
} from '../../engine/sim/charter'
import { FLEET_MANAGER_ROLES } from '../../engine/sim/staffing'
import { spanMeters } from '../../engine/sim/span'
import type { CharterPricingStrategy, CharterContract, ID } from '../../engine/types'

type Tab = 'inquiries' | 'tours' | 'fleet' | 'history' | 'policy'

const PRICING: Record<CharterPricingStrategy, { label: string; effect: string; detail: string }> = {
  discount: { label: 'Discount', effect: '-12% fee · wins more bids', detail: 'Undercuts the market fee for each coach, so clients rarely go to a rival.' },
  market: { label: 'Market', effect: 'standard rates', detail: 'South India hire rates for the coach you send. Profit is capped at 50% of the fee.' },
  premium: { label: 'Premium', effect: '+20% fee · loses more bids · needs condition 75+', detail: 'High-end weddings and retreats; needs a clean, well-kept coach. Clients compare quotes, so more go to rivals. Profit is still capped at 50% of the fee.' },
}

const LAYOUT_LABEL: Record<string, string> = { semi: 'Semi-sleeper', sleeper: 'Sleeper', seater: 'Seater', van: 'Van / mini bus' }

const catLabel = (id: string) => CHARTER_CATEGORIES.find((c) => c.id === id)?.label ?? id

export function ChartersPage() {
  const s = useDeferredGameState()!
  const g = useGameActions()

  const [tab, setTab] = useState<Tab>('inquiries')
  const [pick, setPick] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [dedicate, setDedicate] = useState('')

  const cfg = getCharterConfig(s)
  const mgr = s.company.charterManagerId ? s.staff[s.company.charterManagerId] : undefined
  const span = spanMeters(s).charter
  const managers = Object.values(s.staff).filter((st) => FLEET_MANAGER_ROLES.includes(st.role))
  const bases = getEligibleCharterBaseCities(s)

  const inquiries = s.charterInquiries ?? []
  const tours = (s.charterContracts ?? []).filter((c) => c.status === 'active' || c.status === 'booked')
  const history = s.charterHistory ?? []
  const stats = s.charterStats ?? { totalContracts: 0, totalRevenue: 0, totalProfit: 0, avgRating: 4.8 }
  const fleet = getCharterFleet(s)
  const freeFleet = fleet.filter((b) => !isBusBusyOnCharter(s, b.id))
  const lineBuses = Object.values(s.buses).filter(
    (b) => b.duty !== 'charter' && b.status === 'active' && !b.scheduleId && !isCharterModel(b.modelId),
  )

  const sign = (id: string) => {
    const busId = pick[id]
    if (!busId) return g.toast('Choose a coach first.', 'bad')
    g.acceptCharterInquiry(id, busId)
  }

  const candidateFleet = [...fleet, ...lineBuses]

  const eligible = (inq: CharterContract) =>
    candidateFleet.filter((b) => canBusTakeContract(b, inq, undefined, true).ok && !isBusBusyOnCharter(s, b.id, inq.startDay, inq.endDay) && !charterDriverShortfall(s, b, inq))

  /** Why no coach fits: the first blocking reason per coach, so the player knows what to fix. */
  const blockers = (inq: CharterContract) =>
    candidateFleet
      .map((b) => {
        const check = canBusTakeContract(b, inq, undefined, true)
        if (!check.ok) return `${b.reg}: ${check.reason}`
        if (isBusBusyOnCharter(s, b.id, inq.startDay, inq.endDay)) return `${b.reg}: booked on those dates`
        const noDriver = charterDriverShortfall(s, b, inq)
        if (noDriver) return `${b.reg}: ${noDriver}`
        return null
      })
      .filter(Boolean) as string[]

  return (
    <>
      <PageHeader title="Charters" tip="Pilgrimage, wedding, school and tour block bookings">
        <label className="row gap6" title={bases.length === 1 ? 'Open a premium lounge in another city to unlock more bases' : 'Charter base city'}>
          <span className="muted">Base</span>
          <select value={cfg.operatingBaseCityId} onChange={(e) => g.setCharterOperatingBase(e.target.value)}>
            {bases.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="row gap6" title="Unlocks auto-assign and negotiation">
          <span className="muted">Manager</span>
          <select
            value={s.company.charterManagerId ?? ''}
            onChange={(e) => g.appointCharterManager(e.target.value ? (e.target.value as ID) : undefined)}
          >
            <option value="">none</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.name} (skill {m.skill})</option>)}
          </select>
        </label>
      </PageHeader>

      <StatRow
        items={[
          { label: 'Fleet', value: `${freeFleet.length}/${fleet.length} free` },
          { label: 'Inquiries', value: inquiries.length, tone: inquiries.length > 0 ? 'accent' : undefined },
          { label: 'On tour', value: tours.length, tone: tours.length > 0 ? 'good' : undefined },
          { label: 'Revenue', value: <M v={stats.totalRevenue} />, title: `${stats.totalContracts} completed` },
          {
            label: 'Profit',
            value: <M v={stats.totalProfit} />,
            tone: stats.totalProfit >= 0 ? 'good' : 'bad',
            title: stats.totalRevenue > 0 ? `${Math.round((stats.totalProfit / stats.totalRevenue) * 100)}% margin` : undefined,
          },
          { label: 'Client rating', value: `${stats.avgRating}★`, tone: 'warn' },
        ]}
      />

      <div className="row gap mb12">
        <Tabs
          tabs={[
            ['inquiries', `Inquiries (${inquiries.length})`],
            ['tours', `Tours (${tours.length})`],
            ['fleet', `Fleet (${fleet.length})`],
            ['history', `History (${history.length})`],
            ['policy', 'Policy'],
          ] as const}
          value={tab}
          onChange={setTab}
          inline
        />
        <span className="grow" />
        {mgr && tab === 'inquiries' && inquiries.length > 0 && (
          <button className="small primary" onClick={() => g.autoAssignCharters()} title="Match the most profitable coach to each inquiry">
            Auto-assign ({inquiries.length})
          </button>
        )}
      </div>

      {/* ---------------- INQUIRIES ---------------- */}
      {tab === 'inquiries' && (
        inquiries.length === 0 ? (
          <Panel flat><Empty text="No open inquiries." /></Panel>
        ) : (
          <Panel flat>
            <div className="xscroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Tour</th>
                  <th>When</th>
                  <th>Needs</th>
                  <th className="num">Fee</th>
                  <th>Coach</th>
                  <th className="num">Profit</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {inquiries.map((inq) => {
                  const options = eligible(inq)
                  const busId = pick[inq.id]
                  const bus = busId ? s.buses[busId] : undefined
                  const quote = bus ? quoteCharterForBus(s, inq, bus) : null
                  const win = bus ? charterWinChance(s, inq, bus) : null
                  const cost = quote?.costs ?? null
                  const optionFees = options.map((b) => quoteCharterForBus(s, inq, b).payout)
                  const feeLo = optionFees.length ? Math.min(...optionFees) : inq.payout
                  const feeHi = optionFees.length ? Math.max(...optionFees) : inq.payout
                  const isOpen = open === inq.id
                  return (
                    <Fragment key={inq.id}>
                      <tr>
                        <td>
                          <b>{inq.title}</b>
                          <div className="muted">{inq.clientName} · {inq.destinationName}</div>
                          <div className="muted">{catLabel(inq.category)}</div>
                        </td>
                        <td className="nowrap">
                          {fmtDate(inq.startDay)}
                          <div className="muted">{inq.durationDays} day{inq.durationDays === 1 ? '' : 's'} · {inq.roundTripKm} km</div>
                          {(inq.positioningKm ?? 0) > 0 && (
                            <div className="muted" title="Empty run from our charter base to the client's city and back, at our cost">+{inq.positioningKm} km empty run</div>
                          )}
                          {inq.respondByDay !== undefined && <div className="muted">reply by {fmtDate(inq.respondByDay)}</div>}
                        </td>
                        <td className="nowrap">
                          <b>{inq.minSeats}+</b> seats
                          <div className="muted">{LAYOUT_LABEL[inq.preferredCoachKind] ?? inq.preferredCoachKind}</div>
                        </td>
                        <td className="num good" title="Priced by the coach you send">
                          {quote ? <M v={quote.payout} /> : feeLo === feeHi ? <span className="muted">~<M v={feeLo} /></span> : <span className="muted"><M v={feeLo} />–<M v={feeHi} /></span>}
                        </td>
                        <td>
                          <select value={busId ?? ''} onChange={(e) => setPick((p) => ({ ...p, [inq.id]: e.target.value }))}>
                            <option value="">{options.length > 0 ? `choose (${options.length} free)` : 'none free'}</option>
                            {options.map((b) => (
                              <option key={b.id} value={b.id}>{b.reg} · {BUS_MODELS[b.modelId]?.seats}s · {busHealthScore(b)}% · {fmtCompact(optionFees[options.indexOf(b)]!)}</option>
                            ))}
                          </select>
                        </td>
                        <td className="num">
                          {cost ? <span className={cost.netProfit >= 0 ? 'good' : 'bad'}><M v={cost.netProfit} /> <span className="muted">{cost.marginPct}%</span></span> : <span className="dim">—</span>}
                          {win !== null && <div className="muted" title="Chance the client books us rather than a rival at this fee">{Math.round(win * 100)}% win</div>}
                        </td>
                        <td className="nowrap right">
                          <button className="small" title="Cost breakdown" onClick={() => setOpen(isOpen ? null : inq.id)}>{isOpen ? '▴' : '▾'}</button>{' '}
                          <button className="small primary" disabled={!busId} onClick={() => sign(inq.id)}>Sign</button>{' '}
                          <button className="small dim" title="Decline" onClick={() => g.rejectCharterInquiry(inq.id)}>✕</button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7}>
                            <div className="row gap wrap" style={{ alignItems: 'flex-start', gap: 28 }}>
                              <div>
                                <div className="muted">Direct costs {bus ? `(${bus.reg})` : ''}</div>
                                {cost ? (
                                  <table className="data" style={{ width: 'auto' }}>
                                    <tbody>
                                      <tr><td>Fuel · {cost.isElectric ? 'EV' : `${cost.fuelLitres}L @ ${cost.fuelKmpl.toFixed(1)} km/l`}</td><td className="num"><M v={cost.fuelCost} /></td></tr>
                                      <tr><td>Driver outstation bata · {cost.driverCount} driver{cost.driverCount > 1 ? 's' : ''} × {inq.durationDays}d</td><td className="num"><M v={cost.driverBata} /></td></tr>
                                      <tr><td>FASTag tolls & permits</td><td className="num"><M v={cost.tollCost} /></td></tr>
                                      {cost.maintenanceCost > 0 && <tr><td>Maintenance & prep</td><td className="num"><M v={cost.maintenanceCost} /></td></tr>}
                                      <tr><td><b>Total</b></td><td className="num"><b><M v={cost.totalDirectCost} /></b></td></tr>
                                      {quote && (
                                        <tr>
                                          <td colSpan={2} className="muted">
                                            ₹{quote.ratePerKm}/km for this coach · fee <M v={quote.payout} />
                                            {quote.capped ? ' · held at the 50% profit cap' : quote.floored ? ' · raised to cost + 5%' : ''}
                                            {(inq.positioningKm ?? 0) > 0 ? ` · costs include the ${inq.positioningKm} km empty run` : ''}
                                          </td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                ) : (
                                  <div className="dim">Choose a coach to see costs.</div>
                                )}
                              </div>
                              {options.length === 0 && (
                                <div>
                                  <div className="muted">Why no coach fits</div>
                                  {candidateFleet.length === 0
                                    ? <div className="dim">No coaches in depot or charter fleet. Dedicate one or purchase in Market.</div>
                                    : blockers(inq).map((r) => <div key={r} className="warn">{r}</div>)}
                                </div>
                              )}
                              {inq.notes && <div className="muted" style={{ maxWidth: 320, whiteSpace: 'normal' }}>{inq.notes}</div>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
            </div>
          </Panel>
        )
      )}

      {/* ---------------- TOURS ---------------- */}
      {tab === 'tours' && (
        tours.length === 0 ? (
          <Panel flat><Empty text="No tours booked." /></Panel>
        ) : (
          <Panel flat>
            <table className="data">
              <thead>
                <tr>
                  <th>Tour</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Coach</th>
                  <th>Dates</th>
                  <th className="num">Km</th>
                  <th className="num">Fee</th>
                  <th className="num">Est. profit</th>
                </tr>
              </thead>
              <tbody>
                {tours.map((c) => {
                  const bus = c.busId ? s.buses[c.busId] : undefined
                  const running = c.status === 'active'
                  return (
                    <tr key={c.id}>
                      <td><b>{c.title}</b><div className="muted">{c.clientName} · {c.destinationName}</div></td>
                      <td><span className={`pill small ${running ? 'good' : 'info'}`}>{running ? 'on tour' : 'booked'}</span></td>
                      <td className="nowrap">
                        <Bar value={running ? c.currentDayProgress / c.durationDays : 0} width={8} tone="good" />{' '}
                        <span className="muted">{running ? c.currentDayProgress : 0}/{c.durationDays}d</span>
                      </td>
                      <td>{bus ? <div><CoachCell bus={bus} /><div className="dim small" style={{ fontSize: '0.74rem' }}>{busHealthScore(bus)}% health</div></div> : <span className="dim">unassigned</span>}</td>
                      <td className="nowrap">{fmtDateShort(c.startDay)} – {fmtDateShort(c.endDay)}<div className="muted">{c.durationDays} day{c.durationDays === 1 ? '' : 's'}</div></td>
                      <td className="num">{c.roundTripKm}</td>
                      <td className="num good"><M v={c.payout} /></td>
                      <td className="num"><M v={c.netProfitEst} colored /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Panel>
        )
      )}

      {/* ---------------- FLEET ---------------- */}
      {tab === 'fleet' && (
        <>
          <div className="row gap mb12">
            <select value={dedicate} onChange={(e) => setDedicate(e.target.value)} style={{ minWidth: 240 }}>
              <option value="">Add an idle line coach ({lineBuses.length})</option>
              {lineBuses.map((b) => (
                <option key={b.id} value={b.id}>{b.reg} · {modelTitle(BUS_MODELS[b.modelId])} · {BUS_MODELS[b.modelId]?.seats}s</option>
              ))}
            </select>
            <button
              className="small primary"
              disabled={!dedicate}
              onClick={() => { g.setBusDuty(dedicate, 'charter'); setDedicate('') }}
            >
              Dedicate
            </button>
            <span className="grow" />
            <Link to="/market" className="small">Buy charter vehicles ›</Link>
          </div>
          <Panel flat>
            {fleet.length === 0 ? (
              <Empty text="No charter coaches." />
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Coach</th>
                    <th>Model</th>
                    <th className="num">Seats</th>
                    <th>Status</th>
                    <th className="num">Condition</th>
                    <th className="num">Rating</th>
                    <th className="num">Tours</th>
                    <th className="num">Earned</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {fleet.map((b) => {
                    const m = BUS_MODELS[b.modelId]
                    const busy = isBusBusyOnCharter(s, b.id)
                    const special = isCharterModel(b.modelId)
                    const health = busHealthScore(b)
                    return (
                      <tr key={b.id}>
                        <td><BusLink id={b.id} reg={b.reg} />{special && <span className="pill small info ml6">charter model</span>}</td>
                        <td>{modelTitle(m)} <span className="muted">{coachKind(m)}</span></td>
                        <td className="num">{m?.seats ?? '—'}</td>
                        <td><span className={`pill small ${busy ? 'warn' : 'good'}`}>{busy ? 'on tour' : 'free'}</span></td>
                        <td className={`num ${health >= cfg.minConditionScore ? 'good' : 'bad'}`} title={`Charter minimum ${cfg.minConditionScore}%`}>{health}%</td>
                        <td className="num">{b.qualityScore.toFixed(1)}★</td>
                        <td className="num">{b.lifeTrips}</td>
                        <td className="num good"><M v={b.lifeRevenue} /></td>
                        <td className="num">
                          {!special && !busy && (
                            <button className="small dim" onClick={() => g.setBusDuty(b.id, 'line')}>Return to line</button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Panel>
        </>
      )}

      {/* ---------------- HISTORY ---------------- */}
      {tab === 'history' && (
        history.length === 0 ? (
          <Panel flat><Empty text="No completed charters yet." /></Panel>
        ) : (
          <Panel flat>
            <table className="data">
              <thead>
                <tr>
                  <th>Tour</th>
                  <th>Coach</th>
                  <th className="num">Km</th>
                  <th className="num">Fee</th>
                  <th className="num">Costs</th>
                  <th className="num">Profit</th>
                  <th className="num">Client</th>
                </tr>
              </thead>
              <tbody>
                {history.map((c) => {
                  const bus = c.busId ? s.buses[c.busId] : undefined
                  const rev = c.completedRevenue ?? c.payout
                  const exp = c.completedExpenses ?? (c.fuelCostEst + c.tollCostEst + c.driverBataEst + (c.maintenanceCostEst ?? 0))
                  return (
                    <tr key={c.id}>
                      <td>
                        <b>{c.title}</b>
                        <div className="muted">{c.clientName} · {c.destinationName} · {c.durationDays}d</div>
                        {c.notes?.includes('Breakdown') && <div className="warn">breakdown en route: fee cut</div>}
                      </td>
                      <td><CoachCell bus={bus} /></td>
                      <td className="num">{c.roundTripKm}</td>
                      <td className="num"><M v={rev} /></td>
                      <td className="num warn"><M v={exp} /></td>
                      <td className="num"><M v={rev - exp} colored /></td>
                      <td className="num">{c.clientRating ? `${c.clientRating}★` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Panel>
        )
      )}

      {/* ---------------- POLICY ---------------- */}
      {tab === 'policy' && (
        <div className="grid-2">
          <Panel title="Pricing">
            <div className="stack10">
              {(Object.keys(PRICING) as CharterPricingStrategy[]).map((k) => (
                <label key={k} className="row gap" style={{ cursor: 'pointer' }} title={PRICING[k].detail}>
                  <input type="radio" name="pricing" checked={cfg.pricingStrategy === k} onChange={() => g.setCharterPricingStrategy(k)} />
                  <b className="bold">{PRICING[k].label}</b>
                  <span className="muted">{PRICING[k].effect}</span>
                </label>
              ))}
            </div>
          </Panel>
          <Panel title="Dispatch">
            <div className="stack10">
              <label className="row gap" style={{ cursor: 'pointer' }} title="The manager books the best free coach for each inquiry">
                <input type="checkbox" checked={cfg.autoAccept} disabled={!mgr} onChange={(e) => g.setCharterAutoAccept(e.target.checked)} />
                <span>Auto-accept inquiries</span>
                {!mgr && <span className="muted">needs a manager</span>}
              </label>
              <div>
                <div className="row between">
                  <span className="muted" title="Coaches below this are not offered for tours">Minimum condition</span>
                  <b>{cfg.minConditionScore}%</b>
                </div>
                <input
                  type="range"
                  min="40"
                  max="90"
                  step="5"
                  value={cfg.minConditionScore}
                  onChange={(e) => g.setCharterMinCondition(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <div className="row between">
                  <span className="muted" title="Auto-accept only books tours with at least this margin">Minimum margin</span>
                  <b>{cfg.minMarginPct ?? 0}%</b>
                </div>
                <input type="range" min="0" max="50" step="5" value={cfg.minMarginPct ?? 0} onChange={(e) => g.setCharterMinMargin(Number(e.target.value))} style={{ width: '100%' }} />
              </div>
              <div>
                <div className="row between">
                  <span className="muted" title="Share of the fee collected when the tour is booked. Refunded if the tour is cancelled.">Deposit</span>
                  <b>{cfg.depositPct ?? 0}%</b>
                </div>
                <input type="range" min="0" max="50" step="5" value={cfg.depositPct ?? 0} onChange={(e) => g.setCharterDeposit(Number(e.target.value))} style={{ width: '100%' }} />
              </div>
              {mgr && (
                <div className="muted" title="Contracts the desk can supervise at once">
                  Desk load {span.demand}/{span.capacity} contracts
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}
    </>
  )
}
