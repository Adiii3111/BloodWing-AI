// Simplified, physically coherent multicopter flight model (synthetic specification).
//
// ground speed  = cruise − wind      (conservative: assume a full headwind on both legs)
// endurance     = rangeKm / cruise   (minutes of still-air flight on a full battery)
// drain/min     = 100 / endurance × (1 + payloadDrainFactor × payload / maxPayload)
// required      = outbound(loaded) + handoff hover(loaded) + return(empty)
// feasible      ⇔ battery − required ≥ reserve

import { DRONE, GROUND, PACKAGING } from './assumptions';
import type { Component, Drone, Weather } from './types';

export function payloadKg(component: Component, units: number): number {
  const p = PACKAGING[component];
  return p.tareKg + p.unitKg * units;
}

export function unitsPerDrone(component: Component, maxPayloadKg = DRONE.maxPayloadKg): number {
  const p = PACKAGING[component];
  return Math.max(0, Math.floor((maxPayloadKg - p.tareKg) / p.unitKg + 1e-9));
}

export function weatherCheck(w: Weather | null): { ok: boolean; reason?: string; review?: boolean } {
  if (!w) return { ok: false, reason: 'weather data unavailable — requires human review', review: true };
  if (w.windKmh > DRONE.maxWindKmh) return { ok: false, reason: `wind ${w.windKmh} km/h exceeds the ${DRONE.maxWindKmh} km/h limit` };
  if (w.visibilityKm < DRONE.minVisibilityKm) return { ok: false, reason: `visibility ${w.visibilityKm} km is below ${DRONE.minVisibilityKm} km` };
  if ((DRONE.groundedPrecip as readonly string[]).includes(w.precip)) return { ok: false, reason: `${w.precip.replace('-', ' ')} grounds the fleet` };
  return { ok: true };
}

export function groundSpeedKmh(cruiseKmh: number, w: Weather | null): number {
  return Math.max(10, cruiseKmh - (w?.windKmh ?? 0));
}

export function flightMinutes(distanceKm: number, cruiseKmh: number, w: Weather | null): number {
  return (distanceKm / groundSpeedKmh(cruiseKmh, w)) * 60;
}

export interface EnergyPlan {
  outboundMin: number;
  returnMin: number;
  requiredPct: number;
  /** Battery needed on a full charge — if > 100 − reserve, the mission exceeds range. */
  exceedsRange: boolean;
}

export function energyPlan(drone: Pick<Drone, 'cruiseKmh' | 'rangeKm' | 'maxPayloadKg'>, distanceKm: number, loadKg: number, w: Weather | null): EnergyPlan {
  const outboundMin = flightMinutes(distanceKm, drone.cruiseKmh, w);
  const returnMin = outboundMin;
  const enduranceMin = (drone.rangeKm / drone.cruiseKmh) * 60;
  const base = 100 / enduranceMin;
  const loaded = base * (1 + DRONE.payloadDrainFactor * Math.min(1, loadKg / drone.maxPayloadKg));
  const requiredPct = outboundMin * loaded + DRONE.handoffMin * loaded + returnMin * base;
  return { outboundMin, returnMin, requiredPct, exceedsRange: requiredPct > 100 - DRONE.reservePct };
}

export function droneCost(distanceKm: number, drones: number): number {
  return drones * (DRONE.costFixedUsd + DRONE.costPerKmUsd * distanceKm * 2);
}

export function roadKm(straightKm: number): number {
  return straightKm * GROUND.roadCircuity;
}

export function groundMinutes(straightKm: number, trafficMultiplier: number): number {
  return (roadKm(straightKm) / GROUND.speedKmh) * 60 * trafficMultiplier;
}

export function groundCost(straightKm: number): number {
  return GROUND.costFixedUsd + GROUND.costPerKmUsd * roadKm(straightKm) * 2;
}
