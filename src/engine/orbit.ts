// ORBIT — milk-run and network optimisation.
//
// Problem: capacitated vehicle routing with time windows (CVRPTW) from one hub.
//   Hard: vehicle capacity, arrival before each stop's latest time, depot stock eligibility,
//         available vehicles, return to base.
//   Objective: fixed cost per vehicle + cost per road km + late penalty (none if feasible).
// Method: a documented HEURISTIC — nearest-feasible-neighbour construction, then 2-opt inside
//   routes and stop relocation between routes, accepting only feasible improvements.
//   It carries no optimality certificate; results are "improved feasible", never "optimal".
// Drones are not used for multi-stop milk runs (payload ≤ 2 kg); a stop whose window cannot be
// met by road is offered as a direct drone mission if that is feasible.

import { DRONE, GROUND, GROUP_FREQ, ORBIT as SYNTHETIC } from './assumptions';
import { energyPlan, groundMinutes, payloadKg, unitsPerDrone, weatherCheck } from './fleet';
import { haversineKm } from './geo';
import { eligibleLots, isDispatchable, pickUnits } from './inventory';
import { siteById } from './network';
import { currentWeather, log } from './simulation';
import type { Allocation, BloodGroup, Component, LatLon, Mission, MilkRunStop, ReplenOrder, SimState } from './types';

export interface StopDemand {
  siteId: string;
  units: number;
  latest: number;
  orders: ReplenOrder[];
}

export interface RouteStop {
  siteId: string;
  units: number;
  arriveAt: number;
  latest: number;
  orders: ReplenOrder[];
}

export interface Route {
  vehicleId: string;
  stops: RouteStop[];
  distanceKm: number;
  departAt: number;
  returnAt: number;
  load: number;
  utilization: number;
  costUsd: number;
}

export interface OrbitSolution {
  hubId: string;
  departAt: number;
  routes: Route[];
  droneDirect: { order: ReplenOrder; droneId: string; etaMin: number }[];
  unserved: { order: ReplenOrder; reason: string }[];
  totalKm: number;
  totalCost: number;
  vehicles: number;
  individual: { trips: number; totalKm: number; totalCost: number; vehicleMinutes: number };
  routedMinutes: number;
  iterations: number;
  allocations: Map<string, Allocation[]>;
}

const serviceMin = SYNTHETIC.serviceMin;

function legMin(a: LatLon, b: LatLon, traffic: number): number {
  return groundMinutes(haversineKm(a, b), traffic);
}
function legKm(a: LatLon, b: LatLon): number {
  return haversineKm(a, b) * GROUND.roadCircuity;
}

/** Routine top-up orders: hospitals below their target stock for common groups. */
export function routineOrders(s: SimState, horizonMin = 6 * 60): ReplenOrder[] {
  const out: ReplenOrder[] = [];
  const lines: [Component, BloodGroup, number][] = [];
  for (const [g, f] of GROUP_FREQ) if (f >= 6) lines.push(['RBC', g as BloodGroup, Math.max(2, Math.round((SYNTHETIC.targetRBC * f) / 100))]);
  lines.push(['PLT', 'A+', 3], ['PLT', 'O+', 3], ['PLASMA', 'A+', 4], ['PLASMA', 'AB+', 3]);
  let n = s.orders.length;
  for (const h of s.sites.filter((x) => x.kind === 'hospital')) {
    for (const [component, group, target] of lines) {
      const have = s.lots.filter((l) => l.siteId === h.id && l.component === component && l.group === group && isDispatchable(l, s.t)).reduce((a, l) => a + l.units, 0);
      const pending = s.orders.filter((o) => o.hospitalId === h.id && o.component === component && o.group === group && o.status !== 'delivered').reduce((a, o) => a + o.units, 0);
      const deficit = target - have - pending;
      if (deficit >= 2) {
        n++;
        out.push({ id: `ORD-${String(n).padStart(3, '0')}`, hospitalId: h.id, component, group, units: deficit, latest: s.t + horizonMin, source: 'routine', status: 'open' });
      }
    }
  }
  return out;
}

function routeTimes(hub: LatLon, stops: { siteId: string; latest: number }[], s: SimState, departAt: number, traffic: number) {
  let t = departAt;
  let cur: LatLon = hub;
  let km = 0;
  const arrivals: number[] = [];
  let feasible = true;
  for (const st of stops) {
    const site = siteById(s.sites, st.siteId);
    t += legMin(cur, site, traffic);
    km += legKm(cur, site);
    arrivals.push(t);
    if (t > st.latest + 1e-6) feasible = false;
    t += serviceMin;
    cur = site;
  }
  t += legMin(cur, hub, traffic);
  km += legKm(cur, hub);
  return { arrivals, returnAt: t, km, feasible };
}

export function solveMilkRun(s: SimState, orders: ReplenOrder[], opts: { hubId: string; capacity?: number; traffic?: number; departIn?: number }): OrbitSolution {
  const hub = siteById(s.sites, opts.hubId);
  const cap = opts.capacity ?? SYNTHETIC.vanCapacityUnits;
  const traffic = opts.traffic ?? s.config.trafficMultiplier;
  const departAt = s.t + (opts.departIn ?? GROUND.prepMin);
  const unserved: OrbitSolution['unserved'] = [];
  const allocations = new Map<string, Allocation[]>();

  // 1. Stock check at the hub (FEFO, exact donor group for top-ups; no double counting)
  const taken = new Map<string, number>();
  const served: ReplenOrder[] = [];
  for (const o of [...orders].sort((a, b) => a.latest - b.latest)) {
    const lots = eligibleLots(s.lots, hub.id, o.component, o.group, s.t)
      .filter((l) => l.group === o.group)
      .map((l) => ({ ...l, units: l.units - (taken.get(l.id) ?? 0) }))
      .filter((l) => l.units > 0);
    const alloc = pickUnits(lots, o.units);
    if (!alloc) {
      unserved.push({ order: o, reason: `${hub.short} lacks ${o.units} eligible ${o.component} ${o.group}` });
      continue;
    }
    for (const a of alloc) taken.set(a.lotId, (taken.get(a.lotId) ?? 0) + a.units);
    allocations.set(o.id, alloc);
    served.push(o);
  }

  // 2. Aggregate to stops (split if a single hospital exceeds vehicle capacity)
  const byHosp = new Map<string, ReplenOrder[]>();
  for (const o of served) byHosp.set(o.hospitalId, [...(byHosp.get(o.hospitalId) ?? []), o]);
  let stops: StopDemand[] = [];
  for (const [siteId, os] of byHosp) {
    let chunk: ReplenOrder[] = [];
    let units = 0;
    for (const o of os) {
      if (units + o.units > cap && chunk.length) {
        stops.push({ siteId, units, latest: Math.min(...chunk.map((c) => c.latest)), orders: chunk });
        chunk = [];
        units = 0;
      }
      chunk.push(o);
      units += o.units;
    }
    if (chunk.length) stops.push({ siteId, units, latest: Math.min(...chunk.map((c) => c.latest)), orders: chunk });
  }

  // 3. Window check by road; offer infeasible stops to a direct drone if possible
  const droneDirect: OrbitSolution['droneDirect'] = [];
  const weather = currentWeather(s);
  const usedDrones = new Set<string>();
  stops = stops.filter((st) => {
    const site = siteById(s.sites, st.siteId);
    if (departAt + legMin(hub, site, traffic) <= st.latest) return true;
    const dist = haversineKm(hub, site);
    const drone = s.drones.find((d) => d.baseId === hub.id && d.status === 'idle' && !usedDrones.has(d.id));
    const single = st.orders.length === 1 ? st.orders[0] : null;
    if (single && drone && weatherCheck(weather).ok && single.units <= unitsPerDrone(single.component, drone.maxPayloadKg)) {
      const plan = energyPlan(drone, dist, payloadKg(single.component, single.units), weather);
      const eta = DRONE.prepMin + plan.outboundMin + DRONE.handoffMin;
      if (!plan.exceedsRange && drone.battery - plan.requiredPct >= DRONE.reservePct && s.t + eta <= st.latest) {
        usedDrones.add(drone.id);
        droneDirect.push({ order: single, droneId: drone.id, etaMin: eta });
        return false;
      }
    }
    for (const o of st.orders) unserved.push({ order: o, reason: `window at ${site.short} cannot be met by road from ${hub.short}` });
    return false;
  });

  // 4. Construction: nearest feasible neighbour
  const vehicles = s.couriers.filter((c) => c.baseId === hub.id && c.status === 'idle');
  const routesStops: StopDemand[][] = [];
  const left = new Set(stops);
  while (left.size) {
    const r: StopDemand[] = [];
    let load = 0;
    let cur: LatLon = hub;
    let t = departAt;
    for (;;) {
      let best: StopDemand | null = null;
      let bestMin = Infinity;
      for (const st of left) {
        if (load + st.units > cap) continue;
        const site = siteById(s.sites, st.siteId);
        const arr = t + legMin(cur, site, traffic);
        if (arr > st.latest) continue;
        const m = arr - t;
        if (m < bestMin) {
          bestMin = m;
          best = st;
        }
      }
      if (!best) break;
      const site = siteById(s.sites, best.siteId);
      t += legMin(cur, site, traffic) + serviceMin;
      cur = site;
      load += best.units;
      r.push(best);
      left.delete(best);
    }
    if (!r.length) {
      for (const st of left) for (const o of st.orders) unserved.push({ order: o, reason: 'no feasible route position' });
      break;
    }
    routesStops.push(r);
  }

  // 5. Improvement: 2-opt within routes, relocate between routes
  const routeKm = (r: StopDemand[]) => routeTimes(hub, r, s, departAt, traffic);
  let iterations = 0;
  let improved = true;
  while (improved && iterations < 200) {
    improved = false;
    iterations++;
    for (let ri = 0; ri < routesStops.length; ri++) {
      const r = routesStops[ri];
      for (let i = 0; i < r.length - 1; i++) {
        for (let j = i + 1; j < r.length; j++) {
          const cand = [...r.slice(0, i), ...r.slice(i, j + 1).reverse(), ...r.slice(j + 1)];
          const c = routeKm(cand);
          if (c.feasible && c.km < routeKm(r).km - 1e-6) {
            routesStops[ri] = cand;
            improved = true;
          }
        }
      }
    }
    for (let a = 0; a < routesStops.length && !improved; a++) {
      for (let b = 0; b < routesStops.length && !improved; b++) {
        if (a === b) continue;
        for (let i = 0; i < routesStops[a].length && !improved; i++) {
          const st = routesStops[a][i];
          const loadB = routesStops[b].reduce((x, y) => x + y.units, 0);
          if (loadB + st.units > cap) continue;
          const ra = routesStops[a].filter((_, k) => k !== i);
          for (let pos = 0; pos <= routesStops[b].length; pos++) {
            const rb = [...routesStops[b].slice(0, pos), st, ...routesStops[b].slice(pos)];
            const before = routeKm(routesStops[a]).km + routeKm(routesStops[b]).km;
            const ca = ra.length ? routeKm(ra) : { km: 0, feasible: true };
            const cb = routeKm(rb);
            const fixedSaving = ra.length ? 0 : SYNTHETIC.vehicleFixedUsd / GROUND.costPerKmUsd;
            if (ca.feasible && cb.feasible && ca.km + cb.km < before + fixedSaving - 1e-6) {
              routesStops[a] = ra;
              routesStops[b] = rb;
              improved = true;
              break;
            }
          }
        }
      }
    }
    for (let k = routesStops.length - 1; k >= 0; k--) if (!routesStops[k].length) routesStops.splice(k, 1);
  }

  // 6. Assign vehicles; routes without a vehicle cannot run
  const routes: Route[] = [];
  routesStops.forEach((rs, i) => {
    const v = vehicles[i];
    if (!v) {
      for (const st of rs) for (const o of st.orders) unserved.push({ order: o, reason: `no idle vehicle at ${hub.short}` });
      return;
    }
    const times = routeKm(rs);
    const load = rs.reduce((a, b) => a + b.units, 0);
    routes.push({
      vehicleId: v.id,
      stops: rs.map((st, k) => ({ siteId: st.siteId, units: st.units, arriveAt: times.arrivals[k], latest: st.latest, orders: st.orders })),
      distanceKm: times.km,
      departAt,
      returnAt: times.returnAt,
      load,
      utilization: load / cap,
      costUsd: SYNTHETIC.vehicleFixedUsd + GROUND.costPerKmUsd * times.km,
    });
  });

  // Baseline: every order shipped separately as its own round trip
  // One trip per hospital × component request (how separate routine requests would ship).
  const routedOrders = routes.flatMap((r) => r.stops.flatMap((st) => st.orders));
  const trips = [...new Set(routedOrders.map((o) => `${o.hospitalId}|${o.component}`))];
  let iKm = 0;
  let iMin = 0;
  for (const k of trips) {
    const site = siteById(s.sites, k.split('|')[0]);
    iKm += 2 * legKm(hub, site);
    iMin += 2 * legMin(hub, site, traffic) + serviceMin;
  }
  const totalKm = routes.reduce((a, r) => a + r.distanceKm, 0);
  return {
    hubId: hub.id,
    departAt,
    routes,
    droneDirect,
    unserved,
    totalKm,
    totalCost: routes.reduce((a, r) => a + r.costUsd, 0),
    vehicles: routes.length,
    individual: { trips: trips.length, totalKm: iKm, totalCost: trips.length * SYNTHETIC.vehicleFixedUsd + GROUND.costPerKmUsd * iKm, vehicleMinutes: iMin },
    routedMinutes: routes.reduce((a, r) => a + (r.returnAt - r.departAt), 0),
    iterations,
    allocations,
  };
}

/** Commit the plan: deduct hub stock, launch milk-run missions; stops add stock on arrival. */
export function executeMilkRun(s: SimState, sol: OrbitSolution): Mission[] {
  const hub = siteById(s.sites, sol.hubId);
  const out: Mission[] = [];
  for (const r of sol.routes) {
    const courier = s.couriers.find((c) => c.id === r.vehicleId);
    if (!courier || courier.status !== 'idle') throw new Error(`Vehicle ${r.vehicleId} is not idle`);
    const stops: MilkRunStop[] = [];
    for (const st of r.stops) {
      const deliveries: MilkRunStop['deliveries'] = [];
      for (const o of st.orders) {
        const alloc = sol.allocations.get(o.id)!;
        for (const a of alloc) {
          const lot = s.lots.find((l) => l.id === a.lotId)!;
          if (!isDispatchable(lot, s.t) || lot.units < a.units) throw new Error(`Lot ${a.lotId} no longer available`);
          lot.units -= a.units;
          deliveries.push({ component: lot.component, group: lot.group, units: a.units, expiresAt: lot.expiresAt, reservedFor: o.reservedFor });
        }
        const live = s.orders.find((x) => x.id === o.id);
        if (live) live.status = 'routed';
        else s.orders.push({ ...o, status: 'routed' });
      }
      stops.push({ siteId: st.siteId, arriveAt: st.arriveAt, doneAt: st.arriveAt + serviceMin, deliveries });
    }
    s.counters.mission++;
    const id = `MR-${String(s.counters.mission).padStart(3, '0')}`;
    const timeline = [{ t: s.t, lat: hub.lat, lon: hub.lon }, { t: r.departAt, lat: hub.lat, lon: hub.lon }];
    for (const st of stops) {
      const site = siteById(s.sites, st.siteId);
      timeline.push({ t: st.arriveAt, lat: site.lat, lon: site.lon }, { t: st.doneAt, lat: site.lat, lon: site.lon });
    }
    timeline.push({ t: r.returnAt, lat: hub.lat, lon: hub.lon });
    const m: Mission = {
      id,
      kind: 'milkrun',
      requestId: '',
      decisionId: '',
      mode: 'ground',
      sourceId: hub.id,
      destId: stops[stops.length - 1].siteId,
      vehicleIds: [courier.id],
      component: 'RBC',
      units: r.load,
      phase: 'preparing',
      dispatchedAt: s.t,
      departAt: r.departAt,
      arriveAt: stops[0].arriveAt,
      handoffDoneAt: stops[stops.length - 1].doneAt,
      returnAt: r.returnAt,
      path: timeline.map((p) => ({ lat: p.lat, lon: p.lon })),
      deadlineAt: Math.min(...r.stops.map((x) => x.latest)),
      timeline,
      stops,
      distanceKm: r.distanceKm,
    };
    courier.status = 'preparing';
    courier.missionId = id;
    s.missions.push(m);
    out.push(m);
    log(s, 'ok', `ORBIT ${id}: ${courier.id} milk run ${hub.short} → ${stops.map((x) => siteById(s.sites, x.siteId).short).join(' → ')} → ${hub.short} · ${r.load} units · ${r.distanceKm.toFixed(1)} km`);
  }
  return out;
}

export function orderDeliveredSync(s: SimState): void {
  for (const m of s.missions) {
    if (m.kind !== 'milkrun' || !m.stops) continue;
    for (const st of m.stops) {
      if (!st.delivered) continue;
      for (const o of s.orders) if (o.status === 'routed' && o.hospitalId === st.siteId) o.status = 'delivered';
    }
  }
}

export const ORBIT_NOTE = 'Heuristic: nearest-feasible-neighbour construction + 2-opt + relocate. Improved feasible solution — not proven optimal.';

/** Network mode: try each hub in turn on whatever earlier hubs could not serve. */
export function solveNetwork(s: SimState, orders: ReplenOrder[], hubOrder: string[] = ['DA', 'DB', 'DC'], opts: { traffic?: number } = {}): OrbitSolution[] {
  const out: OrbitSolution[] = [];
  let remaining = orders;
  for (const hubId of hubOrder) {
    if (!remaining.length) break;
    const sol = solveMilkRun(s, remaining, { hubId, traffic: opts.traffic });
    if (!sol.routes.length && !sol.droneDirect.length) continue;
    out.push(sol);
    const servedIds = new Set([...sol.routes.flatMap((r) => r.stops.flatMap((st) => st.orders.map((o) => o.id))), ...sol.droneDirect.map((d) => d.order.id)]);
    remaining = remaining.filter((o) => !servedIds.has(o.id));
  }
  // Report what nobody could serve, once.
  if (out.length) {
    const last = out[out.length - 1];
    const servedAll = new Set(out.flatMap((sol) => sol.routes.flatMap((r) => r.stops.flatMap((st) => st.orders.map((o) => o.id)))));
    last.unserved = remaining.filter((o) => !servedAll.has(o.id)).map((o) => ({ order: o, reason: last.unserved.find((u) => u.order.id === o.id)?.reason ?? 'no hub could serve it' }));
    for (const sol of out.slice(0, -1)) sol.unserved = [];
  }
  return out;
}
