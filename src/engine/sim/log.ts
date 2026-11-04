import { nextId } from '../core/ids'
import type { Decision, GameState, LogCat } from '../types'

/** All relevant operational categories land in the inbox; visually styled by category. */
const KEEP: ReadonlySet<LogCat> = new Set(['alert', 'event', 'good', 'finance', 'info', 'trip'])

export function pushLog(s: GameState, cat: LogCat, text: string, link?: string): void {
  if (!KEEP.has(cat)) return
  if (!s.inbox) s.inbox = []
  s.inbox.push({ id: nextId(s.ids, 'm'), day: s.day, cat, text, read: false, ...(link ? { link } : {}) })
  if (s.inbox.length > 300) s.inbox.splice(0, s.inbox.length - 300)
}

/** Keep last 30 days of messages (capped at 300 entries, oldest pruned first) so players can review historical events and alerts. */
export function pruneInbox(s: GameState): void {
  const minDay = s.day - 30
  let list = (s.inbox ?? []).filter((m) => m.day >= minDay)
  if (list.length > 300) {
    list = list.slice(list.length - 300)
  }
  s.inbox = list
}

export function pushDecision(s: GameState, d: Omit<Decision, 'id' | 'day'>): void {
  s.decisions.push({ ...d, id: nextId(s.ids, 'd'), day: s.day })
}
