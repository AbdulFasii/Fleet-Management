import { Fragment, useMemo, useState } from 'react'
import { useGame } from '../../store/gameStore'
import { fmtYm, fmtDateShort, ymKey } from '../../engine/core/calendar'
import { fleetBookValue, loansOutstanding, netWorth, receivablesTotal, getMonthlyFuelBreakdown } from '../../engine/sim/finance'
import type { MonthlySummary, Txn, TxnHead } from '../../engine/types'
import { M, Panel } from '../bits'

const INCOME_LABELS: Partial<Record<TxnHead, string>> = {
  ticket: 'Ticket sales', cargo: 'Parcel & cargo', charter: 'Festival & tour charters', advertising: 'Body advertising',
  cancellation_fee: 'Cancellation retained',
  insurance_claim: 'Insurance settlements', other_income: 'Other',
}

const EXPENSE_GROUPS: { label: string; heads: [TxnHead, string][] }[] = [
  {
    label: 'Direct trip costs',
    heads: [['fuel', 'Diesel / energy'], ['adblue', 'AdBlue'], ['toll', 'Tolls (FASTag)'], ['border_tax', 'Border / entry tax'], ['bata', 'Crew bata'], ['parking_cleaning', 'Parking & cleaning']],
  },
  {
    label: 'Channels & marketing',
    heads: [['redbus_commission', 'RedBus commission'], ['agent_commission', 'Agent commission'], ['pg_fees', 'Payment gateway'], ['marketing', 'App marketing'], ['app_opex', 'App opex']],
  },
  {
    label: 'Fleet',
    heads: [['maintenance', 'Maintenance & repairs'], ['accident_repair', 'Accident & repair'], ['tyres', 'Tyres'], ['insurance', 'Insurance'], ['fitness', 'Fitness certs'], ['road_tax', 'Annual road tax'], ['permit_tax', 'Route permits'], ['gps_telematics', 'GPS'], ['lease_rent', 'Lease rents'], ['attach_owner_share', 'Attach owner share'], ['inspection', 'Inspections'], ['rebranding', 'Rebranding'], ['amenity_retrofit', 'Amenity retrofits']],
  },
  {
    label: 'People & admin',
    heads: [['salary', 'Salaries'], ['training', 'Training'], ['office_admin', 'Office & admin'], ['depot_rent', 'Depot rent']],
  },
  {
    label: 'Finance & statutory',
    heads: [['interest', 'Loan interest (EMI)'], ['od_interest', 'Overdraft interest'], ['penalty', 'Penalties'], ['processing_fee', 'Processing fees'], ['gst', 'GST remitted'], ['income_tax', 'Income tax'], ['fine', 'Fines & challans'], ['refund', 'Refunds'], ['depreciation', 'Depreciation (non-cash)']],
  },
]

function PnlTab() {
  const s = useGame((g) => g.state)!
  const months: MonthlySummary[] = [...s.monthly.slice(-5), s.curMonth]
  const hasCargoSplit = months.some((m) => (m.cargoCoachRevenue ?? 0) > 0 || (m.cargoTruckRevenue ?? 0) > 0)

  const row = (label: string, get: (m: MonthlySummary) => number, cls?: string, strong?: boolean) => (
    <tr key={label} className={strong ? 'total' : ''}>
      <td className={cls}>{label}</td>
      {months.map((m) => {
        const v = get(m)
        return <td key={m.ym} className="num">{v !== 0 ? <M v={v} colored={strong} /> : <span className="faint">—</span>}</td>
      })}
    </tr>
  )

  return (
    <Panel flat title="Profit & loss (last months + live current month)">
      <table className="data">
        <thead>
          <tr>
            <th>Head</th>
            {months.map((m, i) => <th key={m.ym} className="num">{fmtYm(m.ym)}{i === months.length - 1 ? ' (live)' : ''}</th>)}
          </tr>
        </thead>
        <tbody>
          {Object.entries(INCOME_LABELS).map(([head, label]) => {
            if (head === 'cargo') {
              const name = s.company.dedicatedCargoSubsidiary ? 'Cargo subsidiary revenue' : label
              return (
                <Fragment key="cargo">
                  {row(name, (m) => (m.income.cargo ?? 0) + (m.income.cargo_spot ?? 0), 'good')}
                  {hasCargoSplit && row('  ↳ Bus cargo (coach bellies)', (m) => m.cargoCoachRevenue ?? 0, 'dim')}
                  {hasCargoSplit && row('  ↳ Dedicated cargo vehicles', (m) => m.cargoTruckRevenue ?? 0, 'dim')}
                </Fragment>
              )
            }
            return row(label, (m) => m.income[head as TxnHead] ?? 0, 'good')
          })}
          {row('TOTAL REVENUE', (m) => m.revenueTotal, 'good', true)}
          {EXPENSE_GROUPS.map((grp) => (
            <Fragment key={grp.label}>
              {grp.heads.map(([head, label]) => (
                <Fragment key={head}>
                  {row(`  ${label}`, (m) => -(m.expense[head] ?? 0), 'dim')}
                  {head === 'fuel' && (
                    <>
                      <tr key="fuel_roadside">
                        <td className="dim small" style={{ paddingLeft: 24, fontStyle: 'italic' }}>↳ Highway roadside pumps (retail)</td>
                        {months.map((m) => {
                          const bd = getMonthlyFuelBreakdown(s, m)
                          return (
                            <td key={m.ym} className="num faint small">
                              {bd.roadside > 0 ? <M v={-bd.roadside} /> : '—'}
                            </td>
                          )
                        })}
                      </tr>
                      {months.some((m) => getMonthlyFuelBreakdown(s, m).depotTanker > 0) && (
                        <tr key="fuel_depot">
                          <td className="dim small" style={{ paddingLeft: 24, fontStyle: 'italic' }}>↳ Home depot bulk yard tank (-₹4/L discount)</td>
                          {months.map((m) => {
                            const bd = getMonthlyFuelBreakdown(s, m)
                            return (
                              <td key={m.ym} className="num faint small">
                                {bd.depotTanker > 0 ? <M v={-bd.depotTanker} /> : '—'}
                              </td>
                            )
                          })}
                        </tr>
                      )}
                      {(months.some((m) => getMonthlyFuelBreakdown(s, m).cashback > 0) || (s.company.fuelContract?.active && s.company.fuelContract.partner !== 'none')) && (
                        <>
                          <tr key="fuel_cashback">
                            <td className="good small" style={{ paddingLeft: 24, fontStyle: 'italic', fontWeight: 600 }}>
                              ↳ Fleet card 2.5% rebate
                            </td>
                            {months.map((m) => {
                              const bd = getMonthlyFuelBreakdown(s, m)
                              return (
                                <td key={m.ym} className="num good small" style={{ fontWeight: 600 }}>
                                  {bd.cashback > 0 ? (
                                    <>
                                      +<M v={bd.cashback} />
                                      {m.ym === s.curMonth.ym && s.company.fuelCashbackAccrued ? (
                                        <span className="dim small" style={{ marginLeft: 3 }}>(accrued)</span>
                                      ) : null}
                                    </>
                                  ) : (
                                    <span className="faint">—</span>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                          <tr key="fuel_net" style={{ borderBottom: '1px dashed var(--border)' }}>
                            <td className="small" style={{ paddingLeft: 24, fontWeight: 600 }}>
                              ↳ Net effective diesel expense
                            </td>
                            {months.map((m) => {
                              const bd = getMonthlyFuelBreakdown(s, m)
                              return (
                                <td key={m.ym} className="num small" style={{ fontWeight: 600 }}>
                                  {bd.gross > 0 ? <M v={-bd.net} /> : <span className="faint">—</span>}
                                </td>
                              )
                            })}
                          </tr>
                        </>
                      )}
                    </>
                  )}
                </Fragment>
              ))}
              {row(`${grp.label} total`, (m) => -grp.heads.reduce((a, [h]) => a + (m.expense[h] ?? 0), 0), 'warn', true)}
            </Fragment>
          ))}
          {row('NET PROFIT', (m) => m.profit, undefined, true)}
          <tr>
            <td className="dim">Load factor / trips</td>
            {months.map((m) => (
              <td key={m.ym} className="num dim">
                {m.seatKm > 0 ? `${Math.round(((m.loadFactor || m.paxKm / m.seatKm)) * 100)}% · ${m.trips}` : '—'}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </Panel>
  )
}

function BalanceTab() {
  const s = useGame((g) => g.state)!
  const assets: [string, number][] = [
    ['Cash & bank', s.company.cash],
    ['Receivables (RedBus/app settlements)', receivablesTotal(s)],
    ['Fleet (book value)', fleetBookValue(s)],
  ]
  const liabilities: [string, number][] = [
    ['Term loans outstanding', loansOutstanding(s)],
    ['Overdraft drawn', s.od.drawn],
    ['GST payable', s.company.gstPayable],
    ['Income tax provision (unpaid)', s.company.taxProvision],
  ]
  const ta = assets.reduce((a, [, v]) => a + v, 0)
  const tl = liabilities.reduce((a, [, v]) => a + v, 0)
  return (
    <div className="grid-2">
      <Panel title="Assets" flat>
        <table className="data">
          <tbody>
            {assets.map(([label, v]) => <tr key={label}><td>{label}</td><td className="num"><M v={v} full /></td></tr>)}
            <tr className="total"><td>Total assets</td><td className="num"><M v={ta} full /></td></tr>
          </tbody>
        </table>
      </Panel>
      <Panel title="Liabilities & equity" flat>
        <table className="data">
          <tbody>
            {liabilities.map(([label, v]) => <tr key={label}><td>{label}</td><td className="num"><M v={v} full /></td></tr>)}
            <tr className="total"><td>Total liabilities</td><td className="num"><M v={tl} full /></td></tr>
            <tr className="total"><td>NET WORTH (equity)</td><td className="num"><M v={netWorth(s)} full colored /></td></tr>
          </tbody>
        </table>
      </Panel>
    </div>
  )
}

function CashflowTab() {
  const s = useGame((g) => g.state)!
  const months: MonthlySummary[] = [...s.monthly.slice(-5), s.curMonth]
  const byYm = useMemo(() => {
    const map: Record<string, { op: number; inv: number; fin: number }> = {}
    for (const m of months) map[m.ym] = { op: 0, inv: 0, fin: 0 }
    const keep = new Set(months.map((m) => m.ym))
    for (const t of s.txns) {
      const ym = ymKey(t.day)
      const row = map[ym]
      if (!row || !keep.has(ym)) continue
      const sign = t.kind === 'income' || t.kind === 'capital_in' ? 1 : -1
      const v = sign * t.amount
      if (t.head === 'depreciation') continue
      if (['bus_purchase', 'workshop_capex', 'app_capex', 'asset_sale', 'deposit'].includes(t.head)) row.inv += v
      else if (['loan_disbursal', 'loan_principal', 'seed_capital', 'od_draw', 'od_repay'].includes(t.head)) row.fin += v
      else row.op += v
    }
    return map
  }, [s.txns, s.monthly, s.curMonth])

  const cell = (ym: string, pick: (r: { op: number; inv: number; fin: number }) => number) => {
    const r = byYm[ym] ?? { op: 0, inv: 0, fin: 0 }
    const v = pick(r)
    return v !== 0 ? <M v={v} colored /> : <span className="faint">—</span>
  }

  return (
    <Panel flat title="Cash flow (last months + live current month)">
      <table className="data">
        <thead>
          <tr>
            <th>Activity</th>
            {months.map((m, i) => (
              <th key={m.ym} className="num">{fmtYm(m.ym)}{i === months.length - 1 ? ' (live)' : ''}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Operating (tickets, fuel, salaries…)</td>
            {months.map((m) => <td key={m.ym} className="num">{cell(m.ym, (r) => r.op)}</td>)}
          </tr>
          <tr>
            <td>Investing (buses, workshop, app)</td>
            {months.map((m) => <td key={m.ym} className="num">{cell(m.ym, (r) => r.inv)}</td>)}
          </tr>
          <tr>
            <td>Financing (loans, capital)</td>
            {months.map((m) => <td key={m.ym} className="num">{cell(m.ym, (r) => r.fin)}</td>)}
          </tr>
          <tr className="total">
            <td>Net cash movement</td>
            {months.map((m) => {
              const r = byYm[m.ym] ?? { op: 0, inv: 0, fin: 0 }
              const v = r.op + r.inv + r.fin
              return (
                <td key={m.ym} className="num">
                  {v !== 0 ? <M v={v} colored /> : <span className="faint">—</span>}
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </Panel>
  )
}

function LedgerTab() {
  const s = useGame((g) => g.state)!
  const [filter, setFilter] = useState('all')
  const heads = useMemo(() => [...new Set(s.txns.map((t) => t.head))].sort(), [s.txns])
  const rows = useMemo(() => {
    let r: Txn[] = s.txns
    if (filter !== 'all') r = r.filter((t) => t.head === filter)
    return [...r].reverse().slice(0, 250)
  }, [s.txns, filter])
  return (
    <Panel
      flat
      title="Ledger (recent transactions)"
      right={
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">all heads</option>
          {heads.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
      }
    >
      <table className="data">
        <thead><tr><th>Day</th><th>Head</th><th>Kind</th><th className="num">Amount</th><th>Ref</th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td className="dim">{fmtDateShort(t.day)}</td>
              <td>{t.head}</td>
              <td className={t.kind === 'income' ? 'good' : t.kind === 'expense' ? 'warn' : 'info'}>{t.kind}</td>
              <td className="num"><M v={(t.kind === 'income' || t.kind === 'capital_in' ? 1 : -1) * t.amount} colored /></td>
              <td className="dim small">
                {t.note ?? ''}
                {t.busId && s.buses[t.busId] ? ` · ${s.buses[t.busId].reg}` : ''}
                {t.count && t.count > 1 ? ` · ${t.count} postings` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

export function FinancePage() {
  const [tab, setTab] = useState<'pnl' | 'bs' | 'cf' | 'ledger'>('pnl')
  return (
    <>
      <div className="page-title">
        Finance
        <span className="spacer" />
        <span className="flex">
          {(['pnl', 'bs', 'cf', 'ledger'] as const).map((t) => (
            <button key={t} className={tab === t ? 'primary' : ''} onClick={() => setTab(t)}>
              {{ pnl: 'P&L', bs: 'Balance sheet', cf: 'Cash flow', ledger: 'Ledger' }[t]}
            </button>
          ))}
        </span>
      </div>
      {tab === 'pnl' && <PnlTab />}
      {tab === 'bs' && <BalanceTab />}
      {tab === 'cf' && <CashflowTab />}
      {tab === 'ledger' && <LedgerTab />}
    </>
  )
}
