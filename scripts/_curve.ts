const raw: number[] = []
for (let d = 0; d <= 30; d++) {
  const early = Math.exp(-((d - 16) ** 2) / (2 * 9 ** 2))
  const mid = 0.85 * Math.exp(-((d - 6) ** 2) / (2 * 3.2 ** 2))
  const late = 0.35 * Math.exp(-((d - 1.5) ** 2) / (2 * 1.6 ** 2))
  raw.push(early + mid + late)
}
const sum = raw.reduce((a, b) => a + b, 0)
const c = raw.map((x) => x / sum)
const tail = Array(32).fill(0)
for (let i = 30; i >= 0; i--) tail[i] = c[i]! + tail[i + 1]!
console.log('d0-2', (c[0]! + c[1]! + c[2]!).toFixed(3), 'd0-7', c.slice(0, 8).reduce((a, b) => a + b, 0).toFixed(3))
console.log('tail8', tail[8].toFixed(3), 'tail3', tail[3].toFixed(3), 'tail2', tail[2].toFixed(3), 'tail15', tail[15].toFixed(3))
console.log(c.map((x) => +x.toFixed(4)).join(', '))
for (const lf of [0.5, 0.62, 0.7, 0.78, 0.85]) {
  console.log('LF', lf, 'd14', +(lf * tail[15]).toFixed(3), 'd7', +(lf * tail[8]).toFixed(3), 'd2', +(lf * tail[3]).toFixed(3), 'd1', +(lf * tail[2]).toFixed(3))
}
