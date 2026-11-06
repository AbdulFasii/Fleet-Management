import { useMemo, useState, type ReactNode } from 'react'
import { useGame, useGameActions } from '../store/gameStore'
import { fmtCompact } from '../engine/core/money'
import { fmtClock } from '../engine/core/calendar'
import { BAL } from '../engine/data/balance'
import { routeName } from '../engine/data/routes'
import { BUS_MODELS } from '../engine/data/busModels'
import type { BusGroup, ID } from '../engine/types'
import { fleetGroups, getDescendantGroupIds } from '../engine/sim/groups'
import { quoteBrandSale, quoteMerge, quoteSpinOff, quoteTransfer } from '../engine/sim/brandActions'
import { BrandOptions } from './BrandOptions'
import { GroupBadge, Modal } from './bits'

export type BrandActionTab = 'close' | 'transfer' | 'merge' | 'spinoff' | 'sell'

const TAB_LABEL: Record<BrandActionTab, string> = {
  close: 'Close brand',
  transfer: 'Move coaches',
  merge: 'Merge into…',
  spinoff: 'Spin off…',
  sell: 'Sell brand',
}

const FLEET_TABS: BrandActionTab[] = ['close', 'transfer', 'merge', 'spinoff', 'sell']
const OPERATOR_TABS: BrandActionTab[] = ['close', 'merge']

/**
 * One dialog for everything that changes a brand's life: close it, move its coaches, merge it,
 * spin a new brand off it, or sell it. Routes, permits and services always stay with you.
 */
export function BrandActionsModal({
  groupId,
  initial = 'close',
  onClose,
}: {
  groupId: ID
  initial?: BrandActionTab
  onClose: () => void
}) {
  const group = useGame((x) => x.state?.groups?.[groupId])
  const [tab, setTab] = useState<BrandActionTab>(initial)
  if (!group) return null
  const tabs = group.kind === 'operator' ? OPERATOR_TABS : FLEET_TABS
  const active = tabs.includes(tab) ? tab : 'close'

  return (
    <Modal
      wide
      onClose={onClose}
      title={
        <span className="flex" style={{ alignItems: 'center', gap: 8 }}>
          Brand actions <GroupBadge group={group} /> {group.name}
        </span>
      }
    >
      <div className="stack12">
        <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
          {tabs.map((t) => (
            <button key={t} className={`small ${t === active ? 'primary' : ''}`} onClick={() => setTab(t)}>
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        {active === 'close' && <CloseTab group={group} onClose={onClose} />}
        {active === 'transfer' && <TransferTab group={group} onClose={onClose} />}
        {active === 'merge' && <MergeTab group={group} onClose={onClose} />}
        {active === 'spinoff' && <SpinOffTab group={group} onClose={onClose} />}
        {active === 'sell' && <SellTab group={group} onClose={onClose} />}
      </div>
    </Modal>
  )
}

function Footer({ children }: { children: ReactNode }) {
  return (
    <div className="flex" style={{ gap: 8, justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      {children}
    </div>
  )
}

const box = { background: 'var(--bg3)', padding: 10, borderRadius: 6, border: '1px solid var(--border)' } as const

function useBrandData(group: BusGroup) {
  const s = useGame((x) => x.state)!
  const buses = useMemo(
    () => Object.values(s.buses).filter((b) => b.groupId === group.id).sort((a, b) => a.reg.localeCompare(b.reg)),
    [s.buses, group.id],
  )
  const schedules = useMemo(
    () => Object.values(s.schedules).filter((sch) => sch.groupId === group.id),
    [s.schedules, group.id],
  )
  return { s, buses, schedules }
}

function toggle(set: Set<ID>, id: ID): Set<ID> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

const coachLabel = (b: { reg: string; modelId: string }, scheduled: boolean) =>
  `${b.reg} · ${BUS_MODELS[b.modelId]?.maker ?? ''} ${BUS_MODELS[b.modelId]?.name ?? b.modelId}${scheduled ? ' · on a service' : ''}`

interface TabProps {
  group: BusGroup
  onClose: () => void
}

/* ───────────────────────────── Close ───────────────────────────── */

function CloseTab({ group, onClose }: TabProps) {
  const g = useGameActions()
  const { s, buses, schedules } = useBrandData(group)
  const [dest, setDest] = useState('')
  const isOperator = group.kind === 'operator'
  const others = fleetGroups(s).filter((x) => x.id !== group.id)
  const children = Object.values(s.groups ?? {}).filter((x) => x.parentGroupId === group.id && x.status === 'active').length

  return (
    <>
      <p style={{ margin: 0 }}>
        Close <b>{group.name}</b>? It leaves pickers and scheduling; ledger and trip history stay, and a closed brand can be restored later.
      </p>
      {isOperator ? (
        <div style={box}>
          <div><b>Brands it runs:</b> {children}</div>
          <div className="dim small">They move up to this operator's own parent, or become top-level brands.</div>
        </div>
      ) : (
        <>
          <div style={box}>
            <div><b>Coaches to reassign:</b> {buses.length}</div>
            <div><b>Schedules to reassign:</b> {schedules.length}</div>
            {children > 0 && <div><b>Sub-brands moving up:</b> {children}</div>}
          </div>
          <div className="form-row">
            <label>Transfer fleet &amp; schedules to:</label>
            <select value={dest} onChange={(e) => setDest(e.target.value)} style={{ minWidth: 240 }}>
              <BrandOptions s={s} brands={others} />
              <option value="">Unassigned</option>
            </select>
          </div>
        </>
      )}
      <Footer>
        <button onClick={onClose}>Cancel</button>
        <button
          className="danger"
          onClick={() => {
            if (g.retireGroup(group.id, dest || undefined) === null) onClose()
          }}
        >
          Confirm close
        </button>
      </Footer>
    </>
  )
}

/* ───────────────────────────── Move coaches ───────────────────────────── */

function TransferTab({ group, onClose }: TabProps) {
  const g = useGameActions()
  const { s, buses } = useBrandData(group)
  const [picked, setPicked] = useState<Set<ID>>(new Set())
  const [dest, setDest] = useState<string>('')
  const [repaint, setRepaint] = useState(true)
  const targets = fleetGroups(s).filter((x) => x.id !== group.id && Boolean(x.cargoBrand) === Boolean(group.cargoBrand))
  const toId = dest || undefined
  const ids = [...picked]
  const quote = quoteTransfer(s, ids, toId, repaint)

  return (
    <>
      <div className="form-row">
        <label>Move to</label>
        <select value={dest} onChange={(e) => setDest(e.target.value)} style={{ minWidth: 220 }}>
          <BrandOptions s={s} brands={targets} />
          <option value="">Unassigned</option>
        </select>
      </div>
      {dest !== '' && (
        <label className="flex" style={{ alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={repaint} onChange={(e) => setRepaint(e.target.checked)} />
          <span>Repaint in the new livery ({fmtCompact(BAL.rebrandCost)} each)</span>
        </label>
      )}
      {buses.length === 0 ? (
        <div className="dim">This brand has no coaches.</div>
      ) : (
        <div className="stack6" style={{ maxHeight: 260, overflowY: 'auto' }}>
          <label className="flex" style={{ alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={picked.size === buses.length}
              onChange={(e) => setPicked(e.target.checked ? new Set(buses.map((b) => b.id)) : new Set())}
            />
            <b>All {buses.length} coaches</b>
          </label>
          {buses.map((b) => (
            <label key={b.id} className="flex" style={{ alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={picked.has(b.id)} onChange={() => setPicked(toggle(picked, b.id))} />
              <span>{coachLabel(b, Boolean(b.scheduleId))}</span>
            </label>
          ))}
        </div>
      )}
      <div className="dim small">
        A coach on a service is taken off it first, since a service only runs coaches of its own brand.
        {quote.rebrandCost > 0 && (
          <>
            {' '}Repainting <b>{quote.moving}</b> coaches: <b>{fmtCompact(quote.rebrandCost)}</b>.
          </>
        )}
      </div>
      <Footer>
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={ids.length === 0}
          onClick={() => {
            if (g.transferCoaches(ids, toId, repaint) === null) onClose()
          }}
        >
          Move {ids.length || ''} coach{ids.length === 1 ? '' : 'es'}
        </button>
      </Footer>
    </>
  )
}

/* ─────────────────────────────── Merge ─────────────────────────────── */

function MergeTab({ group, onClose }: TabProps) {
  const g = useGameActions()
  const s = useGame((x) => x.state)!
  const [into, setInto] = useState('')
  const blocked = useMemo(() => getDescendantGroupIds(s.groups ?? {}, group.id), [s.groups, group.id])
  const targets = Object.values(s.groups ?? {}).filter(
    (x) =>
      x.status === 'active' &&
      x.id !== group.id &&
      !blocked.has(x.id) &&
      (x.kind ?? 'fleet') === (group.kind ?? 'fleet') &&
      Boolean(x.cargoBrand) === Boolean(group.cargoBrand),
  )
  const quote = into ? quoteMerge(s, group.id, into) : null
  const dest = into ? s.groups?.[into] : undefined

  return (
    <>
      <div className="form-row">
        <label>Merge into</label>
        <select value={into} onChange={(e) => setInto(e.target.value)} style={{ minWidth: 240 }}>
          <option value="">Select brand…</option>
          <BrandOptions s={s} brands={targets} mode="tree" />
        </select>
      </div>
      {targets.length === 0 && <div className="dim">No other brand of the same kind to merge into.</div>}
      {quote &&
        (quote.error ? (
          <div className="bad">{quote.error}</div>
        ) : (
          <div style={box}>
            <div><b>{quote.coaches}</b> coaches move to {dest?.name} (repaint {fmtCompact(quote.rebrandCost)})</div>
            <div><b>{quote.services}</b> services move over</div>
            <div><b>{quote.brandsMoved}</b> sub-brands are re-parented</div>
            <div className="dim small" style={{ marginTop: 6 }}>
              Reviews are blended by review count. {group.name} is then closed, with its history kept in reports.
            </div>
          </div>
        ))}
      <Footer>
        <button onClick={onClose}>Cancel</button>
        <button
          className="danger"
          disabled={!into || Boolean(quote?.error)}
          onClick={() => {
            if (g.mergeBrands(group.id, into) === null) onClose()
          }}
        >
          Merge brands
        </button>
      </Footer>
    </>
  )
}

/* ────────────────────────────── Spin off ────────────────────────────── */

function SpinOffTab({ group, onClose }: TabProps) {
  const g = useGameActions()
  const { s, buses, schedules } = useBrandData(group)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [schPicked, setSchPicked] = useState<Set<ID>>(new Set())
  const [busPicked, setBusPicked] = useState<Set<ID>>(new Set())

  const viaService = new Set<ID>()
  for (const id of schPicked) for (const b of s.schedules[id]?.busIds ?? []) viaService.add(b)
  const looseBuses = buses.filter((b) => !viaService.has(b.id))
  const input = {
    fromId: group.id,
    name: name.trim(),
    code: code.trim().toUpperCase(),
    scheduleIds: [...schPicked],
    busIds: [...busPicked].filter((id) => !viaService.has(id)),
  }
  const quote = quoteSpinOff(s, input)
  const valid = input.name !== '' && input.code.length >= 2 && input.code.length <= 5 && quote.coaches + quote.services > 0

  return (
    <>
      <div className="flex" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="form-row">
          <label>New brand name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Keralines Lux" />
        </div>
        <div className="form-row">
          <label>Code (2-5)</label>
          <input
            type="text"
            maxLength={5}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            style={{ width: 90, textTransform: 'uppercase' }}
          />
        </div>
      </div>
      <div className="dim small">
        It starts with {group.name}'s settings, sits beside it in the brand tree, and can be recoloured from its own card.
      </div>

      <div className="flex" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="stack6" style={{ flex: '1 1 260px', maxHeight: 240, overflowY: 'auto' }}>
          <b>Services to move ({schedules.length})</b>
          {schedules.length === 0 && <span className="dim">No services.</span>}
          {schedules.map((sch) => (
            <label key={sch.id} className="flex" style={{ alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={schPicked.has(sch.id)} onChange={() => setSchPicked(toggle(schPicked, sch.id))} />
              <span>
                {routeName(sch.routeId)} · {fmtClock(sch)}
                <span className="dim small"> · {sch.busIds.length} coach{sch.busIds.length === 1 ? '' : 'es'}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="stack6" style={{ flex: '1 1 260px', maxHeight: 240, overflowY: 'auto' }}>
          <b>Other coaches to move ({looseBuses.length})</b>
          {looseBuses.length === 0 && <span className="dim">None left.</span>}
          {looseBuses.map((b) => (
            <label key={b.id} className="flex" style={{ alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={busPicked.has(b.id)} onChange={() => setBusPicked(toggle(busPicked, b.id))} />
              <span>{coachLabel(b, Boolean(b.scheduleId))}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="dim small">
        Chosen services take all their coaches along. Moving <b>{quote.coaches}</b> coaches and <b>{quote.services}</b> services; repainting{' '}
        <b>{fmtCompact(quote.rebrandCost)}</b>.
      </div>
      <Footer>
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={!valid}
          onClick={() => {
            if (!('error' in g.spinOffBrand(input))) onClose()
          }}
        >
          Create brand
        </button>
      </Footer>
    </>
  )
}

/* ────────────────────────────── Sell brand ────────────────────────────── */

function SellTab({ group, onClose }: TabProps) {
  const g = useGameActions()
  const s = useGame((x) => x.state)!
  const [includeCoaches, setIncludeCoaches] = useState(true)
  const [moveTo, setMoveTo] = useState('')
  const [confirm, setConfirm] = useState(false)
  const quote = quoteBrandSale(s, group.id, includeCoaches)
  const targets = fleetGroups(s).filter((x) => x.id !== group.id)
  const rating = group.ratingCount >= BAL.groupRatingMinReviews ? group.rating : s.company.rating

  return (
    <>
      <div className="dim">
        A buyer takes the name, badge and reputation. <b>Routes, permits and services never go with it.</b> They stay with you under the brand you pick below.
      </div>
      {quote.error ? (
        <div className="bad">{quote.error}</div>
      ) : (
        <div style={box}>
          <div className="flex" style={{ justifyContent: 'space-between' }}>
            <span>Brand name and goodwill <span className="dim small">(★ {rating.toFixed(2)}, last 30 days profit {fmtCompact(quote.profit30d)})</span></span>
            <b>{fmtCompact(quote.goodwill)}</b>
          </div>
          <div className="flex" style={{ justifyContent: 'space-between' }}>
            <span>{quote.coaches.length} owned coach{quote.coaches.length === 1 ? '' : 'es'} <span className="dim small">(after loans and fees)</span></span>
            <b>{fmtCompact(quote.coachNet)}</b>
          </div>
          <div className="flex" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
            <b>You receive</b>
            <b className="good">{fmtCompact(quote.total)}</b>
          </div>
        </div>
      )}
      <label className="flex" style={{ alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={includeCoaches} onChange={(e) => setIncludeCoaches(e.target.checked)} />
        <span>Include its owned coaches in the sale</span>
      </label>
      <div className="form-row">
        <label>Services stay under</label>
        <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} style={{ minWidth: 240 }}>
          <BrandOptions s={s} brands={targets} />
          <option value="">Unassigned</option>
        </select>
      </div>
      {!quote.error && (
        <div className="dim small">
          {quote.services} service{quote.services === 1 ? '' : 's'} stay with you
          {quote.keptCoaches > 0 && <>, with {quote.keptCoaches} coach{quote.keptCoaches === 1 ? '' : 'es'} (leased, attached or not included)</>}.
          {includeCoaches && quote.coaches.length > 0 && (
            <span className="warn"> Services lose the coaches that are sold, and their open trips are cancelled with refunds.</span>
          )}
        </div>
      )}
      <label className="flex" style={{ alignItems: 'center', gap: 6 }}>
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        <span>I understand a sold brand cannot be bought back or restored.</span>
      </label>
      <Footer>
        <button onClick={onClose}>Cancel</button>
        <button
          className="danger"
          disabled={Boolean(quote.error) || !confirm}
          onClick={() => {
            if (g.sellBrand(group.id, { includeCoaches, moveTo: moveTo || undefined }) === null) onClose()
          }}
        >
          Sell for {fmtCompact(quote.total)}
        </button>
      </Footer>
    </>
  )
}
