/**
 * Print the hottest functions from a V8 .cpuprofile.
 *
 *   npx tsx scripts/pass-profile.ts --fleet 120 --profile
 *   npx tsx scripts/cpu-hotspots.ts [day.cpuprofile] [--top 25]
 *
 * Self time only (time spent inside the function itself, not its callees),
 * which is what "this pass is slow" usually means.
 */
import { readFileSync } from 'node:fs'

const file = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'day.cpuprofile'
const topIdx = process.argv.indexOf('--top')
const top = topIdx >= 0 ? Number(process.argv[topIdx + 1] ?? 25) : 25

type Frame = { functionName: string; url: string; lineNumber: number }
type Node = { id: number; callFrame: Frame; children?: number[] }
type Profile = { nodes: Node[]; samples: number[]; timeDeltas: number[]; startTime: number; endTime: number }

const profile = JSON.parse(readFileSync(file, 'utf8')) as Profile
const nodes = new Map<number, Node>()
for (const n of profile.nodes) nodes.set(n.id, n)

const selfByNode = new Map<number, number>()
let total = 0
for (let i = 0; i < profile.samples.length; i++) {
  const id = profile.samples[i]!
  const dt = Math.max(0, profile.timeDeltas[i] ?? 0)
  total += dt
  selfByNode.set(id, (selfByNode.get(id) ?? 0) + dt)
}

const short = (url: string): string => {
  const m = url.match(/bus-management[\\/](.*)$/)
  return m ? m[1]! : url || '(native)'
}

// V8 gives one node per call site, so a hot anonymous node can be identified
// by the function that called it.
const parentOf = new Map<number, Node>()
for (const n of profile.nodes) {
  for (const child of n.children ?? []) parentOf.set(child, n)
}
const label = (n: Node | undefined): string =>
  n ? `${n.callFrame.functionName || '(anon)'} ${short(n.callFrame.url)}` : '(root)'

type Row = { name: string; where: string; ms: number; via: string }
const rows: Row[] = []
for (const [id, us] of selfByNode) {
  const node = nodes.get(id)
  if (!node) continue
  const f = node.callFrame
  const via = label(parentOf.get(id))
  rows.push({
    name: f.functionName || '(anonymous)',
    where: `${short(f.url)}:${f.lineNumber + 1}`,
    ms: us / 1000,
    via,
  })
}
rows.sort((a, b) => b.ms - a.ms)

console.log(`${file}: ${(total / 1000).toFixed(0)} ms sampled, ${rows.length} frames\n`)
console.log('self time by function:')
for (const r of rows.slice(0, top)) {
  const pct = total > 0 ? ((r.ms * 1000) / total) * 100 : 0
  console.log(`  ${r.ms.toFixed(1).padStart(9)} ms ${pct.toFixed(1).padStart(5)}%  ${r.name.padEnd(30)} in ${r.where}  <- ${r.via}`)
}

const byFile = new Map<string, number>()
for (const r of rows) {
  const f = r.where.replace(/:\d+$/, '')
  byFile.set(f, (byFile.get(f) ?? 0) + r.ms)
}
console.log('\nself time by file:')
for (const [f, ms] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  const pct = total > 0 ? ((ms * 1000) / total) * 100 : 0
  console.log(`  ${ms.toFixed(1).padStart(9)} ms ${pct.toFixed(1).padStart(5)}%  ${f}`)
}

// Disjoint sampled categories inside the real bookingPass call tree. Financial
// work nested in allocation/cancellations is attributed to financial updates.
const categoryFunctions = new Map<string, string>()
for (const [category, names] of [
  ['financial updates', ['flushSaleBatch', 'earn', 'spend', 'spendNetted', 'pushTxn', 'bumpRouteStats', 'accrueGstOnTicket', 'reverseAttachOwnerShare']],
  ['cancellations', ['processCancellations', 'processTripCancellations']],
  ['seat allocation', ['allocateSeats', 'allocateAggregate', 'backfillElapsedSales', 'backfillGap']],
  ['demand estimation', ['tripLoadFactor', 'tripArrivals', 'buildBookingCtx', 'channelWeights']],
] as const) {
  for (const name of names) categoryFunctions.set(name, category)
}
const categories = new Map<string, number>()
for (const [id, us] of selfByNode) {
  let node = nodes.get(id)
  let category: string | undefined
  let booking = false
  while (node) {
    category ??= categoryFunctions.get(node.callFrame.functionName)
    if (node.callFrame.functionName === 'bookingPass') { booking = true; break }
    node = parentOf.get(node.id)
  }
  if (booking) {
    const label = category ?? 'other booking work'
    categories.set(label, (categories.get(label) ?? 0) + us / 1000)
  }
}
if (categories.size) {
  console.log('\nbooking subcategories (disjoint sampled time):')
  for (const [category, ms] of [...categories].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${ms.toFixed(1).padStart(9)} ms ${category}`)
  }
}
