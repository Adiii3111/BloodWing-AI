// Time-stepped discrete-event simulation of the synthetic Boston blood logistics network.
// Every dashboard metric is computed from this state — nothing is animated independently.

import { DEFAULT_DEADLINE, DRONE, GROUND, GROUP_FREQ, UNFULFILLED_GRACE_MIN } from './assumptions';
import { evaluateRequest, type DispatchContext } from './dispatch';
import { commitAllocations, freshLot, generateInventory, isDispatchable } from './inventory';
import { DEPOTS, HOSPITALS, LOGAN_ZONE, SITES, siteById } from './network';
import { Rng } from './rng';
import type {
  BloodGroup,
  BloodRequest,
  Component,
  Courier,
  Decision,
  Drone,
  LatLon,
  Mission,
  RecipientGroup,
  ScheduledRequest,
  SimConfig,
  SimEvent,
  SimState,
  Urgency,
  Weather,
} from './types';

/** Extension points set by higher-level modules (avoids circular imports). */
export const hooks: { holdLocal: ((s: SimState, req: ScheduledRequest) => number) | null } = { holdLocal: null };

export const CLEAR_WEATHER: Weather = { windKmh: 14, visibilityKm: 16, precip: 'none' };

export const DEFAULT_CONFIG: SimConfig = {
  seed: 2026,
  policy: 'ai',
  trafficMultiplier: 1.2,
  weather: CLEAR_WEATHER,
  dronesEnabled: true,
  restrictedZones: [LOGAN_ZONE],
  ambientPerHour: 0,
  resupplyEveryMin: 12 * 60,
};

export interface FleetSpec {
  dronesPerDepot?: Record<string, number>;
  couriersPerDepot?: number;
  couriersPerHospital?: number;
  cruiseKmh?: number;
  rangeKm?: number;
  maxPayloadKg?: number;
}

export interface CreateOptions {
  config?: Partial<SimConfig>;
  fleet?: FleetSpec;
  allowHospitalTransfers?: boolean;
}

type Ext = SimState & {
  allowHospitalTransfers: boolean;
  targets: Record<string, number>;
  droneStart: Record<string, number>;
};

export function createSimulation(opts: CreateOptions = {}): SimState {
  const config: SimConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const fleet = opts.fleet ?? {};
  const counters = { req: 0, mission: 0, decision: 0, lot: 0 };
  const sites = SITES.map((s) => ({ ...s }));
  const lots = generateInventory(sites, config.seed, counters);
  const rng = new Rng(config.seed ^ 0x51ed27);

  const perDepot = fleet.dronesPerDepot ?? { DA: 3, DB: 2, DC: 2 };
  const drones: Drone[] = [];
  let n = 0;
  for (const d of DEPOTS) {
    for (let i = 0; i < (perDepot[d.id] ?? 0); i++) {
      n++;
      drones.push({
        id: `WING-${String(n).padStart(2, '0')}`,
        baseId: d.id,
        status: 'idle',
        battery: Math.round(rng.range(78, 100)),
        cruiseKmh: fleet.cruiseKmh ?? DRONE.cruiseKmh,
        rangeKm: fleet.rangeKm ?? DRONE.rangeKm,
        maxPayloadKg: fleet.maxPayloadKg ?? DRONE.maxPayloadKg,
        lat: d.lat,
        lon: d.lon,
        busyMin: 0,
      });
    }
  }
  const couriers: Courier[] = [];
  for (const s of sites) {
    const count = s.kind === 'depot' ? (fleet.couriersPerDepot ?? 2) : (fleet.couriersPerHospital ?? 1);
    for (let i = 0; i < count; i++) {
      couriers.push({
        id: `${s.kind === 'depot' ? 'VAN' : 'CAR'}-${s.short.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}${i + 1}`,
        baseId: s.id,
        status: 'idle',
        capacityUnits: GROUND.capacityUnits,
        lat: s.lat,
        lon: s.lon,
        busyMin: 0,
      });
    }
  }

  const targets: Record<string, number> = {};
  for (const l of lots) {
    if (siteById(sites, l.siteId).kind !== 'depot' || !isDispatchable(l, 0)) continue;
    const k = `${l.siteId}|${l.component}|${l.group}`;
    targets[k] = (targets[k] ?? 0) + l.units;
  }

  const state: Ext = {
    t: 0,
    config,
    sites,
    lots,
    drones,
    couriers,
    requests: [],
    decisions: [],
    missions: [],
    events: [],
    schedule: [],
    expiredUnits: { RBC: 0, PLT: 0, PLASMA: 0 },
    rngState: rng.s,
    counters,
    lastRetryAt: 0,
    lastResupplyAt: 0,
    incidents: [],
    appointments: [],
    orders: [],
    allowHospitalTransfers: opts.allowHospitalTransfers ?? true,
    targets,
    droneStart: {},
  };
  log(state, 'info', `Network online · ${HOSPITALS.length} hospitals · ${DEPOTS.length} depots · ${drones.length} drones · ${couriers.length} ground vehicles`);
  return state;
}

export function log(state: SimState, severity: SimEvent['severity'], text: string): void {
  state.events.push({ t: state.t, severity, text });
  if (state.events.length > 250) state.events.splice(0, state.events.length - 250);
}

export function currentWeather(state: SimState): Weather | null {
  const w = state.config.weatherWindows?.find((x) => state.t >= x.start && state.t < x.end);
  return w ? w.weather : state.config.weather;
}

export function dispatchContext(state: SimState): DispatchContext {
  const s = state as Ext;
  return {
    t: state.t,
    sites: state.sites,
    lots: state.lots,
    drones: state.drones,
    couriers: state.couriers,
    weather: currentWeather(state),
    trafficMultiplier: state.config.trafficMultiplier,
    dronesEnabled: state.config.dronesEnabled,
    restrictedZones: state.config.restrictedZones,
    forecastUnits6h: state.forecastUnits6h,
    allowHospitalTransfers: s.allowHospitalTransfers,
    weightsOverride: state.config.weightsOverride,
  };
}

export interface RequestInput {
  hospitalId: string;
  component: Component;
  recipientGroup: RecipientGroup;
  units: number;
  urgency: Urgency;
  deadlineMin?: number;
  label?: string;
  incidentId?: string;
  /** SENTINEL: a human must authorise before anything is dispatched. */
  requireAuth?: boolean;
}

export function submitRequest(state: SimState, input: RequestInput): BloodRequest {
  if (!Number.isInteger(input.units) || input.units < 1) throw new Error('units must be a positive integer');
  state.counters.req++;
  const req: BloodRequest = {
    id: `REQ-${String(state.counters.req).padStart(3, '0')}`,
    hospitalId: input.hospitalId,
    component: input.component,
    recipientGroup: input.recipientGroup,
    units: input.units,
    urgency: input.urgency,
    deadlineMin: input.deadlineMin ?? DEFAULT_DEADLINE[input.urgency],
    label: input.label,
    incidentId: input.incidentId,
    createdAt: state.t,
    status: input.requireAuth ? 'awaiting-auth' : 'queued',
    attempts: 0,
  };
  state.requests.push(req);
  const h = siteById(state.sites, req.hospitalId);
  log(
    state,
    req.urgency === 'critical' ? 'crit' : req.urgency === 'urgent' ? 'warn' : 'info',
    `${req.id} ${req.urgency.toUpperCase()} · ${h.short} needs ${req.units} ${req.component} (${req.recipientGroup === 'UNKNOWN' ? 'group unknown' : req.recipientGroup}) within ${req.deadlineMin} min`,
  );
  if (input.requireAuth) {
    // Evaluate and show the recommendation, but commit nothing until a human authorises.
    state.counters.decision++;
    const id = `DEC-${String(state.counters.decision).padStart(3, '0')}`;
    state.decisions.push(evaluateRequest(dispatchContext(state), req, state.config.policy, id));
    req.decisionId = id;
    log(state, 'warn', `${req.id} recommendation ready — awaiting clinical/logistics authorisation`);
  } else tryDispatch(state, req);
  return req;
}

/** Simulated human authorisation: re-evaluates on the current network state, then dispatches. */
export function authorizeRequest(state: SimState, requestId: string, by = 'blood bank coordinator (simulated)'): Decision {
  const req = state.requests.find((r) => r.id === requestId);
  if (!req) throw new Error(`Unknown request ${requestId}`);
  if (req.status !== 'awaiting-auth') throw new Error(`${requestId} is not awaiting authorisation`);
  req.status = 'queued';
  req.authorizedAt = state.t;
  log(state, 'ok', `${req.id} authorised by ${by}`);
  return tryDispatch(state, req);
}

export function declineRequest(state: SimState, requestId: string): void {
  const req = state.requests.find((r) => r.id === requestId);
  if (!req || req.status !== 'awaiting-auth') return;
  req.status = 'declined';
  log(state, 'info', `${req.id} declined at authorisation — nothing dispatched`);
}

/** Evaluate without committing anything (used by the dispatch builder preview). */
export function previewDecision(state: SimState, input: RequestInput): Decision {
  const req: BloodRequest = {
    id: 'PREVIEW',
    hospitalId: input.hospitalId,
    component: input.component,
    recipientGroup: input.recipientGroup,
    units: input.units,
    urgency: input.urgency,
    deadlineMin: input.deadlineMin ?? DEFAULT_DEADLINE[input.urgency],
    createdAt: state.t,
    status: 'queued',
    attempts: 0,
  };
  return evaluateRequest(dispatchContext(state), req, state.config.policy, 'PREVIEW');
}

export function tryDispatch(state: SimState, req: BloodRequest): Decision {
  req.attempts++;
  let id = req.decisionId;
  if (!id) {
    state.counters.decision++;
    id = `DEC-${String(state.counters.decision).padStart(3, '0')}`;
  }
  const decision = evaluateRequest(dispatchContext(state), req, state.config.policy, id);
  const idx = state.decisions.findIndex((d) => d.id === id);
  if (idx >= 0) state.decisions[idx] = decision;
  else state.decisions.push(decision);
  req.decisionId = id;

  if (decision.chosen) {
    launchMission(state, req, decision);
  } else if (req.attempts === 1) {
    log(state, 'warn', `${req.id} no feasible dispatch yet — queued for re-evaluation (human review)`);
  }
  return decision;
}

function launchMission(state: SimState, req: BloodRequest, d: Decision): void {
  const o = d.chosen!;
  commitAllocations(state.lots, o.allocations, state.t);
  state.counters.mission++;
  const id = `MSN-${String(state.counters.mission).padStart(3, '0')}`;
  const src = siteById(state.sites, o.sourceId);
  const dst = siteById(state.sites, req.hospitalId);
  const path: LatLon[] =
    o.mode === 'drone'
      ? [src, dst].map((p) => ({ lat: p.lat, lon: p.lon }))
      : [{ lat: src.lat, lon: src.lon }, { lat: src.lat, lon: dst.lon }, { lat: dst.lat, lon: dst.lon }];
  const departAt = state.t + o.prepMin;
  const arriveAt = departAt + o.travelMin;
  const handoffDoneAt = arriveAt + o.handoffMin;
  const returnAt = handoffDoneAt + o.returnMin;
  const end = path[path.length - 1];
  let timeline: Mission['timeline'];
  if (o.mode === 'drone') {
    timeline = [
      { t: departAt, ...path[0] },
      { t: arriveAt, ...end },
      { t: handoffDoneAt, ...end },
      { t: returnAt, ...path[0] },
    ];
  } else {
    // Ground: split travel time across the two legs of the illustrative L-shaped route.
    const d1 = Math.abs(path[1].lon - path[0].lon) * 82;
    const d2 = Math.abs(path[2].lat - path[1].lat) * 111;
    const f = d1 + d2 > 0 ? d1 / (d1 + d2) : 0.5;
    timeline = [
      { t: departAt, ...path[0] },
      { t: departAt + f * o.travelMin, ...path[1] },
      { t: arriveAt, ...end },
      { t: handoffDoneAt, ...end },
      { t: handoffDoneAt + (1 - f) * o.returnMin, ...path[1] },
      { t: returnAt, ...path[0] },
    ];
  }
  const m: Mission = {
    id,
    kind: 'request',
    timeline,
    requestId: req.id,
    decisionId: d.id,
    mode: o.mode,
    sourceId: src.id,
    destId: dst.id,
    vehicleIds: o.vehicleIds,
    component: req.component,
    units: req.units,
    phase: 'preparing',
    dispatchedAt: state.t,
    departAt,
    arriveAt,
    handoffDoneAt,
    returnAt,
    path,
    deadlineAt: req.createdAt + req.deadlineMin,
    batteryUsePct: o.batteryUsePct,
  };
  state.missions.push(m);
  const ext = state as Ext;
  for (const vid of o.vehicleIds) {
    const v = vehicle(state, vid);
    if (!v || v.status !== 'idle') throw new Error(`Vehicle ${vid} is not idle — double allocation prevented`);
    v.status = 'preparing';
    v.missionId = id;
    if (o.mode === 'drone') ext.droneStart[vid] = (v as Drone).battery;
  }
  req.status = 'dispatched';
  req.missionId = id;
  log(
    state,
    'ok',
    `${id} dispatched · ${src.short} → ${dst.short} by ${o.mode === 'drone' ? `drone ${o.vehicleIds.join('+')}` : `ground ${o.vehicleIds[0]}`} · ETA ${Math.round(o.etaMin)} min${d.status === 'dispatch-late' ? ' (late — human review)' : ''}`,
  );
}

export function vehicle(state: SimState, id: string): Drone | Courier | undefined {
  return state.drones.find((d) => d.id === id) ?? state.couriers.find((c) => c.id === id);
}

export function positionAt(tl: { t: number; lat: number; lon: number }[], t: number): LatLon {
  if (t <= tl[0].t) return tl[0];
  for (let i = 1; i < tl.length; i++) {
    if (t <= tl[i].t) {
      const a = tl[i - 1];
      const b = tl[i];
      const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
    }
  }
  return tl[tl.length - 1];
}

export function advance(state: SimState, dtMin: number): void {
  let remaining = dtMin;
  while (remaining > 1e-9) {
    const h = Math.min(1, remaining);
    step(state, h);
    remaining -= h;
  }
}

function step(state: SimState, h: number): void {
  const ext = state as Ext;
  state.t += h;
  const t = state.t;

  // Scheduled arrivals
  if (state.schedule.length) {
    const due = state.schedule.filter((s) => s.at <= t);
    if (due.length) {
      state.schedule = state.schedule.filter((s) => s.at > t);
      for (const s of due) {
        let units = s.units;
        if (s.incidentId && hooks.holdLocal) units = hooks.holdLocal(state, s);
        if (units > 0) submitRequest(state, { ...s, units });
      }
    }
  }
  // Ambient (background) demand
  if (state.config.ambientPerHour > 0) {
    const rng = new Rng(state.rngState);
    const k = rng.poisson((state.config.ambientPerHour * h) / 60);
    for (let i = 0; i < k; i++) submitRequest(state, randomRequest(rng));
    state.rngState = rng.s;
  }

  // Missions
  for (const m of state.missions) {
    if (m.phase === 'complete') continue;
    const vehicles = m.vehicleIds.map((id) => vehicle(state, id)!);
    const lastStopDone = m.kind === 'milkrun' ? m.stops![m.stops!.length - 1].doneAt : m.handoffDoneAt;
    if (t < m.departAt) m.phase = 'preparing';
    else if (m.kind === 'request' && t < m.arriveAt) m.phase = 'enroute';
    else if (m.kind === 'request' && t < m.handoffDoneAt) m.phase = 'handoff';
    else if (m.kind === 'milkrun' && t < lastStopDone) m.phase = 'enroute';
    else if (t < m.returnAt) m.phase = 'returning';
    else m.phase = 'complete';

    if (m.kind === 'request') {
      const req = state.requests.find((r) => r.id === m.requestId)!;
      if (t >= m.handoffDoneAt && req.status === 'dispatched') {
        req.status = 'delivered';
        req.deliveredAt = m.handoffDoneAt;
        m.onTime = m.handoffDoneAt <= m.deadlineAt + 1e-6;
        const dst = siteById(state.sites, m.destId);
        log(state, m.onTime ? 'ok' : 'warn', `${m.id} delivered ${m.units} ${m.component} to ${dst.short} · ${Math.round(m.handoffDoneAt - req.createdAt)} min after request${m.onTime ? '' : ' — LATE'}`);
      }
    } else {
      for (const stop of m.stops!) {
        if (stop.delivered || t < stop.doneAt) continue;
        stop.delivered = true;
        let units = 0;
        for (const d of stop.deliveries) {
          state.counters.lot++;
          state.lots.push({
            id: `L${String(state.counters.lot).padStart(4, '0')}`,
            siteId: stop.siteId,
            component: d.component,
            group: d.group,
            units: d.units,
            expiresAt: d.expiresAt,
            status: d.reservedFor ? 'reserved' : 'released',
            reservedFor: d.reservedFor,
          });
          units += d.units;
        }
        log(state, 'ok', `${m.id} stop ${siteById(state.sites, stop.siteId).short}: ${units} units received into inventory`);
      }
    }

    const pos = positionAt(m.timeline, t);
    vehicles.forEach((v, i) => {
      const isDrone = m.mode === 'drone';
      const offset = isDrone && vehicles.length > 1 ? (i - (vehicles.length - 1) / 2) * 0.0009 : 0;
      v.lat = pos.lat + offset;
      v.lon = pos.lon + offset;
      if (m.phase === 'complete') {
        v.status = 'idle';
        v.missionId = undefined;
      } else {
        v.status = (isDrone
          ? { preparing: 'preparing', enroute: 'outbound', handoff: 'handoff', returning: 'returning' }[m.phase]
          : { preparing: 'preparing', enroute: 'enroute', handoff: 'handoff', returning: 'returning' }[m.phase]) as never;
        v.busyMin += h;
      }
      if (isDrone) {
        const d = v as Drone;
        const start = ext.droneStart[d.id] ?? d.battery;
        const f = Math.max(0, Math.min(1, (t - m.departAt) / Math.max(1e-6, m.returnAt - m.departAt)));
        d.battery = Math.max(0, start - (m.batteryUsePct ?? 0) * f);
      }
    });
    if (m.phase === 'complete') {
      const src = siteById(state.sites, m.sourceId);
      log(state, 'info', `${m.vehicleIds.join('+')} back at ${src.short}`);
    }
  }

  // EMS status for incidents (SENTINEL)
  for (const inc of state.incidents) {
    const prev = inc.emsStatus;
    inc.emsStatus = t < inc.t + 3 ? 'alert' : t < inc.assessedAt ? 'on-scene' : t < inc.departSceneAt ? 'assessed' : t < inc.patientArriveAt ? 'transporting' : 'arrived';
    if (prev !== inc.emsStatus && inc.emsStatus === 'arrived') log(state, 'info', `${inc.ref} patient arrived at ${siteById(state.sites, inc.hospitalId).short} (simulated)`);
  }

  // Idle drones recharge
  for (const d of state.drones) if (d.status === 'idle') d.battery = Math.min(100, d.battery + DRONE.chargePctPerMin * h);

  // Re-evaluate queued requests every 2 minutes; give up after deadline + grace
  if (t - state.lastRetryAt >= 2) {
    state.lastRetryAt = t;
    for (const r of state.requests) {
      if (r.status !== 'queued') continue;
      if (t > r.createdAt + r.deadlineMin + UNFULFILLED_GRACE_MIN) {
        r.status = 'unfulfilled';
        log(state, 'crit', `${r.id} unfulfilled — no feasible option before deadline + ${UNFULFILLED_GRACE_MIN} min`);
      } else tryDispatch(state, r);
    }
  }

  // Expiry check every 10 minutes
  if (Math.floor(t / 10) !== Math.floor((t - h) / 10)) {
    let expired = 0;
    for (const l of state.lots) {
      if (l.status !== 'expired' && l.units > 0 && l.expiresAt <= t) {
        state.expiredUnits[l.component] += l.units;
        expired += l.units;
        l.status = 'expired';
      }
    }
    if (expired > 0) log(state, 'warn', `${expired} units reached expiry and were removed from available stock`);
  }

  // Depot resupply from the regional supplier (upper echelon)
  if (state.config.resupplyEveryMin > 0 && t - state.lastResupplyAt >= state.config.resupplyEveryMin) {
    state.lastResupplyAt = t;
    let added = 0;
    for (const [k, target] of Object.entries(ext.targets)) {
      const [siteId, component, group] = k.split('|') as [string, Component, BloodGroup];
      const have = state.lots.filter((l) => l.siteId === siteId && l.component === component && l.group === group && isDispatchable(l, t)).reduce((s, l) => s + l.units, 0);
      if (have < target) {
        state.lots.push(freshLot(state.counters, siteId, component, group, target - have, t));
        added += target - have;
      }
    }
    if (added > 0) log(state, 'info', `Scheduled resupply: ${added} units delivered to depots from the regional supplier`);
  }
}

// ------------------------------------------------------------------ synthetic demand

const URGENCY_MIX = [['critical', 20], ['urgent', 35], ['routine', 45]] as const;
const COMPONENT_MIX = [['RBC', 65], ['PLT', 15], ['PLASMA', 20]] as const;

export function randomRequest(rng: Rng, hospitalWeights?: Record<string, number>): RequestInput {
  const hospitalId = rng.weighted(HOSPITALS.map((h) => [h.id, hospitalWeights?.[h.id] ?? 1] as const));
  const urgency = rng.weighted(URGENCY_MIX) as Urgency;
  const component = rng.weighted(COMPONENT_MIX) as Component;
  const unknown = urgency === 'critical' && rng.next() < 0.35;
  const recipientGroup: RecipientGroup = unknown ? 'UNKNOWN' : (rng.weighted(GROUP_FREQ) as BloodGroup);
  const units =
    component === 'RBC' ? (urgency === 'critical' ? rng.int(2, 6) : rng.int(1, 4)) : component === 'PLT' ? rng.int(1, 2) : rng.int(2, 4);
  return { hospitalId, component, recipientGroup, units, urgency };
}

// ------------------------------------------------------------------ metrics

export interface Metrics {
  activeEmergencies: number;
  queued: number;
  availableUnits: number;
  availableByComponent: Record<Component, number>;
  dronesAvailable: number;
  dronesTotal: number;
  avgResponseMin: number | null;
  p90ResponseMin: number | null;
  timeSavedMin: number | null;
  atRiskUnits: number;
  onTimeRate: number | null;
  delivered: number;
  unfulfilled: number;
  missionsActive: number;
  droneUtilization: number;
  groundUtilization: number;
  costUsd: number;
  expiredUnits: number;
  droneShare: number | null;
}

export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[idx];
}

export function computeMetrics(state: SimState): Metrics {
  const t = state.t;
  const byC: Record<Component, number> = { RBC: 0, PLT: 0, PLASMA: 0 };
  let atRisk = 0;
  for (const l of state.lots) {
    if (l.status === 'expired' || l.units <= 0) continue;
    if (isDispatchable(l, t)) byC[l.component] += l.units;
    if (l.status !== 'quarantine' && l.expiresAt - t <= 48 * 60) atRisk += l.units;
  }
  const delivered = state.requests.filter((r) => r.status === 'delivered');
  const responses = delivered.map((r) => r.deliveredAt! - r.createdAt);
  const unfulfilled = state.requests.filter((r) => r.status === 'unfulfilled').length;
  const onTime = state.missions.filter((m) => m.kind === 'request' && m.onTime === true).length;
  const closed = delivered.length + unfulfilled;

  let saved = 0;
  let savedN = 0;
  let cost = 0;
  let droneMissions = 0;
  for (const r of delivered) {
    const d = state.decisions.find((x) => x.id === r.decisionId);
    if (!d?.chosen) continue;
    cost += d.chosen.costUsd;
    if (d.chosen.mode === 'drone') droneMissions++;
    if (d.groundBaselineEta != null) {
      saved += d.groundBaselineEta - d.chosen.etaMin;
      savedN++;
    }
  }
  const horizon = Math.max(1, t);
  const droneBusy = state.drones.reduce((s, d) => s + d.busyMin, 0);
  const groundBusy = state.couriers.reduce((s, c) => s + c.busyMin, 0);
  return {
    activeEmergencies: state.requests.filter((r) => (r.status === 'queued' || r.status === 'dispatched' || r.status === 'awaiting-auth') && r.urgency !== 'routine').length,
    queued: state.requests.filter((r) => r.status === 'queued').length,
    availableUnits: byC.RBC + byC.PLT + byC.PLASMA,
    availableByComponent: byC,
    dronesAvailable: state.drones.filter((d) => d.status === 'idle' && d.battery >= DRONE.reservePct + 15).length,
    dronesTotal: state.drones.length,
    avgResponseMin: responses.length ? responses.reduce((a, b) => a + b, 0) / responses.length : null,
    p90ResponseMin: percentile(responses, 0.9),
    timeSavedMin: savedN ? saved : null,
    atRiskUnits: atRisk,
    onTimeRate: closed ? onTime / closed : null,
    delivered: delivered.length,
    unfulfilled,
    missionsActive: state.missions.filter((m) => m.phase !== 'complete').length,
    droneUtilization: state.drones.length ? droneBusy / (state.drones.length * horizon) : 0,
    groundUtilization: state.couriers.length ? groundBusy / (state.couriers.length * horizon) : 0,
    costUsd: cost,
    expiredUnits: state.expiredUnits.RBC + state.expiredUnits.PLT + state.expiredUnits.PLASMA,
    droneShare: delivered.length ? droneMissions / delivered.length : null,
  };
}

export function scheduleRequests(state: SimState, reqs: ScheduledRequest[]): void {
  state.schedule.push(...reqs);
  state.schedule.sort((a, b) => a.at - b.at);
}
