import type { LatLon } from './types';

const R = 6371; // km

export function haversineKm(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Local equirectangular projection to km around an origin; accurate at city scale. */
function toKm(p: LatLon, origin: LatLon): [number, number] {
  const kx = 111.32 * Math.cos((origin.lat * Math.PI) / 180);
  return [(p.lon - origin.lon) * kx, (p.lat - origin.lat) * 110.574];
}

/** Does the straight segment a→b pass within radiusKm of center? */
export function segmentIntersectsCircle(a: LatLon, b: LatLon, center: LatLon, radiusKm: number): boolean {
  const [ax, ay] = toKm(a, center);
  const [bx, by] = toKm(b, center);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = ax + t * dx;
  const py = ay + t * dy;
  return Math.hypot(px, py) <= radiusKm;
}

export function lerpLatLon(a: LatLon, b: LatLon, f: number): LatLon {
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

/** Position at fraction f (0..1) of the total length of a polyline. */
export function alongPath(path: LatLon[], f: number): LatLon {
  if (path.length === 1 || f <= 0) return path[0];
  if (f >= 1) return path[path.length - 1];
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const d = haversineKm(path[i - 1], path[i]);
    segs.push(d);
    total += d;
  }
  let target = f * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i] || i === segs.length - 1) {
      return lerpLatLon(path[i], path[i + 1], segs[i] === 0 ? 1 : Math.min(1, target / segs[i]));
    }
    target -= segs[i];
  }
  return path[path.length - 1];
}

export function bearingDeg(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
