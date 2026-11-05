# Simulation reliability and performance

## Verification and profiling

- `npm run test:saves` checks delayed and failed worker results, real store replacement actions, manual saves, page-hide flushing, cloud destination changes, and storage retries. Tests use fake storage, timers and workers; no player saves or cloud accounts are accessed.
- `npm run test:sim` checks 493 reference states across three fleet sizes and three seeds. It includes hybrid cabins, festivals, coach replacement, workshop cover, month boundaries, and both branches of seven-day save/load continuations.
- References live in `scripts/fixtures/sim-reference.json`. They were captured with the original cancellation scan, before enabling the new index. `npx tsx scripts/test-sim-performance.ts --record` deliberately replaces them and must only be used for reviewed, intentional behavior changes.
- `npm run perf:sim` alternates the original cancellation scan and optimized index through the real `advanceDay` pipeline. It discards the first warm-up pair and compares three measured 14-day runs per fleet, asserting identical final states for every pair. Generated reference modules and timings stay in ignored `.profiles/`.
- `npm run profile:sim -- --fleet 70` samples the actual daily pipeline. Inspect it with `npx tsx scripts/cpu-hotspots.ts .profiles/day-70.cpuprofile`; the report separates cancellation, allocation, demand and financial work. The profiler no longer maintains a second, incomplete simulation pipeline.
- For browser measurements, start `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`, then run `npm run perf:browser`. Set `PERF_CHROME` for another Chromium executable or `PERF_URL` for another local server. The script uses its own headless browser profile and stores results in `.profiles/browser-performance.json`.

Browser rendering measures a store update through its actual DOM commit and forced layout. Day/week totals include two animation frames; worker round-trip includes encoding and response delivery. These are local headless development measurements, not production-device guarantees. Long-task observations cover the whole measurement sequence, including setup.

## Local measurements (2026-11-05)

Interleaved engine A/B medians, in milliseconds per day:

| Coaches | Original cancellation scan | Indexed cancellations | Speedup |
| --- | ---: | ---: | ---: |
| 20 | 29.55 | 16.01 | 1.85× |
| 70 | 69.25 | 57.12 | 1.21× |
| 140 | 57.60 | 43.77 | 1.32× |

These measure this follow-up optimization against the already optimized trip planner, not against the initial version of the game. Absolute timings vary with host load, JIT and garbage collection; the paired tests also require identical final states. Fleet counts include idle coaches, so cost need not increase monotonically with fleet size.

In separate 70-coach CPU profiles of 42 simulated days, cancellation processing accounted for 667.8 ms of sampled booking time before indexing and 43.1 ms afterwards. The remaining largest sampled booking categories were financial updates (615.0 ms), demand estimation (506.2 ms) and seat allocation (242.0 ms). Profiling samples are diagnostic, not wall-clock benchmark medians.

Isolated headless Chrome, dashboard at 1440×1000, three-sample medians in milliseconds:

| Coaches | Engine day | Initial clone | Save DTO | Worker dispatch | Worker round-trip | Render update → commit/layout | Day → paint | Week → paint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 | 22.3 | 25.0 | 0.9 | 10.0 | 135.8 | 91.7 | 119.7 | 249.9 |
| 70 | 37.8 | 29.9 | 1.3 | 9.1 | 127.1 | 71.3 | 106.9 | 387.8 |
| 140 | 38.7 | 39.4 | 2.4 | 14.4 | 142.3 | 67.0 | 114.3 | 412.5 |

The render measurement mounts/restores the dashboard and includes React scheduling; it is not the incremental cost of every day update. Save encoding runs in the worker, but posting its DTO still copies data synchronously. Observed long tasks peaked at 204–456 ms across the full measurement sequence. Cloning, dashboard rendering and the current 120 ms skip chunks remain opportunities for a separate responsiveness change. Moving simulation to a worker is deliberately deferred.

## Existing gameplay defects deliberately left unchanged

### Reloading near-departure bookings can change outcomes

Reproduce with the hybrid fixtures in `test-sim-performance.ts`, seed 9001: encode the state on measured day 30, decode and hydrate it, then advance both the original and loaded states. Canonical save DTOs differ after the first continued day, including revenue and cash. Both continuation branches now have independent reference hashes so performance changes must preserve each branch's existing behavior.

The codec packs live seat maps into sold rows. Cancellation processing uses different selection algorithms for packed rows and live seats, and the loaded state initially has packed seats even near departure. This explains a route to different seeded outcomes; a gameplay correction needs its own reviewed change and updated references. No save format or cancellation rules were changed here.

### Overnight festival-only services can omit named-window legs

A paired festival-only Chennai–Madurai service at 21:00 / 09:00 generates padded repositioning legs but no normal window legs. `generateTrips` sends festival-only schedules through `generateTripsForDay`, while the normal leg planner returns no legs for schedules requiring marathon readiness. That branch does not invoke the marathon planner.

The festival-pad test now uses a feasible same-day 09:00 / 21:00 service to test padding independently. This overnight scheduling defect remains separate from the performance change.

### Collection decisions are not fully seeded

The `cheque_bounce` collection-agency decision uses `Math.random()` in `events.ts`. Long reference runs therefore choose the deterministic write-off option. Production behavior is unchanged; references do not claim to validate determinism of the collection-agency option.

## Corrected test fixtures

- Driver-rest coverage uses Chennai–Tirupati, where 21:00 outbound and 06:00 return fit the coach's drive and cooldown. The old Chennai–Madurai fixture had no such return departure; its helper treated a missing trip as eligible. Missing test departures now fail explicitly.
- Return-only seasonal coverage uses 09:00 / 21:00. The old 21:30 return left only 11.5 hours until the next outbound, less than the route's 11.9 hours of drive plus cooldown. All four daily festival legs are still asserted with the feasible clock.
- The festival-pad test checks the named window from a fresh planning snapshot instead of treating undispatched bookings from earlier calendar jumps as actual journeys.

## Save behavior

Each deferred local save has a game-session generation, revision, day and original cloud destination. Newer saves supersede older worker results and their error fallbacks. Reset/load/import/start/abandon invalidates deferred work. Page-hide can synchronously flush a save still encoding in the worker. Cloud snapshots are isolated from later live-state mutations and never follow a different selected slot. Requests already dispatched to the network cannot be recalled by cancelling a timer.

Storage-full compaction always uses a private copy, preserving the live gameplay state. Save serialization and the public store API remain compatible; no migration is needed.
