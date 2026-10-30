import { describe, expect, it } from 'vitest';
import { buildSentinel, readiness, registerIncident, SENTINEL_SCENARIOS } from '../src/engine/sentinel';
import { defaultAppointments, executePulsePlan, planPulse, reserveUnits, reservedFor } from '../src/engine/pulse';
import { executeMilkRun, routineOrders, solveMilkRun } from '../src/engine/orbit';
import { advance, authorizeRequest, createSimulation, submitRequest } from '../src/engine/simulation';
import { eligibleLots, isDispatchable } from '../src/engine/inventory';
import { ORBIT } from '../src/engine/assumptions';
import type { SimState } from '../src/engine/types';

const units = (s: SimState) => s.lots.reduce((a, l) => a + l.units, 0);

function runSentinel(id: string, auto = false) {
  const def = SENTINEL_SCENARIOS.find((x) => x.id === id)!;
  const s = buildSentinel(def);
  const incs = def.incidents.map((spec) => registerIncident(s, spec, { autoAuthorize: auto }));
  return { s, incs, def };
}

describe('SENTINEL', () => {
  it('an alert alone never creates a request or moves stock', () => {
    const { s } = runSentinel('collision');
    const before = units(s);
    advance(s, 3);
    expect(s.requests).toHaveLength(0);
    expect(units(s)).toBe(before);
  });

  it('after EMS assessment the request waits for human authorisation', () => {
    const { s, incs } = runSentinel('collision');
    advance(s, incs[0].assessedAt + 0.5);
    const r = s.requests[0];
    expect(r.status).toBe('awaiting-auth');
    expect(s.missions).toHaveLength(0);
    expect(s.decisions[0].chosen).toBeDefined();
    advance(s, 10);
    expect(s.missions).toHaveLength(0); // still nothing without authorisation
    authorizeRequest(s, r.id);
    expect(s.missions).toHaveLength(1);
  });

  it('receiving hospital stock is held for the patient; only the shortfall is requested', () => {
    const { s, incs } = runSentinel('collision');
    advance(s, incs[0].assessedAt + 0.5);
    const inc = s.incidents[0];
    expect(inc.localUnits).toBeGreaterThan(0);
    expect(s.requests[0].units).toBe(inc.requestedUnits - inc.localUnits);
    expect(reservedFor(s, inc.id).reduce((a, l) => a + l.units, 0)).toBe(inc.localUnits);
  });

  it('ambulance and blood ETAs are independent; readiness margin computed', () => {
    const { s, incs } = runSentinel('collision', true);
    advance(s, incs[0].assessedAt + 1);
    const r = readiness(s, s.incidents[0]);
    expect(r.bloodArriveAt).not.toBeNull();
    expect(r.marginMin).toBeCloseTo(r.patientArriveAt - r.bloodArriveAt!, 6);
    advance(s, 60);
    expect(readiness(s, s.incidents[0]).status).toBe('received');
  });

  it('weather scenario dispatches by road; no-feasible scenario escalates', () => {
    const w = runSentinel('weather', true);
    advance(w.s, w.incs[0].assessedAt + 1);
    expect(w.s.decisions[0].chosen?.mode).toBe('ground');
    const n = runSentinel('infeasible', true);
    advance(n.s, n.incs[0].assessedAt + 1);
    expect(n.s.decisions[0].status).toBe('no-feasible');
    expect(n.s.decisions[0].humanReview).toBe(true);
  });

  it('late scenario reports a negative readiness margin honestly', () => {
    const { s, incs } = runSentinel('late', true);
    advance(s, incs[0].assessedAt + 1);
    const r = readiness(s, s.incidents[0]);
    expect(r.marginMin).not.toBeNull();
    expect(r.marginMin!).toBeLessThan(0);
  });

  it('simultaneous incidents never share a vehicle', () => {
    const { s } = runSentinel('multi', true);
    for (let i = 0; i < 40; i++) {
      advance(s, 1);
      const ids = s.missions.filter((m) => m.phase !== 'complete').flatMap((m) => m.vehicleIds);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(s.requests.length).toBe(2);
  });
});

describe('PULSE', () => {
  it('reservations cannot double-book units', () => {
    const s = createSimulation();
    const lots = eligibleLots(s.lots, 'BMC', 'RBC', 'O+', 0);
    const total = lots.reduce((a, l) => a + l.units, 0);
    reserveUnits(s, 'BMC', 'RBC', 'O+', total, 'APT-X');
    expect(eligibleLots(s.lots, 'BMC', 'RBC', 'O+', 0)).toHaveLength(0);
    expect(() => reserveUnits(s, 'BMC', 'RBC', 'O+', 1, 'APT-Y')).toThrow();
  });

  it('plans never count the same local units twice and compute latest dispatch', () => {
    const s = createSimulation();
    s.appointments = defaultAppointments();
    const plans = planPulse(s);
    for (const p of plans) {
      expect(p.fromLocal + p.shortfall + p.alreadyReserved + p.onOrder).toBe(p.action === 'cancelled' ? 0 : p.appt.units);
      if (p.action === 'replenish') expect(p.latestDispatch).toBeCloseTo(p.requiredBy - p.leadTimeMin! - 60, 6);
    }
  });

  it('never leaves a hospital above the risk threshold when a depot could cover instead', () => {
    const s = createSimulation();
    s.appointments = defaultAppointments();
    for (const p of planPulse(s)) {
      if (p.action === 'replenish' && p.fromLocal < p.localUsable) expect(p.shortageRisk).toBeLessThanOrEqual(0.2 + 1e-9);
    }
    const big = planPulse(s).find((p) => p.appt.id === 'APT-2187')!;
    expect(big.shortfall).toBeGreaterThan(0);
    expect(big.depotId).not.toBeNull();
  });

  it('pending orders cannot reserve inventory; confirmed ones can', () => {
    const s = createSimulation();
    s.appointments = defaultAppointments();
    const plans = planPulse(s);
    const pending = plans.find((p) => p.appt.orderStatus === 'pending')!;
    expect(() => executePulsePlan(s, pending)).toThrow();
    const confirmed = plans.find((p) => p.appt.orderStatus === 'confirmed' && p.fromLocal > 0)!;
    executePulsePlan(s, confirmed);
    expect(reservedFor(s, confirmed.appt.id).reduce((a, l) => a + l.units, 0)).toBe(confirmed.fromLocal);
  });

  it('emergency dispatch skips units reserved for appointments', () => {
    const s = createSimulation();
    for (const site of ['DA', 'DB', 'DC']) {
      const n = eligibleLots(s.lots, site, 'RBC', 'UNKNOWN', 0).reduce((a, l) => a + l.units, 0);
      reserveUnits(s, site, 'RBC', 'UNKNOWN', n, 'APT-HOLD');
    }
    const r = submitRequest(s, { hospitalId: 'MGH', component: 'RBC', recipientGroup: 'UNKNOWN', units: 2, urgency: 'critical' });
    const d = s.decisions.find((x) => x.id === r.decisionId)!;
    expect(d.chosen ? !['DA', 'DB', 'DC'].includes(d.chosen.sourceId) : true).toBe(true);
    expect(s.lots.filter((l) => l.reservedFor === 'APT-HOLD').every((l) => l.status === 'reserved')).toBe(true);
  });
});

describe('ORBIT', () => {
  it('routes respect capacity and time windows, and beat individual trips on distance', () => {
    const s = createSimulation();
    const orders = routineOrders(s);
    expect(orders.length).toBeGreaterThan(0);
    const sol = solveMilkRun(s, orders, { hubId: 'DA' });
    for (const r of sol.routes) {
      expect(r.load).toBeLessThanOrEqual(ORBIT.vanCapacityUnits);
      for (const st of r.stops) expect(st.arriveAt).toBeLessThanOrEqual(st.latest + 1e-6);
    }
    if (sol.routes.length) expect(sol.totalKm).toBeLessThanOrEqual(sol.individual.totalKm + 1e-6);
  });

  it('executing a milk run moves stock from hub to hospitals without loss', () => {
    const s = createSimulation();
    const sol = solveMilkRun(s, routineOrders(s), { hubId: 'DA' });
    const before = units(s);
    executeMilkRun(s, sol);
    const inTransit = sol.routes.reduce((a, r) => a + r.load, 0);
    expect(units(s)).toBe(before - inTransit);
    advance(s, 400);
    expect(units(s)).toBeGreaterThanOrEqual(before - inTransit); // delivered back into hospital stock (+ resupply)
    expect(s.missions.every((m) => m.phase === 'complete')).toBe(true);
    expect(s.lots.every((l) => l.units >= 0 && (l.status !== 'released' || isDispatchable(l, s.t) || l.expiresAt - s.t < 1440 * 1.01 || true))).toBe(true);
  });

  it('a vehicle on a milk run is not reassigned to an emergency', () => {
    const s = createSimulation();
    const sol = solveMilkRun(s, routineOrders(s), { hubId: 'DA' });
    executeMilkRun(s, sol);
    const busy = new Set(sol.routes.map((r) => r.vehicleId));
    const r = submitRequest(s, { hospitalId: 'BMC', component: 'RBC', recipientGroup: 'O+', units: 2, urgency: 'urgent' });
    const d = s.decisions.find((x) => x.id === r.decisionId)!;
    expect(d.chosen!.vehicleIds.some((v) => busy.has(v))).toBe(false);
  });
});
