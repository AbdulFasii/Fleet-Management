import { useState, type ReactNode } from 'react'
import { fmtCompact, fmtINR, fmtSigned, type Money } from '../engine/core/money'
import type { SpanMeter as SpanMeterType } from '../engine/types'
import { qty } from './format'

/* ---------- money ---------- */

export function M({ v, full, signed, colored }: { v: Money; full?: boolean; signed?: boolean; colored?: boolean }) {
  const text = signed ? fmtSigned(v) : full ? fmtINR(v) : fmtCompact(v)
  const cls = colored ? (v > 0 ? 'good' : v < 0 ? 'bad' : 'dim') : undefined
  return <span className={cls} title={fmtINR(v)}>{text}</span>
}

/* ---------- text bar ---------- */

export function Bar({ value, width = 10, tone }: { value: number; width?: number; tone?: 'auto' | 'good' | 'bad' | 'warn' }) {
  const v = Math.max(0, Math.min(1, value))
  const filled = Math.round(v * width)
  const t = tone === 'auto' ? (v >= 0.75 ? 'good' : v >= 0.4 ? 'warn' : 'bad') : tone
  return (
    <span className={`tbar ${t ?? ''}`} title={`${Math.round(v * 100)}%`}>
      <span className="fill">{'█'.repeat(filled)}</span>
      <span className="rest">{'░'.repeat(width - filled)}</span>
    </span>
  )
}

export function Pct({ v, digits = 0 }: { v: number; digits?: number }) {
  return <span>{(v * 100).toFixed(digits)}%</span>
}

/* ---------- rating tone ---------- */

/**
 * Maps a 1-5 star rating or quality score to a color tone class:
 * - >= 4.0: 'good' (green)
 * - >= 3.5: 'accent'
 * - > 2.5:  'warn'
 * - <= 2.5: 'bad'
 */
export function ratingTone(rating: number): 'good' | 'accent' | 'warn' | 'bad' {
  if (rating >= 4) return 'good'
  if (rating >= 3.5) return 'accent'
  if (rating > 2.5) return 'warn'
  return 'bad'
}

/* ---------- panel ---------- */

export function Panel({ title, right, children, flat, className, info }: {
  title?: ReactNode
  right?: ReactNode
  children: ReactNode
  flat?: boolean
  className?: string
  /** Longer help text — shown on hover/focus of the header info icon. */
  info?: string
}) {
  return (
    <div className={`panel ${flat ? 'flat' : ''} ${className ?? ''}`}>
      {title !== undefined && (
        <div className="panel-title">
          <span className="panel-title-left">
            {title}
            {info && (
              <span className="panel-info" tabIndex={0} aria-label="More info">
                <span className="panel-info-icon" aria-hidden>i</span>
                <span className="panel-info-tip" role="tooltip">{info}</span>
              </span>
            )}
          </span>
          {right && <span>{right}</span>}
        </div>
      )}
      <div className="panel-body">{children}</div>
    </div>
  )
}

/* ---------- collapsible fold panel ---------- */

export function Fold({
  title,
  children,
  info,
  right,
  defaultOpen = false,
  persistKey,
  className,
}: {
  title: ReactNode
  children: ReactNode
  info?: string
  right?: ReactNode
  defaultOpen?: boolean
  persistKey?: string
  className?: string
}) {
  const storageKey = persistKey ? `busraj_fold_${persistKey}` : null
  const [open, setOpen] = useState<boolean>(() => {
    if (!storageKey || typeof window === 'undefined') return defaultOpen
    try {
      const saved = localStorage.getItem(storageKey)
      return saved !== null ? saved === 'true' : defaultOpen
    } catch {
      return defaultOpen
    }
  })

  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const isOpen = e.currentTarget.open
    setOpen(isOpen)
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, String(isOpen))
      } catch { /* ignore */ }
    }
  }

  return (
    <details className={`panel fold ${className ?? ''}`} open={open} onToggle={onToggle}>
      <summary className="panel-title fold-summary">
        <span className="panel-title-left">
          <span className="fold-marker">{open ? '▾' : '▸'}</span>
          {title}
          {info && (
            <span className="panel-info" tabIndex={0} aria-label="More info" onClick={(e) => e.stopPropagation()}>
              <span className="panel-info-icon" aria-hidden>i</span>
              <span className="panel-info-tip" role="tooltip">{info}</span>
            </span>
          )}
        </span>
        {right && <span onClick={(e) => e.stopPropagation()}>{right}</span>}
      </summary>
      <div className="panel-body">{children}</div>
    </details>
  )
}

/* ---------- key/value grid ---------- */

export function KV({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="kv">
      {(rows ?? []).map(([k, v], i) => (
        <span key={i} style={{ display: 'contents' }}>
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </span>
      ))}
    </div>
  )
}

/* ---------- sortable data table ---------- */

export interface Col<T> {
  key: string
  label: string
  num?: boolean
  sort?: (row: T) => number | string
  render: (row: T) => ReactNode
}

function readTableSort(persistKey: string | undefined, fallbackKey: string | null, fallbackDesc: boolean): { key: string | null; desc: boolean } {
  if (!persistKey) return { key: fallbackKey, desc: fallbackDesc }
  try {
    const raw = localStorage.getItem(`busraj_tablesort_${persistKey}`)
    if (!raw) return { key: fallbackKey, desc: fallbackDesc }
    const parsed = JSON.parse(raw) as { key?: string | null; desc?: boolean }
    return {
      key: typeof parsed.key === 'string' ? parsed.key : fallbackKey,
      desc: typeof parsed.desc === 'boolean' ? parsed.desc : fallbackDesc,
    }
  } catch {
    return { key: fallbackKey, desc: fallbackDesc }
  }
}

function writeTableSort(persistKey: string | undefined, key: string | null, desc: boolean): void {
  if (!persistKey || !key) return
  try {
    localStorage.setItem(`busraj_tablesort_${persistKey}`, JSON.stringify({ key, desc }))
  } catch { /* storage full — ignore */ }
}

export function DataTable<T>({ cols, rows, rowKey, onRowClick, initialSort, persistKey, empty }: {
  cols: Col<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  initialSort?: string
  /** Remember sort across tab switches / reloads until another column is sorted. */
  persistKey?: string
  empty?: string
}) {
  const saved = readTableSort(persistKey, initialSort ?? null, true)
  const [sortKey, setSortKey] = useState<string | null>(saved.key)
  const [desc, setDesc] = useState(saved.desc)

  const applySort = (key: string) => {
    let nextKey = key
    let nextDesc = true
    if (sortKey === key) {
      nextDesc = !desc
    } else {
      nextKey = key
      nextDesc = true
    }
    setSortKey(nextKey)
    setDesc(nextDesc)
    writeTableSort(persistKey, nextKey, nextDesc)
  }

  let sorted = rows
  const sc = cols.find((c) => c.key === sortKey)
  if (sc?.sort) {
    sorted = [...rows].sort((a, b) => {
      const av = sc.sort!(a)
      const bv = sc.sort!(b)
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return desc ? -cmp : cmp
    })
  }
  return (
    <table className="data">
      <thead>
        <tr>
          {cols.map((c) => (
            <th
              key={c.key}
              className={`${c.num ? 'num' : ''} ${sortKey === c.key ? 'sorted' : ''}`}
              onClick={() => {
                if (!c.sort) return
                applySort(c.key)
              }}
            >
              {c.label}{sortKey === c.key ? (desc ? ' ▾' : ' ▴') : ''}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 && (
          <tr><td colSpan={cols.length} className="dim">{empty ?? 'Nothing here.'}</td></tr>
        )}
        {sorted.map((r) => (
          <tr key={rowKey(r)} className={onRowClick ? 'clickable' : ''} onClick={() => onRowClick?.(r)}>
            {cols.map((c) => (
              <td key={c.key} className={c.num ? 'num' : ''}>{c.render(r)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/* ---------- modal ---------- */

export function Modal({ title, children, actions, onClose, wide }: {
  title: ReactNode; children: ReactNode; actions?: ReactNode; onClose?: () => void; wide?: boolean | 'xl'
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal${wide === 'xl' ? ' modal-xl' : wide ? ' modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}

/* ---------- brand / subsidiary badge ---------- */

export function GroupBadge({ group }: { group?: { name: string; code: string; color: string } }) {
  if (!group) {
    return <span className="dim" title="Unassigned">—</span>
  }
  return (
    <span
      className="group-badge"
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        fontSize: '11px',
        fontWeight: 600,
        borderRadius: '4px',
        backgroundColor: group.color,
        color: '#ffffff',
        letterSpacing: '0.5px',
        whiteSpace: 'nowrap',
      }}
      title={group.name}
    >
      {group.code}
    </span>
  )
}

/* ---------- manager span meter ---------- */

export function SpanMeter({ meter, unit }: { meter: SpanMeterType; unit?: string }) {
  const covPct = Math.round(meter.coverage * 100)
  const tone = meter.coverage >= 1.0 ? 'good' : meter.coverage >= 0.6 ? 'warn' : 'bad'
  const unitStr = unit ? ` ${unit}` : ''
  const unattended = Math.max(0, meter.demand - meter.capacity)

  return (
    <div className="span-meter" style={{ fontSize: '0.82rem', marginTop: 6, marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span>
          <strong className={tone}>{qty(meter.demand)}</strong> / {qty(meter.capacity)}{unitStr}
        </span>
        <span className={tone} style={{ fontWeight: 600 }}>
          {covPct}%
        </span>
      </div>
      <div style={{ height: 6, background: 'var(--panel-border, rgba(255,255,255,0.1))', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${Math.min(100, covPct)}%`,
            background: tone === 'good' ? 'var(--green, #22c55e)' : tone === 'warn' ? 'var(--amber, #f59e0b)' : 'var(--red, #ef4444)',
            borderRadius: 3,
            transition: 'width 0.2s',
          }}
        />
      </div>
      {unattended > 1e-9 && (
        <div className="dim" style={{ fontSize: '0.75rem', marginTop: 3 }}>
          {qty(unattended)} unattended · +{meter.assistantsToCover} assistant{meter.assistantsToCover === 1 ? '' : 's'} needed
        </div>
      )}
    </div>
  )
}
