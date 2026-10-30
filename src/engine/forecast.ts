// Machine-learning layer: a Poisson regression (generalised linear model, log link) that forecasts
// hourly blood-request counts per hospital from calendar features and recent demand.
//
// • Trained on SYNTHETIC history generated below (seeded) — there is no real hospital data.
// • Evaluated on a chronologically held-out test window against two naive baselines.
// • Output feeds (a) the shortage-risk panel and (b) the inventory-risk term of the dispatch
//   objective when a hospital is considered as a transfer source.

import { HOSPITALS, SIM_START } from './network';
import { Rng } from './rng';

/** Synthetic base request rates per hour (network illustration only). */
const BASE_RATE: Record<string, number> = { MGH: 0.62, BWH: 0.5, BMC: 0.55, BIDMC: 0.42, BCH: 0.26, TMC: 0.34 };
export const UNITS_PER_REQUEST = 2.6;

export interface HistoryRow {
  day: number;
  hour: number;
  dow: number;
  hospital: number;
  count: number;
}

function hourProfile(h: number): number {
  // Daytime surgical peak plus an evening trauma shoulder.
  return 0.55 + 0.55 * Math.exp(-((h - 11) ** 2) / 18) + 0.35 * Math.exp(-((h - 20) ** 2) / 8);
}

export function generateHistory(days = 120, seed = 41): HistoryRow[] {
  const rng = new Rng(seed);
  const rows: HistoryRow[] = [];
  const surge: number[] = HOSPITALS.map(() => 0);
  for (let day = 0; day < days; day++) {
    const dow = (SIM_START.dayOfWeek + day) % 7;
    const weekend = dow === 0 || dow === 6;
    for (let hour = 0; hour < 24; hour++) {
      HOSPITALS.forEach((h, hi) => {
        // Occasional multi-hour surges (mass-casualty-like clusters) that decay.
        if (rng.next() < 0.004) surge[hi] = rng.range(1.5, 3);
        surge[hi] *= 0.72;
        const lambda = BASE_RATE[h.id] * hourProfile(hour) * (weekend ? 0.78 : 1) * (1 + surge[hi]);
        rows.push({ day, hour, dow, hospital: hi, count: rng.poisson(lambda) });
      });
    }
  }
  return rows;
}

const NH = HOSPITALS.length;

export function featureNames(): string[] {
  return ['bias', 'sin(h)', 'cos(h)', 'sin(2h)', 'cos(2h)', 'weekend', ...HOSPITALS.slice(1).map((h) => `hosp:${h.short}`), 'log1p(last 3h)', 'log1p(last 24h)'];
}

function features(hour: number, dow: number, hospital: number, last3: number, last24: number): number[] {
  const a = (2 * Math.PI * hour) / 24;
  const f = [1, Math.sin(a), Math.cos(a), Math.sin(2 * a), Math.cos(2 * a), dow === 0 || dow === 6 ? 1 : 0];
  for (let i = 1; i < NH; i++) f.push(hospital === i ? 1 : 0);
  f.push(Math.log1p(last3), Math.log1p(last24) - Math.log(1 + 24 * 0.45));
  return f;
}

interface Sample {
  x: number[];
  y: number;
  row: HistoryRow;
}

function buildSamples(rows: HistoryRow[]): Sample[] {
  const series: number[][] = HOSPITALS.map(() => []);
  const samples: Sample[] = [];
  for (const r of rows) series[r.hospital].push(r.count);
  const idx: number[] = HOSPITALS.map(() => 0);
  for (const r of rows) {
    const s = series[r.hospital];
    const i = idx[r.hospital]++;
    if (i < 24) continue;
    let last3 = 0;
    let last24 = 0;
    for (let k = 1; k <= 24; k++) {
      last24 += s[i - k];
      if (k <= 3) last3 += s[i - k];
    }
    samples.push({ x: features(r.hour, r.dow, r.hospital, last3, last24), y: r.count, row: r });
  }
  return samples;
}

export interface ForecastModel {
  weights: number[];
  names: string[];
  trainDays: number;
  testDays: number;
  trainRows: number;
  testRows: number;
  metrics: {
    mae: number;
    maeHourMean: number;
    maeGlobalMean: number;
    devianceRatio: number;
    calibration: { bucket: string; predicted: number; observed: number; n: number }[];
  };
  ms: number;
}

function predictOne(w: number[], x: number[]): number {
  let z = 0;
  for (let i = 0; i < w.length; i++) z += w[i] * x[i];
  return Math.exp(Math.max(-10, Math.min(5, z)));
}

/** Full-batch gradient descent with Adam on the Poisson negative log-likelihood (+ small L2). */
export function trainForecast(days = 120, testDays = 30, epochs = 260): ForecastModel {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const rows = generateHistory(days);
  const samples = buildSamples(rows);
  const cut = days - testDays;
  const train = samples.filter((s) => s.row.day < cut);
  const test = samples.filter((s) => s.row.day >= cut);
  const p = train[0].x.length;
  const w = new Array(p).fill(0);
  w[0] = Math.log(train.reduce((s, r) => s + r.y, 0) / train.length);
  const m = new Array(p).fill(0);
  const v = new Array(p).fill(0);
  const lr = 0.05;
  const lambda = 1e-3;
  for (let e = 1; e <= epochs; e++) {
    const g = new Array(p).fill(0);
    for (const s of train) {
      const mu = predictOne(w, s.x);
      const r = mu - s.y;
      for (let i = 0; i < p; i++) g[i] += r * s.x[i];
    }
    for (let i = 0; i < p; i++) {
      const gi = g[i] / train.length + (i ? lambda * w[i] : 0);
      m[i] = 0.9 * m[i] + 0.1 * gi;
      v[i] = 0.999 * v[i] + 0.001 * gi * gi;
      const mh = m[i] / (1 - 0.9 ** e);
      const vh = v[i] / (1 - 0.999 ** e);
      w[i] -= (lr * mh) / (Math.sqrt(vh) + 1e-8);
    }
  }

  // Baselines fitted on the training window only
  const hourMean = new Map<string, { s: number; n: number }>();
  let globalSum = 0;
  for (const s of train) {
    const k = `${s.row.hospital}|${s.row.hour}`;
    const c = hourMean.get(k) ?? { s: 0, n: 0 };
    c.s += s.y;
    c.n++;
    hourMean.set(k, c);
    globalSum += s.y;
  }
  const globalMean = globalSum / train.length;
  let mae = 0;
  let maeH = 0;
  let maeG = 0;
  let dev = 0;
  let devNull = 0;
  const dev1 = (y: number, mu: number) => 2 * ((y > 0 ? y * Math.log(y / mu) : 0) - (y - mu));
  const buckets = [0, 0.3, 0.6, 1, 10];
  const cal = buckets.slice(0, -1).map(() => ({ pred: 0, obs: 0, n: 0 }));
  for (const s of test) {
    const mu = predictOne(w, s.x);
    const hm = hourMean.get(`${s.row.hospital}|${s.row.hour}`)!;
    const muH = hm.s / hm.n;
    mae += Math.abs(s.y - mu);
    maeH += Math.abs(s.y - muH);
    maeG += Math.abs(s.y - globalMean);
    dev += dev1(s.y, mu);
    devNull += dev1(s.y, muH);
    const b = buckets.findIndex((x, i) => mu >= x && mu < buckets[i + 1]);
    if (b >= 0) {
      cal[b].pred += mu;
      cal[b].obs += s.y;
      cal[b].n++;
    }
  }
  const n = test.length;
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    weights: w,
    names: featureNames(),
    trainDays: cut,
    testDays,
    trainRows: train.length,
    testRows: n,
    metrics: {
      mae: mae / n,
      maeHourMean: maeH / n,
      maeGlobalMean: maeG / n,
      devianceRatio: dev / devNull,
      calibration: cal.map((c, i) => ({
        bucket: `${buckets[i]}–${i === cal.length - 1 ? '∞' : buckets[i + 1]}`,
        predicted: c.n ? c.pred / c.n : 0,
        observed: c.n ? c.obs / c.n : 0,
        n: c.n,
      })),
    },
    ms: t1 - t0,
  };
}

/**
 * Expected requests per hospital over the next `hours`, rolling the model forward from the
 * current simulated clock. Recent demand = requests observed in the live simulation.
 */
export function forecastNextHours(model: ForecastModel, simMinute: number, recentByHospital: Record<string, { last3: number; last24: number }>, hours = 6): Record<string, { requests: number; units: number; hourly: number[] }> {
  const out: Record<string, { requests: number; units: number; hourly: number[] }> = {};
  HOSPITALS.forEach((h, hi) => {
    const recent = recentByHospital[h.id] ?? { last3: 1, last24: 24 * BASE_RATE[h.id] * 0.75 };
    let total = 0;
    const hourly: number[] = [];
    for (let k = 0; k < hours; k++) {
      const abs = SIM_START.hour * 60 + simMinute + k * 60;
      const hour = Math.floor(abs / 60) % 24;
      const dow = (SIM_START.dayOfWeek + Math.floor(abs / 1440)) % 7;
      const mu = predictOne(model.weights, features(hour, dow, hi, recent.last3, recent.last24));
      hourly.push(mu);
      total += mu;
    }
    out[h.id] = { requests: total, units: total * UNITS_PER_REQUEST, hourly };
  });
  return out;
}
