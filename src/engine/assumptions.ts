// Every number the model relies on lives here, so it can be cited and changed in one place.
// All values are SYNTHETIC engineering / planning assumptions for a research prototype.
// None of them are clinical standards, regulatory limits, or measured performance.

import type { Component, Urgency, Weights } from './types';

export const DRONE = {
  cruiseKmh: 80,
  rangeKm: 36, // still air, full battery, empty — ≈ 27 min endurance
  maxPayloadKg: 2.0,
  reservePct: 25, // battery that must remain on landing back at base
  payloadDrainFactor: 0.3, // +30% energy per minute at full payload
  prepMin: 6, // pick, pack, load, pre-flight checks
  handoffMin: 3, // descent, release / landing, receipt
  chargePctPerMin: 2.2,
  maxDronesPerRequest: 3,
  costFixedUsd: 45,
  costPerKmUsd: 1.2,
  // Operating envelope (simplified scenario assumptions)
  maxWindKmh: 35,
  minVisibilityKm: 3,
  groundedPrecip: ['heavy-rain', 'snow', 'thunderstorm'] as const,
};

export const GROUND = {
  roadCircuity: 1.4, // road km per straight-line km (simplified)
  speedKmh: 24, // average urban courier speed, free-flowing traffic
  prepMin: 10,
  handoffMin: 4,
  capacityUnits: 30,
  costFixedUsd: 60,
  costPerKmUsd: 2.5,
};

/** ORBIT milk-run assumptions (synthetic). */
export const ORBIT = {
  serviceMin: 8, // unload, count, sign at each stop
  vehicleFixedUsd: 60, // per vehicle dispatched
  targetRBC: 22, // hospital target red-cell stock used for routine top-ups
  vanCapacityUnits: 48, // refrigerated van, multi-compartment
};

/** Transport container weights (kg) and validated hold times (min) — synthetic. */
export const PACKAGING: Record<Component, { tareKg: number; unitKg: number; holdMin: number; container: string }> = {
  RBC: { tareKg: 0.6, unitKg: 0.35, holdMin: 360, container: 'refrigerated shipper, 1–10 °C' },
  PLT: { tareKg: 0.6, unitKg: 0.3, holdMin: 240, container: 'room-temperature shipper, 20–24 °C' },
  PLASMA: { tareKg: 0.9, unitKg: 0.3, holdMin: 240, container: 'frozen shipper, ≤ −18 °C' },
};

/** Minimum remaining shelf life for a unit to be dispatched (min). */
export const MIN_REMAINING_MIN: Record<Component, number> = {
  RBC: 24 * 60,
  PLT: 12 * 60,
  PLASMA: 24 * 60,
};

/** Shelf life of freshly supplied units (days) — typical orders of magnitude, simplified. */
export const SHELF_LIFE_DAYS: Record<Component, number> = { RBC: 42, PLT: 5, PLASMA: 365 };

/** Hospitals may only transfer units above this local floor (eligible units of the component). */
export const HOSPITAL_FLOOR: Record<Component, number> = { RBC: 8, PLT: 2, PLASMA: 4 };

/** Synthetic service targets used to set deadlines — not clinical standards. */
export const DEFAULT_DEADLINE: Record<Urgency, number> = { critical: 30, urgent: 60, routine: 180 };

/** Grace period after the deadline before a queued request is recorded as unfulfilled. */
export const UNFULFILLED_GRACE_MIN = 60;

/** Robustness check: every travel leg 30% slower than planned. */
export const ROBUST_TRAVEL_FACTOR = 1.3;

/** Normalisation reference for the cost term. */
export const COST_REF_USD = 120;

/** Objective weights by urgency. Hard constraints are never traded against these. */
export const WEIGHTS: Record<Urgency, Weights> = {
  critical: { delay: 0.5, lateness: 0.3, cost: 0.04, inventory: 0.1, operational: 0.06 },
  urgent: { delay: 0.4, lateness: 0.25, cost: 0.1, inventory: 0.15, operational: 0.1 },
  routine: { delay: 0.2, lateness: 0.2, cost: 0.3, inventory: 0.18, operational: 0.12 },
};

/** U.S.-style population blood-group frequencies used only to generate synthetic stock and demand. */
export const GROUP_FREQ = [
  ['O+', 37],
  ['A+', 36],
  ['B+', 8],
  ['O-', 7],
  ['A-', 6],
  ['AB+', 3],
  ['B-', 2],
  ['AB-', 1],
] as const;

export const COMPONENT_LABEL: Record<Component, string> = {
  RBC: 'Red blood cells',
  PLT: 'Platelets',
  PLASMA: 'Plasma',
};

export const COMPONENT_SHORT: Record<Component, string> = { RBC: 'RBC', PLT: 'PLT', PLASMA: 'FFP' };
