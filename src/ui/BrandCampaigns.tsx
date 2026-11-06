import { useMemo, useState } from 'react'
import { useGame, useGameActions } from '../store/gameStore'
import { fmtCompact } from '../engine/core/money'
import { routeName } from '../engine/data/routes'
import type { ID } from '../engine/types'
import { CAMPAIGN_LIFT_CAP } from '../engine/sim/brandModifiers'
import { activeCampaigns, launchCost, LAUNCH_TIERS, ROUTE_PUSH } from '../engine/sim/brandActions'
import { GroupBadge, Hint, Modal } from './bits'

/** One-off marketing pushes for a brand, in their own dialog. */
export function BrandCampaignsModal({ groupId, onClose }: { groupId: ID; onClose: () => void }) {
  const s = useGame((x) => x.state)!
  const g = useGameActions()
  const group = s.groups?.[groupId]
  const [routePush, setRoutePush] = useState('')
  const routesServed = useMemo(
    () => [...new Set(Object.values(s.schedules).filter((sch) => sch.groupId === groupId).map((sch) => sch.routeId))],
    [s.schedules, groupId],
  )
  if (!group) return null
  const isOperator = group.kind === 'operator'
  const campaigns = activeCampaigns(s, group)
  const launchRunning = campaigns.some((c) => c.kind === 'launch')

  return (
    <Modal
      title={
        <span className="flex" style={{ alignItems: 'center', gap: 8 }}>
          Campaigns <GroupBadge group={group} /> {group.name}
        </span>
      }
      onClose={onClose}
      actions={<button onClick={onClose}>Close</button>}
    >
      <div className="stack12">
        <div className="dim small">
          One-off pushes that lift demand and fade out over time. Total lift is capped at +{Math.round(CAMPAIGN_LIFT_CAP * 100)}%.
          {isOperator && ' An operator campaign lifts every brand beneath it.'}
        </div>

        <div className="stack6">
          <b>Running</b>
          {campaigns.length === 0 && <span className="dim">Nothing running.</span>}
          {campaigns.map((c) => {
            const left = c.endDay - s.day + 1
            const lift = c.boost * (1 - (s.day - c.startDay) / (c.endDay - c.startDay + 1))
            return (
              <div key={c.id} className="flex" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="pill info small">{c.kind === 'launch' ? 'Launch' : 'Corridor push'}</span>
                {c.routeId && <span>{routeName(c.routeId)}</span>}
                <span className="dim small">
                  {left} day{left === 1 ? '' : 's'} left · now +{(Math.max(0, lift) * 100).toFixed(1)}% demand
                </span>
                <button className="small text" onClick={() => g.stopBrandCampaign(group.id, c.id)}>
                  Stop
                </button>
              </div>
            )
          })}
        </div>

        <div className="stack6">
          <div className="flex" style={{ alignItems: 'center', gap: 6 }}>
            <b>Launch campaign</b>
            <Hint text="Brand-wide push for 30 days. Also raises company awareness a little. One at a time." />
          </div>
          <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
            {LAUNCH_TIERS.map((t) => (
              <button
                key={t.id}
                className="small"
                disabled={launchRunning}
                title={launchRunning ? 'A launch campaign is already running.' : `${t.days} days, +${Math.round(t.boost * 100)}% demand at the start, fading out`}
                onClick={() => g.launchBrandCampaign(group.id, { kind: 'launch', tier: t.id })}
              >
                {t.label} · {fmtCompact(launchCost(group, t))} · +{Math.round(t.boost * 100)}%
              </button>
            ))}
          </div>
        </div>

        {!isOperator && (
          <div className="stack6">
            <div className="flex" style={{ alignItems: 'center', gap: 6 }}>
              <b>Corridor push</b>
              <Hint text="Lifts demand on one route this brand runs, for 21 days." />
            </div>
            <div className="flex" style={{ alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <select value={routePush} onChange={(e) => setRoutePush(e.target.value)} style={{ minWidth: 220 }} disabled={routesServed.length === 0}>
                <option value="">{routesServed.length === 0 ? 'No services yet' : 'Pick a route…'}</option>
                {routesServed.map((r) => (
                  <option key={r} value={r} disabled={campaigns.some((c) => c.kind === 'route' && c.routeId === r)}>
                    {routeName(r)}
                  </option>
                ))}
              </select>
              <button
                className="small"
                disabled={!routePush}
                onClick={() => {
                  if (g.launchBrandCampaign(group.id, { kind: 'route', routeId: routePush }) === null) setRoutePush('')
                }}
              >
                Start · {fmtCompact(ROUTE_PUSH.cost)} · +{Math.round(ROUTE_PUSH.boost * 100)}% · {ROUTE_PUSH.days}d
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
