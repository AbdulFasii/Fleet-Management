# Fleet Operator

A text-based, dashboard-style business simulation where you run a private
intercity bus company in India — the world of RedBus listings, Volvo
sleepers, diesel prices, RTO permits, festival rushes and EMIs.

Built with React + TypeScript + Vite. The whole simulation is a pure,
deterministic TypeScript engine (`src/engine`) with a thin terminal-styled
UI on top. Auto-saves to your browser.

## Run it

```bash
npm install
npm run dev        # play at the printed URL
npm run build      # production build
npm run sim -- --seed 42 --years 2 --bot competent   # headless balance run
npm run sim -- --seed 42 --years 2 --bot careless    # watch a bad operator die
```

Simulation regression checks, save reliability tests, performance commands, measurements, and known gameplay findings are documented in [simulation findings](docs/simulation-findings.md).

## The game

You start with seed capital (₹15L–₹1Cr depending on difficulty), one
pre-granted route permit, an empty depot and a credit score. The goal is
simple: don't go bankrupt, and build the most respected fleet on the
highway. There is no win screen — only survival, growth, and the
scoreboard when it ends.

### A day in the life

Each day tick runs the full pipeline: world drift (diesel walk, competitor
fares) → random events → deliveries & permits → booking window (every open
trip sells seats based on demand) → today's departures (fuel, tolls, crew
bata, breakdown/accident rolls, reviews) → maintenance & staff upkeep →
settlements & banking → month-end close (payroll, rents, depreciation,
GST, advance tax) → bankruptcy check → KPI snapshot.

Skip a day (N), a week (W) or a month (M). Skips pause automatically when
something needs your attention.

### Getting a bus on the road (the checklist)

1. **Market (3)** — four ways in:
   - **New from dealer**: 15–90 day body-building lead time.
   - **Used market**: hidden per-subsystem condition. Spend ₹8k on an
     inspection or gamble.
   - **Dry lease**: monthly rent + deposit, no capex; you crew and maintain.
   - **Attach**: a third-party owner runs his bus under your brand. He
     keeps ~70–78% of tickets and bears fuel/crew/upkeep; you keep the
     channel margin and carry the brand risk when his AC dies.
2. **Staff (8)** — hire and assign drivers (routes over 8 driving hours
   need TWO) and one conductor per bus (tickets and cabin; no separate
   cleaner).
3. **Routes (4)** — permits cost ₹25k, take 2–4 weeks, can be rejected,
   and better corridors are gated behind reputation.
4. **Schedules (5)** — route + departure slot + fare policy + boarding
   points + cancellation policy + sales channels. Overnight routes want
   19:00–23:00 departures and sleepers. Short routes run both directions
   daily; long routes alternate directions (a second bus makes it daily).

### Demand — why your bus fills (or doesn't)

Every open trip sells seats daily from a 30-day booking curve (most sales
in the final week). Your share of corridor demand is a product of:

- **Price vs the market** (elasticity ~2.3; the market itself surges in
  festivals and undercuts you in price wars),
- **Rating** (heavily weighted — a 2.8★ operator is invisible),
- **Brand awareness, punctuality, bus quality, comfort**,
- **Class fit** (sleeper on overnight, seater by day) and **slot quality**,
- **Boarding points** and **cancellation policy**,
- **Channel reach**: RedBus (10% commission, T+5 settlement, RedDeal promo
  and the Primo badge as boosters), your own app (build tiers ₹3L/₹8L/₹20L,
  2% PG fees, T+1 settlement, grows via marketing CAC and riders), and
  agents/counters (7%, instant cash).

Calendar matters enormously: Fri/Sun peaks, Diwali/Sankranti/Chhath surges
(directional — out of the metros before, back after), summer holidays,
wedding season, and the monsoon slump with landslide closures on ghat
routes. Seats are sold individually — lower berths and windows go first,
ladies-reserved seats follow RedBus rules, and cancellations refund by
time-to-departure tiers.

### Money — where it goes

Per trip: diesel (mileage × price × AC penalty), AdBlue, FASTag tolls,
border tax on interstate runs, crew bata, parking/cleaning. Monthly:
salaries, depot rent, office, GPS, lease rents, app opex, marketing.
Quarterly: AITP/state road tax. Yearly: insurance, fitness, permit
renewals. Statutory: 5% GST on AC tickets (remitted monthly), quarterly
advance income tax, FY settlement in March. Non-cash: WDV depreciation.

Side income: parcels in the luggage bay, body advertising, on-board sales.

The central tension is **working capital**: RedBus pays you T+5 while
diesel is cash today. The overdraft bridges the gap — at 15% and with a
limit set by your credit score.

### Banking & failure

Hire-purchase loans from four lenders (LTV up to 85%, rates by credit
score), EMIs every 30 days. Miss one: penalty + credit hit. Miss three in
a row: the financier repossesses the bus mid-schedule. If cash goes
negative beyond the OD limit, the bank forces fire sales at 68% of book —
and if that's not enough, the NCLT ends your run with a scorecard.

### Keeping the machine alive

Per-subsystem wear (engine, gearbox, brakes, suspension, AC, body,
electrical) scales with km and doubles when service is overdue (every
25,000 km). Bad condition = breakdowns (rescue + 50% refunds + rating
crater) and accidents (deductible, weeks of downtime). A sound old chassis
(engine, gearbox, suspension all 50+) can be **re-bodied** once for
₹4–8 L — body, AC and electricals back to 90 and five extra years of
useful life — while **seat refurbishment** (₹30–80 k) adds +1.5 comfort
and a passenger-satisfaction lift. Tyres last 90k km
(retreads 55k). An own workshop (₹15L/₹35L) makes jobs 35–45% cheaper and
faster. Drivers fatigue on long hauls and take leave; underpaid crews
resign, get poached, or strike.

### Events

Diesel shocks, RedBus commission hikes, price wars, RTO crackdowns,
monsoon landslides, bandhs, RTC strikes (a gift!), new expressways, EV
subsidy windows, viral complaints (or praise), and rivals selling out
their fleets to you at a discount.

## Architecture

```
src/engine/          pure TS, zero React imports, fully deterministic
  core/              money (integer paise), calendar (festivals), RNG, ids
  data/              balance.ts (every tunable), routes, buses, lenders
  sim/               finance ledger, demand, booking, dispatch, fleet,
                     staffing, maintenance, banking, events, tax, kpi…
  tick.ts            the day pipeline
  newGame.ts         initial state factory
src/store/           zustand + immer wrapper, intents, localStorage saves
src/ui/              terminal-styled pages (keyboard: N/W/M, 1-9 tabs)
scripts/sim.ts       headless balance harness (npm run sim)
```

Every rupee is an integer number of paise moving through a transaction
ledger; P&L, balance sheet, cash flow and per-bus/per-route economics all
derive from it. All randomness flows through named, seeded streams —
a save replays identically.

## Balance targets (verified by the harness)

- A **competent** bot (inspected used sleepers on finance, full crews,
  on-time servicing, auto-pricing) is comfortably profitable and reaches
  ~₹3-4Cr net worth in 2 years.
- A **careless** bot (uninspected bus, thin fares, RedDeal always on, no
  maintenance ever) goes bankrupt in **~9 months**.

Tune everything from `src/engine/data/balance.ts`.
