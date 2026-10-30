# Model assumptions & limitations

Everything below is a **synthetic planning assumption** for a research prototype. None of it is a clinical standard, a regulatory limit or measured performance.

## Network
- **Hospitals:** six illustrative Boston nodes at approximate campus coordinates. They have no affiliation, data or participation.
- **Depots:** Alpha (south), Bravo (Cambridge side) and Charlie (north) are fictional.
- **Airspace:** a simplified 2.5 km no-fly circle around the airport, plus an optional simulated downtown restriction. Any straight-line route that crosses one is rejected. Real airspace and authorisation are far more complex, and drone lines on the map are illustrations, not flight paths.
- **Roads:** road km = 1.4 × straight-line km. Couriers average 24 km/h in free flow, multiplied by a scenario traffic factor. Ground routes are drawn as illustrative L-shapes.

## Products & eligibility (simplified, scoped)
| Component | Shelf life (simplified) | Transport | Eligibility used |
|---|---|---|---|
| Red cells | 42 d | refrigerated shipper 1–10 °C, 6 h hold | ABO/RhD compatible; unknown group → O− only |
| Platelets | 5 d | room-temp shipper 20–24 °C, 4 h hold | any ABO; RhD− recipients → RhD− units |
| Plasma | 365 d | frozen shipper ≤ −18 °C, 4 h hold | reverse ABO; RhD ignored; unknown → AB only |

- Minimum remaining shelf life to dispatch: 24 h for red cells and plasma, 12 h for platelets.
- Units that are quarantined, reserved or expired are never dispatched.
- Allocation goes compatible-first, then first-expiring-first-out. Universal-donor units are used last.
- Hospitals keep a local floor (red cells 8, platelets 2, plasma 4) that transfers can't breach.
- PULSE plans ABO/RhD-identical units only. Extended antigen matching, crossmatching, irradiation and other special requirements are **not modelled**.

## Drones (synthetic specification)
- 80 km/h cruise, 36 km still-air range (≈ 27 min), 2.0 kg payload, which fits 4 red-cell, 4 platelet or 3 plasma units.
- Ground speed = cruise − wind, assuming a full headwind on both legs (conservative).
- Energy drain rises 30% at full payload. The return leg is flown empty, with a 3-minute hover for handoff.
- The mission is feasible only if the battery left on landing is at least the 25% reserve.
- Prep 6 min, handoff 3 min, charging 2.2%/min, at most 3 drones per request.
- Grounded when wind > 35 km/h, visibility < 3 km, or in heavy rain, snow or thunderstorms. A missing weather feed means *requires human review*.

## Ground vehicles
- Prep 10 min, handoff 4 min, emergency capacity 30 units. ORBIT vans carry 48 units across multiple compartments.
- Depots have 2 couriers each; hospitals have 1.

## Costs (synthetic)
- Drone: $45 per drone + $1.20/km for the round trip.
- Ground: $60 + $2.50 per road km for the round trip.
- Milk run: $60 per vehicle + $2.50 per road km.

## SENTINEL
- EMS response 7 min × √traffic, assessment 5 min after arrival, departure from scene 12 min after arrival, ambulance speed 42 km/h × road circuity, delay scaled by √traffic.
- The receiving hospital is fixed by EMS in each scenario, and its own compatible units are held for the patient first.
- Receipt check-in takes 5 min. Clinical verification and preparation are **not modelled**.

## PULSE
- Units must be on the shelf 4 h before the appointment and stay in date for 24 h after it.
- Handling buffer 60 min, safety margin 120 min, planning traffic ×1.5.
- Forecast emergency demand over the next 6 h (the routine replenishment cycle) may not leave more than a 20% probability of exceeding the hospital's slack. If it would, the plan holds fewer units locally and replenishes the rest.

## Demand & forecasting
- Synthetic Poisson arrivals with daily and weekly profiles and occasional surges. Group frequencies follow typical U.S. donor-population proportions and are used only to generate data.
- Deadlines: critical 30, urgent 60, routine 180 min (synthetic service targets).
- The forecaster is trained and tested on synthetic data only.

## What the results do and do not mean
- The Lab compares policies under these assumptions. Confidence intervals reflect only replication-to-replication variation in a synthetic model, and no multiple-comparison correction is applied.
- No result here is evidence about real-world performance, patient outcomes or safety. "Lives saved" or "clinically proven" claims are not made and must not be inferred.
- Real deployment would require EMS integration and authorisation, hospital and blood-bank partnerships, clinical ordering and product-release workflows, quality assurance, validated temperature-controlled transport, aviation authorisation and airspace coordination, security, privacy and consent, and operational and clinical validation.
