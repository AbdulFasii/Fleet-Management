import { useMemo } from 'react'
import {
  Area, AreaChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useGame } from '../store/gameStore'
import { fmtDateShort } from '../engine/core/calendar'
import { toRupees } from '../engine/core/money'
import { BAL } from '../engine/data/balance'
import { APP_TIER_NAMES } from '../engine/sim/channels'
import { Bar, KV, M, Panel, ratingTone } from './bits'

export function FleetHealthPanel() {
  const s = useGame((g) => g.state)!

  const pxSafetyStats = useMemo(() => {
    const buses = Object.values(s.buses)
    const drivers = Object.values(s.staff).filter((st) => st.role === 'driver')
    const completedTrips = Object.values(s.trips).filter((t) => t.status === 'completed' && t.outcome)
    const pssList = completedTrips.map((t) => t.outcome!.pss).filter((p): p is number => typeof p === 'number')
    const avgPss = pssList.length > 0 ? pssList.reduce((a, b) => a + b, 0) / pssList.length : s.company.rating * 2
    const onTimeTrips = completedTrips.filter((t) => (t.outcome?.delayMin ?? 0) <= 15 && !t.outcome?.breakdown).length
    const onTimeRate = completedTrips.length > 0 ? onTimeTrips / completedTrips.length : s.company.punctuality

    const avgCleanliness = buses.length > 0
      ? buses.reduce((a, b) => a + (b.busCleanliness ?? 85), 0) / buses.length
      : 85
    const cleanUnder60 = buses.filter((b) => (b.busCleanliness ?? 85) < 60).length
    const avgDriverSafety = drivers.length > 0
      ? drivers.reduce((a, d) => a + d.safety, 0) / drivers.length
      : 5

    const stylesCount = { aggressive: 0, cautious: 0 }
    for (const d of drivers) {
      const st = d.drivingStyle === 'aggressive' ? 'aggressive' : 'cautious'
      stylesCount[st] = (stylesCount[st] ?? 0) + 1
    }

    return {
      avgPss,
      tripsSampled: pssList.length,
      onTimeRate,
      avgCleanliness,
      cleanUnder60,
      avgDriverSafety,
      stylesCount,
    }
  }, [s])

  return (
    <Panel
      title="Fleet & Quality Health"
      info="Monitors real-time fleet hygiene, safety culture, punctuality and driver behavioural traits. PSS (Passenger Satisfaction Score 0-10) directly anchors your public RedBus rating and Primo status."
    >
      <div className="grid-2" style={{ gap: 12 }}>
        <div>
          <div className="accent small" style={{ fontWeight: 600, marginBottom: 6 }}>Passenger Experience</div>
          <KV rows={[
            ['Average PSS Score', <span className={pxSafetyStats.avgPss >= 7.5 ? 'good' : pxSafetyStats.avgPss < 5 ? 'bad' : 'warn'}><b>{pxSafetyStats.avgPss.toFixed(1)} / 10</b></span>],
            ['RedBus Rating', <span className={ratingTone(s.company.rating)} style={{ fontWeight: 600 }}>★ {s.company.rating.toFixed(2)} / 5.0</span>],
            ['On-Time Arrivals', <><Bar value={pxSafetyStats.onTimeRate} width={8} tone="auto" /> {Math.round(pxSafetyStats.onTimeRate * 100)}%</>],
            ['Trips Evaluated', `${pxSafetyStats.tripsSampled} departures`],
          ]} />
        </div>
        <div>
          <div className="accent small" style={{ fontWeight: 600, marginBottom: 6 }}>Hygiene & Safety</div>
          <KV rows={[
            ['Cleanliness', <><Bar value={pxSafetyStats.avgCleanliness / 100} width={8} tone="auto" /> {Math.round(pxSafetyStats.avgCleanliness)} / 100</>],
            ['Buses Under 60', pxSafetyStats.cleanUnder60 > 0 ? <span className="bad">{pxSafetyStats.cleanUnder60} bus(es)</span> : <span className="good">0 (Clean)</span>],
            ['Primo Sanitation', pxSafetyStats.cleanUnder60 === 0 ? <span className="good">Compliant ✓</span> : <span className="warn">At Risk ⚠</span>],
            ['Driver Safety', `${pxSafetyStats.avgDriverSafety.toFixed(1)}/10 (${pxSafetyStats.stylesCount.cautious}c / ${pxSafetyStats.stylesCount.aggressive}a)`],
          ]} />
        </div>
      </div>
    </Panel>
  )
}

export function CargoTrendPanel() {
  const s = useGame((g) => g.state)!

  const cargoPerformanceData = useMemo(() => {
    const days = 30
    const fromDay = Math.max(s.startDay, s.day - days)
    const byDay = new Map<number, { day: number; kg: number; rev: number }>()

    for (let d = fromDay; d <= s.day; d++) {
      byDay.set(d, { day: d, kg: 0, rev: 0 })
    }

    for (const list of Object.values(s.routeHistory ?? {})) {
      for (const h of list) {
        if (h.day >= fromDay && h.day <= s.day) {
          const entry = byDay.get(h.day)
          if (entry) {
            const ab = h.cargo?.AB
            const ba = h.cargo?.BA
            entry.kg += (ab?.kg ?? 0) + (ba?.kg ?? 0)
            entry.rev += Math.round(toRupees((ab?.revenue ?? 0) + (ba?.revenue ?? 0)))
          }
        }
      }
    }
    return Array.from(byDay.values()).map((e) => ({
      d: fmtDateShort(e.day),
      tonnes: Math.round((e.kg / 1000) * 100) / 100,
      revenue: e.rev,
    }))
  }, [s.routeHistory, s.day, s.startDay])

  return (
    <Panel
      title="Cargo Logistics: Volume vs Revenue (Last 30 Days)"
      info="Daily parcel volume transported in tonnes (1 t = 1,000 kg) vs revenue earned across contracted and spot courier bookings."
    >
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={cargoPerformanceData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <XAxis dataKey="d" tick={{ fontSize: 9, fill: '#64748b' }} interval={4} />
          <YAxis yAxisId="left" tick={{ fontSize: 9, fill: '#64748b' }} width={45} />
          <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#64748b' }} width={45} />
          <Tooltip
            content={({ payload, label }) => (
              <div className="chart-tooltip">
                {label}: {payload?.map((p) => `${p.name}: ${p.dataKey === 'revenue' ? `₹${Number(p.value).toLocaleString('en-IN')}` : `${Number(p.value).toLocaleString('en-IN')} t`}`).join(' · ')}
              </div>
            )}
          />
          <Legend />
          <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="#e8a33d" fill="#e8a33d22" name="Revenue (₹)" />
          <Area yAxisId="right" type="monotone" dataKey="tonnes" stroke="#38bdf8" fill="#38bdf822" name="Weight (t)" />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  )
}

export function ChannelMixPanel() {
  const s = useGame((g) => g.state)!
  const app = s.company.app
  const mix = { redbus: 0, abhibus: 0, ownapp: 0, counter: 0 }
  for (const t of Object.values(s.trips)) {
    const cs = t.channelSold
    if (cs) {
      mix.redbus += cs.redbus ?? 0
      mix.abhibus += cs.abhibus ?? 0
      mix.ownapp += cs.ownapp ?? 0
      mix.counter += cs.counter ?? 0
    }
  }
  const mixTotal = mix.redbus + mix.abhibus + mix.ownapp + mix.counter || 1

  return (
    <Panel
      title="Channel mix (booked seats, recent)"
      info="Build tiers and set the marketing budget under Settings. Growing MAU can push own-app share well past 40% as it pulls traffic off RedBus."
    >
      <KV rows={[
        ['RedBus', <><Bar value={mix.redbus / mixTotal} width={12} /> {Math.round((mix.redbus / mixTotal) * 100)}% <span className="dim small">({(s.world.redbusCommissionBps / 100).toFixed(0)}% comm, T+5)</span></>],
        ['AbhiBus', <><Bar value={mix.abhibus / mixTotal} width={12} /> {Math.round((mix.abhibus / mixTotal) * 100)}%</>],
        ['Own app', <><Bar value={mix.ownapp / mixTotal} width={12} tone="good" /> {Math.round((mix.ownapp / mixTotal) * 100)}% <span className="dim small">(2% PG, T+1)</span></>],
        ['Counter', <><Bar value={mix.counter / mixTotal} width={12} tone="warn" /> {Math.round((mix.counter / mixTotal) * 100)}% <span className="dim small">({(BAL.counterCommissionBps / 100).toFixed(0)}% agent, cash)</span></>],
      ]} />
      <div className="panel-title" style={{ margin: '12px -10px 8px' }}><span>Own app — {APP_TIER_NAMES[app.tier]}</span></div>
      <KV rows={[
        ['Installs', Math.round(app.installs).toLocaleString()],
        ['MAU', Math.round(app.mau).toLocaleString()],
        ['Marketing', app.tier === 0 ? '—' : <M v={app.monthlyMarketing} />],
      ]} />
    </Panel>
  )
}
