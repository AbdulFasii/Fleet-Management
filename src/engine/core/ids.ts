/** Sequential IDs, stored in state so saves stay consistent. */

export interface IdCounter {
  next: number
}

export function nextId(counter: IdCounter, prefix: string): string {
  return `${prefix}${(counter.next++).toString(36)}`
}

/** Tamil Nadu RTO series — company registers coaches in TN. */
const RTO = [
  'TN01', 'TN02', 'TN04', 'TN05', 'TN07', 'TN09', 'TN10',
  'TN18', 'TN22', 'TN23', 'TN28', 'TN30', 'TN31', 'TN32',
  'TN33', 'TN36', 'TN37', 'TN38', 'TN39', 'TN40', 'TN41',
  'TN42', 'TN45', 'TN47', 'TN48', 'TN49', 'TN50', 'TN55',
  'TN57', 'TN58', 'TN59', 'TN63', 'TN64', 'TN67', 'TN68',
  'TN69', 'TN72', 'TN74', 'TN75', 'TN76', 'TN86', 'TN88',
]
const LETTERS = 'ABCDEFGHJKLMNPRSTUVZ'

/** Fake-but-plausible TN bus registration like "TN38 AB 4321". */
export function makeRegistration(rand: () => number): string {
  const rto = RTO[Math.floor(rand() * RTO.length)]!
  const l1 = LETTERS[Math.floor(rand() * LETTERS.length)]!
  const l2 = LETTERS[Math.floor(rand() * LETTERS.length)]!
  const num = 1000 + Math.floor(rand() * 9000)
  return `${rto} ${l1}${l2} ${num}`
}
