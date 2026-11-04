import { Fragment, useMemo, useState } from 'react'
import { useGame } from '../../store/gameStore'
import { fmtDate, fmtDateShort, fmtYm, ymKey } from '../../engine/core/calendar'
import { fmtCompact } from '../../engine/core/money'
import { calcGstDue, incomeTaxOn } from '../../engine/sim/tax'
import { BAL } from '../../engine/data/balance'
import {
  fleetBookValue,
  loansOutstanding,
  netWorth,
  receivablesTotal,
  getMonthlyRefundBreakdown,
  getMonthlyTicketBreakdown,
  getMonthlyFuelBreakdown,
} from '../../engine/sim/finance'
import type { MonthlySummary, Txn, TxnHead } from '../../engine/types'
import { M, Panel, StatRow, Tabs, PageHeader } from '../bits'
import { BankPage } from './Bank'

const INCOME_LABELS: Partial<Record<TxnHead, string>> = {
  ticket: 'Ticket sales',
  cargo: 'Parcel & cargo',
  charter: 'Private & festival charters',
  advertising: 'Body advertising',
  cancellation_fee: 'Cancellation retained',
  insurance_claim: 'Insurance settlements',
  fuel_cashback: 'OMC fleet fuel card cashback',
  other_income: 'Other',
}

const EXPENSE_GROUPS: { label: string; heads: [TxnHead, string][] }[] = [
  {
    label: 'Direct Trip Operating Costs',
    heads: [
      ['fuel', 'Diesel / Energy'],
      ['adblue', 'AdBlue exhaust fluid'],
      ['toll', 'FASTag highway tolls'],
      ['border_tax', 'Interstate border entry tax'],
      ['bata', 'Crew trip bata & per diem'],
      ['loading_unloading', 'Hamali loading & unloading'],
      ['parking_cleaning', 'Depot parking & deep cleaning'],
    ],
  },
  {
    label: 'Sales Channels & Marketing',
    heads: [
      ['redbus_commission', 'RedBus OTA commission (11.5%)'],
      ['agent_commission', 'Agent / counter booking commission (5%)'],
      ['pg_fees', 'Payment gateway fee (1.8%)'],
      ['marketing', 'App marketing & user acquisition'],
      ['app_opex', 'Mobile app server & maintenance'],
    ],
  },
  {
    label: 'Fleet Upkeep & Fixed Assets',
    heads: [
      ['maintenance', 'Preventative maintenance & overhauls'],
      ['accident_repair', 'Accident & breakdown repairs'],
      ['tyres', 'Tyre replacements & retreading'],
      ['insurance', 'Commercial vehicle insurance'],
      ['fitness', 'RTO fitness certification (FC)'],
      ['puc', 'Pollution emission certificates (PUC)'],
      ['road_tax', 'State road taxes'],
      ['permit_tax', 'Route & goods permits'],
      ['gps_telematics', 'AIS-140 GPS telematics subscription'],
      ['gps_fit', 'GPS device retrofit'],
      ['lease_rent', 'Leased coach monthly rents'],
      ['attach_owner_share', 'Attached coach owner revenue share'],
      ['inspection', 'Pre-purchase vehicle inspections'],
      ['cargo_liability', 'Cargo damage & shortfall claims'],
      ['amenity_retrofit', 'Amenity & fitting retrofits'],
      ['cleaning', 'Deep cleans'],
      ['rebranding', 'Brand transfer rebranding'],
    ],
  },
  {
    label: 'People, Yards & Head Office',
    heads: [
      ['salary', 'Staff payroll & managerial salaries'],
      ['training', 'Driver skill & safety training'],
      ['office_admin', 'Head office rent, IT & admin'],
      ['depot_rent', 'Depot & outstation yard rents'],
      ['staff_welfare', 'Crew welfare, meals & medical cover'],
    ],
  },
  {
    label: 'Financing, Tax & Statutory',
    heads: [
      ['interest', 'Term loan interest (EMI)'],
      ['od_interest', 'Working capital overdraft interest'],
      ['penalty', 'Penalties & late charges'],
      ['processing_fee', 'Loan processing fees'],
      ['gst', 'GST statutory remittance'],
      ['income_tax', 'Corporate advance income tax'],
      ['fine', 'RTO / CMVR challans & fines'],
      ['refund', 'Passenger & trip refunds'],
      ['depreciation', 'Depreciation non-cash write-off'],
    ],
  },
]

function PnlPanel() {
  const s = useGame((g) => g.state)!
  const g = useGame()
  const gstInfo = calcGstDue(s)
  const months: MonthlySummary[] = [...s.monthly.slice(-5), s.curMonth]
  const cargoMtd = (s.curMonth.income.cargo ?? 0) + (s.curMonth.income.cargo_spot ?? 0)
  const curTicketBd = getMonthlyTicketBreakdown(s, s.curMonth)
  const hasCargoSplit = months.some((m) => (m.cargoCoachRevenue ?? 0) > 0 || (m.cargoTruckRevenue ?? 0) > 0)

  const partnerId = s.company.fuelContract?.active ? s.company.fuelContract.partner : 'none'
  const partnerNames: Record<string, string> = {
    indianoil: 'IndianOil (XtraPower)',
    hpcl: 'HPCL (DriveTrack Plus)',
    bpcl: 'BPCL (SmartFleet)',
    reliance: 'Jio-bp (Trans-Connect)',
  }
  const fuelPartnerLabel = partnerNames[partnerId] ?? (partnerId !== 'none' ? partnerId.toUpperCase() : 'OMC')
  const hasBulkDepotFuel = months.some((m) => getMonthlyFuelBreakdown(s, m).depotTanker > 0)
  const hasFuelCashback = months.some((m) => getMonthlyFuelBreakdown(s, m).cashback > 0) || (s.company.fuelContract?.active && s.company.fuelContract.partner !== 'none')

  const row = (label: string, getValue: (m: MonthlySummary) => number, cls?: string, strong?: boolean) => (
    <tr key={label} className={strong ? 'total' : ''} style={strong ? { fontWeight: 700 } : undefined}>
      <td className={cls}>{label}</td>
      {months.map((m) => {
        const v = getValue(m)
        return (
          <td key={m.ym} className="num">
            {v !== 0 ? <M v={v} colored={strong} /> : <span className="faint">—</span>}
          </td>
        )
      })}
    </tr>
  )

  const fyProfit = s.company.fyProfit ?? 0
  const target = incomeTaxOn(fyProfit)
  const provided = s.company.advanceTaxPaid ?? 0
  const nextProvision = Math.max(0, target - provided)
  const lastClose = s.monthly.length > 0 ? s.monthly[s.monthly.length - 1] : undefined
  const chargedAtClose = lastClose?.expense.income_tax ?? 0

  return (
    <>
      {/* 4 Financial Control Cards (2x2 Grid) */}
      <div className="grid-2" style={{ gap: 14, marginBottom: 16 }}>
        {/* Card 1: Passenger Ticket Sales */}
        <Panel title="Passenger Ticketing & Channel Distribution (Live Month)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="flex" style={{ justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
              <span className="dim">Gross Ticket Sales (MTD):</span>
              <b className={curTicketBd.gross > 0 ? 'good' : 'faint'} style={{ fontSize: 15 }}>
                <M v={curTicketBd.gross} />
              </b>
            </div>

            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim small">↳ RedBus OTA (11.5% comm.):</span>
              <span className="small">
                {curTicketBd.channels.redbus.seats > 0 && (
                  <span className="dim">{curTicketBd.channels.redbus.seats.toLocaleString('en-IN')} seats · </span>
                )}
                <b><M v={curTicketBd.channels.redbus.revenue} /></b>
                {curTicketBd.gross > 0 && curTicketBd.channels.redbus.revenue > 0 && (
                  <span className="dim small ml6">
                    ({Math.round((curTicketBd.channels.redbus.revenue / curTicketBd.gross) * 100)}%)
                  </span>
                )}
              </span>
            </div>

            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim small">↳ AbhiBus / Aggregators:</span>
              <span className="small">
                {curTicketBd.channels.abhibus.seats > 0 && (
                  <span className="dim">{curTicketBd.channels.abhibus.seats.toLocaleString('en-IN')} seats · </span>
                )}
                <b><M v={curTicketBd.channels.abhibus.revenue} /></b>
                {curTicketBd.gross > 0 && curTicketBd.channels.abhibus.revenue > 0 && (
                  <span className="dim small ml6">
                    ({Math.round((curTicketBd.channels.abhibus.revenue / curTicketBd.gross) * 100)}%)
                  </span>
                )}
              </span>
            </div>

            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim small">↳ Direct Mobile App & Web (1.8% PG):</span>
              <span className="small">
                {curTicketBd.channels.ownapp.seats > 0 && (
                  <span className="dim">{curTicketBd.channels.ownapp.seats.toLocaleString('en-IN')} seats · </span>
                )}
                <b><M v={curTicketBd.channels.ownapp.revenue} /></b>
                {curTicketBd.gross > 0 && curTicketBd.channels.ownapp.revenue > 0 && (
                  <span className="dim small ml6">
                    ({Math.round((curTicketBd.channels.ownapp.revenue / curTicketBd.gross) * 100)}%)
                  </span>
                )}
              </span>
            </div>

            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim small">↳ Counter & Agent Stand (5.0% comm.):</span>
              <span className="small">
                {curTicketBd.channels.counter.seats > 0 && (
                  <span className="dim">{curTicketBd.channels.counter.seats.toLocaleString('en-IN')} seats · </span>
                )}
                <b><M v={curTicketBd.channels.counter.revenue} /></b>
                {curTicketBd.gross > 0 && curTicketBd.channels.counter.revenue > 0 && (
                  <span className="dim small ml6">
                    ({Math.round((curTicketBd.channels.counter.revenue / curTicketBd.gross) * 100)}%)
                  </span>
                )}
              </span>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 4 }}>
              <div className="small flex" style={{ justifyContent: 'space-between' }}>
                <span className="dim">Net realization after channel deductions:</span>
                <span className="good">
                  <b><M v={curTicketBd.netRevenue} /></b>
                  {curTicketBd.totalDeductions > 0 && (
                    <span className="dim small" style={{ marginLeft: 4 }}>
                      (commission & fees -<M v={curTicketBd.totalDeductions} />)
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
        </Panel>

        {/* Card 2: Freight & Ancillary Earnings */}
        <Panel title="Freight Logistics & Ancillary Revenue">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div className="flex" style={{ justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
              <span className="dim">Total Logistics & Ancillary (MTD):</span>
              <b className="good" style={{ fontSize: 15 }}>
                <M v={cargoMtd + (s.curMonth.income.advertising ?? 0) + (s.curMonth.income.insurance_claim ?? 0)} />
              </b>
            </div>

            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim small">↳ Bus Belly Luggage Parcels:</span>
              <b><M v={s.curMonth.cargoCoachRevenue ?? s.curMonth.income.cargo ?? 0} /></b>
            </div>

            {s.company.dedicatedCargoSubsidiary && (
              <div className="flex" style={{ justifyContent: 'space-between' }}>
                <span className="dim small">↳ Dedicated Cargo Truck Fleet:</span>
                <b><M v={s.curMonth.cargoTruckRevenue ?? 0} /></b>
              </div>
            )}

            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim small">↳ Coach Body Branding Advertising:</span>
              <b><M v={s.curMonth.income.advertising ?? 0} /></b>
            </div>

            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim small">↳ Retained Ticket Cancellation Fees:</span>
              <span className="good"><b><M v={s.curMonth.income.cancellation_fee ?? 0} /></b></span>
            </div>

            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim small">↳ Insurance Claim Settlements:</span>
              <b><M v={s.curMonth.income.insurance_claim ?? 0} /></b>
            </div>
          </div>
        </Panel>

        {/* Card 3: GST Compliance & ITC */}
        <Panel title="GST Compliance & Input Tax Credit (ITC)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim">Output GST Collected (5% on AC tickets):</span>
              <b><M v={s.company.gstPayable ?? 0} /></b>
            </div>
            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim" title="5% on diesel and energy">Input tax credit balance:</span>
              <span className="good"><b><M v={s.company.gstInputCredit ?? 0} /></b></span>
            </div>
            {s.company.fuelContract?.active && s.company.fuelContract.partner !== 'none' && (
              <div className="flex" style={{ justifyContent: 'space-between' }}>
                <span className="dim">Fleet Fuel Card ({fuelPartnerLabel}):</span>
                <span className="good">
                  <b>+<M v={s.company.fuelCashbackAccrued ?? 0} /></b> accrued (2.5% rebate)
                </span>
              </div>
            )}
            <div className="flex" style={{ justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
              <span className="dim"><b>Net GST Remittance Payable:</b></span>
              <b className={gstInfo.netDue > 0 ? 'warn' : 'good'} style={{ fontSize: 14 }}>
                <M v={gstInfo.netDue} />
              </b>
            </div>
            <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <span className="small dim">
                {s.company.gstDueDay !== undefined
                  ? s.day > s.company.gstDueDay
                    ? <span className="bad">OVERDUE (due {fmtDate(s.company.gstDueDay)}, 1%/mo penalty)</span>
                    : `Due ${fmtDate(s.company.gstDueDay)}`
                  : 'Due within 7 days of month-end close'}
              </span>
              <button
                className="small primary"
                disabled={gstInfo.netDue <= 0 && (s.company.gstPayable ?? 0) <= 0}
                onClick={() => g.remitGst()}
              >
                Remit GST {gstInfo.netDue > 0 ? `(${fmtCompact(gstInfo.netDue)})` : ''}
              </button>
            </div>
          </div>
        </Panel>

        {/* Card 4: TDS & Corporate Tax */}
        <Panel title="Direct Tax Compliance & TDS">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim">TDS Withheld (1% on attached coach payouts):</span>
              <b><M v={s.company.tdsPayable ?? 0} /></b>
            </div>
            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim">FY Cumulative Net Profit:</span>
              <b><M v={fyProfit} colored /></b>
            </div>
            <div className="flex" style={{ justifyContent: 'space-between', paddingBottom: 6, borderBottom: '1px solid var(--border)' }}>
              <span className="dim">Advance Income Tax Provided ({Math.round(BAL.incomeTaxRate * 100)}%):</span>
              <span>
                <b><M v={provided} /></b>
                <span className="dim small ml6">
                  (Next close: <M v={nextProvision} />{chargedAtClose > 0 ? <> · Last close: <M v={chargedAtClose} /></> : ''})
                </span>
              </span>
            </div>
            <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <span className="small dim">
                {s.company.tdsDueDay !== undefined
                  ? s.day > s.company.tdsDueDay
                    ? <span className="bad">TDS OVERDUE (due {fmtDate(s.company.tdsDueDay)})</span>
                    : `TDS due ${fmtDate(s.company.tdsDueDay)}`
                  : 'TDS due quarterly'}
              </span>
              <button
                className="small primary"
                disabled={(s.company.tdsPayable ?? 0) <= 0}
                onClick={() => g.fileTds()}
              >
                File & Remit TDS {(s.company.tdsPayable ?? 0) > 0 ? `(${fmtCompact(s.company.tdsPayable)})` : ''}
              </button>
            </div>
          </div>
        </Panel>
      </div>

      {/* Multi-Month P&L Comparative Statement */}
      <Panel flat title="Comparative Profit & Loss Statement (Trailing 5 Months + Live Current Month)">
        <div className="xscroll">
          <table className="data">
            <thead>
              <tr>
                <th>Financial Head</th>
                {months.map((m, i) => (
                  <th key={m.ym} className="num">
                    {fmtYm(m.ym)}{i === months.length - 1 ? ' (live)' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Income Heads */}
              {Object.entries(INCOME_LABELS).map(([head, label]) => {
                if (head === 'cargo') {
                  const name = s.company.dedicatedCargoSubsidiary ? 'Cargo logistics revenue' : label!
                  return (
                    <Fragment key="cargo">
                      {row(name, (m) => (m.income.cargo ?? 0) + (m.income.cargo_spot ?? 0), 'good')}
                      {hasCargoSplit && row('  ↳ Coach luggage parcels', (m) => m.cargoCoachRevenue ?? 0, 'dim small')}
                      {hasCargoSplit && row('  ↳ Dedicated freight trucks', (m) => m.cargoTruckRevenue ?? 0, 'dim small')}
                    </Fragment>
                  )
                }
                return row(label!, (m) => m.income[head as TxnHead] ?? 0, 'good')
              })}
              {row('TOTAL REVENUE', (m) => m.revenueTotal, 'good', true)}

              {/* Expense Groups */}
              {EXPENSE_GROUPS.map((grp) => (
                <Fragment key={grp.label}>
                  <tr style={{ background: 'var(--table-header, rgba(255,255,255,0.03))' }}>
                    <td colSpan={months.length + 1} style={{ fontWeight: 700, padding: '6px 8px', fontSize: 11 }} className="accent">
                      {grp.label.toUpperCase()}
                    </td>
                  </tr>
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
                          {hasBulkDepotFuel && (
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
                          {hasFuelCashback && (
                            <tr key="fuel_cashback">
                              <td className="good small" style={{ paddingLeft: 24, fontStyle: 'italic', fontWeight: 600 }}>
                                ↳ {fuelPartnerLabel} Fleet Card 2.5% rebate
                              </td>
                              {months.map((m) => {
                                const bd = getMonthlyFuelBreakdown(s, m)
                                return (
                                  <td key={m.ym} className="num good small bold">
                                    {bd.cashback > 0 ? (
                                      <>
                                        +<M v={bd.cashback} />
                                        {m.ym === s.curMonth.ym && s.company.fuelCashbackAccrued ? (
                                          <span className="dim small" style={{ marginLeft: 3 }} title="Accrues live on trips; settles in cash on Day 1">
                                            (accrued)
                                          </span>
                                        ) : null}
                                      </>
                                    ) : (
                                      <span className="faint">—</span>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          )}
                          {hasFuelCashback && (
                            <tr key="fuel_net" style={{ borderBottom: '1px dashed var(--border)' }}>
                              <td className="small" style={{ paddingLeft: 24, fontWeight: 600, color: 'var(--text)' }}>
                                ↳ Net effective diesel expense
                              </td>
                              {months.map((m) => {
                                const bd = getMonthlyFuelBreakdown(s, m)
                                return (
                                  <td key={m.ym} className="num small bold">
                                    {bd.gross > 0 ? <M v={-bd.net} /> : <span className="faint">—</span>}
                                  </td>
                                )
                              })}
                            </tr>
                          )}
                        </>
                      )}
                      {head === 'refund' && (
                        <>
                          <tr key="ref_pass">
                            <td className="dim small" style={{ paddingLeft: 24, fontStyle: 'italic' }}>↳ Passenger voluntary cancel</td>
                            {months.map((m) => {
                              const bd = getMonthlyRefundBreakdown(s, m)
                              return (
                                <td key={m.ym} className="num faint small">
                                  {bd.passenger > 0 ? <M v={-bd.passenger} /> : '—'}
                                </td>
                              )
                            })}
                          </tr>
                          <tr key="ref_crm">
                            <td className="dim small" style={{ paddingLeft: 24, fontStyle: 'italic' }}>↳ CRM grievance concession</td>
                            {months.map((m) => {
                              const bd = getMonthlyRefundBreakdown(s, m)
                              return (
                                <td key={m.ym} className="num faint small">
                                  {bd.crm > 0 ? <M v={-bd.crm} /> : '—'}
                                </td>
                              )
                            })}
                          </tr>
                          <tr key="ref_bus">
                            <td className="dim small" style={{ paddingLeft: 24, fontStyle: 'italic' }}>↳ Service cancellation / breakdown</td>
                            {months.map((m) => {
                              const bd = getMonthlyRefundBreakdown(s, m)
                              return (
                                <td key={m.ym} className="num faint small">
                                  {bd.busCancel > 0 ? <M v={-bd.busCancel} /> : '—'}
                                </td>
                              )
                            })}
                          </tr>
                        </>
                      )}
                      {head === 'depreciation' && (
                        <tr key="tax_shield">
                          <td className="dim small" style={{ paddingLeft: 24, fontStyle: 'italic' }}>
                            ↳ Tax shield benefit ({Math.round(BAL.incomeTaxRate * 100)}%)
                          </td>
                          {months.map((m) => {
                            const dep = m.expense.depreciation ?? 0
                            const shield = Math.round(dep * BAL.incomeTaxRate)
                            return (
                              <td key={m.ym} className="num faint small">
                                {shield > 0 ? <M v={shield} /> : '—'}
                              </td>
                            )
                          })}
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {row(`${grp.label} Subtotal`, (m) => -grp.heads.reduce((a, [h]) => a + (m.expense[h] ?? 0), 0), 'warn', true)}
                </Fragment>
              ))}

              <tr style={{ height: 6 }} />
              {row('NET PROFIT / (LOSS)', (m) => m.profit, undefined, true)}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}

function BooksPanel() {
  const s = useGame((g) => g.state)!
  const [bookTab, setBookTab] = useState<'bs' | 'cf' | 'ledger'>('bs')
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
      if (['bus_purchase', 'workshop_capex', 'app_capex', 'depot_capex', 'asset_sale', 'deposit'].includes(t.head)) row.inv += v
      else if (['loan_disbursal', 'loan_principal', 'seed_capital', 'od_draw', 'od_repay'].includes(t.head)) row.fin += v
      else row.op += v
    }
    return map
  }, [s.txns, s.monthly, s.curMonth])

  const [filter, setFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState<'all' | 'income' | 'expense' | 'capital'>('all')
  const heads = useMemo(() => [...new Set(s.txns.map((t) => t.head))].sort(), [s.txns])
  const ledgerRows = useMemo(() => {
    let r: Txn[] = s.txns
    if (filter !== 'all') r = r.filter((t) => t.head === filter)
    if (kindFilter !== 'all') {
      if (kindFilter === 'capital') r = r.filter((t) => t.kind === 'capital_in' || t.kind === 'capital_out')
      else r = r.filter((t) => t.kind === kindFilter)
    }
    return [...r].reverse().slice(0, 300)
  }, [s.txns, filter, kindFilter])

  const assets: [string, number][] = [
    ['Cash & Bank Balances', s.company.cash],
    ['Pending Receivables (OTA & Web Settlements)', receivablesTotal(s)],
    ['Fleet Fixed Assets (Book Value)', fleetBookValue(s)],
  ]
  const liabilities: [string, number][] = [
    ['Commercial Term Loans Outstanding', loansOutstanding(s)],
    ['Working Capital Overdraft Drawn', s.od.drawn],
    ['GST Statutory Payable', s.company.gstPayable],
    ['Corporate Income Tax Provision', s.company.taxProvision],
  ]
  const ta = assets.reduce((a, [, v]) => a + v, 0)
  const tl = liabilities.reduce((a, [, v]) => a + v, 0)
  const equity = netWorth(s)

  return (
    <>
      <div className="flex" style={{ marginBottom: 12, gap: 6 }}>
        {([
          ['bs', 'Balance Sheet'],
          ['cf', 'Cash Flow Statement'],
          ['ledger', 'General Ledger'],
        ] as const).map(([id, label]) => (
          <button key={id} className={`small ${bookTab === id ? 'primary' : ''}`} onClick={() => setBookTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {bookTab === 'bs' && (
        <div className="grid-2" style={{ gap: 14 }}>
          <Panel title="Assets (Current & Non-Current)" flat>
            <table className="data">
              <tbody>
                {assets.map(([label, v]) => (
                  <tr key={label}>
                    <td><b>{label}</b></td>
                    <td className="num"><M v={v} full /></td>
                  </tr>
                ))}
                <tr className="total" style={{ borderTop: '2px solid var(--border)' }}>
                  <td><b>TOTAL ASSETS</b></td>
                  <td className="num good"><b><M v={ta} full /></b></td>
                </tr>
              </tbody>
            </table>
          </Panel>

          <Panel title="Liabilities & Shareholder Equity" flat>
            <table className="data">
              <tbody>
                {liabilities.map(([label, v]) => (
                  <tr key={label}>
                    <td><b>{label}</b></td>
                    <td className="num"><M v={v} full /></td>
                  </tr>
                ))}
                <tr className="total" style={{ borderTop: '2px solid var(--border)' }}>
                  <td><b>TOTAL LIABILITIES</b></td>
                  <td className="num warn"><b><M v={tl} full /></b></td>
                </tr>
                <tr className="total" style={{ borderTop: '2px solid var(--border)', background: 'var(--table-header)' }}>
                  <td><b>NET WORTH (OWNER EQUITY)</b></td>
                  <td className="num"><b><M v={equity} full colored /></b></td>
                </tr>
              </tbody>
            </table>
          </Panel>
        </div>
      )}

      {bookTab === 'cf' && (
        <Panel flat title="Cash Flow Statement (Activity Breakdown)">
          <div className="xscroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Cash Flow Activity</th>
                  {months.map((m, i) => (
                    <th key={m.ym} className="num">{fmtYm(m.ym)}{i === months.length - 1 ? ' (live)' : ''}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>Operating Cash Flow</b> (Revenue, Fuel, Taxes, Salaries)</td>
                  {months.map((m) => {
                    const v = byYm[m.ym]?.op ?? 0
                    return <td key={m.ym} className="num">{v !== 0 ? <M v={v} colored /> : <span className="faint">—</span>}</td>
                  })}
                </tr>
                <tr>
                  <td><b>Investing Cash Flow</b> (Fleet Capex, Workshop, App Upgrades)</td>
                  {months.map((m) => {
                    const v = byYm[m.ym]?.inv ?? 0
                    return <td key={m.ym} className="num">{v !== 0 ? <M v={v} colored /> : <span className="faint">—</span>}</td>
                  })}
                </tr>
                <tr>
                  <td><b>Financing Cash Flow</b> (Loans Disbursed, Principal Repaid, OD)</td>
                  {months.map((m) => {
                    const v = byYm[m.ym]?.fin ?? 0
                    return <td key={m.ym} className="num">{v !== 0 ? <M v={v} colored /> : <span className="faint">—</span>}</td>
                  })}
                </tr>
                <tr className="total" style={{ borderTop: '2px solid var(--border)' }}>
                  <td><b>NET CASH MOVEMENT</b></td>
                  {months.map((m) => {
                    const r = byYm[m.ym] ?? { op: 0, inv: 0, fin: 0 }
                    const v = r.op + r.inv + r.fin
                    return <td key={m.ym} className="num"><b>{v !== 0 ? <M v={v} colored /> : <span className="faint">—</span>}</b></td>
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {bookTab === 'ledger' && (
        <Panel
          flat
          title={`General Ledger (${ledgerRows.length} Recent Transactions)`}
          right={
            <div className="flex" style={{ gap: 6 }}>
              <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as any)}>
                <option value="all">All Kinds</option>
                <option value="income">Income Only</option>
                <option value="expense">Expense Only</option>
                <option value="capital">Capital Only</option>
              </select>
              <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="all">All Heads ({heads.length})</option>
                {heads.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          }
        >
          <div className="xscroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Account Head</th>
                  <th>Type</th>
                  <th className="num">Amount</th>
                  <th>Transaction Reference & Notes</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.map((t) => (
                  <tr key={t.id}>
                    <td className="dim small">{fmtDateShort(t.day)}</td>
                    <td><b>{t.head}</b></td>
                    <td>
                      <span className={`pill small ${t.kind === 'income' ? 'good' : t.kind === 'expense' ? 'warn' : 'info'}`}>
                        {t.kind}
                      </span>
                    </td>
                    <td className="num">
                      <b><M v={(t.kind === 'income' || t.kind === 'capital_in' ? 1 : -1) * t.amount} colored /></b>
                    </td>
                    <td className="dim small">
                      {t.refundCategory && (
                        <span className="pill accent small" style={{ marginRight: 6 }}>
                          {t.refundCategory === 'passenger' ? 'Passenger Cancel' : t.refundCategory === 'crm' ? 'CRM Refund' : 'Bus Cancel'}
                        </span>
                      )}
                      {t.note ?? ''}{t.busId && s.buses[t.busId] ? ` · ${s.buses[t.busId].reg}` : ''}
                      {t.count && t.count > 1 ? ` · ${t.count} batch postings` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  )
}

export function MoneyPage() {
  const s = useGame((g) => g.state)!
  const [tab, setTab] = useState<'ops' | 'bank' | 'books'>('ops')
  const receivables = receivablesTotal(s)
  const equity = netWorth(s)

  return (
    <>
      {/* Top Page Header */}
      <PageHeader title="Money">
        <Tabs inline tabs={[
            ['ops', 'Profit & Loss (P&L)'],
            ['bank', 'Banking & Loans'],
            ['books', 'Balance Sheet & Books'],
          ] as const} value={tab} onChange={setTab} />
      </PageHeader>

      <StatRow
        items={[
          { label: 'Cash', value: <M v={s.company.cash} />, tone: s.company.cash < 0 ? 'bad' : 'good', title: s.od.limit > 0 ? `Overdraft ${fmtCompact(s.od.drawn)} of ${fmtCompact(s.od.limit)}` : 'No overdraft facility' },
          { label: 'Receivables', value: <M v={receivables} />, title: 'T+2 settlements from RedBus, AbhiBus and payment gateways' },
          { label: 'Month profit', value: <M v={s.curMonth.profit} colored />, title: `Revenue ${fmtCompact(s.curMonth.revenueTotal)} · ${s.curMonth.trips} trips` },
          { label: 'Net worth', value: <M v={equity} />, tone: 'accent' },
          { label: 'Credit score', value: s.company.creditScore },
        ]}
      />

      {/* Main Sub-View */}
      {tab === 'ops' && <PnlPanel />}
      {tab === 'bank' && <BankPage embedded />}
      {tab === 'books' && <BooksPanel />}
    </>
  )
}
