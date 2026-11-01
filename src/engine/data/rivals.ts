export interface RivalDef {
  id: string
  name: string
  fareIndex: number // 0.85 - 1.25
  comfort: number // 1 - 10
  punctuality: number // 0.70 - 0.95
  awareness: number // 0 - 1
  distressedUntilDay?: number
}

export const RIVALS_DATA: Record<string, RivalDef> = {
  vrl: {
    id: 'vrl',
    name: 'VRL Travels',
    fareIndex: 1.15,
    comfort: 8.5,
    punctuality: 0.90,
    awareness: 0.85,
  },
  srs: {
    id: 'srs',
    name: 'SRS Travels',
    fareIndex: 0.92,
    comfort: 5.5,
    punctuality: 0.82,
    awareness: 0.75,
  },
  kallada: {
    id: 'kallada',
    name: 'Kallada Tours',
    fareIndex: 1.05,
    comfort: 7.0,
    punctuality: 0.85,
    awareness: 0.70,
  },
  ksrtc: {
    id: 'ksrtc',
    name: 'KSRTC Airavat',
    fareIndex: 1.00,
    comfort: 8.0,
    punctuality: 0.88,
    awareness: 0.90,
  },
  intrabus: {
    id: 'intrabus',
    name: 'IntraBus',
    fareIndex: 0.95,
    comfort: 6.5,
    punctuality: 0.80,
    awareness: 0.65,
  },
  shree: {
    id: 'shree',
    name: 'Shree Travels',
    fareIndex: 0.88,
    comfort: 5.0,
    punctuality: 0.75,
    awareness: 0.55,
  },
  kpn: {
    id: 'kpn',
    name: 'KPN Travels',
    fareIndex: 1.02,
    comfort: 7.2,
    punctuality: 0.86,
    awareness: 0.80,
  },
  orange: {
    id: 'orange',
    name: 'Orange Travels',
    fareIndex: 1.08,
    comfort: 7.5,
    punctuality: 0.87,
    awareness: 0.78,
  },
}

export const RIVAL_ALIASES: Record<string, string> = {
  'VRL': 'vrl',
  'VRL Travels': 'vrl',
  'SRS Travels': 'srs',
  'SRS': 'srs',
  'Kallada Travels': 'kallada',
  'Kallada Tours': 'kallada',
  'KSRTC': 'ksrtc',
  'KSRTC Airavat': 'ksrtc',
  'KSRTC (Kerala)': 'ksrtc',
  'IntraBus': 'intrabus',
  'IntrCity SmartBus': 'intrabus',
  'FlixBus': 'intrabus',
  'Zingbus': 'intrabus',
  'Shree Travels': 'shree',
  'KPN Travels': 'kpn',
  'KPN': 'kpn',
  'Orange Travels': 'orange',
  'Orange': 'orange',
  'Parveen': 'kpn',
  'TNSTC': 'ksrtc',
  'SETC': 'ksrtc',
  'Neeta Tours': 'vrl',
  'National Travels': 'srs',
  'Universal Travels': 'kpn',
  'Sugama Tourists': 'srs',
  'Sea Bird': 'vrl',
  'UPSRTC': 'ksrtc',
  'RSRTC': 'ksrtc',
  'HRTC': 'ksrtc',
  'NueGo': 'intrabus',
  'Greenline': 'kallada',
  'Morning Star': 'orange',
  'APSRTC': 'ksrtc',
  'TSRTC': 'ksrtc',
  'NWKRTC': 'ksrtc',
  'PRTC': 'ksrtc',
  'MSRTC': 'ksrtc',
  'Kaveri Travels': 'orange',
  'Jabbar Travels': 'srs',
  'Alhind Tours': 'kallada',
  'SPS Travels': 'kpn',
  'ABT Travels': 'kpn',
  'RATHIMEENA': 'kpn',
  'Murahara': 'kallada',
  'Anand Travels': 'srs',
}

/** Seed route share percents across player and 3 rivals (sum = 100). */
export function seedRouteShare(
  routeId: string,
  competition: number,
  rawRivalNames?: string[],
  playerShare: number = 0,
): { player: number; byRival: Record<string, number> } {
  const player = Math.max(0, Math.min(100, Math.round(playerShare)))
  const remaining = 100 - player

  // Map 3 unique rival ids from raw names or fallback
  const mappedIds: string[] = []
  for (const name of rawRivalNames ?? []) {
    const rid = RIVAL_ALIASES[name] ?? 'shree'
    if (!mappedIds.includes(rid)) mappedIds.push(rid)
    if (mappedIds.length >= 3) break
  }

  const fallback = ['vrl', 'srs', 'shree']
  for (const fb of fallback) {
    if (mappedIds.length >= 3) break
    if (!mappedIds.includes(fb)) mappedIds.push(fb)
  }

  const byRival: Record<string, number> = {}
  const shareEach = Math.floor(remaining / 3)
  let remainder = remaining - shareEach * 3

  for (let i = 0; i < 3; i++) {
    const id = mappedIds[i]!
    const extra = remainder > 0 ? 1 : 0
    if (remainder > 0) remainder--
    byRival[id] = shareEach + extra
  }

  return { player, byRival }
}
