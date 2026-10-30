// Single source of truth for the live simulation shown across the app.
// SENTINEL, PULSE and ORBIT all act on this one SimState: one inventory, one fleet, one clock.
// React panels subscribe to a throttled channel (~10 Hz); the map subscribes per frame.

import { useSyncExternalStore } from 'react';
import { trainForecast, forecastNextHours, type ForecastModel } from '../engine/forecast';
import { Rng } from '../engine/rng';
import { buildScenario, generatedScenario, SCENARIOS, type ScenarioDef } from '../engine/scenarios';
import { buildSentinel, registerIncident, SENTINEL_SCENARIOS, type SentinelScenario } from '../engine/sentinel';
import { defaultAppointments, executePulsePlan, planPulse } from '../engine/pulse';
import { executeMilkRun, orderDeliveredSync, routineOrders, solveNetwork, type OrbitSolution } from '../engine/orbit';
import { advance, authorizeRequest, declineRequest, randomRequest, submitRequest, type RequestInput } from '../engine/simulation';
import type { Appointment, SimState } from '../engine/types';
import { HOSPITALS } from '../engine/network';

export type Speed = 1 | 5 | 20;
type Listener = () => void;

const LS_KEY = 'bloodwing:prefs:v2';

interface Prefs {
  speed: Speed;
  ambient: boolean;
  scenarioId: string;
  genCounter: number;
}

function loadPrefs(): Prefs {
  const d: Prefs = { speed: 1, ambient: false, scenarioId: 'critical', genCounter: 0 };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...d, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return d;
}

function prime(s: SimState): SimState {
  if (!s.appointments.length) s.appointments = defaultAppointments();
  return s;
}

class SimStore {
  state: SimState;
  scenario: ScenarioDef | null = null;
  sentinel: SentinelScenario | null = null;
  scenarioStarted = false;
  running = false;
  speed: Speed;
  ambient: boolean;
  genCounter: number;
  emergencyCounter = 0;
  /** Set when the judge demo is in control of the clock. */
  demoLock = false;
  focusDecisionId: string | null = null;
  model: ForecastModel | null = null;
  forecast: ReturnType<typeof forecastNextHours> | null = null;
  orbit: OrbitSolution[] | null = null;
  orbitHubs: string[] = ['DA', 'DB', 'DC'];

  private version = 0;
  private slow = new Set<Listener>();
  private fast = new Set<Listener>();
  private raf = 0;
  private last = 0;
  private lastNotify = 0;
  private lastForecastAt = -999;

  constructor() {
    const p = loadPrefs();
    this.speed = p.speed;
    this.ambient = p.ambient;
    this.genCounter = p.genCounter;
    const def = SCENARIOS.find((s) => s.id === p.scenarioId) ?? SCENARIOS[0];
    this.state = prime(buildScenario(def));
    this.scenario = def;
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        this.ensureModel();
        this.notify(true);
      }, 400);
    }
  }

  private savePrefs() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ speed: this.speed, ambient: this.ambient, scenarioId: this.scenario?.id ?? 'critical', genCounter: this.genCounter }));
    } catch {
      /* ignore */
    }
  }

  subscribe = (l: Listener) => {
    this.slow.add(l);
    return () => this.slow.delete(l);
  };
  subscribeFrame = (l: Listener) => {
    this.fast.add(l);
    return () => this.fast.delete(l);
  };
  getVersion = () => this.version;

  notify(force = false) {
    this.fast.forEach((l) => l());
    const now = performance.now();
    if (force || now - this.lastNotify > 100) {
      this.lastNotify = now;
      this.version++;
      this.slow.forEach((l) => l());
    }
  }

  /** Decisions always use the trained forecast, so outcomes are identical on every machine. */
  ensureModel() {
    if (!this.model) this.model = trainForecast();
    this.refreshForecast(true);
  }

  private refreshForecast(force = false) {
    if (!this.model) return;
    if (!force && this.state.t - this.lastForecastAt < 10) return;
    this.lastForecastAt = this.state.t;
    const recent: Record<string, { last3: number; last24: number }> = {};
    for (const h of HOSPITALS) {
      const rs = this.state.requests.filter((r) => r.hospitalId === h.id);
      // Live history is short; blend with a typical background level.
      recent[h.id] = { last3: rs.filter((r) => this.state.t - r.createdAt <= 180).length + 1, last24: rs.length + 9 };
    }
    this.forecast = forecastNextHours(this.model, this.state.t, recent);
    this.state.forecastUnits6h = Object.fromEntries(Object.entries(this.forecast).map(([k, v]) => [k, v.units]));
  }

  // ---------------------------------------------------------------- clock
  private loop = (ts: number) => {
    const dt = Math.min(0.1, (ts - this.last) / 1000);
    this.last = ts;
    if (this.running && !this.demoLock) {
      advance(this.state, dt * this.speed);
      this.tickIncidents();
      orderDeliveredSync(this.state);
      this.refreshForecast();
      this.notify();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  ensureLoop() {
    if (!this.raf && typeof window !== 'undefined') {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.loop);
    }
  }

  /** Demo / fast-forward drives the clock directly to an exact target time. */
  advanceTo(t: number) {
    if (t > this.state.t) advance(this.state, t - this.state.t);
    this.tickIncidents();
    orderDeliveredSync(this.state);
    this.refreshForecast();
    this.notify(true);
  }

  private replace(s: SimState) {
    this.state = prime(s);
    this.scenarioStarted = false;
    this.running = false;
    this.focusDecisionId = null;
    this.orbit = null;
    this.lastForecastAt = -999;
    this.ensureModel();
  }

  // ---------------------------------------------------------------- command-centre scenarios
  loadScenario(def: ScenarioDef) {
    this.replace(buildScenario(def, { ambientPerHour: this.ambient ? 4 : 0 }));
    this.scenario = def;
    this.sentinel = null;
    this.savePrefs();
    this.notify(true);
  }

  start() {
    this.ensureModel();
    this.ensureLoop();
    if (this.scenario && !this.scenarioStarted) {
      this.scenarioStarted = true;
      const r = submitRequest(this.state, this.scenario.request);
      this.focusDecisionId = r.decisionId ?? null;
    }
    if (this.sentinel && !this.scenarioStarted) this.startSentinel();
    this.running = true;
    this.notify(true);
  }

  pause() {
    this.running = false;
    this.notify(true);
  }

  resume() {
    this.ensureLoop();
    this.running = true;
    this.notify(true);
  }

  /** Reset restores the scenario's original state exactly (seeded rebuild). */
  reset() {
    if (this.sentinel) this.loadSentinel(this.sentinel);
    else if (this.scenario) this.loadScenario(this.scenario);
  }

  setSpeed(s: Speed) {
    this.speed = s;
    this.savePrefs();
    this.notify(true);
  }

  setAmbient(on: boolean) {
    this.ambient = on;
    this.state.config.ambientPerHour = on ? 4 : 0;
    this.savePrefs();
    this.notify(true);
  }

  newScenario() {
    this.genCounter++;
    this.loadScenario(generatedScenario(this.genCounter));
    this.start();
  }

  /** TRIGGER EMERGENCY: a reproducible synthetic critical request on the live network. */
  triggerEmergency() {
    this.ensureModel();
    this.emergencyCounter++;
    const rng = new Rng(4242 + this.emergencyCounter * 977);
    const r = randomRequest(rng);
    r.urgency = 'critical';
    r.deadlineMin = 30;
    r.label = 'Triggered emergency';
    if (r.component === 'RBC' && r.units < 2) r.units = 2;
    this.scenarioStarted = true;
    const req = submitRequest(this.state, r);
    this.focusDecisionId = req.decisionId ?? null;
    this.ensureLoop();
    this.running = true;
    this.notify(true);
    return req;
  }

  submit(input: RequestInput) {
    this.ensureModel();
    const req = submitRequest(this.state, input);
    this.scenarioStarted = true;
    this.focusDecisionId = req.decisionId ?? null;
    this.ensureLoop();
    this.running = true;
    this.notify(true);
    return req;
  }

  focus(id: string | null) {
    this.focusDecisionId = id;
    this.notify(true);
  }

  // ---------------------------------------------------------------- SENTINEL
  loadSentinel(def: SentinelScenario) {
    this.replace(buildSentinel(def));
    this.sentinel = def;
    this.scenario = null;
    this.notify(true);
  }

  startSentinel(autoAuthorize = false) {
    if (!this.sentinel) return;
    this.scenarioStarted = true;
    for (const spec of this.sentinel.incidents) {
      if (spec.at <= 0) registerIncident(this.state, spec, { autoAuthorize });
    }
    // Later incidents in the same scenario are registered when the clock reaches them.
    this.pendingIncidents = this.sentinel.incidents.filter((x) => x.at > 0).map((spec) => ({ spec, autoAuthorize }));
    this.ensureLoop();
    this.running = true;
    this.notify(true);
  }

  pendingIncidents: { spec: SentinelScenario['incidents'][number]; autoAuthorize: boolean }[] = [];

  /** Called from the loop and demo: register any incident whose time has come. */
  tickIncidents() {
    if (!this.pendingIncidents.length) return;
    const due = this.pendingIncidents.filter((p) => p.spec.at <= this.state.t);
    this.pendingIncidents = this.pendingIncidents.filter((p) => p.spec.at > this.state.t);
    for (const p of due) registerIncident(this.state, p.spec, { autoAuthorize: p.autoAuthorize });
  }

  authorize(requestId: string) {
    const d = authorizeRequest(this.state, requestId);
    this.focusDecisionId = d.id;
    this.notify(true);
    return d;
  }

  decline(requestId: string) {
    declineRequest(this.state, requestId);
    this.notify(true);
  }

  // ---------------------------------------------------------------- PULSE
  plans() {
    return planPulse(this.state);
  }

  updateAppointment(id: string, patch: Partial<Appointment>) {
    const a = this.state.appointments.find((x) => x.id === id);
    if (!a) return;
    Object.assign(a, patch);
    this.notify(true);
  }

  executePlan(apptId: string) {
    const plan = planPulse(this.state).find((p) => p.appt.id === apptId);
    if (!plan) return null;
    const r = executePulsePlan(this.state, plan);
    this.orbit = null;
    this.notify(true);
    return r;
  }

  // ---------------------------------------------------------------- ORBIT
  orbitOrders() {
    const open = this.state.orders.filter((o) => o.status === 'open');
    return [...open, ...routineOrders(this.state)];
  }

  solveOrbit(hubs: string[] = this.orbitHubs) {
    this.orbitHubs = hubs;
    this.orbit = solveNetwork(this.state, this.orbitOrders(), hubs);
    this.notify(true);
    return this.orbit;
  }

  executeOrbit() {
    if (!this.orbit) return;
    for (const sol of this.orbit) executeMilkRun(this.state, sol);
    this.orbit = null;
    this.ensureLoop();
    this.running = true;
    this.notify(true);
  }
}

export const store = new SimStore();

export const SENTINEL_LIST = SENTINEL_SCENARIOS;

export function useSim(): SimStore {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}
