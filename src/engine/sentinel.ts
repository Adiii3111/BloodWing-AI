// SENTINEL — emergency response intelligence.
//
// Two-stage process, by design:
//   Stage 1  An (authorised, simulated) incident alert creates an incident record and notifies EMS.
//            NOTHING is ordered from an alert alone — traffic data cannot establish blood need.
//   Stage 2  After EMS / hospital assessment, an authorised clinical request is raised. EMS chooses
//            the receiving hospital. BLOODWING then recommends a dispatch, which a human must
//            authorise before anything moves.
//
// Ambulance and blood-delivery ETAs are computed independently.
// Readiness margin = patient arrival time − blood delivery time.

import { GROUND } from './assumptions';
import { alongPath, haversineKm } from './geo';
import { eligibleLots, pickUnits } from './inventory';
import { DEPOTS, LOGAN_ZONE, siteById } from './network';
import { reserveUnits } from './pulse';
import { CLEAR_WEATHER, createSimulation, hooks, log, scheduleRequests } from './simulation';
import type { Component, Incident, LatLon, RecipientGroup, ScheduledRequest, SimConfig, SimState } from './types';

export const EMS = {
  responseMin: 7, // alert → EMS on scene (synthetic)
  assessMin: 5, // on scene → clinical assessment / request
  onSceneMin: 12, // on scene → depart with patient
  speedKmh: 42, // average ambulance speed with lights (synthetic)
  trafficSensitivity: 0.5, // ambulance delay grows with √(traffic multiplier)
  authMin: 1, // simulated human authorisation time (auto mode)
  receiptCheckMin: 5, // receipt + label/temperature check-in at the hospital (synthetic)
};

export interface IncidentSpec {
  label: string;
  lat: number;
  lon: number;
  hospitalId: string;
  component: Component;
  recipientGroup: RecipientGroup;
  requestedUnits: number;
  deadlineMin: number;
  /** Minutes after scenario start when the alert arrives. */
  at: number;
}

export interface SentinelScenario {
  id: string;
  title: string;
  tagline: string;
  story: string;
  config: Partial<SimConfig>;
  setup?: (s: SimState) => void;
  incidents: IncidentSpec[];
}

const quarantineAll = (s: SimState, pred: (siteId: string) => boolean, group = 'O-') => {
  for (const l of s.lots) if (l.component === 'RBC' && l.group === group && pred(l.siteId)) l.status = 'quarantine';
};

export const SENTINEL_SCENARIOS: SentinelScenario[] = [
  {
    id: 'collision',
    title: 'Highway collision',
    tagline: 'I-93 southbound · trauma patient',
    story: 'A multi-vehicle collision is reported on I-93 southbound. EMS assesses a trauma patient, chooses Boston Medical Center as the receiving hospital, and the hospital requests O-negative red cells beyond what it holds locally.',
    config: { trafficMultiplier: 1.2, weather: CLEAR_WEATHER },
    incidents: [{ label: 'I-93 SB collision (simulated)', lat: 42.2955, lon: -71.0455, hospitalId: 'BMC', component: 'RBC', recipientGroup: 'UNKNOWN', requestedUnits: 14, deadlineMin: 30, at: 0 }],
  },
  {
    id: 'congested',
    title: 'Congested roads',
    tagline: 'Mass Pike · traffic ×2.6',
    story: 'A collision on the Mass Pike near Allston during peak congestion. Ground travel takes 2.6× longer for everyone — including the ambulance.',
    config: { trafficMultiplier: 2.6, weather: CLEAR_WEATHER },
    incidents: [{ label: 'I-90 EB collision (simulated)', lat: 42.3528, lon: -71.1335, hospitalId: 'BIDMC', component: 'RBC', recipientGroup: 'UNKNOWN', requestedUnits: 13, deadlineMin: 30, at: 0 }],
  },
  {
    id: 'stockout',
    title: 'Nearest depot out of stock',
    tagline: 'Depot Alpha has no releasable O−',
    story: "Depot Alpha's O-negative stock is quarantined pending a quality check. The engine must look further across the network.",
    config: { trafficMultiplier: 1.3, weather: CLEAR_WEATHER },
    setup: (s) => quarantineAll(s, (id) => id === 'DA'),
    incidents: [{ label: 'South End pedestrian incident (simulated)', lat: 42.3405, lon: -71.0735, hospitalId: 'TMC', component: 'RBC', recipientGroup: 'UNKNOWN', requestedUnits: 11, deadlineMin: 30, at: 0 }],
  },
  {
    id: 'weather',
    title: 'Drone weather restriction',
    tagline: 'Gusts 46 km/h · fleet grounded',
    story: 'Wind gusts exceed the drone operating envelope. Every blood movement must go by road.',
    config: { trafficMultiplier: 1.3, weather: { windKmh: 46, visibilityKm: 9, precip: 'light-rain' } },
    incidents: [{ label: 'Dorchester Ave collision (simulated)', lat: 42.3005, lon: -71.0575, hospitalId: 'BMC', component: 'RBC', recipientGroup: 'UNKNOWN', requestedUnits: 12, deadlineMin: 35, at: 0 }],
  },
  {
    id: 'multi',
    title: 'Multiple simultaneous incidents',
    tagline: 'Two trauma patients, one O− supply',
    story: 'Two collisions minutes apart send trauma patients to two different hospitals. Both need O-negative red cells, and they compete for the same drones and depot stock.',
    config: { trafficMultiplier: 1.4, weather: CLEAR_WEATHER },
    incidents: [
      { label: 'I-93 NB collision (simulated)', lat: 42.3815, lon: -71.0705, hospitalId: 'MGH', component: 'RBC', recipientGroup: 'UNKNOWN', requestedUnits: 12, deadlineMin: 30, at: 0 },
      { label: 'Columbia Rd collision (simulated)', lat: 42.3175, lon: -71.0455, hospitalId: 'BMC', component: 'RBC', recipientGroup: 'UNKNOWN', requestedUnits: 12, deadlineMin: 30, at: 2 },
    ],
  },
  {
    id: 'late',
    title: 'Patient arrives first',
    tagline: 'Short transport · grounded fleet',
    story: 'The incident is minutes from Massachusetts General Hospital, drones are grounded by wind, and traffic is heavy. The patient will arrive before the extra units can — the system must say so plainly.',
    config: { trafficMultiplier: 1.9, weather: { windKmh: 41, visibilityKm: 8, precip: 'light-rain' } },
    incidents: [{ label: 'Storrow Drive collision (simulated)', lat: 42.3598, lon: -71.0785, hospitalId: 'MGH', component: 'RBC', recipientGroup: 'UNKNOWN', requestedUnits: 12, deadlineMin: 30, at: 0 }],
  },
  {
    id: 'infeasible',
    title: 'No feasible delivery',
    tagline: 'Network O− held · fleet grounded',
    story: 'All network O-negative stock outside the receiving hospital is held, and the fleet is grounded. BLOODWING must not invent an answer: it reports no feasible option and escalates to humans.',
    config: { trafficMultiplier: 1.3, weather: { windKmh: 52, visibilityKm: 4, precip: 'heavy-rain' } },
    setup: (s) => quarantineAll(s, (id) => id !== 'BMC'),
    incidents: [{ label: 'Blue Hill Ave collision (simulated)', lat: 42.3125, lon: -71.0855, hospitalId: 'BMC', component: 'RBC', recipientGroup: 'UNKNOWN', requestedUnits: 12, deadlineMin: 30, at: 0 }],
  },
];

export const SENTINEL_SEED = 2026;

export function buildSentinel(def: SentinelScenario): SimState {
  const s = createSimulation({ config: { seed: SENTINEL_SEED, restrictedZones: [LOGAN_ZONE], ...def.config } });
  def.setup?.(s);
  log(s, 'info', `SENTINEL scenario loaded — ${def.title}`);
  return s;
}

function ambulanceMinutes(scene: LatLon, hospital: LatLon, traffic: number): number {
  return ((haversineKm(scene, hospital) * GROUND.roadCircuity) / EMS.speedKmh) * 60 * Math.sqrt(traffic);
}

/**
 * Stage 1: register the incident alert (EMS notified). Stage 2 is scheduled for the moment
 * EMS completes its assessment: the receiving hospital's own eligible units are held for the
 * patient, and only the shortfall is requested from the network — pending human authorisation.
 */
export function registerIncident(s: SimState, spec: IncidentSpec, opts: { autoAuthorize?: boolean } = {}): Incident {
  const n = s.incidents.length + 1;
  const hospital = siteById(s.sites, spec.hospitalId);
  const traffic = s.config.trafficMultiplier;
  const onScene = s.t + EMS.responseMin * Math.sqrt(traffic);
  const assessedAt = onScene + EMS.assessMin;
  const departSceneAt = onScene + EMS.onSceneMin;
  const transport = ambulanceMinutes(spec, hospital, traffic);
  const inc: Incident = {
    id: `INC-${n}`,
    ref: `BW-${String(2600 + n * 37).padStart(5, '0')}`,
    label: spec.label,
    lat: spec.lat,
    lon: spec.lon,
    t: s.t,
    hospitalId: spec.hospitalId,
    emsStatus: 'alert',
    assessedAt,
    departSceneAt,
    patientArriveAt: departSceneAt + transport,
    ambulancePath: [{ lat: spec.lat, lon: spec.lon }, { lat: spec.lat, lon: hospital.lon }, { lat: hospital.lat, lon: hospital.lon }],
    localUnits: 0,
    requestedUnits: spec.requestedUnits,
  };
  s.incidents.push(inc);
  log(s, 'crit', `CRITICAL INCIDENT ${inc.ref} — ${spec.label}. EMS notified. No blood is ordered from an alert alone.`);
  scheduleRequests(s, [
    {
      at: assessedAt,
      hospitalId: spec.hospitalId,
      component: spec.component,
      recipientGroup: spec.recipientGroup,
      units: Math.max(1, spec.requestedUnits),
      urgency: 'critical',
      deadlineMin: spec.deadlineMin,
      label: `${inc.ref} clinical request`,
      incidentId: inc.id,
      requireAuth: !opts.autoAuthorize,
    },
  ]);
  return inc;
}

/**
 * Stage 2 hook, run by the simulation when EMS assessment completes: the receiving hospital's
 * own compatible units are held for the patient and only the shortfall goes to the network.
 */
export function holdLocalUnits(s: SimState, req: ScheduledRequest): number {
  const inc = s.incidents.find((i) => i.id === req.incidentId);
  if (!inc) return req.units;
  const lots = eligibleLots(s.lots, inc.hospitalId, req.component, req.recipientGroup, s.t);
  const local = Math.min(req.units, lots.reduce((a, l) => a + l.units, 0));
  if (local > 0) reserveUnits(s, inc.hospitalId, req.component, req.recipientGroup, local, inc.id);
  inc.localUnits = local;
  const need = req.units - local;
  log(s, 'info', `${inc.ref}: EMS assessment complete → ${siteById(s.sites, inc.hospitalId).short} holds ${local} compatible units for the patient; ${need > 0 ? `${need} requested from the network` : 'no network shipment needed'}`);
  return need;
}
hooks.holdLocal = holdLocalUnits;

export function ambulancePosition(inc: Incident, t: number): LatLon {
  if (t <= inc.departSceneAt) return inc.ambulancePath[0];
  const f = (t - inc.departSceneAt) / Math.max(1e-6, inc.patientArriveAt - inc.departSceneAt);
  return alongPath(inc.ambulancePath, Math.min(1, f));
}

export interface Readiness {
  patientArriveAt: number;
  bloodArriveAt: number | null;
  /** patient arrival − blood arrival (positive = blood first). */
  marginMin: number | null;
  stages: { key: string; label: string; at: number | null; done: boolean; note?: string }[];
  status: 'awaiting-assessment' | 'awaiting-auth' | 'in-transit' | 'received' | 'local-only' | 'no-feasible' | 'declined';
}

export function readiness(s: SimState, inc: Incident): Readiness {
  const req = s.requests.find((r) => r.incidentId === inc.id);
  const decision = req ? s.decisions.find((d) => d.id === req.decisionId) : undefined;
  const mission = req?.missionId ? s.missions.find((m) => m.id === req.missionId) : undefined;
  let bloodArriveAt: number | null = null;
  if (mission) bloodArriveAt = mission.handoffDoneAt;
  else if (req?.status === 'awaiting-auth' && decision?.chosen) bloodArriveAt = s.t + decision.chosen.etaMin; // projection if authorised now
  let status: Readiness['status'] = 'awaiting-assessment';
  if (req) {
    if (req.status === 'awaiting-auth') status = 'awaiting-auth';
    else if (req.status === 'declined') status = 'declined';
    else if (req.status === 'delivered') status = 'received';
    else if (req.status === 'dispatched') status = 'in-transit';
    else status = 'no-feasible';
  } else if (s.t >= inc.assessedAt && !s.schedule.some((x) => x.incidentId === inc.id)) status = 'local-only';
  const received = req?.status === 'delivered' ? req.deliveredAt! : null;
  return {
    patientArriveAt: inc.patientArriveAt,
    bloodArriveAt,
    marginMin: bloodArriveAt == null ? null : inc.patientArriveAt - bloodArriveAt,
    status,
    stages: [
      { key: 'alert', label: 'Incident alert · EMS notified', at: inc.t, done: s.t >= inc.t },
      { key: 'assess', label: 'EMS assessment · clinical request', at: inc.assessedAt, done: s.t >= inc.assessedAt },
      { key: 'auth', label: 'Human authorisation', at: req?.authorizedAt ?? null, done: req?.authorizedAt != null },
      { key: 'dispatch', label: 'Dispatched', at: mission?.dispatchedAt ?? null, done: !!mission },
      { key: 'receipt', label: 'Received at hospital', at: received, done: received != null && s.t >= received },
      {
        key: 'verify',
        label: 'Receipt check-in (label, temperature)',
        at: received != null ? received + EMS.receiptCheckMin : null,
        done: received != null && s.t >= received + EMS.receiptCheckMin,
        note: 'synthetic 5-min step',
      },
      { key: 'prep', label: 'Clinical verification & preparation', at: null, done: false, note: 'hospital transfusion service — not modelled' },
    ],
  };
}

/** Pick an illustrative depot label for the map legend. */
export const DEPOT_IDS = DEPOTS.map((d) => d.id);

/** Sanity helper used in tests: units eligible for an incident across the network (excluding the hospital). */
export function networkEligible(s: SimState, spec: IncidentSpec): number {
  let n = 0;
  for (const site of s.sites) {
    if (site.id === spec.hospitalId) continue;
    const lots = eligibleLots(s.lots, site.id, spec.component, spec.recipientGroup, s.t);
    n += pickUnits(lots, 1) ? lots.reduce((a, l) => a + l.units, 0) : 0;
  }
  return n;
}
