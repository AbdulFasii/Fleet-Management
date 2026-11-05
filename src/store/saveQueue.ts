import type { GameState } from '../engine/types'

interface SaveTicket {
  state: GameState
  mutable: boolean
  generation: number
  revision: number
  day: number
  version: number
  destination: string | null
  destinationRevision: number
  cloudGeneration: number
}

interface SaveQueueDependencies {
  destination: () => string | null
  destinationRevision: () => number
  toDto: (state: GameState) => Record<string, unknown>
  encode: (dto: Record<string, unknown>, version: number, day: number) => Promise<string>
  write: (payload: string, day: number) => boolean
  persistSync: (state: GameState, mutable: boolean) => boolean
  append: (destination: string, state: GameState, dto: Record<string, unknown>) => Promise<unknown>
}

/** Owns deferred work; no ticket may outlive its game session or a newer save. */
export function createSaveQueue(deps: SaveQueueDependencies) {
  let generation = 0
  let revision = 0
  let pending: SaveTicket | null = null
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let cloudTimer: ReturnType<typeof setTimeout> | undefined
  let cloudRevision = 0
  let cloudGeneration = 0

  const current = (ticket: SaveTicket) => ticket.generation === generation && ticket.revision === revision
  const cancelCloud = () => {
    cloudRevision++
    clearTimeout(cloudTimer)
    cloudTimer = undefined
  }
  const clearTimer = () => {
    clearTimeout(saveTimer)
    saveTimer = undefined
  }
  const queueCloud = (ticket: SaveTicket) => {
    cancelCloud()
    const cloudToken = cloudRevision
    if (!ticket.destination || ticket.cloudGeneration !== cloudGeneration) return
    cloudTimer = setTimeout(() => {
      cloudTimer = undefined
      if (!current(ticket) || cloudToken !== cloudRevision || ticket.cloudGeneration !== cloudGeneration
        || deps.destination() !== ticket.destination || deps.destinationRevision() !== ticket.destinationRevision) return
      // DTOs share live state branches. Snapshot only when actually sending to
      // cloud, so later simulation ticks cannot mutate a request in flight.
      try {
        const dto = structuredClone(deps.toDto(ticket.state))
        const snapshot = { ...ticket.state, company: { ...ticket.state.company }, day: ticket.day }
        deps.append(ticket.destination!, snapshot, dto).catch((err) => {
          console.warn('Background cloud append failed:', err)
        })
      } catch (err) {
        console.warn('Background cloud append failed:', err)
      }
    }, 1200)
  }
  const ticketFor = (state: GameState, mutable: boolean): SaveTicket => {
    clearTimer()
    cancelCloud()
    return { state, mutable, generation, revision: ++revision, day: state.day,
      version: state.version, destination: deps.destination(),
      destinationRevision: deps.destinationRevision(), cloudGeneration }
  }
  const persistTicket = (ticket: SaveTicket): boolean => {
    if (!current(ticket)) return true
    const ok = deps.persistSync(ticket.state, ticket.mutable)
    if (ok) {
      pending = null
      queueCloud(ticket)
    }
    return ok
  }
  const flushAsync = async () => {
    clearTimer()
    const ticket = pending
    if (!ticket) return
    try {
      const dto = deps.toDto(ticket.state)
      const payload = await deps.encode(dto, ticket.version, ticket.day)
      if (!current(ticket)) return
      if (deps.write(payload, ticket.day)) {
        pending = null
        queueCloud(ticket)
      } else {
        persistTicket(ticket)
      }
    } catch (err) {
      if (!current(ticket)) return
      console.warn('Async worker save encode failed, falling back to sync:', err)
      persistTicket(ticket)
    }
  }

  return {
    enqueue(state: GameState, mutable = false) {
      pending = ticketFor(state, mutable)
      saveTimer = setTimeout(() => {
        flushAsync().catch((err) => { console.warn('Autosave failed; pending state retained:', err) })
      }, 500)
    },
    saveNow(state: GameState, mutable = false): boolean {
      pending = ticketFor(state, mutable)
      return persistTicket(pending)
    },
    flushSync(): boolean {
      clearTimer()
      if (!pending) return true
      // Supersede an in-flight encode, but retain its state for page-hide.
      // Retain its original cloud destination even if the selected slot changed.
      cancelCloud()
      pending = { ...pending, revision: ++revision }
      return persistTicket(pending)
    },
    invalidate() {
      generation++
      revision++
      clearTimer()
      cancelCloud()
      pending = null
    },
    cancelCloud() {
      cloudGeneration++
      cancelCloud()
    },
  }
}
