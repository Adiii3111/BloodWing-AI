# BLOODWING AI

**Predict the Need. Optimize the Network. Deliver in Time.** — *Every second circulates.*

An AI-assisted blood logistics research prototype built for Northeastern University's **AI in Healthcare Builder Blitz** (October 30, 2026). It coordinates emergency response, scheduled transfusions and routine replenishment across a **synthetic** Boston-area network of hospitals, fictional depots, drones and ground vehicles. Everything runs on **one shared simulation**: one inventory, one fleet, one clock.

> **Research simulation using synthetic data. Not for clinical decision-making.** All hospital demand, inventory, vehicle specifications, routes and performance metrics are simulated. The prototype is not connected to any real healthcare, EMS, traffic or aviation system. Hospitals appear only as illustrative map nodes; no affiliation, participation or endorsement is implied. Depots are fictional.

---

## The three systems

| System | Tagline | What it does |
|---|---|---|
| **SENTINEL** | From incident alert to blood readiness | Simulated incident → EMS assessment → clinical request → engine recommendation → **human authorisation** → ambulance-vs-blood race with independently computed ETAs and a readiness margin. An alert alone never orders blood. |
| **PULSE** | Anticipating tomorrow's demand, today | Fictional patients with scheduled transfusions. Plans hold ABO/RhD-identical units locally (only while the hospital's forecast emergency shortage risk stays acceptable) and replenish the rest with a *latest feasible dispatch* time. Pending orders are predictions only; nothing is reserved until an order is confirmed. |
| **ORBIT** | One network. Smarter movement. | Capacitated vehicle routing with time windows (CVRPTW) for routine top-ups and PULSE orders: nearest-feasible-neighbour construction, then 2-opt and relocate. Compared against one trip per request on the same orders. It's a heuristic, not proven optimal. |

They interact through the shared state. PULSE reservations and incident holds are hard constraints for SENTINEL, and vans on ORBIT milk runs are never reassigned. The dispatch explanation says so whenever it applies.

## Pages

| # | Route | Contents |
|---|---|---|
| — | `#/` | Cinematic opening |
| 01 | `#/mission` | Command Center: live map, 8 state-derived KPIs, Scenarios A–D, **TRIGGER EMERGENCY**, start / pause / resume / reset, 1× / 5× / 20×, "Why this route?" |
| 02 | `#/sentinel` | Seven deterministic emergency scenarios and the race against time |
| 03 | `#/pulse` | Planning board, plan timeline, 14-day outlook, forecast evaluation |
| 04 | `#/orbit` | Milk-run optimiser, route cards, individual-vs-consolidated comparison |
| 05 | `#/dispatch` | Engine pipeline, request builder, live evaluation matrix, weights |
| 06 | `#/inventory` | Lot-level digital twin, expiry timeline, holds, ML shortage risk, alerts |
| 07 | `#/fleet` | Drone cards, energy model, feasibility calculator, ground vehicles |
| 08 | `#/lab` | Ground-only vs drone-first vs AI on identical seeded demand, 95% CIs, CSV export |
| 09 | `#/research` | Research foundation, architecture diagram, evidence, limitations |
| 10 | `#/impact` | Executive summary of simulated results |
| 11 | `#/about` | Creator and attribution |
| — | `#/pitch` | Five-slide pitch mode (← → keys) |
| — | `#/demo` | **Judge demo**: 120 s, five acts, pause / resume / restart |

## Run it

Requires Node 20+.

```bash
npm install          # install
npm run dev          # local development → http://localhost:5173
npm test             # unit tests (vitest)
npm run build        # type-check + production build → dist/
npm run preview      # serve the production build
```

No API keys, accounts or backend are needed. The map uses keyless Esri dark-gray tiles; if they fail it falls back to inverted OpenStreetMap tiles, then to a schematic grid, and the simulation keeps working either way.

## Judge demo mode

Open **`#/demo`** (or click **Start live demo** in the header) and press **Start live demo**. It runs 120 seconds:

1. **The Emergency (0–40 s)**: I-93 collision → EMS assessment → Boston Medical Center holds its own O− and requests the shortfall → engine recommends → simulated coordinator authorises → ambulance and drones race → readiness margin is recorded.
2. **The Prediction (40–64 s)**: PT-2187's red-cell exchange is confirmed. The emergency has just drawn down BMC's shelf, so PULSE reserves locally only what keeps the forecast shortage risk acceptable (here: none), orders the units for consolidated delivery, and shows the latest feasible dispatch time.
3. **The Optimisation (64–88 s)**: ORBIT consolidates routine top-ups plus the PULSE order into milk runs and compares them with individual trips, then the vans are dispatched.
4. **The Connected Network (88–104 s)**: a second emergency arrives mid-route. The engine serves it without touching reserved units or committed vans.
5. **The Impact (104–120 s)**: measured outcomes, then the title card.

The script only paces the clock and presses the same buttons a user would. Every number comes from the engine at that moment, and the run is identical every time (seeded).

## Deploy

**GitHub Pages** (configured): push to `main` on a GitHub repository. Then, in *Settings → Pages*, set **Source = GitHub Actions**. `.github/workflows/deploy.yml` tests, builds and publishes `dist/`. The build uses relative asset paths and hash routing, so it works at any sub-path (for example `https://<user>.github.io/<repo>/`).

**Vercel / Netlify / any static host**: build command `npm run build`, output directory `dist`.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). In short:

```
src/engine/   pure TypeScript, no UI — unit-tested
  types.ts           domain types
  assumptions.ts     every synthetic constant, in one place
  network.ts         sites, restricted zones, clock
  compatibility.ts   component-specific eligibility rules
  inventory.ts       lots, FEFO, commits (never negative), synthetic stock
  fleet.ts           drone energy/feasibility, ground travel
  dispatch.ts        decision engine: feasibility → evaluation → optimisation → explanation
  simulation.ts      time-stepped DES: missions, charging, expiry, resupply, retries, metrics
  forecast.ts        ML: Poisson regression demand forecaster + held-out evaluation
  sentinel.ts        incidents, EMS model, two-stage request, readiness
  pulse.ts           scheduled-transfusion planning, reservations
  orbit.ts           CVRPTW heuristic + milk-run execution
  scenarios.ts       Command Center scenarios A–D + seeded generator
  experiment.ts      Lab: policies × replications, CIs, CSV
src/lib/      store (shared live state), router, lab cache
src/pages/    one file per route
src/components/ map, race, panels, hero, charts
tests/        engine + systems tests
```

## What is AI, what is optimisation, what is rules

| Layer | Implementation | Label used in the app |
|---|---|---|
| Prediction | Poisson GLM trained on synthetic hourly history, evaluated on a later held-out window against seasonal and global baselines | "ML", "prediction" |
| Prescription | Weighted multi-objective selection over the hard-feasible set (dispatch); CVRPTW heuristic (ORBIT); risk-aware hold-vs-replenish rule (PULSE) | "optimisation", "heuristic" |
| Rules | Compatibility, shelf life, floors, payload, battery reserve, weather, airspace, hold time | "hard constraints" |
| Explanation | Deterministic templates over engine numbers. **No language model is used anywhere.** | "explanations are generated deterministically" |

## Assumptions & limitations

See [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md). All numbers live in `src/engine/assumptions.ts` (plus the PULSE/EMS constants in their modules).

## Research connection

BLOODWING AI is an **independent hackathon prototype** inspired by Winter Simulation Conference 2026 accepted research on discrete-event simulation of a multi-echelon blood supply chain. That research was co-authored by Krithik Reddy Chilkuri and Aditya Kadlabal Sripad under the guidance of Professor Tugce Martagan (Northeastern University). This prototype is not a published result or a validated extension of that work, and reports none of its findings.

Real-world evidence cited (not used as Boston expectations): Nisingizwe MP, et al. (2022). *Effect of unmanned aerial vehicle (drone) delivery on blood product delivery time and wastage in Rwanda.* The Lancet Global Health. https://doi.org/10.1016/S2214-109X(22)00048-1

---

## 30-second elevator pitch

> Blood may be available — time may not be. Hospitals juggle unpredictable emergencies, scheduled transfusions and routine restocking, all competing for the same perishable inventory and the same vehicles. BLOODWING AI is one intelligent layer over the whole network. SENTINEL responds to emergencies after EMS assessment and human authorisation. PULSE prepares for scheduled transfusions before they become urgent. ORBIT consolidates routine deliveries into milk runs. It never assumes the drone is the answer: every recommendation passes hard safety constraints first and comes with a plain explanation. In our synthetic Boston simulation, measured on identical demand, it cuts delivery times against a ground-only baseline. Predict the need. Optimize the network. Deliver in time.

## Three-minute presenter script

**0:00 – 0:25 · Problem** *(Pitch slide 1)*
"Blood may be available. Time may not be. A trauma patient, a scheduled sickle-cell exchange and a routine restock all draw on the same perishable stock, spread across facilities, moved by a limited fleet. The question isn't only whether blood exists — it's whether the right, released, transportable unit reaches the right hospital in time."

**0:25 – 0:50 · Solution** *(slide 2)*
"BLOODWING AI is one decision layer over the whole network: SENTINEL for emergencies, PULSE for scheduled transfusions, ORBIT for routine replenishment. They share one digital twin — one inventory, one fleet, one clock — so a decision in one system respects the commitments of the others."

**0:50 – 2:10 · Live demo** *(open `#/demo`, press Start)*
- "A collision on I-93. EMS is notified, but nothing is ordered from an alert. After assessment, Boston Medical Center holds its own O-negative units for the patient and requests the shortfall."
- "The engine checked every depot and hospital, every drone and courier: compatibility, shelf life, battery reserve, weather, airspace. It recommends drones from Depot Alpha — and a coordinator authorises."
- "Here's the race: ambulance on the left, blood on the right, each with its own ETA. The readiness margin is patient arrival minus blood arrival — positive means the shipment lands first. It doesn't mean blood is ready to transfuse; the hospital still checks and prepares it."
- "Tomorrow a fictional patient has a red-cell exchange. The emergency just used part of Boston Medical's shelf, and PULSE won't drain it further — it orders the units for consolidated delivery, with a latest feasible dispatch time, and flags the hospital's remaining shortage risk."
- "ORBIT folds that order into milk runs with routine top-ups. Same orders, far fewer kilometres than one trip each."
- "Now a second emergency, mid-route. It's served, and the explanation shows what was protected: units reserved for the scheduled patient, vans committed to milk runs. That's the innovation — coordination across competing priorities."

**2:10 – 2:40 · Results** *(slide 5 or `#/impact`)*
"In the Lab, all three policies — ground-only, drone-first and BLOODWING — run on identical seeded demand, with confidence intervals. These are simulation results on synthetic data, and we say so on every screen."

**2:40 – 3:00 · Vision**
"Next: calibrate with real aggregate data, partner with a blood bank, and run in shadow mode alongside existing workflows. Real use needs EMS integration, clinical oversight, a validated cold chain and aviation authorisation. BLOODWING AI — predict the need, optimize the network, deliver in time."
