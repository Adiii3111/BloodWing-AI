// Optimisation laboratory: compares three dispatch policies on IDENTICAL seeded demand and
// IDENTICAL initial inventory (common random numbers), over several replications.
//
//   A  ground-only   nearest depot with eligible stock, courier only (conventional baseline)
//   B  drone-first   nearest depot with eligible stock, drone whenever feasible, else courier
//   C  ai            BLOODWING multimodal engine: every depot and hospital, drone or ground,
//                    chosen by the weighted objective under hard constraints

import { DEFAULT_DEADLINE, WEIGHTS } from './assumptions';
import { DOWNTOWN_TFR, HOSPITALS, LOGAN_ZONE } from './network';
import { Rng } from './rng';
import { advance, CLEAR_WEATHER, computeMetrics, createSimulation, percentile, randomRequest, scheduleRequests } from './simulation';
import type { Policy, ScheduledRequest, SimConfig, Weather, Weights } from './types';

export interface LabParams {
  demandPerHour: number;
  variability: 'low' | 'medium' | 'high';
  dronesPerDepot: number;
  droneSpeedKmh: number;
  droneRangeKm: number;
  dronePayloadKg: number;
  groundDelay: number;
  flyableShare: number; // fraction of hours with flyable weather
  inventory: 'balanced' | 'depot-heavy' | 'hospital-heavy';
  priority: 'balanced' | 'speed' | 'cost';
  airspaceTfr: boolean;
  horizonHours: number;
  replications: number;
  seed: number;
}

export const DEFAULT_LAB: LabParams = {
  demandPerHour: 1.6,
  variability: 'medium',
  dronesPerDepot: 2,
  droneSpeedKmh: 80,
  droneRangeKm: 36,
  dronePayloadKg: 2,
  groundDelay: 1.4,
  flyableShare: 0.8,
  inventory: 'balanced',
  priority: 'balanced',
  airspaceTfr: false,
  horizonHours: 24,
  replications: 8,
  seed: 11,
};

export const POLICIES: { id: Policy; code: string; name: string; short: string }[] = [
  { id: 'ground-only', code: 'A', name: 'Baseline A — Ground only', short: 'Ground only' },
  { id: 'drone-first', code: 'B', name: 'Scenario B — Drone available', short: 'Drone available' },
  { id: 'ai', code: 'C', name: 'Scenario C — AI multimodal', short: 'AI multimodal' },
];

export interface RunResult {
  policy: Policy;
  rep: number;
  requests: number;
  delivered: number;
  unfulfilled: number;
  avgMin: number;
  p90Min: number;
  onTimeRate: number;
  droneUtil: number;
  groundUtil: number;
  costUsd: number;
  expiredUnits: number;
  droneShare: number;
  transferShare: number;
  responseTimes: number[];
}

function demandStream(p: LabParams, rep: number): ScheduledRequest[] {
  const rng = new Rng(p.seed * 1009 + rep * 7);
  const horizon = p.horizonHours * 60;
  const out: ScheduledRequest[] = [];
  const surgeP = { low: 0, medium: 0.04, high: 0.1 }[p.variability];
  const weights: Record<string, number> = {};
  for (const h of HOSPITALS) weights[h.id] = 0.6 + rng.next();
  for (let m = 0; m < horizon; m++) {
    const hour = (14 + Math.floor(m / 60)) % 24;
    const diurnal = 0.6 + 0.55 * Math.exp(-((hour - 12) ** 2) / 20) + 0.3 * Math.exp(-((hour - 20) ** 2) / 8);
    let k = rng.poisson((p.demandPerHour * diurnal) / 60);
    if (rng.next() < surgeP / 60) k += rng.int(2, 4);
    for (let i = 0; i < k; i++) {
      const r = randomRequest(rng, weights);
      out.push({ at: m + 0.5, ...r, deadlineMin: DEFAULT_DEADLINE[r.urgency] });
    }
  }
  return out;
}

function weatherWindows(p: LabParams, rep: number): { start: number; end: number; weather: Weather }[] {
  const rng = new Rng(p.seed * 31 + rep * 101);
  const out: { start: number; end: number; weather: Weather }[] = [];
  for (let h = 0; h < p.horizonHours + 4; h++) {
    if (rng.next() > p.flyableShare) out.push({ start: h * 60, end: (h + 1) * 60, weather: { windKmh: Math.round(rng.range(38, 55)), visibilityKm: 6, precip: 'light-rain' } });
  }
  return out;
}

function priorityWeights(p: LabParams['priority']): SimConfig['weightsOverride'] {
  if (p === 'balanced') return undefined;
  const scale = (w: Weights, k: keyof Weights, f: number): Weights => {
    const out = { ...w, [k]: w[k] * f };
    const s = Object.values(out).reduce((a, b) => a + b, 0);
    return Object.fromEntries(Object.entries(out).map(([kk, v]) => [kk, v / s])) as unknown as Weights;
  };
  const key: keyof Weights = p === 'speed' ? 'delay' : 'cost';
  return { critical: scale(WEIGHTS.critical, key, 2.5), urgent: scale(WEIGHTS.urgent, key, 2.5), routine: scale(WEIGHTS.routine, key, 2.5) };
}

export function runOne(p: LabParams, policy: Policy, rep: number): RunResult {
  const s = createSimulation({
    config: {
      seed: p.seed + rep,
      policy,
      trafficMultiplier: p.groundDelay,
      weather: CLEAR_WEATHER,
      weatherWindows: weatherWindows(p, rep),
      dronesEnabled: policy !== 'ground-only' && p.dronesPerDepot > 0,
      restrictedZones: p.airspaceTfr ? [LOGAN_ZONE, DOWNTOWN_TFR] : [LOGAN_ZONE],
      ambientPerHour: 0,
      weightsOverride: priorityWeights(p.priority),
    },
    fleet: {
      dronesPerDepot: { DA: p.dronesPerDepot, DB: p.dronesPerDepot, DC: p.dronesPerDepot },
      cruiseKmh: p.droneSpeedKmh,
      rangeKm: p.droneRangeKm,
      maxPayloadKg: p.dronePayloadKg,
    },
  });
  // Inventory distribution variants shift stock between echelons (same seed → same lots).
  if (p.inventory !== 'balanced') {
    for (const l of s.lots) {
      const hospital = s.sites.find((x) => x.id === l.siteId)!.kind === 'hospital';
      if (p.inventory === 'depot-heavy' && hospital) l.units = Math.max(0, Math.round(l.units * 0.6));
      if (p.inventory === 'hospital-heavy' && hospital) l.units = Math.round(l.units * 1.6);
      if (p.inventory === 'hospital-heavy' && !hospital) l.units = Math.max(0, Math.round(l.units * 0.7));
    }
  }
  const stream = demandStream(p, rep);
  scheduleRequests(s, stream);
  advance(s, p.horizonHours * 60 + 120);
  const m = computeMetrics(s);
  const delivered = s.requests.filter((r) => r.status === 'delivered');
  const times = delivered.map((r) => r.deliveredAt! - r.createdAt);
  let transfers = 0;
  for (const r of delivered) {
    const d = s.decisions.find((x) => x.id === r.decisionId);
    if (d?.chosen && s.sites.find((x) => x.id === d.chosen!.sourceId)!.kind === 'hospital') transfers++;
  }
  const closed = delivered.length + m.unfulfilled;
  return {
    policy,
    rep,
    requests: s.requests.length,
    delivered: delivered.length,
    unfulfilled: m.unfulfilled + s.requests.filter((r) => r.status === 'queued').length,
    avgMin: times.length ? times.reduce((a, b) => a + b, 0) / times.length : NaN,
    p90Min: percentile(times, 0.9) ?? NaN,
    onTimeRate: closed ? s.missions.filter((x) => x.onTime).length / closed : NaN,
    droneUtil: m.droneUtilization,
    groundUtil: m.groundUtilization,
    costUsd: m.costUsd,
    expiredUnits: m.expiredUnits,
    droneShare: m.droneShare ?? 0,
    transferShare: delivered.length ? transfers / delivered.length : 0,
    responseTimes: times,
  };
}

const T_975: Record<number, number> = { 1: 12.71, 2: 4.3, 3: 3.18, 4: 2.78, 5: 2.57, 6: 2.45, 7: 2.36, 8: 2.31, 9: 2.26, 10: 2.23, 11: 2.2, 12: 2.18, 14: 2.16, 19: 2.09, 29: 2.05 };
function tCrit(df: number): number {
  if (df <= 0) return NaN;
  const keys = Object.keys(T_975).map(Number).sort((a, b) => a - b);
  for (const k of keys) if (df <= k) return T_975[k];
  return 1.96;
}

export interface Summary {
  mean: number;
  lo: number;
  hi: number;
}

export function meanCI(xs: number[]): Summary {
  const v = xs.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (!n) return { mean: NaN, lo: NaN, hi: NaN };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, lo: mean, hi: mean };
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  const h = (tCrit(n - 1) * sd) / Math.sqrt(n);
  return { mean, lo: mean - h, hi: mean + h };
}

export type MetricKey = 'avgMin' | 'p90Min' | 'onTimeRate' | 'unfulfilled' | 'droneUtil' | 'groundUtil' | 'costUsd' | 'expiredUnits';

export const METRICS: { key: MetricKey; label: string; unit: string; better: 'lower' | 'higher' | 'none'; fmt: (x: number) => string }[] = [
  { key: 'avgMin', label: 'Mean delivery time', unit: 'min', better: 'lower', fmt: (x) => x.toFixed(1) },
  { key: 'p90Min', label: '90th percentile delivery time', unit: 'min', better: 'lower', fmt: (x) => x.toFixed(1) },
  { key: 'onTimeRate', label: 'Deadline fulfilment rate', unit: '%', better: 'higher', fmt: (x) => (x * 100).toFixed(1) },
  { key: 'unfulfilled', label: 'Unfulfilled requests', unit: 'per run', better: 'lower', fmt: (x) => x.toFixed(2) },
  { key: 'droneUtil', label: 'Drone utilisation', unit: '%', better: 'none', fmt: (x) => (x * 100).toFixed(1) },
  { key: 'groundUtil', label: 'Ground vehicle utilisation', unit: '%', better: 'none', fmt: (x) => (x * 100).toFixed(1) },
  { key: 'costUsd', label: 'Transport cost (synthetic)', unit: 'USD per run', better: 'lower', fmt: (x) => x.toFixed(0) },
  { key: 'expiredUnits', label: 'Units expired in horizon', unit: 'units', better: 'lower', fmt: (x) => x.toFixed(1) },
];

export interface LabResult {
  params: LabParams;
  runs: RunResult[];
  summary: Record<Policy, Record<MetricKey, Summary>>;
  /** Paired differences C − A per replication (common random numbers). */
  pairedVsA: Record<Policy, Record<MetricKey, Summary>>;
  ms: number;
}

export function summarise(params: LabParams, runs: RunResult[], ms: number): LabResult {
  const summary = {} as LabResult['summary'];
  const paired = {} as LabResult['pairedVsA'];
  for (const pol of POLICIES) {
    summary[pol.id] = {} as Record<MetricKey, Summary>;
    paired[pol.id] = {} as Record<MetricKey, Summary>;
    const mine = runs.filter((r) => r.policy === pol.id).sort((a, b) => a.rep - b.rep);
    const base = runs.filter((r) => r.policy === 'ground-only').sort((a, b) => a.rep - b.rep);
    for (const m of METRICS) {
      const ci = meanCI(mine.map((r) => r[m.key]));
      // Rates live in [0, 1]; a normal-approximation interval must not leave that range.
      if (m.unit === '%') summary[pol.id][m.key] = { mean: ci.mean, lo: Math.max(0, ci.lo), hi: Math.min(1, ci.hi) };
      else summary[pol.id][m.key] = { mean: ci.mean, lo: m.key === 'unfulfilled' || m.key === 'expiredUnits' || m.key === 'costUsd' ? Math.max(0, ci.lo) : ci.lo, hi: ci.hi };
      paired[pol.id][m.key] = meanCI(mine.map((r, i) => r[m.key] - base[i][m.key]));
    }
  }
  return { params, runs, summary, pairedVsA: paired, ms };
}

/** Runs all policies × replications, yielding to the UI between runs. */
export async function runLab(p: LabParams, onProgress?: (done: number, total: number) => void): Promise<LabResult> {
  const t0 = performance.now();
  const runs: RunResult[] = [];
  const total = p.replications * POLICIES.length;
  let done = 0;
  for (let rep = 0; rep < p.replications; rep++) {
    for (const pol of POLICIES) {
      runs.push(runOne(p, pol.id, rep));
      done++;
      onProgress?.(done, total);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return summarise(p, runs, performance.now() - t0);
}

export function runLabSync(p: LabParams): LabResult {
  const runs: RunResult[] = [];
  for (let rep = 0; rep < p.replications; rep++) for (const pol of POLICIES) runs.push(runOne(p, pol.id, rep));
  return summarise(p, runs, 0);
}

export function toCSV(r: LabResult): string {
  const head = ['policy', 'replication', 'requests', 'delivered', 'unfulfilled', 'mean_delivery_min', 'p90_delivery_min', 'on_time_rate', 'drone_utilisation', 'ground_utilisation', 'transport_cost_usd', 'expired_units', 'drone_share', 'cross_hospital_share'];
  const lines = [head.join(',')];
  for (const x of r.runs) {
    lines.push(
      [x.policy, x.rep, x.requests, x.delivered, x.unfulfilled, x.avgMin.toFixed(2), x.p90Min.toFixed(2), x.onTimeRate.toFixed(4), x.droneUtil.toFixed(4), x.groundUtil.toFixed(4), x.costUsd.toFixed(2), x.expiredUnits, x.droneShare.toFixed(4), x.transferShare.toFixed(4)].join(','),
    );
  }
  const p = r.params;
  lines.push('');
  lines.push(`# parameters,${Object.entries(p).map(([k, v]) => `${k}=${v}`).join(';')}`);
  lines.push('# Synthetic simulation output — BLOODWING AI research prototype. Not for clinical decision-making.');
  return lines.join('\n');
}
