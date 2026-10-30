// Core domain types for the BLOODWING AI simulation.
// Time is always expressed in simulation minutes since the scenario started (t = 0).

export type Component = 'RBC' | 'PLT' | 'PLASMA';
export type ABO = 'O' | 'A' | 'B' | 'AB';
export type Rh = '+' | '-';
export type BloodGroup = `${ABO}${Rh}`;
/** UNKNOWN = group not yet typed (emergency release). */
export type RecipientGroup = BloodGroup | 'UNKNOWN';
export type Urgency = 'critical' | 'urgent' | 'routine';
export type SiteKind = 'hospital' | 'depot';
export type Mode = 'drone' | 'ground';
export type Policy = 'ai' | 'ground-only' | 'drone-first';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Site extends LatLon {
  id: string;
  name: string;
  short: string;
  kind: SiteKind;
  /** Depots host drones; hospitals only receive them. */
  dronesBased: boolean;
  note?: string;
}

export type LotStatus = 'released' | 'quarantine' | 'reserved' | 'expired';

export interface Lot {
  id: string;
  siteId: string;
  component: Component;
  group: BloodGroup;
  units: number;
  /** Absolute sim minute at which the lot expires. */
  expiresAt: number;
  status: LotStatus;
  /** Set when the lot is held for a scheduled transfusion (PULSE) or an incident patient. */
  reservedFor?: string;
}

export type Precip = 'none' | 'light-rain' | 'heavy-rain' | 'snow' | 'thunderstorm';

export interface Weather {
  windKmh: number;
  visibilityKm: number;
  precip: Precip;
}

export interface RestrictedZone extends LatLon {
  id: string;
  name: string;
  radiusKm: number;
}

export type DroneStatus = 'idle' | 'preparing' | 'outbound' | 'handoff' | 'returning' | 'maintenance';

export interface Drone extends LatLon {
  id: string;
  baseId: string;
  status: DroneStatus;
  /** State of charge, percent. */
  battery: number;
  cruiseKmh: number;
  /** Still-air range on a full battery with no payload, km. */
  rangeKm: number;
  maxPayloadKg: number;
  missionId?: string;
  busyMin: number;
}

export type CourierStatus = 'idle' | 'preparing' | 'enroute' | 'handoff' | 'returning';

export interface Courier extends LatLon {
  id: string;
  baseId: string;
  status: CourierStatus;
  capacityUnits: number;
  missionId?: string;
  busyMin: number;
}

export type RequestStatus = 'awaiting-auth' | 'declined' | 'queued' | 'dispatched' | 'delivered' | 'unfulfilled';

export interface BloodRequest {
  id: string;
  hospitalId: string;
  component: Component;
  recipientGroup: RecipientGroup;
  units: number;
  urgency: Urgency;
  createdAt: number;
  /** Minutes after createdAt by which the product must arrive. */
  deadlineMin: number;
  label?: string;
  status: RequestStatus;
  /** Incident that produced this request (SENTINEL). */
  incidentId?: string;
  authorizedAt?: number;
  decisionId?: string;
  missionId?: string;
  deliveredAt?: number;
  attempts: number;
}

export interface Allocation {
  lotId: string;
  group: BloodGroup;
  units: number;
  expiresAt: number;
}

export interface ScoreTerms {
  delay: number;
  lateness: number;
  cost: number;
  inventory: number;
  operational: number;
}

export interface Option {
  id: string;
  sourceId: string;
  mode: Mode;
  vehicleIds: string[];
  allocations: Allocation[];
  distanceKm: number;
  prepMin: number;
  travelMin: number;
  handoffMin: number;
  /** Arrival, minutes after the decision time. */
  etaMin: number;
  /** Return leg duration back to base, minutes. */
  returnMin: number;
  costUsd: number;
  /** Battery percent used per drone (drone mode only). */
  batteryUsePct?: number;
  /** Lowest battery left on landing back at base (drone mode only). */
  batteryLeftPct?: number;
  meetsDeadline: boolean;
  slackMin: number;
  /** ETA if every travel leg takes 30% longer than planned. */
  robustEtaMin: number;
  terms: ScoreTerms;
  score: number;
  notes: string[];
}

export interface Rejection {
  sourceId: string;
  mode: Mode;
  reasons: string[];
}

export type DecisionStatus = 'dispatch' | 'dispatch-late' | 'no-feasible';

export interface Weights {
  delay: number;
  lateness: number;
  cost: number;
  inventory: number;
  operational: number;
}

export interface Decision {
  id: string;
  requestId: string;
  at: number;
  policy: Policy;
  status: DecisionStatus;
  chosen?: Option;
  /** Other feasible options, best first. */
  alternatives: Option[];
  rejected: Rejection[];
  weights: Weights;
  explanation: string[];
  /** Earliest feasible ground ETA from any source (null if none) — used for "time saved". */
  groundBaselineEta: number | null;
  /** Source inventory of the requested component before/after this dispatch (eligible units). */
  sourceBefore?: number;
  sourceAfter?: number;
  humanReview: boolean;
}

export type MissionPhase = 'preparing' | 'enroute' | 'handoff' | 'returning' | 'complete';

export interface TimelinePoint extends LatLon {
  t: number;
}

export interface MilkRunStop {
  siteId: string;
  arriveAt: number;
  doneAt: number;
  deliveries: { component: Component; group: BloodGroup; units: number; expiresAt: number; reservedFor?: string }[];
  delivered?: boolean;
}

export interface Mission {
  id: string;
  kind: 'request' | 'milkrun';
  requestId: string;
  decisionId: string;
  mode: Mode;
  sourceId: string;
  destId: string;
  vehicleIds: string[];
  component: Component;
  units: number;
  phase: MissionPhase;
  dispatchedAt: number;
  departAt: number;
  arriveAt: number;
  handoffDoneAt: number;
  returnAt: number;
  path: LatLon[];
  deadlineAt: number;
  onTime?: boolean;
  batteryUsePct?: number;
  /** Position over time; vehicles are interpolated along it. */
  timeline: TimelinePoint[];
  stops?: MilkRunStop[];
  distanceKm?: number;
}

export interface Incident extends LatLon {
  id: string;
  ref: string;
  label: string;
  t: number;
  hospitalId: string;
  emsStatus: 'alert' | 'on-scene' | 'assessed' | 'transporting' | 'arrived';
  assessedAt: number;
  departSceneAt: number;
  patientArriveAt: number;
  ambulancePath: LatLon[];
  requestId?: string;
  /** Units the receiving hospital already holds for the patient. */
  localUnits: number;
  requestedUnits: number;
}

export type EventSeverity = 'info' | 'ok' | 'warn' | 'crit';

export interface SimEvent {
  t: number;
  text: string;
  severity: EventSeverity;
}

export interface ScheduledRequest {
  at: number;
  hospitalId: string;
  component: Component;
  recipientGroup: RecipientGroup;
  units: number;
  urgency: Urgency;
  deadlineMin: number;
  label?: string;
  incidentId?: string;
  requireAuth?: boolean;
}

export interface SimConfig {
  seed: number;
  policy: Policy;
  /** Multiplies ground travel time (1 = normal traffic). */
  trafficMultiplier: number;
  /** null = weather feed missing → drones require human review. */
  weather: Weather | null;
  /** Optional time-varying weather windows (override `weather` while active). */
  weatherWindows?: { start: number; end: number; weather: Weather }[];
  dronesEnabled: boolean;
  restrictedZones: RestrictedZone[];
  /** Background demand, requests per hour across the network (0 = off). */
  ambientPerHour: number;
  /** Depot resupply from the regional blood supplier every N minutes (0 = off). */
  resupplyEveryMin: number;
  weightsOverride?: Partial<Record<Urgency, Weights>>;
}

export interface SimState {
  t: number;
  config: SimConfig;
  sites: Site[];
  lots: Lot[];
  drones: Drone[];
  couriers: Courier[];
  requests: BloodRequest[];
  decisions: Decision[];
  missions: Mission[];
  events: SimEvent[];
  schedule: ScheduledRequest[];
  expiredUnits: Record<Component, number>;
  rngState: number;
  counters: { req: number; mission: number; decision: number; lot: number };
  /** Optional ML forecast: expected units demanded at each hospital over the next 6 h. */
  forecastUnits6h?: Record<string, number>;
  lastRetryAt: number;
  lastResupplyAt: number;
  incidents: Incident[];
  appointments: Appointment[];
  orders: ReplenOrder[];
}

export interface Appointment {
  id: string;
  patientId: string;
  condition: string;
  hospitalId: string;
  /** Sim minute of the appointment. */
  at: number;
  component: Component;
  group: BloodGroup;
  units: number;
  orderStatus: 'confirmed' | 'pending' | 'cancelled';
  /** Set once PULSE has acted on a confirmed order. */
  planned?: boolean;
}

export interface ReplenOrder {
  id: string;
  hospitalId: string;
  component: Component;
  group: BloodGroup;
  units: number;
  /** Must arrive by this sim minute. */
  latest: number;
  source: 'pulse' | 'routine';
  reservedFor?: string;
  status: 'open' | 'routed' | 'delivered';
}
