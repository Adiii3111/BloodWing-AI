// Prepared, reproducible scenarios. Each one sets conditions and a request — the ENGINE decides
// the outcome. Nothing here hard-codes which source or mode wins.

import { CLEAR_WEATHER, createSimulation, log, submitRequest, type RequestInput } from './simulation';
import { Rng } from './rng';
import { HOSPITALS } from './network';
import type { SimConfig, SimState } from './types';
import { randomRequest } from './simulation';

export interface ScenarioDef {
  id: string;
  code: string;
  title: string;
  tagline: string;
  story: string;
  config: Partial<SimConfig>;
  setup?: (s: SimState) => void;
  request: RequestInput;
}

export const SCENARIO_SEED = 2026;

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'critical',
    code: 'A',
    title: 'Critical Emergency',
    tagline: 'Trauma activation — group unknown',
    story: 'A trauma patient arrives at Massachusetts General Hospital. Their blood group is not yet known, so only O-negative red cells can be released. The clock starts now.',
    config: { trafficMultiplier: 1.2, weather: CLEAR_WEATHER },
    request: { hospitalId: 'MGH', component: 'RBC', recipientGroup: 'UNKNOWN', units: 4, urgency: 'critical', deadlineMin: 25, label: 'Trauma activation' },
  },
  {
    id: 'traffic',
    code: 'B',
    title: 'Traffic Disruption',
    tagline: 'Roads at ×3 travel time',
    story: 'A major road incident triples ground travel times across the South End. Boston Medical Center needs six units of O-positive red cells for an emergency surgery.',
    config: { trafficMultiplier: 3.0, weather: CLEAR_WEATHER },
    request: { hospitalId: 'BMC', component: 'RBC', recipientGroup: 'O+', units: 6, urgency: 'urgent', deadlineMin: 30, label: 'Emergency surgery' },
  },
  {
    id: 'grounded',
    code: 'C',
    title: 'Drone Unavailable',
    tagline: 'High winds · low batteries',
    story: "Wind gusts of 46 km/h exceed the fleet's operating limit, and Depot Bravo's drones are still recharging. Boston Children's Hospital needs two units of platelets.",
    config: { trafficMultiplier: 1.3, weather: { windKmh: 46, visibilityKm: 10, precip: 'light-rain' } },
    setup: (s) => {
      for (const d of s.drones) if (d.baseId === 'DB') d.battery = 31;
      const m = s.drones.find((d) => d.baseId === 'DC');
      if (m) m.status = 'maintenance';
    },
    request: { hospitalId: 'BCH', component: 'PLT', recipientGroup: 'A+', units: 2, urgency: 'urgent', deadlineMin: 60, label: 'Oncology platelet support' },
  },
  {
    id: 'shortage',
    code: 'D',
    title: 'Inventory Shortage',
    tagline: 'Nearest depot has no eligible units',
    story: "Tufts Medical Center needs three units of B-negative red cells. Depot Alpha, the nearest depot, has none it can release: its B− lot is quarantined, its O− is reserved for a scheduled case, and its B+ units are incompatible.",
    config: { trafficMultiplier: 1.4, weather: CLEAR_WEATHER },
    setup: (s) => {
      for (const l of s.lots) {
        if (l.siteId !== 'DA' || l.component !== 'RBC') continue;
        if (l.group === 'B-') l.status = 'quarantine';
        if (l.group === 'O-') l.status = 'reserved';
      }
      s.counters.lot++;
      s.lots.push({ id: `L${String(s.counters.lot).padStart(4, '0')}`, siteId: 'DA', component: 'RBC', group: 'B+', units: 6, expiresAt: 20 * 1440, status: 'released' });
    },
    request: { hospitalId: 'TMC', component: 'RBC', recipientGroup: 'B-', units: 3, urgency: 'urgent', deadlineMin: 45, label: 'Obstetric haemorrhage' },
  },
];

export function scenarioById(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/** Build the state for a scenario WITHOUT submitting its request yet. */
export function buildScenario(def: ScenarioDef, extra: Partial<SimConfig> = {}): SimState {
  const s = createSimulation({ config: { seed: SCENARIO_SEED, ...def.config, ...extra } });
  def.setup?.(s);
  log(s, 'info', `Scenario ${def.code} — ${def.title} loaded`);
  return s;
}

export function runScenarioRequest(s: SimState, def: ScenarioDef) {
  return submitRequest(s, def.request);
}

/** A reproducible "new scenario": conditions and request drawn from a numbered seed. */
export function generatedScenario(n: number): ScenarioDef {
  const rng = new Rng(7919 * n + 17);
  const windy = rng.next() < 0.25;
  const traffic = Math.round(rng.range(1, 2.8) * 10) / 10;
  const req = randomRequest(rng);
  if (req.urgency === 'routine') req.urgency = 'urgent';
  const h = HOSPITALS.find((x) => x.id === req.hospitalId)!;
  return {
    id: `gen-${n}`,
    code: `#${n}`,
    title: `Generated scenario ${n}`,
    tagline: `${h.short} · traffic ×${traffic}${windy ? ' · high wind' : ''}`,
    story: `Seeded scenario ${n}: ${h.name} raises a ${req.urgency} request. Traffic ×${traffic}${windy ? ', with winds above the drone limit' : ''}.`,
    config: {
      trafficMultiplier: traffic,
      weather: windy ? { windKmh: Math.round(rng.range(38, 55)), visibilityKm: 8, precip: 'light-rain' } : { windKmh: Math.round(rng.range(5, 28)), visibilityKm: 14, precip: 'none' },
    },
    request: req,
  };
}
