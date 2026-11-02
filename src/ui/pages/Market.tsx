import { useEffect, useState } from 'react'
import { useGame } from '../../store/gameStore'
import {
  BUS_MODELS,
  CLASS_LABEL,
  NEW_MAKERS,
  NEW_MODEL_LIST,
  chassisLayoutVariants,
  coachKind,
  coachKindClass,
  coachSpec,
  dealerCatalogRows,
  isCargoModel,
  layoutOptionLabel,
  modelTitle,
} from '../../engine/data/busModels'
import { BAL } from '../../engine/data/balance'
import { quoteLoan, availableLoanProducts } from '../../engine/sim/banking'
import { effectiveNewPrice, worstSubsystem, usedPrice, type FinancePlan } from '../../engine/sim/fleet'
import { activeGroups } from '../../engine/sim/groups'
import { fmtCompact, type Money } from '../../engine/core/money'
import {
  designsForModel,
  getDesign,
  modelSupportsBodyDesigns,
  composeLeadTime,
  coachTitle,
  fleetModelLabel,
  bodyPackagePrice,
} from '../../engine/data/bodyBuilders'
import { Bar, KV, M, Modal, Panel } from '../bits'

export function FinanceModal({ price: initialPrice, title, isNew, modelId, onConfirm, onClose }: {
  price: Money
  title: string
  isNew?: boolean
  modelId?: string
  onConfirm: (plan: FinancePlan, bodyDesignId?: string, orderedModelId?: string) => void
  onClose: () => void
}) {
  const s = useGame((g) => g.state)!
  const seedModel = modelId ? BUS_MODELS[modelId] : undefined
  const supportsCustomBody = Boolean(isNew && seedModel && modelSupportsBodyDesigns(seedModel))
  const layoutVariants = supportsCustomBody && seedModel ? chassisLayoutVariants(seedModel) : []
  const [selectedModelId, setSelectedModelId] = useState<string>(modelId ?? '')
  const model = selectedModelId ? BUS_MODELS[selectedModelId] : seedModel
  const designOptions = supportsCustomBody && model ? designsForModel(s, model) : []
  const [selectedDesignId, setSelectedDesignId] = useState<string>(designOptions[0]?.design.id ?? '')
  useEffect(() => {
    if (!designOptions.some((o) => o.design.id === selectedDesignId)) {
      setSelectedDesignId(designOptions[0]?.design.id ?? '')
    }
  }, [selectedModelId, designOptions, selectedDesignId])
  const selectedDesign = designOptions.find((o) => o.design.id === selectedDesignId)?.design
  const selectedBuilder = designOptions.find((o) => o.design.id === selectedDesignId)?.builder

  const price = supportsCustomBody && model ? effectiveNewPrice(s, model.id, selectedDesignId) : initialPrice
  const leadDays = isNew && model ? composeLeadTime(model, selectedDesign) : undefined

  const products = availableLoanProducts(s)
  const [productId, setProductId] = useState<string>('cash')
  const [months, setMonths] = useState(48)
  const [orderedCount, setOrderedCount] = useState(0)
  const quote = productId !== 'cash' ? quoteLoan(s, productId, price, months) : null
  const product = products.find((p) => p.id === productId)
  const liquidity = s.company.cash + (s.od.limit - s.od.drawn)
  const needed = quote ? quote.downPayment + quote.processingFee : price
  const depDefault = s.company.depreciationDefault ?? 'SLM'
  const depRate = depDefault === 'WDV'
    ? (s.company.depreciationRatePct ?? BAL.depreciationStandardRate.WDV)
    : (s.company.depreciationRatePct ?? BAL.depreciationStandardRate.SLM)

  return (
    <Modal
      title={title}
      onClose={onClose}
      actions={
        <>
          {orderedCount > 0 && (
            <span className="good small" style={{ marginRight: 'auto' }}>
              ✓ {orderedCount} {isNew ? 'ordered' : 'purchased'}
            </span>
          )}
          <button onClick={onClose}>Close</button>
          <button
            className="primary"
            disabled={(!isNew && orderedCount > 0) || needed > liquidity}
            onClick={() => {
              onConfirm(
                productId === 'cash' ? {} : { loanProductId: productId, months },
                supportsCustomBody ? selectedDesignId : undefined,
                supportsCustomBody ? selectedModelId : undefined,
              )
              if (!isNew) {
                onClose()
                return
              }
              setOrderedCount((c) => c + 1)
            }}
          >
            {needed > liquidity
              ? `Need ${fmtCompact(needed)} liquidity`
              : !isNew && orderedCount > 0
              ? 'Purchased'
              : orderedCount > 0
              ? 'Order another'
              : 'Confirm purchase'}
          </button>
        </>
      }
    >
      {supportsCustomBody && (
        <div style={{ marginBottom: 14, padding: 12, background: 'var(--panel-alt, #151a21)', borderRadius: 6, border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '0.9rem' }}>Chassis Body Selection</div>
          {layoutVariants.length > 0 && (
            <div className="form-row" style={{ marginBottom: 8 }}>
              <label style={{ minWidth: 100 }}>Layout</label>
              <select
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                style={{ flex: 1 }}
              >
                {layoutVariants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {layoutOptionLabel(v)} · {CLASS_LABEL[v.cls]}
                  </option>
                ))}
              </select>
            </div>
          )}
          {model && (
            <div className="dim small" style={{ marginBottom: 8 }}>
              Chassis {modelTitle(model)} ·{' '}
              <span className={coachKindClass(model)}>{coachKind(model)}</span>
              <span> {model.layout.cols}</span>
              {!model.isCargoOnly && <> · {model.seats} {coachKind(model) === 'Sleeper' || coachKind(model) === 'Hybrid' ? 'berths' : 'seats'}</>}
              {' · '}base {fmtCompact(model.priceNew)}
            </div>
          )}
          {designOptions.length > 0 && (
            <div className="form-row" style={{ margin: 0 }}>
              <label style={{ minWidth: 100 }}>Body Design</label>
              <select
                value={selectedDesignId}
                onChange={(e) => setSelectedDesignId(e.target.value)}
                style={{ flex: 1 }}
              >
                {designOptions.length === 0 ? (
                  <option value="">No body designs for this chassis length</option>
                ) : (
                  designOptions.map(({ builder, design }) => {
                    const body = bodyPackagePrice(builder.id, design, model?.name ?? '')
                    return (
                      <option key={design.id} value={design.id}>
                        {builder.name} — {design.name} (+{fmtCompact(body)})
                      </option>
                    )
                  })
                )}
              </select>
            </div>
          )}
          {selectedDesign && (
            <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'flex-start' }}>
              {selectedDesign.image ? (
                <img
                  src={selectedDesign.image}
                  alt={selectedDesign.name}
                  style={{ width: 110, height: 70, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)', flexShrink: 0 }}
                />
              ) : (
                <div style={{ width: 110, height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0e1217', borderRadius: 4, border: '1px solid var(--border)', color: 'var(--dim)', fontSize: '0.75rem', flexShrink: 0 }}>
                  No photo
                </div>
              )}
              <div style={{ flex: 1, fontSize: '0.8rem', lineHeight: 1.4 }}>
                <div style={{ fontWeight: 600 }}>{selectedBuilder?.name} · {selectedDesign.name}</div>
                <div className="dim mt4">
                  <span>Body: <b>+{fmtCompact(bodyPackagePrice(selectedBuilder?.id, selectedDesign, model?.name ?? ''))}</b></span>
                  {' · '}
                  <span>Lead: <b>{selectedDesign.leadDaysAdd >= 0 ? `+${selectedDesign.leadDaysAdd}d` : `${selectedDesign.leadDaysAdd}d`}</b> ({leadDays}d total)</span>
                </div>
                <div className="dim">
                  <span>Comfort: <b className={selectedDesign.comfortDelta >= 0 ? 'good' : 'bad'}>{selectedDesign.comfortDelta >= 0 ? `+${selectedDesign.comfortDelta}` : selectedDesign.comfortDelta}</b></span>
                  {' · '}
                  <span>Maint: <b className={selectedDesign.maintDelta <= 0 ? 'good' : 'bad'}>{selectedDesign.maintDelta >= 0 ? `+${Math.round(selectedDesign.maintDelta * 100)}%` : `${Math.round(selectedDesign.maintDelta * 100)}%`}</b></span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      <KV rows={[
        ['Price', <M v={price} full />],
        ...(leadDays ? [['Delivery lead time', `${leadDays} days`]] as [string, any][] : []),
        ['Your liquidity (cash + OD)', <M v={liquidity} full />],
      ]} />
      <div className="form-row mt12">
        <label>Financing</label>
        <select value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="cash">Full cash</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.lender} (LTV {Math.round(p.maxLtv * 100)}%)</option>
          ))}
        </select>
        {productId !== 'cash' && product && (
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {Array.from({ length: (product.maxMonths - product.minMonths) / 12 + 1 }, (_, i) => product.minMonths + i * 12).map((m) => (
              <option key={m} value={m}>{m} months</option>
            ))}
          </select>
        )}
      </div>
      {quote && (
        <KV rows={[
          ['Loan principal', <M v={quote.principal} full />],
          ['Down payment now', <M v={quote.downPayment} full />],
          ['Processing fee', <M v={quote.processingFee} />],
          ['Interest rate', `${(quote.rateBps / 100).toFixed(1)}% p.a.`],
          ['EMI (monthly)', <span className="accent"><M v={quote.emi} full /></span>],
          ['Total repayment', <M v={quote.emi * quote.months} />],
        ]} />
      )}
      {productId === 'cash' && (
        <p className="small dim" title="Paying cash keeps you debt-free but drains working capital. Buses earn while EMIs run — most operators finance.">
          Cash purchase — full amount from liquidity.
        </p>
      )}
      <div className="mt12 pt12" style={{ borderTop: '1px solid var(--border)' }}>
        <p className="small dim" style={{ margin: 0 }}>
          Asset depreciation:{' '}
          <b>
            {depDefault === 'NONE'
              ? 'This coach books no depreciation and stays at cost'
              : `This coach will use ${depDefault} at ${depRate.toFixed(1)}% a year`}
          </b>{' '}
          (locked by company tax policy).
        </p>
      </div>
    </Modal>
  )
}

export function MarketPage() {
  const s = useGame((g) => g.state)!
  const g = useGame()
  const activeBrandList = activeGroups(s)
  const [selectedBrand, setSelectedBrand] = useState('')
  const [leaseBrand, setLeaseBrand] = useState<Record<string, string>>({})
  const [attachBrand, setAttachBrand] = useState<Record<string, string>>({})
  const [buying, setBuying] = useState<{ kind: 'new' | 'used'; id: string; price: Money; title: string } | null>(null)
  const subsidiary = Boolean(s.company.dedicatedCargoSubsidiary)
  const makers = NEW_MAKERS.filter((brand) =>
    NEW_MODEL_LIST.some((m) => m.maker === brand && (subsidiary || !isCargoModel(m))),
  )
  const [maker, setMaker] = useState(makers[0] ?? NEW_MAKERS[0] ?? 'BharatBenz')
  useEffect(() => {
    if (!makers.includes(maker) && makers[0]) setMaker(makers[0])
  }, [maker, makers])
  const catalog = dealerCatalogRows(
    NEW_MODEL_LIST.filter((m) => m.maker === maker && (subsidiary || !isCargoModel(m))),
  )
  const chassisStyleCatalog = maker === 'Ashok Leyland' || maker === 'BharatBenz'

  return (
    <>
      <div className="page-title">
        Market <span className="sub">refreshes in {s.marketRefreshDay - s.day} day(s) · four ways to put a bus on the road</span>
        <span className="spacer" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 'normal' }}>
          Assign to Brand:
          <select
            value={selectedBrand}
            onChange={(e) => setSelectedBrand(e.target.value)}
            style={{ minWidth: 160 }}
          >
            {activeBrandList.map((grp) => (
              <option key={grp.id} value={grp.id}>
                {grp.code} - {grp.name}
              </option>
            ))}
            <option value="">Unassigned</option>
          </select>
        </label>
      </div>

      <Panel
        title="Buy new — dealer catalog"
        info="Order from the maker list. Finance at purchase (cash or vehicle HP). Delivery lead time applies before the bus is active."
        right={
          <span className="flex flex-wrap">
            {makers.map((brand) => (
              <button
                key={brand}
                className={`small ${maker === brand ? 'primary' : ''}`}
                onClick={() => setMaker(brand)}
              >
                {brand}
              </button>
            ))}
          </span>
        }
        flat
      >
        <table className="data">
          <thead>
            <tr>
              <th>Model</th>
              {!chassisStyleCatalog && <th>Layout</th>}
              <th className="num">Seats</th>
              <th>Class</th>
              <th className="num">Mileage</th>
              <th className="num">Comfort</th>
              <th className="num">Delivery</th>
              <th className="num">{chassisStyleCatalog ? 'Chassis' : 'Price'}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {catalog.map((m) => {
              const variants = chassisStyleCatalog && !isCargoModel(m) ? chassisLayoutVariants(m) : [m]
              const price = m.priceNew
              const subsidised = effectiveNewPrice(s, m.id) < m.priceNew
              const seatLo = Math.min(...variants.map((v) => v.seats))
              const seatHi = Math.max(...variants.map((v) => v.seats))
              return (
                <tr key={chassisStyleCatalog && !isCargoModel(m) ? `${m.maker}::${m.name}` : m.id}>
                  <td>
                    <span className="accent">{modelTitle(m)}</span>
                    <div className="small faint">
                      {chassisStyleCatalog && !isCargoModel(m)
                        ? 'Chassis · pick layout & body on order'
                        : coachSpec(m)}
                    </div>
                  </td>
                  {!chassisStyleCatalog && (
                    <td>
                      <span className={coachKindClass(m)}>{coachKind(m)}</span>
                      <span className="dim small"> {m.layout.cols}</span>
                    </td>
                  )}
                  <td className="num">
                    {m.isCargoOnly
                      ? `${((m.cargoCapKg || 0) / 1000).toFixed(0)}T cargo`
                      : chassisStyleCatalog && seatLo !== seatHi
                        ? `${seatLo}–${seatHi}`
                        : m.seats}
                  </td>
                  <td className="dim">
                    {chassisStyleCatalog && !isCargoModel(m) ? 'Chassis + body' : CLASS_LABEL[m.cls]}
                  </td>
                  <td className="num" title={m.electric ? 'Electric, billed per km' : 'Loaded highway km/l with AC on, cautious driver. Aggressive driving is about 3.0 km/l where this reads 3.5.'}>{m.electric ? `${fmtCompact(BAL.electricCostPerKm)}/km` : `${m.mileage} km/l`}</td>
                  <td className="num">{m.isCargoOnly ? '—' : chassisStyleCatalog ? 'via body' : `${m.comfort}/10`}</td>
                  <td className="num">{m.leadTimeDays}d+</td>
                  <td className="num">
                    <M v={price} />{subsidised && <span className="good"> EV-subsidy!</span>}
                  </td>
                  <td className="num">
                    <button className="small" onClick={() => setBuying({ kind: 'new', id: m.id, price, title: `Order new ${modelTitle(m)}` })}>order</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Panel>

      <Panel title={`Used market — hidden condition, inspect for ${fmtCompact(BAL.inspectionCost)}`} flat>
        <table className="data">
          <thead>
            <tr><th>Listing</th><th>Layout</th><th className="num">Seats</th><th>Age / odo</th><th className="num">Fair value</th><th className="num">Asking</th><th>Condition</th><th>History</th><th /></tr>
          </thead>
          <tbody>
            {s.usedMarket.length === 0 && <tr><td colSpan={9} className="dim">Market is empty this week.</td></tr>}
            {s.usedMarket.map((l) => {
              const model = BUS_MODELS[l.modelId]
              if (!model || (!subsidiary && isCargoModel(model))) return null
              const fair = usedPrice(l.modelId, l.ageYears, l.bodyDesignId, s)
              const title = fleetModelLabel(model, {
                bodyBuilderId: l.bodyBuilderId,
                bodyDesignId: l.bodyDesignId,
                bodyDesignName: l.bodyDesignName,
                bodyBuilders: s.bodyBuilders,
              })
              return (
                <tr key={l.id}>
                  <td>
                    <div>
                      <span className="accent">{title}</span> <span className="dim">{l.reg}</span>
                      <div className="small faint">
                        {coachSpec(model)} · {model.electric ? 'electric' : `${model.mileage} km/l`} · {l.sellerNote}
                        {l.gpsDeviceFitted ? <span className="good"> · GPS fitted</span> : <span className="dim"> · No GPS</span>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={coachKindClass(model)}>{coachKind(model)}</span>
                    <span className="dim small"> {model.layout.cols}{model.ac ? ' · AC' : ' · Non-AC'}</span>
                  </td>
                  <td className="num">{model.seats}</td>
                  <td>{l.ageYears} yrs · {Math.round(l.odometer / 1000)}k km</td>
                  <td className="num dim"><M v={fair} /></td>
                  <td className="num"><M v={l.askPrice} />{l.askPrice > fair * 1.05 && <span className="bad"> ▲</span>}{l.askPrice < fair * 0.95 && <span className="good"> ▼</span>}</td>
                  <td>
                    {l.inspected ? (
                      <span title="worst subsystem"><Bar value={worstSubsystem(l.condition) / 100} tone="auto" width={8} /> {Math.round(worstSubsystem(l.condition))}</span>
                    ) : (
                      <span className="dim">unknown</span>
                    )}
                  </td>
                  <td>{l.inspected ? (l.accidentHistory ? <span className="bad">accident!</span> : <span className="good">clean</span>) : <span className="dim">?</span>}</td>
                  <td className="num nowrap">
                    {!l.inspected && <button className="small" onClick={() => g.inspectListing(l.id)}>inspect</button>}{' '}
                    <button className="small" onClick={() => setBuying({ kind: 'used', id: l.id, price: l.askPrice, title: `Buy used ${title} ${l.reg}` })}>buy</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Panel>

      <div className="grid-2">
        <Panel
          title="Dry lease — no capex; owner services, you staff"
          flat
          info="You appoint drivers and a conductor and pay the monthly rent. The owner carries papers, service, tyres, overhauls, insurance, road tax and fitness — the rent is what that costs them plus their money. Deposit is refunded if you run the full lock-in."
        >
          <table className="data">
            <thead><tr><th>Bus</th><th>Layout</th><th className="num">Seats</th><th>Odo</th><th className="num">Rent/mo</th><th className="num">Deposit</th><th className="num">Lock-in</th><th /></tr></thead>
            <tbody>
              {s.leaseOffers.length === 0 && <tr><td colSpan={8} className="dim">No lease offers this week.</td></tr>}
              {s.leaseOffers.map((o) => {
                const m = BUS_MODELS[o.modelId]
                if (!m || (!subsidiary && isCargoModel(m))) return null
                const title = fleetModelLabel(m, {
                  bodyBuilderId: o.bodyBuilderId,
                  bodyDesignId: o.bodyDesignId,
                  bodyDesignName: o.bodyDesignName,
                  bodyBuilders: s.bodyBuilders,
                })
                return (
                  <tr key={o.id}>
                    <td>
                      <span className="accent">{title}</span> <span className="dim">({o.ageYears} yrs)</span>
                      <div className="small faint">{m.electric ? 'electric' : `${m.mileage} km/l`} · {o.gpsDeviceFitted ? <span className="good">GPS fitted</span> : <span className="dim">No GPS</span>}</div>
                    </td>
                    <td><span className={coachKindClass(m)}>{coachKind(m)}</span> <span className="dim small">{m.ac ? 'AC' : 'Non-AC'}</span></td>
                    <td className="num">{m.seats}</td>
                    <td className="dim">{Math.round((o.odometer ?? o.ageYears * 70_000) / 1000)}k km</td>
                    <td className="num"><M v={o.monthlyRent} /></td>
                    <td className="num"><M v={o.monthlyRent * o.depositMonths} /></td>
                    <td className="num">{o.minMonths} mo</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <select
                        className="small"
                        style={{ maxWidth: 90, fontSize: 11, padding: '1px 4px', marginRight: 4 }}
                        value={leaseBrand[o.id] !== undefined ? leaseBrand[o.id] : selectedBrand}
                        onChange={(e) => setLeaseBrand((prev) => ({ ...prev, [o.id]: e.target.value }))}
                      >
                        <option value="">—</option>
                        {activeBrandList.map((b) => (
                          <option key={b.id} value={b.id}>{b.code}</option>
                        ))}
                      </select>
                      <button
                        className="small"
                        onClick={() => {
                          const chosen = leaseBrand[o.id] !== undefined ? leaseBrand[o.id] : selectedBrand
                          g.startLease(o.id, chosen || undefined)
                        }}
                      >
                        sign
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Panel>

        <Panel
          title="Attach a third-party bus — their bus, your brand"
          flat
          info="Zero capex. The owner keeps papers, fuel, crew, service and repairs — you pay their ticket share and carry the brand risk."
        >
          {s.company.brandAwareness < BAL.attachMinBrandAwareness ? (
            <p className="small warn" style={{ padding: '8px 10px' }}>
              Attach is mid-game: need brand awareness ≥ {Math.round(BAL.attachMinBrandAwareness * 100)}%
              (now {Math.round(s.company.brandAwareness * 100)}%). Until then, buy or lease coaches.
            </p>
          ) : (
            <>
              <table className="data">
                <thead><tr><th>Bus</th><th>Layout</th><th className="num">Seats</th><th>Odo</th><th className="num">Owner share</th><th>Condition hint</th><th /></tr></thead>
                <tbody>
                  {s.attachOffers.length === 0 && <tr><td colSpan={7} className="dim">No attach offers this week.</td></tr>}
                  {s.attachOffers.map((o) => {
                    const m = BUS_MODELS[o.modelId]
                    if (!m || (!subsidiary && isCargoModel(m))) return null
                    const title = fleetModelLabel(m, {
                      bodyBuilderId: o.bodyBuilderId,
                      bodyDesignId: o.bodyDesignId,
                      bodyDesignName: o.bodyDesignName,
                      bodyBuilders: s.bodyBuilders,
                    })
                    return (
                      <tr key={o.id}>
                        <td>
                          <span className="accent">{title}</span> <span className="dim">{o.reg} · {o.ageYears} yrs</span>
                          <div className="small faint">{m.electric ? 'electric' : `${m.mileage} km/l`} · {o.gpsDeviceFitted ? <span className="good">GPS fitted</span> : <span className="dim">No GPS</span>}</div>
                        </td>
                        <td><span className={coachKindClass(m)}>{coachKind(m)}</span> <span className="dim small">{m.ac ? 'AC' : 'Non-AC'}</span></td>
                        <td className="num">{m.seats}</td>
                        <td className="dim">{Math.round((o.odometer ?? o.ageYears * 80_000) / 1000)}k km</td>
                        <td className="num">{Math.round(o.ownerShare * 100)}% of tickets</td>
                        <td className={o.qualityTier === 'good' ? 'good' : o.qualityTier === 'rough' ? 'bad' : 'warn'}>{o.qualityTier}</td>
                        <td className="num" style={{ whiteSpace: 'nowrap' }}>
                          <select
                            className="small"
                            style={{ maxWidth: 90, fontSize: 11, padding: '1px 4px', marginRight: 4 }}
                            value={attachBrand[o.id] !== undefined ? attachBrand[o.id] : selectedBrand}
                            onChange={(e) => setAttachBrand((prev) => ({ ...prev, [o.id]: e.target.value }))}
                          >
                            {activeBrandList.map((b) => (
                              <option key={b.id} value={b.id}>{b.code}</option>
                            ))}
                            <option value="">—</option>
                          </select>
                          <button
                            className="small"
                            onClick={() => {
                              const chosen = attachBrand[o.id] !== undefined ? attachBrand[o.id] : selectedBrand
                              g.signAttach(o.id, chosen || undefined)
                            }}
                          >
                            attach
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
        </Panel>
      </div>

      {buying && (
        <FinanceModal
          price={buying.price}
          title={buying.title}
          isNew={buying.kind === 'new'}
          modelId={buying.kind === 'new' ? buying.id : undefined}
          onClose={() => setBuying(null)}
          onConfirm={(plan, bodyDesignId, orderedModelId) => {
            const gid = selectedBrand || undefined
            if (buying.kind === 'new') g.orderNewBus(orderedModelId || buying.id, plan, gid, bodyDesignId)
            else g.buyUsed(buying.id, plan, gid)
          }}
        />
      )}
    </>
  )
}
