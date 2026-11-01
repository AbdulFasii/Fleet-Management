import { useMemo, useState } from 'react'
import { useGame } from '../../store/gameStore'
import { fmtDate } from '../../engine/core/calendar'
import { ACHIEVEMENT_DEFS } from '../../engine/sim/reputation'
import type { LogCat } from '../../engine/types'
import { Panel } from '../bits'

type FilterCat = 'all' | 'alert' | 'finance' | 'event' | 'good' | 'info' | 'trip'

const FILTERS: { id: FilterCat; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'alert', label: 'Alerts' },
  { id: 'finance', label: 'Finance' },
  { id: 'event', label: 'Events' },
  { id: 'good', label: 'Good' },
  { id: 'info', label: 'Info' },
  { id: 'trip', label: 'Trips' },
]

function catPillTone(cat: LogCat): string {
  switch (cat) {
    case 'alert': return 'bad'
    case 'finance': return 'warn'
    case 'event': return 'info'
    case 'good': return 'good'
    case 'info': return 'dim'
    case 'trip': return 'dim'
    default: return 'dim'
  }
}

export function InboxPage() {
  const s = useGame((g) => g.state)!
  const markInboxRead = useGame((g) => g.markInboxRead)
  const markAllInboxRead = useGame((g) => g.markAllInboxRead)
  const [filter, setFilter] = useState<FilterCat>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const unreadCount = useMemo(() => s.inbox.filter((m) => !m.read).length, [s.inbox])

  const counts = useMemo(() => {
    const c: Record<FilterCat, number> = { all: s.inbox.length, alert: 0, finance: 0, event: 0, good: 0, info: 0, trip: 0 }
    for (const m of s.inbox) {
      if (m.cat in c) c[m.cat as FilterCat]++
    }
    return c
  }, [s.inbox])

  const msgs = useMemo(
    () => [...s.inbox].reverse().filter((m) => filter === 'all' || m.cat === filter),
    [s.inbox, filter],
  )

  const earned = Object.entries(s.achievements)

  return (
    <>
      <div className="page-title">
        Inbox & Notifications
        <span className="sub">Retained for past 30 days ({s.inbox.length} entries · {unreadCount} unread)</span>
        <span className="spacer" />
        <button
          className="small"
          disabled={unreadCount === 0}
          onClick={() => markAllInboxRead()}
          title="Mark all notifications as read"
        >
          Mark all read
        </button>
        <div className="tab-bar-inline" style={{ display: 'flex', gap: 6, marginLeft: 12 }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={filter === f.id ? 'primary' : 'small'}
              style={{ padding: '4px 10px', fontSize: '0.85rem' }}
              onClick={() => setFilter(f.id)}
            >
              {f.label} <span className="dim small">({counts[f.id] ?? 0})</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '2.5fr 1fr', gap: 16 }}>
        <Panel
          title={`Message Log (${filter === 'all' ? 'All categories' : filter})`}
          flat
        >
          <div style={{ maxHeight: '72vh', overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Date</th>
                  <th style={{ width: 90 }}>Category</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {msgs.length === 0 && (
                  <tr>
                    <td colSpan={3} className="dim" style={{ padding: '24px 12px', textAlign: 'center' }}>
                      No messages found in this category.
                    </td>
                  </tr>
                )}
                {msgs.map((m) => {
                  const isExpanded = expandedId === m.id
                  const isUnread = !m.read
                  return (
                    <tr
                      key={m.id}
                      onClick={() => {
                        setExpandedId((prev) => (prev === m.id ? null : m.id))
                        if (isUnread) markInboxRead(m.id)
                      }}
                      style={{
                        cursor: 'pointer',
                        background: isUnread ? 'rgba(56, 189, 248, 0.05)' : undefined,
                      }}
                      title="Click to expand full message details"
                    >
                      <td className="nowrap dim small">
                        {isUnread && <span style={{ color: 'var(--accent)', marginRight: 4 }}>●</span>}
                        <b style={{ color: isUnread ? 'var(--accent)' : 'var(--text-main)' }}>{fmtDate(m.day)}</b>
                        <span className="dim" style={{ marginLeft: 6 }}>
                          {m.day === s.day ? '(today)' : `(Day ${m.day - s.startDay + 1})`}
                        </span>
                      </td>
                      <td>
                        <span className={`pill small ${catPillTone(m.cat)}`}>
                          {m.cat.toUpperCase()}
                        </span>
                      </td>
                      <td className={`log-cat-${m.cat}`} style={{ lineHeight: 1.45, fontSize: '0.92rem' }}>
                        <div style={{ fontWeight: isUnread ? 600 : 400 }}>
                          {m.text.length > 90 && !isExpanded ? `${m.text.slice(0, 87)}...` : m.text}
                        </div>
                        {isExpanded && (
                          <div
                            style={{
                              marginTop: 6,
                              padding: '8px 10px',
                              background: 'var(--bg-card)',
                              borderLeft: '3px solid var(--accent)',
                              borderRadius: 4,
                              whiteSpace: 'pre-wrap',
                              fontSize: '0.90rem',
                              color: 'var(--text-main)',
                            }}
                          >
                            <div style={{ marginBottom: 4, fontSize: '0.75rem' }} className="dim">
                              Ref: {m.id} · Cat: {m.cat.toUpperCase()} · Day: {m.day}
                            </div>
                            {m.text}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title={`Achievements (${earned.length}/${ACHIEVEMENT_DEFS.length})`} flat>
          <div style={{ maxHeight: '72vh', overflowY: 'auto' }}>
            <table className="data">
              <tbody>
                {ACHIEVEMENT_DEFS.map((a) => {
                  const day = s.achievements[a.id]
                  return (
                    <tr key={a.id}>
                      <td className={day !== undefined ? 'good' : 'faint'}>
                        {day !== undefined ? '★' : '☆'} {a.label}
                      </td>
                      <td className="num dim small">{day !== undefined ? fmtDate(day) : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  )
}
