/** Profile the actual advanceDay pipeline, including every current subsystem.
 * npx tsx scripts/pass-profile.ts [--fleet 70]
 * npx tsx scripts/cpu-hotspots.ts .profiles/day-70.cpuprofile
 * No mirrored pipeline: adding an engine pass automatically includes it here.
 */
export {}
if (!process.argv.includes('--profile')) process.argv.push('--profile')
if (!process.argv.includes('--fleet')) process.argv.push('--fleet', '70')
await import('./test-sim-performance')
