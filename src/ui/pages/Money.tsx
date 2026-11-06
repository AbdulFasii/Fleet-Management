import { Fragment, useMemo, useState } from 'react'
import { useGameActions, useDeferredGameState } from '../../store/gameStore'
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
  getMonthlyCharterBreakdown,
} from '../../engine/sim/finance'
import type { MonthlySummary, Txn, TxnHead } from '../../engine/types'
import { Bar, M, Panel, StatRow, Tabs, PageHeader } from '../bits'
import { BankPage } from './Bank'

const INCOME_LABELS: Partial<Record<TxnHead, string>> = {
  ticket: 'Ticket sales',
  cargo: 'Parcel & cargo',
  charter: 'Private & festival charters',
  lounge_revenue: 'Passenger lounges cafe & snacks',
  advertising: 'Body advertising',
  cancellation_fee: 'Cancellation retained',
  insurance_claim: 'Insurance settlements',
  fuel_cashback: 'OMC fleet fuel card cashback',
  fuel_hedge: 'Fuel hedge payouts',
  other_income: 'Other',
}

const EXPENSE_GROUPS: { label: string; heads: [TxnHead, string][] }[] = [
  {
    label: 'Direct Trip Operating Costs',
    heads: [
      ['fuel', 'Diesel / Energy'],
      ['fuel_hedge', 'Fuel hedge premium & losses'],
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
      ['lounge_opex', 'Passenger lounge rents, power & attendant wages'],
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
  const s = useDeferredGameState()!
  const g = useGameActions()
  const gstInfo = calcGstDue(s)
  const months: MonthlySummary[] = [...s.monthly.slice(-5), s.curMonth]
  const cargoMtd = (s.curMonth.income.cargo ?? 0) + (s.curMonth.income.cargo_spot ?? 0)
  const curTicketBd = getMonthlyTicketBreakdown(s, s.curMonth)
  const hasCargoSplit = months.some((m) => (m.cargoCoachRevenue ?? 0) > 0 || (m.cargoTruckRevenue ?? 0) > 0)
  const hasCharterSplit = months.some((m) => (m.income.charter ?? 0) > 0 || (m.charterPrivateRevenue ?? 0) > 0 || (m.charterFestivalRevenue ?? 0) > 0)
  const hasLounges = (s.company.lounges?.length ?? 0) > 0 || months.some((m) => (m.income.lounge_revenue ?? 0) > 0 || (m.expense.lounge_opex ?? 0) > 0)

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
      {/* 4 Financial Control Cards in three columns: ticketing | freight | GST over direct tax */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 14, marginBottom: 16, alignItems: 'stretch' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {/* Card 1: Passenger Ticket Sales, compact */}
        <Panel title="Ticket Sales by Channel (This Month)" style={{ flex: 1, marginBottom: 0 }}>
          <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <span>
                <span className="dim">Gross </span>
                <b className={curTicketBd.gross > 0 ? 'good' : 'faint'}><M v={curTicketBd.gross} /></b>
              </span>
              <span title="Net realisation after channel commission and payment-gateway fees">
                <span className="dim">Net </span>
                <b className="good"><M v={curTicketBd.netRevenue} /></b>
                {curTicketBd.totalDeductions > 0 && (
                  <span className="dim"> (fees −<M v={curTicketBd.totalDeductions} />)</span>
                )}
              </span>
            </div>

            <table className="data small" style={{ margin: 0 }}>
              <tbody>
                {([
                  ['RedBus', '11.5% commission', curTicketBd.channels.redbus],
                  ['AbhiBus', 'Aggregators', curTicketBd.channels.abhibus],
                  ['Own app', 'Mobile app & web, 1.8% payment gateway', curTicketBd.channels.ownapp],
                  ['Counter', 'Counter & agent stand, 5.0% commission', curTicketBd.channels.counter],
                ] as const).map(([label, detail, ch]) => {
                  const share = curTicketBd.gross > 0 ? ch.revenue / curTicketBd.gross : 0
                  return (
                    <tr key={label} title={detail}>
                      <td style={{ padding: '2px 6px' }}>{label}</td>
                      <td className="num dim" style={{ padding: '2px 6px' }}>
                        {ch.seats > 0 ? `${ch.seats.toLocaleString('en-IN')} seats` : '—'}
                      </td>
                      <td className="num" style={{ padding: '2px 6px' }}><b><M v={ch.revenue} /></b></td>
                      <td className="num" style={{ padding: '2px 6px', width: 110 }}>
                        <span className="flex" style={{ alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                          <Bar value={share} width={6} />
                          <span style={{ minWidth: 28, textAlign: 'right' }}>{Math.round(share * 100)}%</span>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>


        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {/* Card 2: Freight & Ancillary Earnings */}
        <Panel title="Freight & Ancillary Revenue (This Month)" style={{ flex: 1, marginBottom: 0 }}>
          <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div>
              <span className="dim">Total </span>
              <b className="good">
                <M v={cargoMtd + (s.curMonth.income.advertising ?? 0) + (s.curMonth.income.insurance_claim ?? 0)} />
              </b>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', columnGap: 20, rowGap: 3 }}>
            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim">Luggage parcels</span>
              <b><M v={s.curMonth.cargoCoachRevenue ?? s.curMonth.income.cargo ?? 0} /></b>
            </div>

            {s.company.dedicatedCargoSubsidiary && (
              <div className="flex" style={{ justifyContent: 'space-between' }}>
                <span className="dim">Cargo trucks</span>
                <b><M v={s.curMonth.cargoTruckRevenue ?? 0} /></b>
              </div>
            )}

            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim">Coach branding ads</span>
              <b><M v={s.curMonth.income.advertising ?? 0} /></b>
            </div>

            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim">Cancellation fees kept</span>
              <span className="good"><b><M v={s.curMonth.income.cancellation_fee ?? 0} /></b></span>
            </div>

            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim">Insurance claims</span>
              <b><M v={s.curMonth.income.insurance_claim ?? 0} /></b>
            </div>

            {(s.curMonth.income.charter ?? 0) > 0 && (
              <>
                <div className="flex" style={{ justifyContent: 'space-between' }}>
                  <span className="dim">Private charters</span>
                  <b><M v={getMonthlyCharterBreakdown(s, s.curMonth).privateTour} /></b>
                </div>
                <div className="flex" style={{ justifyContent: 'space-between' }}>
                  <span className="dim">Festival charters</span>
                  <b><M v={getMonthlyCharterBreakdown(s, s.curMonth).festival} /></b>
                </div>
              </>
            )}

            {hasLounges && (
              <div className="flex" style={{ justifyContent: 'space-between' }}>
                <span className="dim">Lounges net P/L</span>
                <span className={((s.curMonth.income.lounge_revenue ?? 0) - (s.curMonth.expense.lounge_opex ?? 0)) >= 0 ? 'good' : 'bad'}>
                  <b><M v={(s.curMonth.income.lounge_revenue ?? 0) - (s.curMonth.expense.lounge_opex ?? 0)} colored /></b>
                </span>
              </div>
            )}
            </div>
          </div>
        </Panel>

        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
        {/* Card 3: GST, income tax and TDS, side by side in one compact card */}
        <Panel title="Tax: GST · Income Tax · TDS" style={{ flex: 1, marginBottom: 0 }}>
          <div className="small" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 20, rowGap: 3 }}>
            <div className="flex" style={{ justifyContent: 'space-between' }} title="5% output GST on AC tickets">
              <span className="dim">Output GST</span>
              <b><M v={s.company.gstPayable ?? 0} /></b>
            </div>
            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <span className="dim">FY net profit</span>
              <b><M v={fyProfit} colored /></b>
            </div>

            <div className="flex" style={{ justifyContent: 'space-between' }} title="5% on diesel and energy">
              <span className="dim">Input credit</span>
              <span className="good"><b><M v={s.company.gstInputCredit ?? 0} /></b></span>
            </div>
            <div
              className="flex"
              style={{ justifyContent: 'space-between' }}
              title={`Advance income tax at ${Math.round(BAL.incomeTaxRate * 100)}%. Next close: ${fmtCompact(nextProvision)}${chargedAtClose > 0 ? ` · last close: ${fmtCompact(chargedAtClose)}` : ''}`}
            >
              <span className="dim">Advance tax ({Math.round(BAL.incomeTaxRate * 100)}%)</span>
              <b><M v={provided} /></b>
            </div>

            {s.company.fuelContract?.active && s.company.fuelContract.partner !== 'none' ? (
              <div className="flex" style={{ justifyContent: 'space-between' }} title={`${fuelPartnerLabel} fleet card, 2.5% rebate accrued this month`}>
                <span className="dim">Fuel rebate</span>
                <span className="good"><b>+<M v={s.company.fuelCashbackAccrued ?? 0} /></b></span>
              </div>
            ) : <span />}
            <div className="flex" style={{ justifyContent: 'space-between' }} title="1% withheld on attached coach payouts">
              <span className="dim">TDS withheld</span>
              <b><M v={s.company.tdsPayable ?? 0} /></b>
            </div>

            <div className="flex" style={{ justifyContent: 'space-between' }}>
              <b>Net GST payable</b>
              <b className={gstInfo.netDue > 0 ? 'warn' : 'good'}><M v={gstInfo.netDue} /></b>
            </div>
            <span />

            <div className="flex" style={{ alignItems: 'center', gap: 6, marginTop: 4 }}>
              <button
                className="small primary"
                disabled={gstInfo.netDue <= 0 && (s.company.gstPayable ?? 0) <= 0}
                onClick={() => g.remitGst()}
              >
                Remit GST {gstInfo.netDue > 0 ? `(${fmtCompact(gstInfo.netDue)})` : ''}
              </button>
              <span className="dim">
                {s.company.gstDueDay !== undefined
                  ? s.day > s.company.gstDueDay
                    ? <span className="bad">overdue, 1%/mo</span>
                    : `due ${fmtDate(s.company.gstDueDay)}`
                  : 'due after month close'}
              </span>
            </div>
            <div className="flex" style={{ alignItems: 'center', gap: 6, marginTop: 4 }}>
              <button
                className="small primary"
                disabled={(s.company.tdsPayable ?? 0) <= 0}
                onClick={() => g.fileTds()}
              >
                Remit TDS {(s.company.tdsPayable ?? 0) > 0 ? `(${fmtCompact(s.company.tdsPayable)})` : ''}
              </button>
              <span className="dim">
                {s.company.tdsDueDay !== undefined
                  ? s.day > s.company.tdsDueDay
                    ? <span className="bad">overdue</span>
                    : `due ${fmtDate(s.company.tdsDueDay)}`
                  : 'quarterly'}
              </span>
            </div>
          </div>
        </Panel>
        </div>
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
                if (head === 'charter') {
                  return (
                    <Fragment key="charter">
                      {row(label!, (m) => m.income.charter ?? 0, 'good')}
                      {hasCharterSplit && row('  ↳ Private tour charters', (m) => getMonthlyCharterBreakdown(s, m).privateTour, 'dim small')}
                      {hasCharterSplit && row('  ↳ Festival & seasonal charters', (m) => getMonthlyCharterBreakdown(s, m).festival, 'dim small')}
                    </Fragment>
                  )
                }
                if (head === 'lounge_revenue') {
                  return (
                    <Fragment key="lounge_revenue">
                      {row(label!, (m) => m.income.lounge_revenue ?? 0, 'good')}
                      {hasLounges && (
                        <tr key="lounge_rev_net">
                          <td className="dim small" style={{ paddingLeft: 24, fontStyle: 'italic' }}>
                            ↳ Net lounge margin (after rents, power & staff)
                          </td>
                          {months.map((m) => {
                            const rev = m.income.lounge_revenue ?? 0
                            const opex = m.expense.lounge_opex ?? 0
                            const net = rev - opex
                            return (
                              <td key={m.ym} className="num faint small bold">
                                {rev > 0 || opex > 0 ? (
                                  <span className={net >= 0 ? 'good' : 'bad'}>
                                    {net >= 0 ? '+' : ''}<M v={net} />
                                  </span>
                                ) : '—'}
                              </td>
                            )
                          })}
                        </tr>
                      )}
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
                      {head === 'lounge_opex' && hasLounges && (
                        <tr key="lounge_net" style={{ borderBottom: '1px dashed var(--border)' }}>
                          <td className="small" style={{ paddingLeft: 24, fontWeight: 600, color: 'var(--text)' }}>
                            ↳ Net passenger lounges profit / (loss)
                          </td>
                          {months.map((m) => {
                            const rev = m.income.lounge_revenue ?? 0
                            const opex = m.expense.lounge_opex ?? 0
                            const net = rev - opex
                            return (
                              <td key={m.ym} className="num small bold">
                                {rev > 0 || opex > 0 ? (
                                  <span className={net >= 0 ? 'good' : 'bad'}>
                                    <M v={net} colored />
                                  </span>
                                ) : (
                                  <span className="faint">—</span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
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
  const s = useDeferredGameState()!
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
      if (['bus_purchase', 'workshop_capex', 'app_capex', 'depot_capex', 'lounge_capex', 'asset_sale', 'deposit'].includes(t.head)) row.inv += v
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
  const s = useDeferredGameState()!
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
      {tab === 'ops' && (
        <>
          <PnlPanel />
        </>
      )}
      {tab === 'bank' && <BankPage embedded />}
      {tab === 'books' && <BooksPanel />}
    </>
  )
}
