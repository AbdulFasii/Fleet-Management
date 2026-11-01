/**
 * Sales channels: OTAs, own app, counter/agents.
 * Toggles live in Schedule defaults (Settings); applied fleet-wide.
 */
import type { Channel } from '../types'

export const CHANNELS = ['redbus', 'abhibus', 'ownapp', 'counter'] as const

export type ChannelFlags = Record<Channel, boolean>

export interface ChannelMeta {
  label: string
  short: string
  /** ota | own | agent */
  kind: 'ota' | 'own' | 'agent'
  /** Base demand weight when enabled (relative). */
  weight: number
  /** Commission / PG in basis points. */
  commissionBps: number
  settleDays: number
  blurb: string
}

/** Major India bus aggregators + own + counter. */
export const CHANNEL_META: Record<Channel, ChannelMeta> = {
  redbus: {
    label: 'RedBus',
    short: 'RedBus',
    kind: 'ota',
    weight: 1.0,
    commissionBps: 800,
    settleDays: 5,
    blurb: 'Largest aggregator — T+5 float, Primo / RedDeal apply here.',
  },
  abhibus: {
    label: 'AbhiBus',
    short: 'AbhiBus',
    kind: 'ota',
    weight: 0.48,
    commissionBps: 900,
    settleDays: 5,
    blurb: 'Strong South India inventory — ~9% commission, T+5.',
  },
  ownapp: {
    label: 'Own app',
    short: 'App',
    kind: 'own',
    weight: 0, // computed from MAU
    commissionBps: 200,
    settleDays: 2,
    blurb: '2% PG, T+2 — grows with MAU / app tier.',
  },
  counter: {
    label: 'Counter / agents',
    short: 'Counter',
    kind: 'agent',
    weight: 0, // computed from brand
    commissionBps: 1000,
    settleDays: 1,
    blurb: 'Cash agents — 10%, next day (T+1).',
  },
}

export const DEFAULT_CHANNELS: ChannelFlags = {
  redbus: true,
  abhibus: true,
  ownapp: true,
  counter: true,
}

export function emptyChannelSold(): Record<Channel, number> {
  return { redbus: 0, abhibus: 0, ownapp: 0, counter: 0 }
}

/** Fill missing flags from defaults (old saves / partial patches). */
export function normalizeChannels(partial?: Partial<ChannelFlags> | null): ChannelFlags {
  return {
    redbus: partial?.redbus ?? DEFAULT_CHANNELS.redbus,
    abhibus: partial?.abhibus ?? DEFAULT_CHANNELS.abhibus,
    ownapp: partial?.ownapp ?? DEFAULT_CHANNELS.ownapp,
    counter: partial?.counter ?? DEFAULT_CHANNELS.counter,
  }
}

export function enabledChannelLabels(flags: ChannelFlags): string {
  return CHANNELS.filter((c) => flags[c]).map((c) => CHANNEL_META[c].short).join(' · ') || 'none'
}
