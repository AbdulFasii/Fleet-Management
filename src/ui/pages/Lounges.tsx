import { useState } from 'react'
import { fmtDate } from '../../engine/core/calendar'
import { Link } from 'react-router-dom'
import { useGameActions, useDeferredGameState } from '../../store/gameStore'
import { Panel, Modal, StatRow, Empty, PageHeader } from '../bits'
import { fmtCompact } from '../../engine/core/money'
import { CITIES, cityName } from '../../engine/data/cities'
import {
  LOUNGE_AMENITIES,
  LOUNGE_AMENITY_PRESETS,
  LOUNGE_SEATING,
  LOUNGE_SEATING_ORDER,
  LOUNGE_TIERS,
  getCityBoardingClusters,
  getLoungeTierDef,
  loungeAmenityIds,
  loungePackage,
  loungePackageOf,
  tierAllows,
} from '../../engine/data/loungeCatalog'
import { getLoungeSchedulesHandled } from '../../engine/sim/lounge'
import type { LoungeAmenityId, LoungeSeating, LoungeTier, PassengerLounge } from '../../engine/types'

const signed = (n: number, d = 2) => `${n > 0 ? '+' : ''}${n.toFixed(d)}`

function amenityEffect(a: (typeof LOUNGE_AMENITIES)[number]): string {
  const bits: string[] = []
  if (a.capture > 0) bits.push(`+${Math.round(a.capture * 100)}% use`)
  if (a.spend > 0) bits.push(`+${Math.round(a.spend * 100)}% snack spend`)
  bits.push(`comfort ${signed(a.comfort)}`)
  return bits.join(' · ')
}

function amenityCost(a: (typeof LOUNGE_AMENITIES)[number]): string {
  if (a.perPax > 0) return `${fmtCompact(a.perPax)}/pax`
  if (a.daily > 0) return `${fmtCompact(a.daily)}/day`
  return 'free'
}

const amenityMinTier = (id: LoungeAmenityId) => LOUNGE_AMENITIES.find((a) => a.id === id)!.minTier

/** Seating and amenity choices, shared by the open and refit screens. */
function PackagePicker({ tier, seating, setSeating, amenities, setAmenities }: {
  tier: LoungeTier
  seating: LoungeSeating
  setSeating: (s: LoungeSeating) => void
  amenities: LoungeAmenityId[]
  setAmenities: (a: LoungeAmenityId[]) => void
}) {
  const toggle = (id: LoungeAmenityId) =>
    setAmenities(amenities.includes(id) ? amenities.filter((x) => x !== id) : [...amenities, id])
  const preset = (ids: LoungeAmenityId[]) => setAmenities(ids.filter((id) => tierAllows(tier, amenityMinTier(id))))
  const activePreset = LOUNGE_AMENITY_PRESETS.find(
    (pr) => pr.amenities.filter((id) => tierAllows(tier, amenityMinTier(id))).slice().sort().join() === amenities.slice().sort().join(),
  )
  return (
    <>
      <div>
        <div className="muted mb8">Seating</div>
        <table className="data">
          <thead>
            <tr><th /><th>Package</th><th className="num">Seats</th><th className="num">Comfort</th><th className="num">Conversion</th><th className="num">Fit-out</th></tr>
          </thead>
          <tbody>
            {LOUNGE_SEATING_ORDER.map((id) => {
              const d = LOUNGE_SEATING[id]
              const ok = tierAllows(tier, d.minTier)
              const seats = loungePackage(tier, id, []).seats
              return (
                <tr key={id} className={ok ? '' : 'dim'} style={{ cursor: ok ? 'pointer' : 'not-allowed' }} onClick={() => ok && setSeating(id)} title={ok ? undefined : `Needs a ${LOUNGE_TIERS[d.minTier].label.split(' ')[0]} lounge or larger`}>
                  <td><input type="radio" name="seating" disabled={!ok} checked={seating === id} onChange={() => setSeating(id)} /></td>
                  <td><b>{d.label}</b></td>
                  <td className="num">{seats}</td>
                  <td className="num">{d.comfort === 0 ? 'base' : signed(d.comfort)}</td>
                  <td className="num">{d.conv === 0 ? 'base' : `${signed(d.conv * 100, 1)}%`}</td>
                  <td className="num">{d.setupPct === 0 ? 'base' : `${d.setupPct > 0 ? '+' : ''}${Math.round(d.setupPct * 100)}%`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div>
        <div className="row between mb8">
          <span className="muted">Amenities</span>
          <span className="subtabs inline">
            {LOUNGE_AMENITY_PRESETS.map((pr) => (
              <button key={pr.id} className={`small ${activePreset?.id === pr.id ? 'primary' : ''}`} onClick={() => preset(pr.amenities)}>
                {pr.label}
              </button>
            ))}
          </span>
        </div>
        <table className="data">
          <tbody>
            {LOUNGE_AMENITIES.map((a) => {
              const ok = tierAllows(tier, a.minTier)
              return (
                <tr key={a.id} className={ok ? '' : 'dim'} style={{ cursor: ok ? 'pointer' : 'not-allowed' }} onClick={() => ok && toggle(a.id)} title={ok ? undefined : `Needs a ${LOUNGE_TIERS[a.minTier].label.split(' ')[0]} lounge or larger`}>
                  <td><input type="checkbox" disabled={!ok} checked={ok && amenities.includes(a.id)} onChange={() => toggle(a.id)} /></td>
                  <td><b>{a.label}</b></td>
                  <td className="muted">{amenityEffect(a)}</td>
                  <td className="num">{amenityCost(a)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function LoungesPage() {
  const s = useDeferredGameState()!
  const g = useGameActions()

  const lounges = s.company.lounges ?? []
  const [showOpenModal, setShowOpenModal] = useState(false)
  const [upgradingLounge, setUpgradingLounge] = useState<PassengerLounge | null>(null)
  const [closingLounge, setClosingLounge] = useState<PassengerLounge | null>(null)

  // Open Form State
  const defaultCity = s.company.homeCityId || 'maa'
  const [selectedCity, setSelectedCity] = useState(defaultCity)
  const [selectedCluster, setSelectedCluster] = useState(() => getCityBoardingClusters(defaultCity)[0] ?? '')
  const [selectedTier, setSelectedTier] = useState<LoungeTier>('express')
  const [customLocation, setCustomLocation] = useState('')
  const [selectedSeating, setSelectedSeating] = useState<LoungeSeating>('cushioned')
  const [selectedAmenities, setSelectedAmenities] = useState<LoungeAmenityId[]>([])
  const [refitting, setRefitting] = useState<PassengerLounge | null>(null)
  const [refitSeating, setRefitSeating] = useState<LoungeSeating>('cushioned')
  const [refitAmenities, setRefitAmenities] = useState<LoungeAmenityId[]>([])

  // When city changes, update cluster options
  const handleCityChange = (cityId: string) => {
    setSelectedCity(cityId)
    const clusters = getCityBoardingClusters(cityId)
    setSelectedCluster(clusters[0] ?? '')
    setCustomLocation('')
  }

  const changeTier = (tier: LoungeTier) => {
    setSelectedTier(tier)
    setSelectedAmenities((a) => a.filter((id) => tierAllows(tier, amenityMinTier(id))))
    if (!tierAllows(tier, LOUNGE_SEATING[selectedSeating].minTier)) setSelectedSeating('cushioned')
  }

  const startRefit = (l: PassengerLounge) => {
    setRefitting(l)
    setRefitSeating(l.seating ?? 'cushioned')
    setRefitAmenities(loungeAmenityIds(l, s.config?.passengerConfig))
  }

  // Summary Metrics
  const totalLounges = lounges.length
  const totalYesterdayPax = lounges.reduce((a, l) => a + l.yesterdayPax, 0)
  const totalYesterdayRevenue = lounges.reduce((a, l) => a + l.yesterdaySnackRevenue, 0)
  const totalYesterdayRent = lounges.reduce((a, l) => a + l.yesterdayRentExpense, 0)
  const totalYesterdayElectric = lounges.reduce((a, l) => a + l.yesterdayElectricExpense, 0)
  const totalYesterdayStaff = lounges.reduce((a, l) => a + l.yesterdayStaffExpense, 0)
  const totalYesterdayOpex = totalYesterdayRent + totalYesterdayElectric + totalYesterdayStaff
  const totalYesterdayProfit = totalYesterdayRevenue - totalYesterdayOpex

  const handleOpenLounge = () => {
    const loc = customLocation.trim() || selectedCluster
    if (!loc) {
      g.toast('Please select or specify a boarding location.', 'bad')
      return
    }
    g.openPassengerLounge(selectedCity, loc, selectedTier, selectedSeating, selectedAmenities)
    setShowOpenModal(false)
    setCustomLocation('')
  }

  const handleUpgrade = (newTier: LoungeTier) => {
    if (!upgradingLounge) return
    g.upgradePassengerLounge(upgradingLounge.id, newTier)
    setUpgradingLounge(null)
  }

  const handleClose = () => {
    if (!closingLounge) return
    g.closePassengerLounge(closingLounge.id)
    setClosingLounge(null)
  }

  return (
    <>
      {/* Top Header & Actions Bar */}
      <PageHeader title="Lounges" tip="Waiting areas with snack counters and charter booking offices" facts={<>{(s.company.lounges ?? []).length} open</>}>
        <Link to="/settings?tab=lounges" className="small dim" style={{ marginRight: 8 }}>
          Policies ›
        </Link>
        <button className="primary small" onClick={() => setShowOpenModal(true)}>
          + Open lounge
        </button>
      </PageHeader>

      <StatRow
        items={[
          { label: 'Lounges', value: totalLounges, title: `${new Set(lounges.map((l) => l.cityId)).size} cities` },
          { label: 'Pax/day', value: totalYesterdayPax.toLocaleString('en-IN') },
          { label: 'Sales/day', value: fmtCompact(totalYesterdayRevenue), tone: 'good' },
          { label: 'Opex/day', value: fmtCompact(totalYesterdayOpex), title: `Rent ${fmtCompact(totalYesterdayRent)} · power ${fmtCompact(totalYesterdayElectric)} · staff ${fmtCompact(totalYesterdayStaff)}` },
          { label: 'Net/day', value: `${totalYesterdayProfit >= 0 ? '+' : ''}${fmtCompact(totalYesterdayProfit)}`, tone: totalYesterdayProfit >= 0 ? 'good' : 'bad' },
        ]}
      />

      {/* Main Content: Lounges Directory */}
      {lounges.length === 0 ? (
        <Panel flat>
          <Empty text="No lounges yet." />
          <button className="primary small" onClick={() => setShowOpenModal(true)} title="Waiting room, snack bar and charter office; lifts bookings on routes from this city">
            + Open lounge in {cityName(defaultCity)}
          </button>
        </Panel>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 14 }}>
          {lounges.map((lounge) => {
            const tierDef = getLoungeTierDef(lounge.tier)
            const schedules = getLoungeSchedulesHandled(s, lounge.cityId)
            const cName = cityName(lounge.cityId)
            const isProfitable = lounge.yesterdayNetProfit >= 0
            const pkgOf = loungePackageOf(lounge, s.config?.passengerConfig)
            const tierName = lounge.tier === 'business' ? 'Executive' : lounge.tier === 'premium' ? 'Premium' : 'Express'

            return (
              <div
                key={lounge.id}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--panel-alt, #151a21)',
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div>
                  {/* Top Bar: Location & Badges */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{lounge.locationName}</div>
                      <div className="small dim" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <span>{cName}</span>
                        <span>·</span>
                        <span>Opened {fmtDate(lounge.openedDay)}</span>
                      </div>
                    </div>
                    <span
                      className={`pill small ${
                        lounge.tier === 'business' ? 'good' : lounge.tier === 'premium' ? 'primary' : 'dim'
                      }`}
                      style={{ fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}
                      title={tierDef.label}
                    >
                      {tierName}
                    </span>
                  </div>

                  {/* Highlights & Features */}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 6,
                      margin: '8px 0 12px 0',
                    }}
                  >
                    <span className="pill small dim">{pkgOf.seats} seats</span>
                    <span className="pill small dim">{tierDef.sqft} sq ft</span>
                    {lounge.tier !== 'express' && (
                      <span className="pill small primary" title="This lounge branch unlocks charter inquiries from this city!">
                        Tour & Charter Branch
                      </span>
                    )}
                  </div>

                  {/* Schedules Handled Today */}
                  <div
                    style={{
                      padding: '8px 10px',
                      background: 'var(--bg3)',
                      borderRadius: 6,
                      fontSize: '0.82rem',
                      marginBottom: 10,
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, marginBottom: 4 }}>
                      <span>Schedules Handled</span>
                      <span className="good">{schedules.total} Daily Departures/Arrivals</span>
                    </div>
                    <div className="dim small" style={{ fontSize: '0.78rem' }}>
                      {schedules.routeNames.length > 0
                        ? schedules.routeNames.slice(0, 3).join(' · ') + (schedules.routeNames.length > 3 ? ` +${schedules.routeNames.length - 3} more` : '')
                        : 'No direct schedules registered in this city yet.'}
                    </div>
                  </div>

                  {/* Daily Throughput & P&L Card */}
                  <div
                    style={{
                      padding: '10px 12px',
                      background: 'var(--bg)',
                      borderRadius: 6,
                      fontSize: '0.83rem',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="dim">Yesterday Waiting Passengers:</span>
                      <b>{lounge.yesterdayPax} pax <span className="dim">({Math.round((lounge.yesterdayPax / pkgOf.capacity) * 100)}% cap)</span></b>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="dim">Snack & Drink Net Margin:</span>
                      <b className="good">+{fmtCompact(lounge.yesterdaySnackRevenue)} / day</b>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="dim">Fixed Daily Opex (Rent, Power, Wages):</span>
                      <span className="bad">−{fmtCompact(lounge.yesterdayRentExpense + lounge.yesterdayElectricExpense + lounge.yesterdayStaffExpense)} / day</span>
                    </div>

                    <div
                      style={{
                        borderTop: '1px solid var(--border)',
                        paddingTop: 6,
                        marginTop: 2,
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontWeight: 700,
                      }}
                    >
                      <span>Daily Net Margin:</span>
                      <span className={isProfitable ? 'good' : 'bad'}>
                        {isProfitable ? '+' : ''}{fmtCompact(lounge.yesterdayNetProfit)} / day
                      </span>
                    </div>
                  </div>

                  {/* Lifetime Stats */}
                  <div className="dim small" style={{ marginTop: 8, fontSize: '0.75rem', textAlign: 'right' }}>
                    Lifetime: {lounge.lifetimePax.toLocaleString('en-IN')} pax hosted · {fmtCompact(lounge.lifetimeRevenue)} snack sales
                  </div>
                </div>

                {/* Card Actions */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  <button className="small dim" onClick={() => setClosingLounge(lounge)}>
                    Close…
                  </button>
                  <button className="small" onClick={() => startRefit(lounge)}>
                    Refit…
                  </button>
                  {lounge.tier !== 'business' && (
                    <button className="small primary" onClick={() => setUpgradingLounge(lounge)}>
                      Upgrade…
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: OPEN NEW PASSENGER LOUNGE                                          */}
      {/* ========================================================================= */}
      {showOpenModal && (() => {
        const pkg = loungePackage(selectedTier, selectedSeating, selectedAmenities)
        const handled = getLoungeSchedulesHandled(s, selectedCity)
        return (
          <Modal
            title="Open lounge"
            wide
            onClose={() => setShowOpenModal(false)}
            actions={
              <>
                              <div className="grow">
                <StatRow
                    items={[
                      { label: 'Setup', value: fmtCompact(pkg.setupCost) },
                      { label: 'Seats', value: pkg.seats, title: `Up to ${pkg.capacity} passengers a day` },
                      { label: 'Fixed/day', value: fmtCompact(pkg.dailyFixed), title: `Rent, power, staff and amenities${pkg.perPax > 0 ? `, plus ${fmtCompact(pkg.perPax)} per passenger` : ''}` },
                      { label: 'Conversion', value: `+${(pkg.conversion * 100).toFixed(1)}%`, tone: 'good', title: 'Extra bookings on routes from this city' },
                      { label: 'Comfort', value: signed(pkg.comfort), title: 'Passenger satisfaction points for trips boarding here' },
                      { label: 'Routes here', value: handled.total, title: `${handled.departures} departures and ${handled.arrivals} arrivals a day` },
                    ]}
                  />
                </div>
                <button onClick={() => setShowOpenModal(false)}>Cancel</button>
                <button className="primary" onClick={handleOpenLounge}>Open for {fmtCompact(pkg.setupCost)}</button>
              </>
            }
          >
            <div className="stack14">
              <div className="grid-2">
                <label className="stack10">
                  <span className="muted">City</span>
                  <select value={selectedCity} onChange={(e) => handleCityChange(e.target.value)}>
                    {Object.values(CITIES).map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.state})</option>
                    ))}
                  </select>
                </label>
                <label className="stack10">
                  <span className="muted">Boarding point</span>
                  <select value={selectedCluster} onChange={(e) => setSelectedCluster(e.target.value)}>
                    {getCityBoardingClusters(selectedCity).map((cl) => <option key={cl} value={cl}>{cl}</option>)}
                  </select>
                  <input
                    type="text"
                    placeholder="or a custom name"
                    value={customLocation}
                    onChange={(e) => setCustomLocation(e.target.value)}
                  />
                </label>
              </div>

              <div>
                <div className="muted mb8">Size</div>
                <table className="data">
                  <thead>
                    <tr><th /><th>Lounge</th><th className="num">Area</th><th className="num">Seats</th><th className="num">Setup</th><th className="num">Rent/day</th><th className="num">Conversion</th></tr>
                  </thead>
                  <tbody>
                    {(['express', 'premium', 'business'] as LoungeTier[]).map((key) => {
                      const tdef = LOUNGE_TIERS[key]
                      return (
                        <tr key={key} style={{ cursor: 'pointer' }} onClick={() => changeTier(key)} title={`${tdef.desc} ${tdef.features.join('; ')}.`}>
                          <td><input type="radio" name="tier" checked={selectedTier === key} onChange={() => changeTier(key)} /></td>
                          <td><b>{tdef.name.replace('Royal ', '')}</b>{key !== 'express' && <span className="muted"> · charter office</span>}</td>
                          <td className="num">{tdef.sqft} sq ft</td>
                          <td className="num">{tdef.seats}</td>
                          <td className="num">{fmtCompact(tdef.setupCost)}</td>
                          <td className="num">{fmtCompact(tdef.dailyRent)}</td>
                          <td className="num good">+{(tdef.demandBoostPct * 100).toFixed(1)}%</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <PackagePicker
                tier={selectedTier}
                seating={selectedSeating}
                setSeating={setSelectedSeating}
                amenities={selectedAmenities}
                setAmenities={setSelectedAmenities}
              />

            </div>
          </Modal>
        )
      })()}

      {refitting && (() => {
        const before = loungePackageOf(refitting, s.config?.passengerConfig)
        const pkg = loungePackage(refitting.tier, refitSeating, refitAmenities)
        const cost = Math.max(0, loungePackage(refitting.tier, refitSeating, []).setupCost - loungePackage(refitting.tier, refitting.seating ?? 'cushioned', []).setupCost)
        return (
          <Modal
            title={`Refit: ${refitting.locationName}`}
            wide
            onClose={() => setRefitting(null)}
            actions={
              <>
                              <div className="grow">
                <StatRow
                    items={[
                      { label: 'Seats', value: `${before.seats} → ${pkg.seats}` },
                      { label: 'Fixed/day', value: `${fmtCompact(before.dailyFixed)} → ${fmtCompact(pkg.dailyFixed)}` },
                      { label: 'Conversion', value: `+${(before.conversion * 100).toFixed(1)}% → +${(pkg.conversion * 100).toFixed(1)}%`, tone: 'good' },
                      { label: 'Comfort', value: `${signed(before.comfort)} → ${signed(pkg.comfort)}` },
                    ]}
                  />
                </div>
                <button onClick={() => setRefitting(null)}>Cancel</button>
                <button
                  className="primary"
                  onClick={() => { g.refitPassengerLounge(refitting.id, refitSeating, refitAmenities); setRefitting(null) }}
                >
                  {cost > 0 ? `Refit for ${fmtCompact(cost)}` : 'Apply'}
                </button>
              </>
            }
          >
            <div className="stack14">
              <PackagePicker
                tier={refitting.tier}
                seating={refitSeating}
                setSeating={setRefitSeating}
                amenities={refitAmenities}
                setAmenities={setRefitAmenities}
              />
            </div>
          </Modal>
        )
      })()}

      {upgradingLounge && (
        <Modal title={`Upgrade Lounge: ${upgradingLounge.locationName}`} onClose={() => setUpgradingLounge(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 420 }}>
            {/* Target Options */}
            {(['premium', 'business'] as LoungeTier[])
              .filter((tKey) => LOUNGE_TIERS[tKey].sqft > getLoungeTierDef(upgradingLounge.tier).sqft)
              .map((tKey) => {
                const targetDef = LOUNGE_TIERS[tKey]
                const curDef = getLoungeTierDef(upgradingLounge.tier)
                const cost = Math.max(0, targetDef.setupCost - Math.round(curDef.setupCost * 0.45))
                const canPay = s.company.cash >= cost

                return (
                  <div
                    key={tKey}
                    style={{
                      padding: 12,
                      background: 'var(--bg3)',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <b>{targetDef.name}</b>
                      <span className="pill small primary">{targetDef.sqft} sq ft · {targetDef.seats} seats</span>
                    </div>
                    <div className="dim small">{targetDef.desc}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                      <span className="small">Upgrade CapEx: <b>{fmtCompact(cost)}</b></span>
                      <button
                        className="small primary"
                        disabled={!canPay}
                        onClick={() => handleUpgrade(tKey)}
                      >
                        Upgrade Now
                      </button>
                    </div>
                  </div>
                )
              })}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="small dim" onClick={() => setUpgradingLounge(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CLOSE LOUNGE CONFIRMATION                                         */}
      {/* ========================================================================= */}
      {closingLounge && (
        <Modal title="Close Passenger Lounge" onClose={() => setClosingLounge(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 380 }}>
            <p style={{ margin: 0 }}>
              Close the lounge at <b>{closingLounge.locationName}</b> ({cityName(closingLounge.cityId)})?
            </p>
            <p className="muted" style={{ margin: 0 }}>
              Recovers ~{fmtCompact(Math.round(loungePackageOf(closingLounge, s.config?.passengerConfig).setupCost * 0.25))} (25% of deposit and fixtures).
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button className="small dim" onClick={() => setClosingLounge(null)}>
                Cancel
              </button>
              <button className="small danger" onClick={handleClose}>
                Yes, Close Lounge
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
