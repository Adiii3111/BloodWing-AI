# Architecture

## Principles

1. **One state.** `SimState` (in `src/engine/types.ts`) holds sites, lots, drones, couriers, requests, decisions, missions, incidents, appointments, orders, events and the clock. Every page reads and writes that one object through `src/lib/store.ts`. No widget has numbers of its own.
2. **Pure engine.** `src/engine/` has no React and no DOM. It is deterministic for a given seed and fully unit-tested (`tests/`).
3. **Hard constraints first.** Safety-relevant checks reject options outright, with a reason. Scores only rank options that are already feasible.
4. **Honest outputs.** If nothing is feasible, the engine says so and flags human review. Projections are labelled as projections and predictions as predictions.

## Data flow

```
             ┌──────────── SENTINEL (incident → EMS → request → AUTH) ────┐
             │                                                            │
 PULSE plans ├─► reserveUnits() ──► Lot.status = reserved (hard constraint)│
             │                                                            ▼
             └─► ReplenOrder ──► ORBIT solveMilkRun() ──► milk-run Mission ──► stock added at stops
                                                                          │
 Command Center / Dispatch builder ──► submitRequest() ──► evaluateRequest() ──► launchMission()
                                                                          │
                                 advance(dt): missions, battery, expiry, resupply, retries, EMS
                                                                          │
                                          computeMetrics() ──► KPIs, Impact, Demo Act 5
```

## Dispatch engine (`dispatch.ts`)

For each request, every site other than the destination is a candidate source. Depots can send by drone or ground; hospitals can transfer by ground only, and only above their local floor.

**Stage 1, hard feasibility.**
- Inventory: compatible (component-specific rules), released, enough remaining shelf life, not reserved or quarantined, and enough units above the local floor.
- Drone: drones enabled, weather known and within limits, straight line clear of restricted zones, payload (≤ 3 drones per request), round-trip energy plus a 25% reserve, container hold time, idle drones with enough charge.
- Ground: an idle courier, capacity, and container hold time.

**Stage 2, evaluation.** For each feasible option: ETA = prep + travel + handoff, slack against the deadline, ETA with travel 30% slower, cost, and terms for inventory consequence and fleet impact.

**Stage 3, choice.** Minimise `Σ w·term`. Weights depend on urgency (`WEIGHTS` in `assumptions.ts`). The baseline policies `ground-only` and `drone-first` bypass the score and follow their stated rules.

**Explanation.** Template sentences built from the chosen option, the best alternative of the other mode, rejections, local floors, conservation of universal-donor units, robustness, and commitments that were respected.

## Simulation (`simulation.ts`)

The clock advances in sub-steps of at most 1 minute. Each sub-step:
- submits scheduled requests (SENTINEL stage 2 runs a hook that holds local units first);
- generates ambient Poisson demand;
- moves each mission along its timeline (request missions: prep → enroute → handoff → return; milk runs: one timeline through every stop);
- drains drone batteries along the flight and charges idle drones;
- updates EMS status;
- every 2 min, re-evaluates queued requests and marks them unfulfilled after deadline + 60 min;
- every 10 min, expires lots;
- every 12 h, resupplies depots from the regional supplier.

Requests that require authorisation (`awaiting-auth`) are evaluated but never launched until `authorizeRequest()` is called. That call re-evaluates against the state at that moment.

## ML (`forecast.ts`)

A Poisson GLM with a log link. Features: hour-of-day harmonics, a weekend flag, hospital one-hot, `log1p` of requests in the last 3 h, and `log1p` of requests in the last 24 h. It is trained with full-batch Adam on 90 days of seeded synthetic history and tested on the following 30 days. MAE and deviance are reported against a hospital × hour mean and a global mean. Uses:
- 6-hour expected demand per hospital, shown in the inventory twin;
- the local-shortage term when a hospital is a transfer source (dispatch);
- PULSE hold-vs-replenish risk.

## ORBIT (`orbit.ts`)

1. Allocate hub stock FEFO, exact group.
2. Aggregate orders into stops, splitting any stop above van capacity.
3. Offer stops whose window can't be met by road to a direct drone, if feasible.
4. Construct routes greedily: nearest feasible stop by time, within capacity and each stop's latest time.
5. Improve with 2-opt within routes and relocation between routes, accepting only feasible moves that lower distance.
6. Assign idle vans.

Network mode runs the hubs in order on whatever the previous hubs could not serve. Execution deducts hub stock, and each stop adds lots (reservations included) on arrival.

## Experiment (`experiment.ts`)

For each replication, one seeded demand stream and one seeded initial inventory feed all three policies (common random numbers). The output is the mean with a t-based 95% CI across replications, plus paired differences against Baseline A. Rate CIs are clipped to [0, 1].

## Frontend

Vite + React 18 + TypeScript (strict) + Tailwind v4, plus Leaflet (imperative, per-frame marker updates through a fast store channel), Recharts and Framer Motion for page transitions. The store uses two channels: a throttled (~10 Hz) one for React panels and a per-frame one for the map. Routing is hash-based for static hosting. User preferences and Lab parameters persist in `localStorage`. The simulation itself is rebuilt from its seed, so a refresh is reproducible.
