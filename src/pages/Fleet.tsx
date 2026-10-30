import { Battery, Plane, Truck } from 'lucide-react';
import { useState } from 'react';
import { Badge, Bar, Panel, Section, SimLabel } from '../components/ui';
import { DRONE, GROUND, PACKAGING } from '../engine/assumptions';
import { energyPlan, payloadKg, unitsPerDrone, weatherCheck } from '../engine/fleet';
import { haversineKm } from '../engine/geo';
import { HOSPITALS, siteById } from '../engine/network';
import { currentWeather } from '../engine/simulation';
import type { Component } from '../engine/types';
import { useSim } from '../lib/store';

export default function Fleet() {
  const sim = useSim();
  const s = sim.state;
  const [droneId, setDrone] = useState(s.drones[0]?.id);
  const [dest, setDest] = useState('MGH');
  const [component, setComponent] = useState<Component>('RBC');
  const [units, setUnits] = useState(3);
  const drone = s.drones.find((d) => d.id === droneId) ?? s.drones[0];
  const base = siteById(s.sites, drone.baseId);
  const target = siteById(s.sites, dest);
  const dist = haversineKm(base, target);
  const w = currentWeather(s);
  const load = payloadKg(component, units);
  const plan = energyPlan(drone, dist, load, w);
  const wc = weatherCheck(w);
  const perDrone = unitsPerDrone(component, drone.maxPayloadKg);
  const checks = [
    { ok: units <= perDrone, label: `Payload ${load.toFixed(2)} kg ≤ ${drone.maxPayloadKg} kg (${perDrone} units max)` },
    { ok: wc.ok, label: wc.ok ? 'Weather within envelope' : `Weather: ${wc.reason}` },
    { ok: !plan.exceedsRange, label: `Round trip needs ${plan.requiredPct.toFixed(0)}% on a full charge (usable ${100 - DRONE.reservePct}%)` },
    { ok: drone.battery - plan.requiredPct >= DRONE.reservePct, label: `Battery ${Math.round(drone.battery)}% − ${plan.requiredPct.toFixed(0)}% = ${(drone.battery - plan.requiredPct).toFixed(0)}% ≥ ${DRONE.reservePct}% reserve` },
    { ok: drone.status === 'idle', label: `Drone status: ${drone.status}` },
  ];
  const feasible = checks.every((c) => c.ok);

  return (
    <Section
      num="07"
      eyebrow="Drone & ground fleet operations"
      title={<>A fleet that knows its <span className="text-signal">limits.</span></>}
      lede="All specifications are synthetic engineering assumptions. A drone is never assigned unless the energy model shows it can fly out loaded, hand off, and return empty with the safety reserve intact."
    >
      <div className="mb-3">
        <SimLabel>Synthetic specifications · simplified physics</SimLabel>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        {s.drones.map((d) => {
          const m = s.missions.find((x) => x.id === d.missionId);
          return (
            <button key={d.id} onClick={() => setDrone(d.id)} className={`panel p-3.5 text-left ${d.id === drone.id ? 'panel-signal' : ''}`}>
              <div className="flex items-center justify-between">
                <span className="mono text-[13px] font-semibold">{d.id}</span>
                <Badge tone={d.status === 'idle' ? 'ok' : d.status === 'maintenance' ? 'crit' : 'signal'}>{d.status}</Badge>
              </div>
              <div className="mt-1 text-[11.5px] text-mist">Base {siteById(s.sites, d.baseId).short}</div>
              <div className="mt-2 flex items-center gap-1.5 text-[12px]">
                <Battery size={13} className={d.battery < 40 ? 'text-warn' : 'text-ok'} />
                <span className="mono">{Math.round(d.battery)}%</span>
              </div>
              <Bar value={d.battery} max={100} color={d.battery < 40 ? '#fbbf24' : '#34d399'} h={4} />
              <div className="mono mt-2 text-[10.5px] leading-relaxed text-dim">
                {d.cruiseKmh} km/h · {d.rangeKm} km · {d.maxPayloadKg} kg
                <br />
                {m ? `${m.id} · ${m.phase}` : 'unassigned'}
                <br />
                busy {d.busyMin.toFixed(0)} min this run
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_1fr]">
        <Panel title="Mission feasibility calculator" right={<Badge tone={feasible ? 'ok' : 'crit'}>{feasible ? 'feasible' : 'not feasible'}</Badge>}>
          <div className="grid grid-cols-2 gap-2.5 text-[12px] md:grid-cols-4">
            <label>
              <span className="text-dim">Drone</span>
              <select className="field mt-1" value={drone.id} onChange={(e) => setDrone(e.target.value)}>
                {s.drones.map((d) => (
                  <option key={d.id}>{d.id}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-dim">Destination</span>
              <select className="field mt-1" value={dest} onChange={(e) => setDest(e.target.value)}>
                {HOSPITALS.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.short}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-dim">Component</span>
              <select className="field mt-1" value={component} onChange={(e) => setComponent(e.target.value as Component)}>
                <option value="RBC">RBC</option>
                <option value="PLT">PLT</option>
                <option value="PLASMA">Plasma</option>
              </select>
            </label>
            <label>
              <span className="text-dim">Units</span>
              <input className="field mt-1" type="number" min={1} max={8} value={units} onChange={(e) => setUnits(Math.max(1, Math.min(8, Math.round(+e.target.value || 1))))} />
            </label>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] md:grid-cols-4">
            {[
              ['Straight-line', `${dist.toFixed(2)} km`],
              ['Ground speed', `${Math.max(10, drone.cruiseKmh - (w?.windKmh ?? 0))} km/h`],
              ['Outbound', `${plan.outboundMin.toFixed(1)} min`],
              ['ETA incl. prep', `${(DRONE.prepMin + plan.outboundMin + DRONE.handoffMin).toFixed(1)} min`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-space/50 p-2">
                <div className="text-dim">{k}</div>
                <div className="mono text-soft">{v}</div>
              </div>
            ))}
          </div>
          <ul className="mt-3 space-y-1">
            {checks.map((c) => (
              <li key={c.label} className={`text-[12.5px] ${c.ok ? 'text-ok' : 'text-[#ff9aa2]'}`}>
                {c.ok ? '✓' : '✗'} {c.label}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-dim">Container: {PACKAGING[component].container}. Straight-line distance is an illustration, not an authorised flight path.</p>
        </Panel>
        <Panel title="Flight & ground model (synthetic)">
          <div className="space-y-2 font-mono text-[11.5px] leading-relaxed text-mist">
            <div>ground speed = cruise − wind (full headwind assumed, both legs)</div>
            <div>endurance = range ÷ cruise = {((DRONE.rangeKm / DRONE.cruiseKmh) * 60).toFixed(0)} min</div>
            <div>drain/min = 100 ÷ endurance × (1 + {DRONE.payloadDrainFactor} × payload ÷ max)</div>
            <div>required = outbound(loaded) + {DRONE.handoffMin} min handoff(loaded) + return(empty)</div>
            <div>feasible ⇔ battery − required ≥ {DRONE.reservePct}% · wind ≤ {DRONE.maxWindKmh} km/h · vis ≥ {DRONE.minVisibilityKm} km · no heavy rain/snow/storms</div>
            <div>prep {DRONE.prepMin} min · charge {DRONE.chargePctPerMin}%/min · ≤ {DRONE.maxDronesPerRequest} drones per request</div>
            <div className="pt-2 text-soft">ground: road km = {GROUND.roadCircuity} × straight km · {GROUND.speedKmh} km/h × traffic · prep {GROUND.prepMin} · handoff {GROUND.handoffMin} min</div>
          </div>
          <div className="mt-4">
            <div className="eyebrow mb-1.5">Ground vehicles</div>
            <div className="grid grid-cols-2 gap-1 text-[12px] sm:grid-cols-3">
              {s.couriers.map((c) => (
                <div key={c.id} className="flex items-center gap-1.5 text-mist">
                  <Truck size={12} className={c.status === 'idle' ? 'text-dim' : c.missionId?.startsWith('MR') ? 'text-[#2dd4bf]' : 'text-med'} />
                  <span className="mono">{c.id}</span> <span className="text-dim">{c.status}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-dim">
            <Plane size={12} /> No real drone is controlled. A real deployment needs aviation authorisation, airspace coordination and validated cold-chain handling.
          </p>
        </Panel>
      </div>
    </Section>
  );
}
