import { describe, expect, it } from 'vitest';
import { DRONE } from '../src/engine/assumptions';
import { compatibleGroups, isCompatible } from '../src/engine/compatibility';
import { evaluateRequest } from '../src/engine/dispatch';
import { energyPlan, unitsPerDrone, weatherCheck } from '../src/engine/fleet';
import { commitAllocations, eligibleLots, isDispatchable } from '../src/engine/inventory';
import { DOWNTOWN_TFR } from '../src/engine/network';
import { buildScenario, runScenarioRequest, SCENARIOS } from '../src/engine/scenarios';
import { advance, computeMetrics, createSimulation, dispatchContext, submitRequest } from '../src/engine/simulation';
import { runLabSync, DEFAULT_LAB } from '../src/engine/experiment';
import { trainForecast } from '../src/engine/forecast';
import type { BloodRequest, SimState } from '../src/engine/types';

const req = (over: Partial<BloodRequest> = {}): BloodRequest => ({
  id: 'T1',
  hospitalId: 'MGH',
  component: 'RBC',
  recipientGroup: 'A+',
  units: 2,
  urgency: 'urgent',
  createdAt: 0,
  deadlineMin: 60,
  status: 'queued',
  attempts: 0,
  ...over,
});

const totalUnits = (s: SimState) => s.lots.reduce((a, l) => a + l.units, 0);

describe('compatibility rules', () => {
  it('RBC follows ABO/RhD; unknown group gets O− only', () => {
    expect(compatibleGroups('RBC', 'UNKNOWN')).toEqual(['O-']);
    expect(compatibleGroups('RBC', 'O-')).toEqual(['O-']);
    expect(compatibleGroups('RBC', 'AB+')).toHaveLength(8);
    expect(isCompatible('RBC', 'A-', 'A+')).toBe(false);
    expect(isCompatible('RBC', 'B+', 'A+')).toBe(false);
  });
  it('plasma uses reverse ABO compatibility, not red-cell rules', () => {
    expect(isCompatible('PLASMA', 'O+', 'AB-')).toBe(true);
    expect(isCompatible('PLASMA', 'AB+', 'O+')).toBe(false);
    expect(compatibleGroups('PLASMA', 'UNKNOWN').every((g) => g.startsWith('AB'))).toBe(true);
  });
  it('platelets: any ABO, RhD-negative recipients restricted to RhD-negative', () => {
    expect(isCompatible('PLT', 'O+', 'AB+')).toBe(true);
    expect(isCompatible('PLT', 'A-', 'A+')).toBe(false);
  });
});

describe('flight model', () => {
  it('payload limits units per drone', () => {
    expect(unitsPerDrone('RBC')).toBe(4);
    expect(unitsPerDrone('PLASMA')).toBe(3);
  });
  it('weather limits ground the fleet; missing data requires review', () => {
    expect(weatherCheck({ windKmh: 50, visibilityKm: 10, precip: 'none' }).ok).toBe(false);
    expect(weatherCheck({ windKmh: 10, visibilityKm: 10, precip: 'thunderstorm' }).ok).toBe(false);
    expect(weatherCheck(null)).toMatchObject({ ok: false, review: true });
  });
  it('long missions exceed range', () => {
    const plan = energyPlan({ cruiseKmh: 80, rangeKm: 36, maxPayloadKg: 2 }, 20, 2, null);
    expect(plan.exceedsRange).toBe(true);
  });
});

describe('dispatch engine', () => {
  it('never selects ineligible lots (expired, quarantined, reserved, incompatible)', () => {
    const s = createSimulation();
    const d = evaluateRequest(dispatchContext(s), req({ recipientGroup: 'B-', units: 2 }), 'ai', 'D');
    for (const o of [d.chosen!, ...d.alternatives]) {
      for (const a of o.allocations) {
        const lot = s.lots.find((l) => l.id === a.lotId)!;
        expect(isDispatchable(lot, 0)).toBe(true);
        expect(isCompatible('RBC', 'B-', lot.group)).toBe(true);
      }
    }
  });

  it('rejects sources with insufficient inventory and reports why', () => {
    const s = buildScenario(SCENARIOS.find((x) => x.id === 'shortage')!);
    const d = evaluateRequest(dispatchContext(s), req({ hospitalId: 'TMC', recipientGroup: 'B-', units: 3 }), 'ai', 'D');
    const alpha = d.rejected.filter((r) => r.sourceId === 'DA');
    expect(alpha.length).toBeGreaterThan(0);
    expect(alpha[0].reasons.join(' ')).toMatch(/eligible compatible units/);
    expect(d.chosen?.sourceId).not.toBe('DA');
  });

  it('no feasible option when nothing compatible exists anywhere', () => {
    const s = createSimulation();
    for (const l of s.lots) if (l.component === 'RBC' && l.group === 'O-') l.status = 'quarantine';
    const d = evaluateRequest(dispatchContext(s), req({ recipientGroup: 'UNKNOWN', units: 4, urgency: 'critical', deadlineMin: 30 }), 'ai', 'D');
    expect(d.status).toBe('no-feasible');
    expect(d.chosen).toBeUndefined();
    expect(d.humanReview).toBe(true);
  });

  it('weather restriction removes every drone option → ground fallback', () => {
    const s = createSimulation({ config: { weather: { windKmh: 60, visibilityKm: 10, precip: 'none' } } });
    const d = evaluateRequest(dispatchContext(s), req(), 'ai', 'D');
    expect(d.chosen?.mode).toBe('ground');
    expect(d.alternatives.every((o) => o.mode === 'ground')).toBe(true);
    expect(d.rejected.filter((r) => r.mode === 'drone').every((r) => r.reasons.some((x) => x.includes('wind')))).toBe(true);
  });

  it('missing weather data → drones need human review, not assumed safe', () => {
    const s = createSimulation({ config: { weather: null } });
    const d = evaluateRequest(dispatchContext(s), req(), 'ai', 'D');
    expect(d.chosen?.mode).toBe('ground');
    expect(d.rejected.some((r) => r.reasons.some((x) => x.includes('human review')))).toBe(true);
  });

  it('depleted batteries make a drone infeasible', () => {
    const s = createSimulation();
    for (const d of s.drones) d.battery = 30;
    const d = evaluateRequest(dispatchContext(s), req(), 'ai', 'D');
    expect(d.chosen?.mode).toBe('ground');
    expect(d.rejected.some((r) => r.mode === 'drone' && r.reasons.some((x) => x.includes('battery too low')))).toBe(true);
  });

  it('restricted airspace blocks straight-line routes that cross it', () => {
    const s = createSimulation({ config: { restrictedZones: [DOWNTOWN_TFR] } });
    const d = evaluateRequest(dispatchContext(s), req({ hospitalId: 'MGH' }), 'ai', 'D');
    expect(d.rejected.some((r) => r.mode === 'drone' && r.sourceId === 'DA' && r.reasons.some((x) => x.includes('crosses')))).toBe(true);
  });

  it('hospital transfers respect the local reserve floor', () => {
    const s = createSimulation();
    const d = evaluateRequest(dispatchContext(s), req({ units: 2 }), 'ai', 'D');
    for (const o of [d.chosen!, ...d.alternatives]) {
      const site = s.sites.find((x) => x.id === o.sourceId)!;
      if (site.kind !== 'hospital') continue;
      const total = s.lots.filter((l) => l.siteId === site.id && l.component === 'RBC' && isDispatchable(l, 0)).reduce((a, l) => a + l.units, 0);
      expect(total - 2).toBeGreaterThanOrEqual(8);
    }
  });

  it('picks compatible-first then first-expiring-first-out', () => {
    const s = createSimulation();
    const lots = eligibleLots(s.lots, 'DA', 'RBC', 'A+', 0);
    const aPlus = lots.filter((l) => l.group === 'A+');
    for (let i = 1; i < aPlus.length; i++) expect(aPlus[i].expiresAt).toBeGreaterThanOrEqual(aPlus[i - 1].expiresAt);
    expect(lots[0].group).toBe('A+');
  });
});

describe('simulation integrity', () => {
  it('inventory never goes negative and commits are atomic', () => {
    const s = createSimulation();
    const lot = s.lots.find((l) => isDispatchable(l, 0))!;
    expect(() => commitAllocations(s.lots, [{ lotId: lot.id, group: lot.group, units: lot.units + 1, expiresAt: lot.expiresAt }], 0)).toThrow();
    expect(lot.units).toBeGreaterThan(0);
  });

  it('dispatch deducts exactly the allocated units', () => {
    const s = createSimulation();
    const before = totalUnits(s);
    const r = submitRequest(s, { hospitalId: 'BMC', component: 'RBC', recipientGroup: 'O+', units: 3, urgency: 'urgent' });
    expect(r.status).toBe('dispatched');
    expect(totalUnits(s)).toBe(before - 3);
  });

  it('no vehicle is ever double-allocated under concurrent requests', () => {
    const s = createSimulation({ config: { ambientPerHour: 30 } });
    for (let i = 0; i < 12; i++) {
      submitRequest(s, { hospitalId: ['MGH', 'BMC', 'TMC', 'BWH'][i % 4], component: 'RBC', recipientGroup: 'O+', units: 2, urgency: 'critical' });
      advance(s, 1);
      const active = s.missions.filter((m) => m.phase !== 'complete');
      const ids = active.flatMap((m) => m.vehicleIds);
      expect(new Set(ids).size).toBe(ids.length);
    }
    advance(s, 240);
    expect(s.lots.every((l) => l.units >= 0)).toBe(true);
    expect(s.drones.every((d) => d.battery >= 0 && d.battery <= 100)).toBe(true);
  });

  it('missions complete, vehicles return, request is delivered', () => {
    const s = createSimulation();
    const r = submitRequest(s, { hospitalId: 'MGH', component: 'RBC', recipientGroup: 'UNKNOWN', units: 4, urgency: 'critical', deadlineMin: 25 });
    advance(s, 90);
    expect(r.status).toBe('delivered');
    expect(s.missions[0].phase).toBe('complete');
    expect(s.drones.every((d) => d.status === 'idle' || d.status === 'maintenance')).toBe(true);
    const m = computeMetrics(s);
    expect(m.delivered).toBe(1);
    expect(m.onTimeRate).toBe(1);
  });

  it('is reproducible for a fixed seed', () => {
    const run = () => {
      const s = createSimulation({ config: { seed: 99, ambientPerHour: 6 } });
      advance(s, 300);
      return JSON.stringify({ r: s.requests, m: s.missions.map((m) => [m.id, m.sourceId, m.mode, m.arriveAt]) });
    };
    expect(run()).toBe(run());
  });
});

describe('prepared scenarios produce coherent outcomes', () => {
  const outcome = (id: string) => {
    const def = SCENARIOS.find((x) => x.id === id)!;
    const s = buildScenario(def);
    runScenarioRequest(s, def);
    return s.decisions[0];
  };
  it('A critical: dispatches O− only, within deadline', () => {
    const d = outcome('critical');
    expect(d.status).toBe('dispatch');
    expect(d.chosen!.allocations.every((a) => a.group === 'O-')).toBe(true);
  });
  it('B traffic: drone beats the delayed ground alternative', () => {
    const d = outcome('traffic');
    expect(d.chosen!.mode).toBe('drone');
    expect(d.groundBaselineEta!).toBeGreaterThan(d.chosen!.etaMin);
  });
  it('C grounded: no drone chosen, rejections cite wind', () => {
    const d = outcome('grounded');
    expect(d.chosen!.mode).toBe('ground');
    expect(d.rejected.some((r) => r.reasons.some((x) => x.includes('wind')))).toBe(true);
  });
  it('D shortage: nearest depot rejected, another source serves', () => {
    const d = outcome('shortage');
    expect(d.chosen!.sourceId).not.toBe('DA');
    expect(d.status).toBe('dispatch');
  });
});

describe('experiment + ML', () => {
  it('lab runs all policies on the same demand stream', () => {
    const r = runLabSync({ ...DEFAULT_LAB, replications: 2, horizonHours: 8 });
    const counts = r.runs.map((x) => `${x.rep}:${x.requests}`);
    expect(counts.filter((c) => c.startsWith('0:')).every((c) => c === counts[0])).toBe(true);
    expect(r.runs.every((x) => x.unfulfilled >= 0)).toBe(true);
  });
  it('forecast model trains and beats the global-mean baseline on held-out data', () => {
    const m = trainForecast(60, 15, 150);
    expect(m.metrics.mae).toBeLessThan(m.metrics.maeGlobalMean);
    expect(Number.isFinite(m.metrics.devianceRatio)).toBe(true);
  });
});

it('drone reserve constant is sane', () => {
  expect(DRONE.reservePct).toBeGreaterThan(0);
});
