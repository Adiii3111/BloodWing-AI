// BLOODWING dispatch decision engine.
//
// Stage 1 — hard feasibility: inventory eligibility & compatibility, local reserve floors, payload,
//           range & battery reserve, weather, airspace, container hold time, vehicle availability.
//           Anything that fails is REJECTED with a reason. Hard constraints are never traded off.
// Stage 2 — candidate evaluation: ETA, deadline slack, robustness (+30% travel), cost,
//           inventory consequences, fleet impact.
// Stage 3 — optimisation: minimise a documented weighted sum of normalised terms
//           (weights depend on urgency) over the feasible set.
// Explanations are produced by deterministic templates from the numbers above — no language model.

import {
  COMPONENT_LABEL,
  COST_REF_USD,
  DRONE,
  GROUND,
  HOSPITAL_FLOOR,
  PACKAGING,
  ROBUST_TRAVEL_FACTOR,
  WEIGHTS,
} from './assumptions';
import { groupLabel, isUniversalDonor, recipientLabel } from './compatibility';
import { droneCost, energyPlan, groundCost, groundMinutes, payloadKg, unitsPerDrone, weatherCheck } from './fleet';
import { haversineKm, segmentIntersectsCircle } from './geo';
import { eligibleComponentUnits, eligibleLots, pickUnits, shortageDiagnosis, sumUnits } from './inventory';
import { siteById } from './network';
import type {
  Allocation,
  BloodRequest,
  Courier,
  Decision,
  Drone,
  Lot,
  Option,
  Policy,
  Rejection,
  RestrictedZone,
  ScoreTerms,
  Site,
  Urgency,
  Weather,
  Weights,
} from './types';

export interface DispatchContext {
  t: number;
  sites: Site[];
  lots: Lot[];
  drones: Drone[];
  couriers: Courier[];
  weather: Weather | null;
  trafficMultiplier: number;
  dronesEnabled: boolean;
  restrictedZones: RestrictedZone[];
  /** Expected RBC-equivalent units demanded per hospital over the next 6 h (ML forecast). */
  forecastUnits6h?: Record<string, number>;
  allowHospitalTransfers?: boolean;
  weightsOverride?: Partial<Record<Urgency, Weights>>;
}

const COMPONENT_SHARE = { RBC: 1, PLT: 0.18, PLASMA: 0.3 } as const;

/** P(X > k) for X ~ Poisson(lambda). */
export function poissonTail(lambda: number, k: number): number {
  if (k < 0) return 1;
  let term = Math.exp(-lambda);
  let cdf = term;
  for (let i = 1; i <= k; i++) {
    term *= lambda / i;
    cdf += term;
  }
  return Math.max(0, 1 - cdf);
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const UNIT_NOUN = { RBC: 'red-cell', PLT: 'platelet', PLASMA: 'plasma' } as const;

export function evaluateRequest(ctx: DispatchContext, req: BloodRequest, policy: Policy, decisionId: string): Decision {
  const dest = siteById(ctx.sites, req.hospitalId);
  const weights = ctx.weightsOverride?.[req.urgency] ?? WEIGHTS[req.urgency];
  const elapsed = ctx.t - req.createdAt;
  const remainingDeadline = Math.max(1, req.deadlineMin - elapsed);
  const options: Option[] = [];
  const rejected: Rejection[] = [];
  let reviewFlag = false;

  for (const source of ctx.sites) {
    if (source.id === dest.id) continue;
    const modes = source.dronesBased ? (['drone', 'ground'] as const) : (['ground'] as const);
    if (source.kind === 'hospital' && ctx.allowHospitalTransfers === false) {
      for (const mode of modes) rejected.push({ sourceId: source.id, mode, reasons: ['cross-hospital transfers disabled'] });
      continue;
    }
    const dist = haversineKm(source, dest);

    // ---- Stage 1a: inventory
    const ordered = eligibleLots(ctx.lots, source.id, req.component, req.recipientGroup, ctx.t);
    const compatAvail = sumUnits(ordered);
    const componentTotal = eligibleComponentUnits(ctx.lots, source.id, req.component, ctx.t);
    const floor = source.kind === 'hospital' ? HOSPITAL_FLOOR[req.component] : 0;
    const transferable = Math.max(0, Math.min(compatAvail, componentTotal - floor));
    if (transferable < req.units) {
      const reasons = [`${compatAvail} eligible compatible units, ${req.units} needed`];
      if (floor > 0 && compatAvail >= req.units) reasons[0] = `transfer would breach local floor of ${floor} units`;
      reasons.push(...shortageDiagnosis(ctx.lots, source.id, req.component, req.recipientGroup, ctx.t));
      for (const mode of modes) rejected.push({ sourceId: source.id, mode, reasons });
      continue;
    }
    const allocations = pickUnits(ordered, req.units)!;
    const inventoryTerm = inventoryRisk(ctx, req, source, allocations, transferable, componentTotal);

    // ---- drone option
    if (source.dronesBased) {
      const res = droneOption(ctx, req, source, dest, dist, allocations, inventoryTerm, remainingDeadline);
      if ('reasons' in res) {
        rejected.push({ sourceId: source.id, mode: 'drone', reasons: res.reasons });
        if (res.review) reviewFlag = true;
      } else options.push(res);
    }

    // ---- ground option
    const g = groundOption(ctx, req, source, dist, allocations, inventoryTerm, remainingDeadline);
    if ('reasons' in g) rejected.push({ sourceId: source.id, mode: 'ground', reasons: g.reasons });
    else options.push(g);
  }

  // ---- Stage 3: score and choose
  for (const o of options) o.score = score(o.terms, weights);
  options.sort((a, b) => a.score - b.score);

  const depotGround = options
    .filter((o) => o.mode === 'ground' && siteById(ctx.sites, o.sourceId).kind === 'depot')
    .sort((a, b) => a.distanceKm - b.distanceKm);
  const groundBaselineEta = depotGround.length ? depotGround[0].etaMin : null;

  let chosen: Option | undefined;
  if (policy === 'ai') chosen = options[0];
  else if (policy === 'ground-only') chosen = depotGround[0];
  else {
    // drone-first: nearest depot that can serve at all; drone if feasible there, otherwise ground.
    const depotOpts = options.filter((o) => siteById(ctx.sites, o.sourceId).kind === 'depot').sort((a, b) => a.distanceKm - b.distanceKm);
    const nearest = depotOpts[0]?.sourceId;
    chosen = depotOpts.find((o) => o.sourceId === nearest && o.mode === 'drone') ?? depotOpts.find((o) => o.sourceId === nearest);
  }

  const alternatives = options.filter((o) => o !== chosen);
  const status = !chosen ? 'no-feasible' : chosen.meetsDeadline ? 'dispatch' : 'dispatch-late';
  const humanReview = status !== 'dispatch' || (reviewFlag && !chosen);

  const decision: Decision = {
    id: decisionId,
    requestId: req.id,
    at: ctx.t,
    policy,
    status,
    chosen,
    alternatives,
    rejected,
    weights,
    explanation: [],
    groundBaselineEta,
    humanReview,
  };
  if (chosen) {
    const before = eligibleComponentUnits(ctx.lots, chosen.sourceId, req.component, ctx.t);
    decision.sourceBefore = before;
    decision.sourceAfter = before - req.units;
  }
  decision.explanation = explain(ctx, req, decision, remainingDeadline, reviewFlag);
  return decision;
}

function score(t: ScoreTerms, w: Weights): number {
  return w.delay * t.delay + w.lateness * t.lateness + w.cost * t.cost + w.inventory * t.inventory + w.operational * t.operational;
}

function inventoryRisk(ctx: DispatchContext, req: BloodRequest, source: Site, alloc: Allocation[], transferable: number, componentTotal: number): number {
  const depletion = req.units / Math.max(1, transferable);
  const universalUnits = alloc.filter((a) => isUniversalDonor(req.component, a.group)).reduce((s, a) => s + a.units, 0);
  const recipientIsUniversal = req.recipientGroup === 'UNKNOWN' || isUniversalDonor(req.component, req.recipientGroup);
  const universal = recipientIsUniversal ? 0 : universalUnits / req.units;
  let localRisk = 0;
  if (source.kind === 'hospital') {
    const expected = (ctx.forecastUnits6h?.[source.id] ?? 4) * COMPONENT_SHARE[req.component];
    localRisk = poissonTail(expected, componentTotal - req.units);
  }
  return Math.min(1, 0.45 * depletion + 0.3 * universal + 0.25 * localRisk);
}

type Built = Option | { reasons: string[]; review?: boolean };

function droneOption(
  ctx: DispatchContext,
  req: BloodRequest,
  source: Site,
  dest: Site,
  dist: number,
  allocations: Allocation[],
  inventoryTerm: number,
  deadline: number,
): Built {
  const reasons: string[] = [];
  let review = false;
  if (!ctx.dronesEnabled) return { reasons: ['drone transport disabled in this scenario'] };
  const wc = weatherCheck(ctx.weather);
  if (!wc.ok) {
    reasons.push(wc.reason!);
    review = !!wc.review;
  }
  for (const z of ctx.restrictedZones) {
    if (segmentIntersectsCircle(source, dest, z, z.radiusKm)) reasons.push(`straight-line route crosses ${z.name.toLowerCase()}`);
  }
  const fleet = ctx.drones.filter((d) => d.baseId === source.id);
  if (fleet.length === 0) return { reasons: ['no drones based here'] };
  const maxPayload = fleet[0].maxPayloadKg;
  const perDrone = unitsPerDrone(req.component, maxPayload);
  const n = perDrone > 0 ? Math.ceil(req.units / perDrone) : Infinity;
  if (n > DRONE.maxDronesPerRequest) {
    reasons.push(`${req.units} units need ${n} drones (payload ${perDrone}/drone); limit is ${DRONE.maxDronesPerRequest}`);
    return { reasons, review };
  }
  const load = payloadKg(req.component, Math.min(req.units, perDrone));
  const plan = energyPlan(fleet[0], dist, load, ctx.weather);
  if (plan.exceedsRange) {
    reasons.push(`round trip needs ${Math.round(plan.requiredPct)}% battery — beyond usable ${100 - DRONE.reservePct}% (range)`);
  }
  if (plan.outboundMin + DRONE.handoffMin > PACKAGING[req.component].holdMin) reasons.push('flight exceeds container hold time');

  const idle = fleet.filter((d) => d.status === 'idle');
  const usable = idle.filter((d) => d.battery - plan.requiredPct >= DRONE.reservePct).sort((a, b) => b.battery - a.battery);
  if (!plan.exceedsRange && usable.length < n) {
    if (idle.length < n) reasons.push(`${idle.length} of ${fleet.length} drones idle at ${source.short}; ${n} needed`);
    else {
      const need = Math.round(plan.requiredPct + DRONE.reservePct);
      const levels = idle.map((d) => `${Math.round(d.battery)}%`).join(', ');
      reasons.push(
        n === 1
          ? `battery too low: best ${Math.round(Math.max(...idle.map((d) => d.battery)))}%, mission needs ${need}% incl. reserve`
          : `battery too low: ${usable.length} of ${n} drones have the ${need}% needed incl. reserve (idle at ${levels})`,
      );
    }
  }
  if (reasons.length) return { reasons, review };

  const assigned = usable.slice(0, n);
  const minLeft = Math.min(...assigned.map((d) => d.battery - plan.requiredPct));
  const prep = DRONE.prepMin;
  const eta = prep + plan.outboundMin + DRONE.handoffMin;
  const robust = prep + plan.outboundMin * ROBUST_TRAVEL_FACTOR + DRONE.handoffMin;
  const cost = droneCost(dist, n);
  const operational = 0.5 * (n / fleet.length) + 0.5 * (1 - (minLeft - DRONE.reservePct) / (100 - DRONE.reservePct));
  const terms = makeTerms(eta, deadline, cost, inventoryTerm, operational);
  return {
    id: `${source.id}-drone`,
    sourceId: source.id,
    mode: 'drone',
    vehicleIds: assigned.map((d) => d.id),
    allocations,
    distanceKm: dist,
    prepMin: prep,
    travelMin: plan.outboundMin,
    handoffMin: DRONE.handoffMin,
    etaMin: eta,
    returnMin: plan.returnMin,
    costUsd: cost,
    batteryUsePct: plan.requiredPct,
    batteryLeftPct: minLeft,
    meetsDeadline: eta <= deadline,
    slackMin: deadline - eta,
    robustEtaMin: robust,
    terms,
    score: 0,
    notes: [`${n} drone${n > 1 ? 's' : ''} · ${load.toFixed(2)} kg max load · ${PACKAGING[req.component].container}`],
  };
}

function groundOption(
  ctx: DispatchContext,
  req: BloodRequest,
  source: Site,
  dist: number,
  allocations: Allocation[],
  inventoryTerm: number,
  deadline: number,
): Built {
  const reasons: string[] = [];
  const fleet = ctx.couriers.filter((c) => c.baseId === source.id);
  const idle = fleet.filter((c) => c.status === 'idle');
  if (idle.length === 0) reasons.push(`no idle courier at ${source.short} (${fleet.length} total)`);
  if (req.units > GROUND.capacityUnits) reasons.push(`exceeds courier capacity of ${GROUND.capacityUnits} units`);
  const travel = groundMinutes(dist, ctx.trafficMultiplier);
  if (travel + GROUND.handoffMin > PACKAGING[req.component].holdMin) reasons.push('drive exceeds container hold time');
  if (reasons.length) return { reasons };
  const eta = GROUND.prepMin + travel + GROUND.handoffMin;
  const robust = GROUND.prepMin + travel * ROBUST_TRAVEL_FACTOR + GROUND.handoffMin;
  const cost = groundCost(dist);
  const operational = 0.5 * (1 / fleet.length);
  return {
    id: `${source.id}-ground`,
    sourceId: source.id,
    mode: 'ground',
    vehicleIds: [idle[0].id],
    allocations,
    distanceKm: dist,
    prepMin: GROUND.prepMin,
    travelMin: travel,
    handoffMin: GROUND.handoffMin,
    etaMin: eta,
    returnMin: travel,
    costUsd: cost,
    meetsDeadline: eta <= deadline,
    slackMin: deadline - eta,
    robustEtaMin: robust,
    terms: makeTerms(eta, deadline, cost, inventoryTerm, operational),
    score: 0,
    notes: [`road ≈ ${r1(dist * GROUND.roadCircuity)} km · traffic ×${ctx.trafficMultiplier.toFixed(1)}`],
  };
}

function makeTerms(eta: number, deadline: number, cost: number, inventory: number, operational: number): ScoreTerms {
  return {
    delay: Math.min(2, eta / deadline),
    lateness: Math.min(2, Math.max(0, eta - deadline) / deadline),
    cost: Math.min(2, cost / COST_REF_USD),
    inventory,
    operational: Math.max(0, Math.min(1, operational)),
  };
}

// ------------------------------------------------------------------ explanations (templates)

function describe(ctx: DispatchContext, o: Option): string {
  const s = siteById(ctx.sites, o.sourceId);
  return `${s.short} by ${o.mode}`;
}

function explain(ctx: DispatchContext, req: BloodRequest, d: Decision, deadline: number, reviewFlag: boolean): string[] {
  const out: string[] = [];
  const dest = siteById(ctx.sites, req.hospitalId);
  const o = d.chosen;
  if (!o) {
    out.push(
      `No feasible dispatch for ${req.units} ${COMPONENT_LABEL[req.component].toLowerCase()} (${recipientLabel(req.recipientGroup)}) to ${dest.short}. The request stays queued and is re-evaluated every 2 minutes.`,
    );
    const counts = new Map<string, number>();
    for (const r of d.rejected) for (const reason of r.reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [reason, n] of top) out.push(`Blocking constraint: ${reason}${n > 1 ? ` (${n} options)` : ''}.`);
    out.push(reviewFlag ? 'Safety-critical data is missing — requires human review.' : 'Escalate to a human coordinator.');
    return out;
  }
  const src = siteById(ctx.sites, o.sourceId);
  const groups = [...new Set(o.allocations.map((a) => groupLabel(a.group)))].join(', ');
  const earliest = Math.min(...o.allocations.map((a) => a.expiresAt));
  const days = r1((earliest - ctx.t) / 1440);
  const policyName = d.policy === 'ai' ? '' : d.policy === 'ground-only' ? ' (baseline policy: nearest depot, ground only)' : ' (baseline policy: nearest depot, drone if feasible)';

  out.push(
    `${src.name} was selected${policyName}: it holds ${req.units} eligible ${UNIT_NOUN[req.component]} units (${groups}), and ${o.mode === 'drone' ? 'the drone mission is within operating limits' : 'a courier is available'}, arriving in ${r1(o.etaMin)} min against a ${Math.round(deadline)}-min deadline.`,
  );
  out.push(`Units picked compatible-first, then first-expiring-first-out — the earliest allocated unit expires in ${days} days.`);
  if (o.mode === 'drone') {
    out.push(
      `${o.vehicleIds.join(' + ')} need${o.vehicleIds.length > 1 ? '' : 's'} ${Math.round(o.batteryUsePct!)}% battery for the round trip, landing back with ${Math.round(o.batteryLeftPct!)}% (reserve ${DRONE.reservePct}%).`,
    );
  }
  const altGround = d.alternatives.filter((a) => a.mode === 'ground').sort((a, b) => a.etaMin - b.etaMin)[0];
  const altDrone = d.alternatives.filter((a) => a.mode === 'drone').sort((a, b) => a.etaMin - b.etaMin)[0];
  if (o.mode === 'drone' && altGround) {
    out.push(`Fastest ground alternative (${describe(ctx, altGround)}) would arrive in ${r1(altGround.etaMin)} min — ${r1(altGround.etaMin - o.etaMin)} min later.`);
  }
  if (o.mode === 'ground' && altDrone) {
    const diff = altDrone.etaMin - o.etaMin;
    out.push(
      diff < 0
        ? `A drone from ${siteById(ctx.sites, altDrone.sourceId).short} would be ${r1(-diff)} min faster, but scored worse on cost, inventory or fleet impact while the ground option still ${o.meetsDeadline ? 'meets' : 'is closest to'} the deadline.`
        : `The best drone option (${describe(ctx, altDrone)}) would arrive ${r1(diff)} min later.`,
    );
  }
  if (o.mode === 'ground' && !altDrone) {
    const droneRej = d.rejected.find((r) => r.mode === 'drone');
    if (droneRej) out.push(`No drone option was feasible — e.g. ${siteById(ctx.sites, droneRej.sourceId).short}: ${droneRej.reasons[0]}.`);
  }
  if (src.kind === 'hospital') {
    out.push(`Cross-hospital transfer keeps ${src.short} at ${d.sourceAfter} eligible units — at or above its ${HOSPITAL_FLOOR[req.component]}-unit local floor.`);
  }
  const universal = o.allocations.some((a) => isUniversalDonor(req.component, a.group));
  if (!universal && req.recipientGroup !== 'UNKNOWN' && req.component !== 'PLT') {
    out.push(`Universal-donor units (${req.component === 'RBC' ? 'O−' : 'AB'}) were not used, keeping them for unknown-group emergencies.`);
  }
  out.push(
    o.robustEtaMin <= deadline
      ? `Robustness: even if travel takes 30% longer, arrival (${r1(o.robustEtaMin)} min) stays within the deadline.`
      : `Robustness: if travel takes 30% longer, arrival slips to ${r1(o.robustEtaMin)} min — ${o.robustEtaMin > deadline ? 'past the deadline; monitor closely' : 'still on time'}.`,
  );
  if (!o.meetsDeadline) out.push('No option meets the deadline. This is the earliest feasible arrival — requires human review.');
  out.push(...commitments(ctx, req));
  return out;
}

/** Cross-system coordination: which existing commitments the decision respected. */
function commitments(ctx: DispatchContext, req: BloodRequest): string[] {
  const out: string[] = [];
  const held = ctx.lots.filter((l) => l.status === 'reserved' && l.reservedFor && l.units > 0 && l.component === req.component);
  const scheduled = held.filter((l) => l.reservedFor!.startsWith('APT-')).reduce((a, l) => a + l.units, 0);
  const patients = held.filter((l) => l.reservedFor!.startsWith('INC-')).reduce((a, l) => a + l.units, 0);
  if (scheduled + patients > 0) {
    const parts = [scheduled ? `${scheduled} reserved for scheduled transfusions (PULSE)` : '', patients ? `${patients} held for incident patients (SENTINEL)` : ''].filter(Boolean).join(' and ');
    out.push(`${req.component} units ${parts} were excluded — existing commitments are hard constraints.`);
  }
  const onRun = ctx.couriers.filter((c) => c.missionId?.startsWith('MR-'));
  if (onRun.length) out.push(`${onRun.map((c) => c.id).join(', ')} ${onRun.length > 1 ? 'are' : 'is'} committed to ORBIT milk runs and ${onRun.length > 1 ? 'were' : 'was'} not reassigned.`);
  return out;
}
