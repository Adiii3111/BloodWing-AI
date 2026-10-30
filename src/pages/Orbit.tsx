import { Pause, Play, Route as RouteIcon, Send } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MapView } from '../components/MapView';
import { EventLog, MissionList } from '../components/Panels';
import { Badge, Panel, Section, SimLabel } from '../components/ui';
import { ORBIT, GROUND } from '../engine/assumptions';
import { DEPOTS, siteById } from '../engine/network';
import { ORBIT_NOTE } from '../engine/orbit';
import type { LatLon } from '../engine/types';
import { clock, fmtUsd } from '../lib/format';
import { useSim } from '../lib/store';

const ROUTE_COLORS = ['#2dd4bf', '#22d3ee', '#5eead4', '#67e8f9'];

export default function Orbit() {
  const sim = useSim();
  const s = sim.state;
  const orders = sim.orbitOrders();
  const sol = sim.orbit;

  useEffect(() => {
    if (!sim.orbit) sim.solveOrbit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overlays = useMemo(() => {
    if (!sol) return [];
    const out: { path: LatLon[]; color: string; dashed?: boolean; weight?: number }[] = [];
    let k = 0;
    for (const x of sol) {
      const hub = siteById(s.sites, x.hubId);
      for (const r of x.routes) {
        out.push({ path: [hub, ...r.stops.map((st) => siteById(s.sites, st.siteId)), hub], color: ROUTE_COLORS[k++ % ROUTE_COLORS.length], dashed: true, weight: 2.5 });
      }
    }
    return out;
  }, [sol, s.sites]);

  const totals = sol
    ? {
        km: sol.reduce((a, x) => a + x.totalKm, 0),
        cost: sol.reduce((a, x) => a + x.totalCost, 0),
        vehicles: sol.reduce((a, x) => a + x.vehicles, 0),
        minutes: sol.reduce((a, x) => a + x.routedMinutes, 0),
        iKm: sol.reduce((a, x) => a + x.individual.totalKm, 0),
        iCost: sol.reduce((a, x) => a + x.individual.totalCost, 0),
        iTrips: sol.reduce((a, x) => a + x.individual.trips, 0),
        iMin: sol.reduce((a, x) => a + x.individual.vehicleMinutes, 0),
        units: sol.reduce((a, x) => a + x.routes.reduce((b, r) => b + r.load, 0), 0),
        stops: sol.reduce((a, x) => a + x.routes.reduce((b, r) => b + r.stops.length, 0), 0),
        unserved: sol.flatMap((x) => x.unserved),
        drone: sol.flatMap((x) => x.droneDirect),
      }
    : null;

  const compare = totals
    ? [
        { metric: 'Road km', individual: Math.round(totals.iKm), milk: Math.round(totals.km) },
        { metric: 'Vehicle dispatches', individual: totals.iTrips, milk: totals.vehicles },
        { metric: 'Vehicle hours', individual: +(totals.iMin / 60).toFixed(1), milk: +(totals.minutes / 60).toFixed(1) },
      ]
    : [];

  const activeRuns = s.missions.filter((m) => m.kind === 'milkrun' && m.phase !== 'complete');

  return (
    <div>
      <Section
        num="04"
        eyebrow="ORBIT — Milk-run and network optimisation"
        title={<>One network. <span className="text-[#5eead4]">Smarter movement.</span></>}
        lede="Instead of a separate vehicle for every routine request, ORBIT consolidates replenishment into milk runs: hub → hospital → hospital → hub, within vehicle capacity and each stop's time window. Emergency requests stay separate — SENTINEL never waits for a milk run."
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SimLabel />
          <Badge tone="signal">CVRPTW · heuristic, not proven optimal</Badge>
          <span className="text-[12px] text-dim">Hub order:</span>
          {DEPOTS.map((d) => {
            const on = sim.orbitHubs.includes(d.id);
            return (
              <button
                key={d.id}
                className={`chip ${on ? 'border-[#2dd4bf]/60 text-[#5eead4]' : ''}`}
                aria-pressed={on}
                onClick={() => {
                  const next = on ? sim.orbitHubs.filter((x) => x !== d.id) : [...sim.orbitHubs, d.id];
                  if (next.length) sim.solveOrbit(next);
                }}
              >
                {d.short}
              </button>
            );
          })}
          <button className="btn btn-sm" onClick={() => sim.solveOrbit()}>
            <RouteIcon size={13} /> Re-optimise
          </button>
          <button className="btn btn-sm btn-primary" disabled={!sol || !totals?.vehicles} onClick={() => sim.executeOrbit()}>
            <Send size={13} /> Dispatch milk runs
          </button>
          {activeRuns.length > 0 &&
            (sim.running ? (
              <button className="btn btn-sm" onClick={() => sim.pause()}>
                <Pause size={13} /> Pause
              </button>
            ) : (
              <button className="btn btn-sm" onClick={() => sim.resume()}>
                <Play size={13} /> Resume
              </button>
            ))}
        </div>

        <div className="grid gap-3 xl:grid-cols-[1fr_440px]">
          <div className="space-y-3">
            <MapView height="min(56vh, 600px)" overlays={overlays} />
            {totals && (
              <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
                <Panel title="Individual deliveries vs consolidated milk run — same orders">
                  <div className="h-[210px]">
                    <ResponsiveContainer>
                      <BarChart data={compare} layout="vertical" margin={{ top: 4, right: 36, left: 12, bottom: 0 }} barGap={2}>
                        <CartesianGrid stroke="rgba(148,163,184,.08)" horizontal={false} />
                        <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="metric" tick={{ fill: '#94a3b8', fontSize: 11 }} width={110} axisLine={false} tickLine={false} />
                        <Tooltip cursor={{ fill: 'rgba(148,163,184,.06)' }} contentStyle={{ background: '#07111f', border: '1px solid rgba(148,163,184,.2)', borderRadius: 8, fontSize: 12 }} />
                        <Bar dataKey="individual" name="Individual deliveries" fill="#c47a32" radius={[0, 4, 4, 0]} barSize={12}>
                          <LabelList dataKey="individual" position="right" fill="#94a3b8" fontSize={11} />
                        </Bar>
                        <Bar dataKey="milk" name="Milk run" fill="#0ea5bf" radius={[0, 4, 4, 0]} barSize={12}>
                          <LabelList dataKey="milk" position="right" fill="#94a3b8" fontSize={11} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-1 flex gap-3 text-[11px] text-mist">
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-sm bg-polA" /> Individual deliveries
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-2 w-2 rounded-sm bg-polC" /> Milk run
                    </span>
                  </div>
                </Panel>
                <Panel title="Measured on this scenario">
                  <dl className="grid grid-cols-2 gap-y-2 text-[12.5px]">
                    <dt className="text-dim">Units consolidated</dt>
                    <dd className="mono">{totals.units} units · {totals.stops} stops</dd>
                    <dt className="text-dim">Road distance</dt>
                    <dd className="mono">
                      {totals.km.toFixed(1)} km <span className="text-dim">vs {totals.iKm.toFixed(1)}</span>{' '}
                      <span className="text-ok">({totals.iKm > 0 ? (((totals.iKm - totals.km) / totals.iKm) * 100).toFixed(0) : 0}% less)</span>
                    </dd>
                    <dt className="text-dim">Transport cost (synthetic)</dt>
                    <dd className="mono">
                      {fmtUsd(totals.cost)} <span className="text-dim">vs {fmtUsd(totals.iCost)}</span>
                    </dd>
                    <dt className="text-dim">Vehicles dispatched</dt>
                    <dd className="mono">
                      {totals.vehicles} <span className="text-dim">vs {totals.iTrips} trips</span>
                    </dd>
                    <dt className="text-dim">Drone direct (window rescue)</dt>
                    <dd className="mono">{totals.drone.length}</dd>
                    <dt className="text-dim">Unserved order lines</dt>
                    <dd className="mono">{totals.unserved.length}</dd>
                  </dl>
                  <p className="mt-2 text-[11px] text-dim">
                    Individual baseline = one round trip per hospital × component request, from the same hub, same orders, same traffic. Cost = ${ORBIT.vehicleFixedUsd} per vehicle + ${GROUND.costPerKmUsd}/road km (synthetic).
                  </p>
                </Panel>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {sol?.map((x) =>
              x.routes.map((r, i) => (
                <Panel
                  key={r.vehicleId}
                  title={
                    <span className="text-[#5eead4]">
                      {siteById(s.sites, x.hubId).short} hub · {r.vehicleId}
                    </span>
                  }
                  right={<Badge tone="signal">{Math.round(r.utilization * 100)}% full</Badge>}
                >
                  <ol className="relative space-y-1.5 border-l border-[#2dd4bf]/30 pl-4">
                    <li className="text-[12px] text-mist">
                      <span className="mono text-dim">{clock(r.departAt)}</span> depart {siteById(s.sites, x.hubId).short}
                    </li>
                    {r.stops.map((st) => (
                      <li key={st.siteId + st.arriveAt} className="text-[12.5px]">
                        <span className="absolute -left-[5px] mt-1.5 h-2 w-2 rounded-full" style={{ background: ROUTE_COLORS[i % 4] }} />
                        <span className="mono text-dim">{clock(st.arriveAt)}</span> <span className="font-semibold">{siteById(s.sites, st.siteId).short}</span> · {st.units} units
                        <span className="text-dim"> · window by {clock(st.latest)}</span>
                        {st.orders.some((o) => o.source === 'pulse') && <Badge tone="blue">PULSE</Badge>}
                      </li>
                    ))}
                    <li className="text-[12px] text-mist">
                      <span className="mono text-dim">{clock(r.returnAt)}</span> return · {r.distanceKm.toFixed(1)} road km · {fmtUsd(r.costUsd)}
                    </li>
                  </ol>
                </Panel>
              )),
            )}
            {totals && totals.unserved.length > 0 && (
              <Panel title="Not routed (with reason)">
                <div className="scroll-thin max-h-[160px] space-y-1 overflow-auto">
                  {totals.unserved.map((u) => (
                    <div key={u.order.id} className="text-[12px] text-mist">
                      <span className="mono text-dim">{u.order.id}</span> {siteById(s.sites, u.order.hospitalId).short} {u.order.units} {u.order.component} {u.order.group} — {u.reason}
                    </div>
                  ))}
                </div>
              </Panel>
            )}
            <Panel title={`Open orders (${orders.length})`}>
              <div className="scroll-thin max-h-[200px] space-y-1 overflow-auto text-[12px]">
                {orders.map((o) => (
                  <div key={o.id} className="flex justify-between gap-2 text-mist">
                    <span>
                      <span className="mono text-dim">{o.id}</span> {siteById(s.sites, o.hospitalId).short} · {o.units} {o.component} {o.group}
                    </span>
                    <span className={o.source === 'pulse' ? 'text-[#93c5fd]' : 'text-dim'}>{o.source === 'pulse' ? `PULSE ${o.reservedFor}` : `routine · by ${clock(o.latest)}`}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-dim">Routine top-ups: hospitals below synthetic target stock for common groups. PULSE orders come from executed transfusion plans and carry their reservation through delivery.</p>
            </Panel>
            <Panel title="Active milk runs">
              <MissionList />
            </Panel>
            <Panel title="Event log">
              <EventLog max={8} />
            </Panel>
            <p className="text-[11px] text-dim">
              {ORBIT_NOTE} Hard constraints: van capacity {ORBIT.vanCapacityUnits} units, arrival before each stop's latest time, exact-group depot stock (FEFO), idle vehicles, return to base. Drones are not used for multi-stop runs; a stop whose window road cannot meet is offered as a direct drone mission if feasible.
              {sol && ` Improvement passes: ${sol.map((x) => x.iterations).join(' / ')}.`}
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
}
