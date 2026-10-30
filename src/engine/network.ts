import type { RestrictedZone, Site } from './types';

// Hospitals are ILLUSTRATIVE network nodes at approximate campus coordinates.
// No hospital participates in, endorses, or supplied data to this project.
// Depots are FICTIONAL simulation facilities; they do not represent any real blood bank.

export const SITES: Site[] = [
  { id: 'MGH', name: 'Massachusetts General Hospital', short: 'MGH', kind: 'hospital', lat: 42.3626, lon: -71.0688, dronesBased: false },
  { id: 'BWH', name: "Brigham and Women's Hospital", short: 'Brigham', kind: 'hospital', lat: 42.3361, lon: -71.1069, dronesBased: false },
  { id: 'BMC', name: 'Boston Medical Center', short: 'BMC', kind: 'hospital', lat: 42.3348, lon: -71.0731, dronesBased: false },
  { id: 'BIDMC', name: 'Beth Israel Deaconess Medical Center', short: 'BIDMC', kind: 'hospital', lat: 42.3389, lon: -71.106, dronesBased: false },
  { id: 'BCH', name: "Boston Children's Hospital", short: "Children's", kind: 'hospital', lat: 42.3374, lon: -71.1053, dronesBased: false },
  { id: 'TMC', name: 'Tufts Medical Center', short: 'Tufts MC', kind: 'hospital', lat: 42.3496, lon: -71.0636, dronesBased: false },
  { id: 'DA', name: 'Depot Alpha', short: 'Alpha', kind: 'depot', lat: 42.3215, lon: -71.062, dronesBased: true, note: 'Fictional simulation depot — south' },
  { id: 'DB', name: 'Depot Bravo', short: 'Bravo', kind: 'depot', lat: 42.365, lon: -71.103, dronesBased: true, note: 'Fictional simulation depot — Cambridge side' },
  { id: 'DC', name: 'Depot Charlie', short: 'Charlie', kind: 'depot', lat: 42.3915, lon: -71.035, dronesBased: true, note: 'Fictional simulation depot — north' },
];

export const HOSPITALS = SITES.filter((s) => s.kind === 'hospital');
export const DEPOTS = SITES.filter((s) => s.kind === 'depot');

export function siteById(sites: Site[], id: string): Site {
  const s = sites.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown site ${id}`);
  return s;
}

/** Simplified no-fly assumption around the airport. Real airspace is far more complex. */
export const LOGAN_ZONE: RestrictedZone = { id: 'BOS', name: 'Airport no-fly assumption', lat: 42.3656, lon: -71.0096, radiusKm: 2.5 };

/** Optional temporary flight restriction used in experiments. */
export const DOWNTOWN_TFR: RestrictedZone = { id: 'TFR', name: 'Temporary restriction (simulated)', lat: 42.3555, lon: -71.064, radiusKm: 1.3 };

/** Simulation clock starts Friday 30 Oct 2026 at 14:00 (the Builder Blitz). */
export const SIM_START = { dayOfWeek: 5, hour: 14, date: new Date(2026, 9, 30, 14, 0) };

/** Absolute calendar date for a sim minute. */
export function simDate(t: number): Date {
  return new Date(SIM_START.date.getTime() + t * 60000);
}

/** Sim minute for a calendar date/time (local). */
export function simMinuteOf(d: Date): number {
  return Math.round((d.getTime() - SIM_START.date.getTime()) / 60000);
}

export function clockLabel(t: number): string {
  const total = SIM_START.hour * 60 + t;
  const day = Math.floor(total / 1440);
  const m = ((total % 1440) + 1440) % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(Math.floor(m % 60)).padStart(2, '0');
  if (day <= 0) return `${hh}:${mm}`;
  const d = simDate(t);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${hh}:${mm}`;
}
