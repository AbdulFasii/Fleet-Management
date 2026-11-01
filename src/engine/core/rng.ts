/**
 * Deterministic seeded randomness. Every random draw in the engine goes
 * through a named stream derived from (gameSeed, ...keys) so that a save
 * file replays identically and simulation is reproducible for balancing.
 */

export type Rng = () => number

/** mulberry32 - fast 32-bit PRNG, good enough distribution for a game. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a string hash to a uint32. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** A named stream: rngFor(seed, 'booking', day, tripId) */
export function rngFor(seed: number, ...keys: (string | number)[]): Rng {
  let h = seed >>> 0
  for (const k of keys) {
    h = (h ^ hashStr(String(k))) >>> 0
    h = Math.imul(h, 0x9e3779b1) >>> 0
  }
  return mulberry32(h)
}

/** Integer in [a, b] inclusive. */
export function rInt(rng: Rng, a: number, b: number): number {
  return a + Math.floor(rng() * (b - a + 1))
}

export function rPick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

export function rShuffle<T>(rng: Rng, arr: readonly T[]): T[] {
  const bag = [...arr]
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = bag[i]
    bag[i] = bag[j]!
    bag[j] = tmp!
  }
  return bag
}

export function rChance(rng: Rng, p: number): boolean {
  return rng() < p
}

/** Approximate normal via central limit (mean 0, sd 1). */
export function rNorm(rng: Rng): number {
  let s = 0
  for (let i = 0; i < 6; i++) s += rng()
  return (s - 3) / Math.sqrt(0.5)
}

/** value scaled by a random factor in [1-spread, 1+spread] */
export function rJitter(rng: Rng, value: number, spread: number): number {
  return value * (1 + (rng() * 2 - 1) * spread)
}

/** Probabilistic rounding: 3.7 -> 4 with p=0.7, 3 with p=0.3 */
export function rRound(rng: Rng, x: number): number {
  const f = Math.floor(x)
  return f + (rng() < x - f ? 1 : 0)
}

/** Poisson sample (Knuth) - fine for small lambdas used per trip/day. */
export function rPoisson(rng: Rng, lambda: number): number {
  if (lambda <= 0) return 0
  if (lambda > 30) {
    // normal approximation for large lambda
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * rNorm(rng)))
  }
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rng()
  } while (p > L)
  return k - 1
}
