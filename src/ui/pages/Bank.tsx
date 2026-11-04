import { useState } from 'react'
import { useGame } from '../../store/gameStore'
import {
  CASH_LOAN_SLABS,
  LOAN_PRODUCTS,
  MSME_LENDERS,
  cashLoanRateBps,
  effectiveRateBps,
} from '../../engine/data/loanProducts'
import {
  quoteLoan,
  computeOdLimit,
  odCreditFloor,
  checkMsmeEligibility,
  getLenderRelationshipScore,
  quoteMsmeLoan,
  msmeRateBps,
} from '../../engine/sim/banking'
import { netWorth } from '../../engine/sim/finance'
import { DIFFICULTIES, BAL } from '../../engine/data/balance'
import { fmtDate } from '../../engine/core/calendar'
import { fmtCompact } from '../../engine/core/money'
import { Bar, KV, M, Panel, PageHeader } from '../bits'

function getRelTier(score: number): { title: string; color: string } {
  if (score >= 75) return { title: 'Platinum (-1.5%)', color: 'var(--accent)' }
  if (score >= 50) return { title: 'Gold (-1.1%)', color: 'var(--good)' }
  if (score >= 25) return { title: 'Silver (-0.7%)', color: 'var(--info)' }
  return { title: 'Standard', color: 'var(--dim)' }
}

export function BankPage({ embedded }: { embedded?: boolean } = {}) {
  const s = useGame((g) => g.state)!
  const g = useGame()
  const loans = Object.values(s.loans)
  const active = loans.filter((l) => l.status === 'active')
  const totalEmi = active.reduce((a, l) => a + l.emi, 0)
  const book = {
    balance: active.reduce((a, l) => a + l.balance, 0),
    nextDue: active.reduce<number | undefined>((soon, l) => soon === undefined || l.nextEmiDay < soon ? l.nextEmiDay : soon, undefined),
    rateBps: (() => {
      const w = active.reduce((a, l) => a + l.balance, 0)
      if (w <= 0) return 0
      return active.reduce((a, l) => a + l.rateBps * l.balance, 0) / w
    })(),
  }
  const diff = DIFFICULTIES.find((d) => d.id === s.difficulty)!
  const score = s.company.creditScore
  const unencumberedBuses = Object.values(s.buses).filter((b) => b.ownership === 'owned' && !b.loanId)
  const hasOpenCash = active.some((l) => l.kind === 'cash')

  // MSME application drawer state
  const [applyingLenderId, setApplyingLenderId] = useState<string | null>(null)
  const [applyAmount, setApplyAmount] = useState<number>(0)
  const [applyMonths, setApplyMonths] = useState<number>(36)

  // HP loan refinance drawer state
  const [hpLenderId, setHpLenderId] = useState<string | null>(null)
  const [hpBusId, setHpBusId] = useState<string>('')
  const [hpMonths, setHpMonths] = useState<number>(48)

  const selectedLender = MSME_LENDERS.find((l) => l.id === applyingLenderId)
  const msmeQuote = selectedLender
    ? quoteMsmeLoan(s, selectedLender.id, applyAmount, applyMonths)
    : null

  const selectedHpProduct = LOAN_PRODUCTS.find((p) => p.id === hpLenderId)
  const selectedHpBus = s.buses[hpBusId] ?? unencumberedBuses[0]
  const hpQuote = selectedHpProduct && selectedHpBus
    ? quoteLoan(s, selectedHpProduct.id, selectedHpBus.bookValue, hpMonths)
    : null

  const handleStartApply = (lenderId: string) => {
    const l = MSME_LENDERS.find((x) => x.id === lenderId)
    if (!l) return
    setApplyingLenderId(lenderId)
    setApplyAmount(l.maxAmount)
    setApplyMonths(l.defaultMonths)
    setHpLenderId(null)
  }

  const handleConfirmDisburse = () => {
    if (!selectedLender || !msmeQuote) return
    g.takeMsmeLoan(selectedLender.id, applyAmount, applyMonths)
    setApplyingLenderId(null)
  }

  const handleStartHp = (productId: string) => {
    setHpLenderId(productId)
    if (!hpBusId && unencumberedBuses[0]) {
      setHpBusId(unencumberedBuses[0].id)
    }
    setApplyingLenderId(null)
  }

  const handleConfirmHp = () => {
    if (!selectedHpProduct || !selectedHpBus || !hpQuote) return
    g.takeHpLoan(selectedHpProduct.id, selectedHpBus.id, hpMonths)
    setHpLenderId(null)
  }

  return (
    <>
      {!embedded && (
        <PageHeader title="Loans" facts={<>monthly EMI <M v={totalEmi} /></>} />
      )}
      {embedded && (
        <p className="dim small" style={{ margin: '0 0 8px' }}>
          Monthly EMI burden <M v={totalEmi} />
        </p>
      )}

      <div className="grid-2" style={{ gap: 12, marginBottom: 16 }}>
        <Panel
          title="Credit profile"
          info={`Paid EMIs build score (+${BAL.paidEmiCreditGain} each); a miss costs ${BAL.missedEmiCreditHit} points and ${BAL.repoAfterConsecutiveMissed} consecutive misses gets the bus repossessed. When all loans are cleared, your CIBIL score automatically rehabilitates over time. Score sets your OD floor and loan pricing; rising net worth expands OD headroom.`}
        >
          <KV rows={[
            ['Credit score', <span className={score >= 700 ? 'good' : score >= 620 ? 'warn' : 'bad'}>{score} / 900</span>],
            ['Score bar', <Bar value={(score - 300) / 600} tone="auto" width={12} />],
            ['Loans active', active.length],
            ['Debt status', active.length === 0
              ? <span className="good">Debt-free · CIBIL recovering</span>
              : <span className="dim">{active.length} active loan{active.length > 1 ? 's' : ''}</span>],
            ['EMIs missed (lifetime)', loans.reduce((a, l) => a + l.emisMissed, 0)],
          ]} />
        </Panel>

        <Panel
          title="Overdraft (cash-credit line)"
          info={`Limit = credit floor + ~${Math.round(BAL.odPctOfNetWorth * 100)}% of book equity (NW with OD added back), capped at ${BAL.odNwMultipleCap}× the floor and ${fmtCompact(BAL.odAbsoluteCap)} absolute. Current equity-linked target ${fmtCompact(computeOdLimit(s))} · NW ${fmtCompact(netWorth(s))}. OD auto-covers negative cash and auto-repays from surpluses. If it maxes out, EMIs mark missed — lenders repossess hypothecated buses after ${BAL.repoAfterConsecutiveMissed} consecutive misses (no forced fleet fire sales).`}
        >
          <KV rows={[
            ['Limit', <M v={s.od.limit} full />],
            ['Credit floor', <M v={odCreditFloor(s)} full />],
            ['Drawn', s.od.drawn > 0 ? <span className="bad"><M v={s.od.drawn} full /></span> : <span className="good">nil</span>],
            ['Headroom', <M v={s.od.limit - s.od.drawn} full />],
            ['Rate', `${(s.od.rateBps / 100).toFixed(0)}% p.a., charged monthly`],
            ['Interest accrued', <M v={s.od.accruedInterest} />],
          ]} />
        </Panel>
      </div>

      {/* Unified Borrow Panel covering the 3 Loan Families */}
      <Panel
        title="Borrow (Hire-Purchase, Working Capital & Government MSME)"
        flat
        info="Three distinct credit facilities. On-time monthly payments build your Relationship Score (+1 per EMI), unlocking cheaper interest rates across all lending partners."
      >
        {/* HP Loan Refinance Drawer */}
        {selectedHpProduct && hpQuote && selectedHpBus && (
          <div
            className="panel"
            style={{
              padding: 14,
              marginBottom: 16,
              background: 'var(--bg-card)',
              border: '1px solid var(--accent)',
              borderRadius: 6,
            }}
          >
            <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <b className="accent" style={{ fontSize: '1.05rem' }}>{selectedHpProduct.lender} — Vehicle HP Refinance</b>
                <span className="dim small ml8">· Hypothecate an unencumbered owned coach</span>
              </div>
              <button className="small" onClick={() => setHpLenderId(null)}>✕ Close</button>
            </div>

            <div className="grid-2" style={{ gap: 16, marginBottom: 12 }}>
              <div>
                <label className="dim small" style={{ display: 'block', marginBottom: 6 }}>
                  Select Owned Bus to Hypothecate
                </label>
                <select
                  value={hpBusId || selectedHpBus.id}
                  onChange={(e) => setHpBusId(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px' }}
                >
                  {unencumberedBuses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.reg} ({b.nickname}) — Book Value: {fmtCompact(b.bookValue)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="dim small" style={{ display: 'block', marginBottom: 6 }}>
                  Tenure (Months)
                </label>
                <div className="flex" style={{ gap: 6 }}>
                  {[36, 48, 60].filter((m) => m >= selectedHpProduct.minMonths && m <= selectedHpProduct.maxMonths).map((m) => (
                    <button
                      key={m}
                      className={`small ${hpMonths === m ? 'primary' : ''}`}
                      onClick={() => setHpMonths(m)}
                    >
                      {m} Months
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <KV rows={[
              ['Bus Book Value', <M v={selectedHpBus.bookValue} full />],
              ['Max Facility (LTV)', `${Math.round(selectedHpProduct.maxLtv * 100)}%`],
              ['Disbursed Principal', <b className="good"><M v={hpQuote.principal} full /></b>],
              ['Processing Fee', <M v={hpQuote.processingFee} />],
              ['Effective Interest Rate', <b>{(hpQuote.rateBps / 100).toFixed(1)}% p.a.</b>],
              ['Monthly EMI (every 30d)', <b className="accent"><M v={hpQuote.emi} /></b>],
            ]} />

            <div className="flex" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button onClick={() => setHpLenderId(null)}>Cancel</button>
              <button className="primary" onClick={handleConfirmHp}>
                Sanction HP Facility ({fmtCompact(hpQuote.principal)})
              </button>
            </div>
          </div>
        )}

        {/* MSME Drawer */}
        {selectedLender && msmeQuote && (
          <div
            className="panel"
            style={{
              padding: 14,
              marginBottom: 16,
              background: 'var(--bg-card)',
              border: '1px solid var(--accent)',
              borderRadius: 6,
            }}
          >
            <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <b className="accent" style={{ fontSize: '1.05rem' }}>{selectedLender.name}</b>
                <span className="dim small ml8">· {selectedLender.schemeName}</span>
              </div>
              <button className="small" onClick={() => setApplyingLenderId(null)}>✕ Close</button>
            </div>

            {selectedLender.reputationPenalty && (
              <div className="callout warn mb12" style={{ padding: 8, fontSize: '0.85rem' }}>
                <b>Reputation Risk:</b> Informal moneylenders charge high interest (24% p.a.) and carry stigma. Company reputation drops by -{selectedLender.reputationPenalty}!
              </div>
            )}

            <div className="grid-2" style={{ gap: 16, marginBottom: 12 }}>
              <div>
                <label className="dim small" style={{ display: 'block', marginBottom: 6 }}>
                  Loan Amount (Max: {fmtCompact(selectedLender.maxAmount)})
                </label>
                <div className="flex" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <input
                    type="range"
                    min={100_000_00}
                    max={selectedLender.maxAmount}
                    step={100_000_00}
                    value={applyAmount}
                    onChange={(e) => setApplyAmount(Number(e.target.value))}
                    style={{ flex: 1 }}
                  />
                  <b style={{ minWidth: 90, textAlign: 'right' }}>{fmtCompact(applyAmount)}</b>
                </div>
                <div className="flex" style={{ gap: 6 }}>
                  {[0.25, 0.50, 0.75, 1.0].map((pct) => {
                    const amt = Math.round(selectedLender.maxAmount * pct)
                    return (
                      <button
                        key={pct}
                        className={`small ${applyAmount === amt ? 'primary' : ''}`}
                        onClick={() => setApplyAmount(amt)}
                      >
                        {pct * 100}% ({fmtCompact(amt)})
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="dim small" style={{ display: 'block', marginBottom: 6 }}>
                  Tenure (Months)
                </label>
                <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {selectedLender.allowedMonths.map((m) => (
                    <button
                      key={m}
                      className={`small ${applyMonths === m ? 'primary' : ''}`}
                      onClick={() => setApplyMonths(m)}
                    >
                      {m} Months
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <KV rows={[
              ['Requested Principal', <M v={msmeQuote.principal} full />],
              ['Relationship Score', (
                <span>
                  {getLenderRelationshipScore(s, selectedLender.id)}/100
                  {msmeQuote.discountBps > 0 && (
                    <span className="good ml6">
                      (-{(msmeQuote.discountBps / 100).toFixed(2)}% discount applied)
                    </span>
                  )}
                </span>
              )],
              ['Effective Interest Rate', <b>{(msmeQuote.rateBps / 100).toFixed(2)}% p.a.</b>],
              ['Contractual EMI (every 30d)', <b className="accent"><M v={msmeQuote.emi} /></b>],
              ['Processing Fee', <M v={msmeQuote.processingFee} />],
              ['Net Disbursal to Treasury', <span className="good bold"><M v={msmeQuote.netInflow} colored /></span>],
            ]} />

            <div className="flex" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button onClick={() => setApplyingLenderId(null)}>Cancel</button>
              <button className="primary" onClick={handleConfirmDisburse}>
                Sanction & Disburse {fmtCompact(msmeQuote.principal)}
              </button>
            </div>
          </div>
        )}

        {/* Group 1: Hire-Purchase (Vehicle Loans) */}
        <div style={{ marginTop: 8, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 8px', color: 'var(--fg)', fontSize: '0.95rem' }}>
            1. Hire-Purchase Facilities (Commercial Vehicle Loans)
          </h4>
          <table className="data">
            <thead>
              <tr>
                <th>Lender</th>
                <th className="num">Relationship</th>
                <th className="num">Rate</th>
                <th className="num">Max LTV</th>
                <th>Tenure</th>
                <th>Terms & Eligibility</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {LOAN_PRODUCTS.map((p) => {
                const relScore = getLenderRelationshipScore(s, p.id)
                const tier = getRelTier(relScore)
                const baseRate = effectiveRateBps(p, score, diff.loanRateExtraBps, 0)
                const rate = effectiveRateBps(p, score, diff.loanRateExtraBps, relScore)
                const creditOk = score >= p.minCredit
                const repOk = s.company.reputation >= p.minReputation
                const busOk = unencumberedBuses.length > 0
                const eligible = creditOk && repOk && busOk

                let reason = 'Eligible'
                if (!creditOk) reason = `Requires CIBIL ${p.minCredit}+ (current: ${score})`
                else if (!repOk) reason = `Requires reputation ${p.minReputation}+ (current: ${s.company.reputation})`
                else if (!busOk) reason = 'No unencumbered owned coach to hypothecate'

                return (
                  <tr key={p.id}>
                    <td><b>{p.lender}</b></td>
                    <td className="num">
                      <span style={{ color: tier.color, fontWeight: 600 }}>{relScore}/100</span>
                      <div className="dim small">{tier.title}</div>
                    </td>
                    <td className="num">
                      {(rate / 100).toFixed(1)}%
                      {relScore > 0 && <div className="good small">-{( (baseRate - rate) / 100).toFixed(1)}% rel</div>}
                    </td>
                    <td className="num"><b>{Math.round(p.maxLtv * 100)}%</b></td>
                    <td>{p.minMonths}–{p.maxMonths}m</td>
                    <td>
                      {eligible ? (
                        <span className="good small">{unencumberedBuses.length} unencumbered coach(es) available</span>
                      ) : (
                        <span className="warn small">✗ {reason}</span>
                      )}
                    </td>
                    <td className="num">
                      <button
                        className="small primary"
                        disabled={!eligible}
                        onClick={() => handleStartHp(p.id)}
                      >
                        Take
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Group 2: Working Capital (Cash Loan Slabs) */}
        <div style={{ marginTop: 20, marginBottom: 16 }}>
          <h4 style={{ margin: '0 0 8px', color: 'var(--fg)', fontSize: '0.95rem' }}>
            2. Working Capital Facilities (Unsecured Cash Loans)
          </h4>
          <table className="data">
            <thead>
              <tr>
                <th>Facility Slab</th>
                <th className="num">Relationship</th>
                <th className="num">Rate</th>
                <th className="num">Max Amount</th>
                <th>Tenure</th>
                <th>Terms & Eligibility</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {CASH_LOAN_SLABS.map((slab) => {
                const relScore = getLenderRelationshipScore(s, slab.id)
                const tier = getRelTier(relScore)
                const baseRate = cashLoanRateBps(slab, score, diff.loanRateExtraBps, 0)
                const rate = cashLoanRateBps(slab, score, diff.loanRateExtraBps, relScore)
                const creditOk = score >= slab.minCredit
                const singleOk = !hasOpenCash
                const eligible = creditOk && singleOk

                let reason = 'Eligible'
                if (!creditOk) reason = `Requires CIBIL ${slab.minCredit}+ (current: ${score})`
                else if (!singleOk) reason = 'Active working capital loan open — repay first'

                return (
                  <tr key={slab.id}>
                    <td><b>{slab.label}</b></td>
                    <td className="num">
                      <span style={{ color: tier.color, fontWeight: 600 }}>{relScore}/100</span>
                      <div className="dim small">{tier.title}</div>
                    </td>
                    <td className="num">
                      {(rate / 100).toFixed(1)}%
                      {relScore > 0 && <div className="good small">-{( (baseRate - rate) / 100).toFixed(1)}% rel</div>}
                    </td>
                    <td className="num"><b>{fmtCompact(slab.amount)}</b></td>
                    <td>{slab.months}m</td>
                    <td>
                      {eligible ? (
                        <span className="good small">Clean WC facility limit</span>
                      ) : (
                        <span className="warn small">✗ {reason}</span>
                      )}
                    </td>
                    <td className="num">
                      <button
                        className="small primary"
                        disabled={!eligible}
                        onClick={() => g.takeCashLoan(slab.id)}
                      >
                        Take
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Group 3: Government & NBFC MSME Schemes */}
        <div style={{ marginTop: 20 }}>
          <h4 style={{ margin: '0 0 8px', color: 'var(--fg)', fontSize: '0.95rem' }}>
            3. Government & NBFC Subsidised MSME Schemes (MUDRA / CGTMSE)
          </h4>
          <table className="data">
            <thead>
              <tr>
                <th>Lender & Scheme</th>
                <th className="num">Relationship</th>
                <th className="num">Rate</th>
                <th className="num">Max Amount</th>
                <th>Tenure</th>
                <th>Terms & Eligibility</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {MSME_LENDERS.map((lender) => {
                const relScore = getLenderRelationshipScore(s, lender.id)
                const tier = getRelTier(relScore)
                const { rateBps, discountBps } = msmeRateBps(s, lender, diff.loanRateExtraBps)
                const check = checkMsmeEligibility(s, lender)
                const hasActive = active.some((l) => l.lenderId === lender.id)

                return (
                  <tr key={lender.id}>
                    <td>
                      <b>{lender.name}</b>
                      <br />
                      <span className="dim small">{lender.schemeName}</span>
                    </td>
                    <td className="num">
                      <span style={{ color: tier.color, fontWeight: 600 }}>{relScore}/100</span>
                      <div className="dim small">{tier.title}</div>
                    </td>
                    <td className="num">
                      {(rateBps / 100).toFixed(1)}%
                      {discountBps > 0 ? (
                        <div className="good small">-{(discountBps / 100).toFixed(1)}% sub</div>
                      ) : (
                        <div className="dim small">base</div>
                      )}
                    </td>
                    <td className="num"><b>{fmtCompact(lender.maxAmount)}</b></td>
                    <td>{lender.defaultMonths}m</td>
                    <td>
                      <span>{lender.notes}</span>
                      <br />
                      {hasActive ? (
                        <span className="info small">Active facility running</span>
                      ) : check.eligible ? (
                        <span className="good small">Eligible to draw</span>
                      ) : (
                        <span className="warn small">✗ {check.reason}</span>
                      )}
                    </td>
                    <td className="num">
                      <button
                        className="small primary"
                        disabled={!check.eligible}
                        onClick={() => handleStartApply(lender.id)}
                      >
                        Take
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Active Loan Book */}
      <Panel
        title={`Loan book (${active.length} active)`}
        flat
        info={`Closed loans are dropped from this book. Monthly EMI burden ${fmtCompact(totalEmi)} is the contractual installment across active loans.`}
      >
        <table className="data">
          <thead>
            <tr>
              <th>Lender</th><th>Type</th><th>Bus</th><th className="num">Principal</th><th className="num">Balance</th>
              <th className="num">Rate</th><th className="num">EMI</th><th>Next due</th><th className="num">Paid/Missed</th><th>Status</th><th />
            </tr>
          </thead>
          <tbody>
            {active.length === 0 && <tr><td colSpan={11} className="dim">No active loans. Draw from any of the three borrow groups above or finance a new bus on Market.</td></tr>}
            {active.map((l) => (
              <tr key={l.id}>
                <td>
                  <b>{l.lender}</b>
                  {l.lenderId && (
                    <div className="dim small">Rel: {getLenderRelationshipScore(s, l.lenderId)}/100</div>
                  )}
                </td>
                <td className="dim">{l.kind === 'cash' ? 'working capital' : 'vehicle HP'}</td>
                <td className="dim">{l.busId && s.buses[l.busId] ? s.buses[l.busId].reg : '—'}</td>
                <td className="num"><M v={l.principal} /></td>
                <td className="num"><M v={l.balance} /></td>
                <td className="num">{(l.rateBps / 100).toFixed(1)}%</td>
                <td className="num"><M v={l.emi} /></td>
                <td>{fmtDate(l.nextEmiDay)}</td>
                <td className="num">{l.emisPaid}/{l.emisMissed > 0 ? <span className="bad">{l.emisMissed}</span> : 0}{l.consecutiveMissed > 0 && <span className="bad"> ({l.consecutiveMissed} consec!)</span>}</td>
                <td className="info">active</td>
                <td className="num">
                  <button className="small" title={`Pay off ${fmtCompact(l.balance)} + foreclosure fee`} onClick={() => g.forecloseLoan(l.id)}>foreclose</button>
                </td>
              </tr>
            ))}
          </tbody>
          {active.length > 0 && (
            <tfoot>
              <tr className="total">
                <td>Total</td>
                <td className="dim">{active.filter((l) => l.kind !== 'cash').length} HP · {active.filter((l) => l.kind === 'cash').length} WC</td>
                <td className="dim">{new Set(active.map((l) => l.busId).filter(Boolean)).size} bus(es)</td>
                <td className="num"><M v={active.reduce((a, l) => a + l.principal, 0)} /></td>
                <td className="num"><M v={book.balance} /></td>
                <td className="num">{book.balance > 0 ? `${(book.rateBps / 100).toFixed(1)}%` : '—'}</td>
                <td className="num"><M v={totalEmi} /></td>
                <td>{book.nextDue !== undefined ? fmtDate(book.nextDue) : '—'}</td>
                <td className="num">{active.reduce((a, l) => a + l.emisPaid, 0)}/{active.reduce((a, l) => a + l.emisMissed, 0) || 0}</td>
                <td className="info">{active.length} active</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </Panel>
    </>
  )
}
