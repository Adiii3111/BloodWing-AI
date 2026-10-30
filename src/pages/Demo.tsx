import { CalendarClock, Network, Pause, Play, RotateCcw, Siren, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapView } from '../components/MapView';
import { DecisionPanel } from '../components/Panels';
import { Race } from '../components/Race';
import { Badge, SimLabel } from '../components/ui';
import { Logo } from '../components/Logo';
import { siteById } from '../engine/network';
import { planPulse, PULSE } from '../engine/pulse';
import { readiness, SENTINEL_SCENARIOS } from '../engine/sentinel';
import { computeMetrics } from '../engine/simulation';
import type { OrbitSolution } from '../engine/orbit';
import { clock, fmtPct } from '../lib/format';
import { lab } from '../lib/lab';
import { go } from '../lib/router';
import { store, useSim } from '../lib/store';

// ---------------------------------------------------------------------------------------------
// BLOODWING — Network Intelligence Demonstration. 120 s, five acts, fully deterministic.
// The script only paces the clock and presses the same buttons a user would; every number shown
// is produced by the engine at that moment. Pause, resume and restart at any time.
// ---------------------------------------------------------------------------------------------

const TOTAL = 120;
const ACTS = [
  { n: 1, name: 'Emergency', from: 0, to: 40, color: '#e63946', icon: Siren },
  { n: 2, name: 'Prediction', from: 40, to: 64, color: '#3b82f6', icon: CalendarClock },
  { n: 3, name: 'Optimisation', from: 64, to: 88, color: '#2dd4bf', icon: Network },
  { n: 4, name: 'Connected', from: 88, to: 104, color: '#22d3ee', icon: Network },
  { n: 5, name: 'Impact', from: 104, to: 120, color: '#f8fafc', icon: Play },
];

const DEMO_APPT = 'APT-2187';

interface Memo {
  assessedAt: number;
  raceEnd: number;
  orbitStart: number;
  orbit: OrbitSolution[] | null;
  orbitTotals: { km: number; iKm: number; vehicles: number; trips: number; units: number; stops: number } | null;
  act1: { margin: number | null; responseMin: number | null; mode: string; source: string } | null;
  act4DecisionId: string | null;
  reservedForAppt: number;
  orderId: string | null;
  fired: Set<string>;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * Math.max(0, Math.min(1, f));

function caption(e: number, m: Memo): { title: string; body: string } {
  if (e < 4) return { title: 'An accident is reported in Boston.', body: 'A simulated, authorised incident alert reaches the network. EMS is notified. No blood is ordered from an alert alone.' };
  if (e < 10) return { title: 'EMS assesses the patient and chooses the hospital.', body: 'Only after assessment does the receiving hospital raise a clinical request. Its own compatible units are held for the patient first.' };
  if (e < 14) return { title: 'BLOODWING recommends. A human authorises.', body: 'The engine searched every depot and hospital, every drone and courier, under hard safety constraints. Nothing moves until a coordinator approves.' };
  if (e < 36) return { title: 'The race against time.', body: 'The ambulance and the blood shipment travel at the same time, each with its own independently calculated ETA.' };
  if (e < 40) return { title: 'Readiness margin recorded.', body: 'Margin = patient arrival − blood delivery. Receipt check-in and clinical preparation still follow, under hospital control.' };
  if (e < 52) return { title: 'Some demand is predictable.', body: 'A confirmed red-cell exchange for a fictional sickle-cell patient is on tomorrow’s calendar. PULSE checks identical stock and the ML demand forecast.' };
  if (e < 64) return { title: 'Prepared before it is urgent.', body: 'PULSE will not drain a shelf the emergency just used: it reserves locally only what keeps the forecast shortage risk acceptable, and orders the rest with a latest feasible dispatch time.' };
  if (e < 76) return { title: 'One network. Smarter movement.', body: 'ORBIT consolidates routine top-ups and the PULSE order into milk runs, within capacity and delivery windows — compared against one trip per request.' };
  if (e < 88) return { title: 'Milk runs dispatched.', body: 'Vans leave the hubs. Stock is deducted from depots now and added to each hospital on arrival.' };
  if (e < 104) return { title: 'Competing priorities, one engine.', body: 'A second emergency arrives mid-route. The engine serves it without touching units reserved for the scheduled patient or vans committed to milk runs.' };
  if (e < 114) return { title: 'Measured, not assumed.', body: 'Every figure here was computed by the simulation during this demonstration, or by the Lab on identical seeded demand.' };
  return { title: '', body: '' };
  void m;
}

export default function Demo() {
  const sim = useSim();
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const eRef = useRef(0);
  const memo = useRef<Memo | null>(null);
  const raf = useRef(0);
  const last = useRef(0);

  const init = useCallback(() => {
    const def = SENTINEL_SCENARIOS.find((x) => x.id === 'collision')!;
    store.loadSentinel(def);
    store.demoLock = true;
    store.startSentinel(false);
    store.running = false;
    const inc = store.state.incidents[0];
    memo.current = {
      assessedAt: inc.assessedAt,
      raceEnd: inc.patientArriveAt + 1,
      orbitStart: 0,
      orbit: null,
      orbitTotals: null,
      act1: null,
      act4DecisionId: null,
      reservedForAppt: 0,
      orderId: null,
      fired: new Set(),
    };
    eRef.current = 0;
    setElapsed(0);
    if (!lab.result && !lab.running) void lab.run();
    store.notify(true);
  }, []);

  useEffect(() => {
    init();
    return () => {
      cancelAnimationFrame(raf.current);
      store.demoLock = false;
    };
  }, [init]);

  // --- scripted actions (each fires once, at a fixed elapsed time)
  const step = useCallback((e: number) => {
    const m = memo.current!;
    const s = store.state;
    const once = (key: string, at: number, fn: () => void) => {
      if (e >= at && !m.fired.has(key)) {
        m.fired.add(key);
        fn();
      }
    };
    once('auth', 12.5, () => {
      const req = s.requests.find((r) => r.incidentId === s.incidents[0].id && r.status === 'awaiting-auth');
      if (req) {
        store.authorize(req.id);
        const mission = s.missions.find((x) => x.requestId === req.id);
        if (mission) m.raceEnd = Math.max(s.incidents[0].patientArriveAt, mission.handoffDoneAt) + 1;
      }
    });
    once('act1done', 37, () => {
      const inc = s.incidents[0];
      const r = readiness(s, inc);
      const req = s.requests.find((x) => x.incidentId === inc.id);
      const mission = req?.missionId ? s.missions.find((x) => x.id === req.missionId) : undefined;
      m.act1 = {
        margin: r.marginMin,
        responseMin: req?.deliveredAt != null && req.authorizedAt != null ? req.deliveredAt - req.authorizedAt : null,
        mode: mission?.mode ?? '—',
        source: mission ? siteById(s.sites, mission.sourceId).short : '—',
      };
    });
    once('pulseConfirm', 42, () => store.updateAppointment(DEMO_APPT, { orderStatus: 'confirmed' }));
    once('pulseExec', 58, () => {
      const r = store.executePlan(DEMO_APPT);
      m.reservedForAppt = r?.reserved ?? 0;
      m.orderId = r?.order?.id ?? null;
    });
    once('orbitSolve', 66, () => {
      const sols = store.solveOrbit(['DA', 'DB', 'DC']);
      m.orbit = sols;
      m.orbitTotals = {
        km: sols.reduce((a, x) => a + x.totalKm, 0),
        iKm: sols.reduce((a, x) => a + x.individual.totalKm, 0),
        vehicles: sols.reduce((a, x) => a + x.vehicles, 0),
        trips: sols.reduce((a, x) => a + x.individual.trips, 0),
        units: sols.reduce((a, x) => a + x.routes.reduce((b, r) => b + r.load, 0), 0),
        stops: sols.reduce((a, x) => a + x.routes.reduce((b, r) => b + r.stops.length, 0), 0),
      };
    });
    once('orbitExec', 76, () => {
      store.executeOrbit();
      store.running = false;
      m.orbitStart = store.state.t;
    });
    once('act4', 90, () => {
      const req = store.submit({ hospitalId: 'BMC', component: 'RBC', recipientGroup: 'O+', units: 4, urgency: 'critical', deadlineMin: 30, label: 'Second emergency (demo)' });
      store.running = false;
      m.act4DecisionId = req.decisionId ?? null;
    });

    // --- clock pacing
    let target = s.t;
    if (e < 4) target = lerp(0, 3, e / 4);
    else if (e < 10) target = lerp(3, m.assessedAt + 0.2, (e - 4) / 6);
    else if (e < 14) target = m.assessedAt + 0.2;
    else if (e < 36) target = lerp(m.assessedAt + 0.2, m.raceEnd, (e - 14) / 22);
    else if (e < 76) target = m.raceEnd;
    else if (e < 88) target = lerp(m.orbitStart || m.raceEnd, (m.orbitStart || m.raceEnd) + 30, (e - 76) / 12);
    else if (e < 92) target = (m.orbitStart || m.raceEnd) + 30;
    else if (e < 104) target = lerp((m.orbitStart || m.raceEnd) + 30, (m.orbitStart || m.raceEnd) + 46, (e - 92) / 12);
    store.advanceTo(target);
  }, []);

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const loop = (ts: number) => {
      const dt = Math.min(0.1, (ts - last.current) / 1000);
      last.current = ts;
      eRef.current = Math.min(TOTAL, eRef.current + dt);
      step(eRef.current);
      setElapsed(eRef.current);
      if (eRef.current >= TOTAL) {
        setPlaying(false);
        return;
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, step]);

  const restart = () => {
    cancelAnimationFrame(raf.current);
    init();
    setPlaying(true);
  };

  const s = sim.state;
  const m = memo.current;
  const act = ACTS.find((a) => elapsed >= a.from && elapsed < a.to) ?? ACTS[4];
  const cap = m ? caption(elapsed, m) : { title: '', body: '' };
  const inc = s.incidents[0];
  const plan = planPulse(s).find((p) => p.appt.id === DEMO_APPT);
  const appt = s.appointments.find((a) => a.id === DEMO_APPT);
  const act4 = m?.act4DecisionId ? s.decisions.find((d) => d.id === m.act4DecisionId) : null;
  const metrics = computeMetrics(s);
  const finale = elapsed >= 114;
  const fit1 = useMemo(() => (inc ? [inc, siteById(s.sites, inc.hospitalId), ...s.sites.filter((x) => x.kind === 'depot')] : undefined), [inc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const overlays =
    act.n === 3 && m?.orbit && elapsed < 76
      ? m.orbit.flatMap((x) => x.routes.map((r) => ({ path: [siteById(s.sites, x.hubId), ...r.stops.map((st) => siteById(s.sites, st.siteId)), siteById(s.sites, x.hubId)], color: '#2dd4bf', dashed: true })))
      : undefined;

  return (
    <div className="relative mx-auto max-w-[1800px] px-3 py-3 sm:px-6">
      {/* Act timeline + controls */}
      <div className="panel mb-3 flex flex-wrap items-center gap-3 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Logo size={22} />
          <span className="font-display text-[13px] font-semibold tracking-[0.14em]">NETWORK INTELLIGENCE DEMONSTRATION</span>
        </div>
        <div className="flex min-w-[280px] flex-1 gap-1">
          {ACTS.map((a) => {
            const f = Math.max(0, Math.min(1, (elapsed - a.from) / (a.to - a.from)));
            return (
              <div key={a.n} className="flex-1" style={{ flexGrow: a.to - a.from }}>
                <div className={`mb-1 truncate text-[10.5px] ${act.n === a.n ? 'text-soft' : 'text-dim'}`}>
                  <span className="mono">ACT {a.n}</span> · {a.name}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                  <div className="h-full rounded-full" style={{ width: `${f * 100}%`, background: a.color }} />
                </div>
              </div>
            );
          })}
        </div>
        <span className="mono w-[86px] text-right text-[12px] text-mist">
          {Math.floor(elapsed)}s / {TOTAL}s
        </span>
        <div className="flex gap-1.5">
          {playing ? (
            <button className="btn btn-sm" onClick={() => setPlaying(false)}>
              <Pause size={13} /> Pause
            </button>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={() => (elapsed >= TOTAL ? restart() : setPlaying(true))}>
              <Play size={13} /> {elapsed === 0 ? 'Start live demo' : elapsed >= TOTAL ? 'Replay' : 'Resume'}
            </button>
          )}
          <button className="btn btn-sm" onClick={restart}>
            <RotateCcw size={13} /> Restart
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setPlaying(false);
              store.demoLock = false;
              go('mission');
            }}
            aria-label="Exit demo"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_460px]">
        <div className="space-y-3">
          {act.n === 1 && inc && <Race incident={inc} big />}
          <MapView height={act.n === 1 ? 'min(46vh, 520px)' : 'min(70vh, 760px)'} overlays={overlays} decision={act.n === 4 ? act4 : null} fit={act.n === 1 ? fit1 : undefined} />
        </div>

        <div className="space-y-3">
          <div className="panel p-5" style={{ borderColor: `${act.color}55` }}>
            <div className="eyebrow mb-1" style={{ color: act.color }}>
              Act {act.n} · The {act.name === 'Connected' ? 'connected network' : act.name.toLowerCase()}
            </div>
            <div className="font-display text-[24px] font-semibold leading-tight">{cap.title}</div>
            <p className="mt-2 text-[14px] leading-relaxed text-mist">{cap.body}</p>
            {elapsed === 0 && !playing && (
              <button className="btn btn-primary mt-4 w-full !py-3 text-[15px]" onClick={() => setPlaying(true)}>
                <Play size={16} /> Start live demo
              </button>
            )}
          </div>

          {act.n === 1 && inc && (
            <div className="panel p-4 text-[12.5px]">
              <div className="mb-2 flex items-center justify-between">
                <span className="eyebrow !text-[#ff9aa2]">Incident {inc.ref}</span>
                <Badge tone="crit">EMS {inc.emsStatus}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-y-1.5 text-mist">
                <span className="text-dim">Location</span>
                <span>{inc.label}</span>
                <span className="text-dim">Receiving (EMS)</span>
                <span>{siteById(s.sites, inc.hospitalId).name}</span>
                <span className="text-dim">Request</span>
                <span>{s.t >= inc.assessedAt ? `${inc.requestedUnits} RBC, group unknown → O− only` : 'awaiting assessment'}</span>
                <span className="text-dim">Held locally</span>
                <span>{s.t >= inc.assessedAt ? `${inc.localUnits} units` : '—'}</span>
                <span className="text-dim">Authorisation</span>
                <span>{s.requests[0]?.authorizedAt != null ? `authorised ${clock(s.requests[0].authorizedAt)} (simulated coordinator)` : s.requests[0]?.status === 'awaiting-auth' ? <span className="text-warn">awaiting human authorisation…</span> : '—'}</span>
              </div>
            </div>
          )}
          {act.n === 1 && s.requests[0] && <DecisionPanel decision={s.decisions.find((d) => d.id === s.requests[0].decisionId)} compact />}

          {act.n === 2 && plan && appt && (
            <div className="panel p-4 text-[12.5px]">
              <div className="mb-2 flex items-center justify-between">
                <span className="eyebrow !text-[#93c5fd]">PULSE · {appt.patientId}</span>
                <Badge tone={appt.orderStatus === 'confirmed' ? 'ok' : 'blue'}>{appt.orderStatus}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-y-1.5 text-mist">
                <span className="text-dim">Condition</span>
                <span>{appt.condition} (fictional)</span>
                <span className="text-dim">Appointment</span>
                <span>
                  {clock(appt.at)} · {siteById(s.sites, appt.hospitalId).short}
                </span>
                <span className="text-dim">Clinical order</span>
                <span>
                  {appt.units} RBC {appt.group.replace('-', '−')} (identical units)
                </span>
                <span className="text-dim">Hold locally</span>
                <span>{plan.alreadyReserved > 0 ? `${plan.alreadyReserved} reserved ✓` : `${plan.fromLocal} units`}</span>
                <span className="text-dim">Replenish</span>
                <span>{plan.shortfall > 0 ? `${plan.shortfall} from ${plan.depotId ? siteById(s.sites, plan.depotId).short : '—'}` : plan.onOrder > 0 ? `${plan.onOrder} on order (${m?.orderId ?? 'ORBIT'})` : 'none'}</span>
                <span className="text-dim">{plan.latestDispatch != null ? 'Latest dispatch' : 'Order window'}</span>
                <span className="mono">{plan.latestDispatch != null ? clock(plan.latestDispatch) : s.orders.find((o) => o.reservedFor === DEMO_APPT) ? `arrive by ${clock(s.orders.find((o) => o.reservedFor === DEMO_APPT)!.latest)}` : '—'}</span>
                <span className="text-dim">Shortage risk (ML)</span>
                <span className="mono">{plan.shortageRisk > 0.99 ? '>99%' : `${(plan.shortageRisk * 100).toFixed(0)}%`}</span>
              </div>
              {plan.latestDispatch != null && (
                <div className="mono mt-3 rounded-lg border border-line bg-space/60 p-2 text-[11px] text-mist">
                  {clock(plan.latestDispatch)} = {clock(plan.requiredBy)} − {Math.round(plan.leadTimeMin!)} min transport − {PULSE.handlingBufferMin} min handling
                </div>
              )}
              {m?.orderId && <div className="mt-2 text-ok">Plan executed: {m.reservedForAppt} unit{m.reservedForAppt === 1 ? '' : 's'} reserved locally, {plan.onOrder} on {m.orderId} for ORBIT.</div>}
            </div>
          )}

          {act.n === 3 && m?.orbitTotals && (
            <div className="panel p-4">
              <div className="eyebrow mb-3 !text-[#5eead4]">ORBIT · same orders, two ways</div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg border border-line p-3">
                  <div className="text-[11px] text-dim">Individual deliveries</div>
                  <div className="font-display text-3xl font-semibold text-polA">{m.orbitTotals.iKm.toFixed(0)}</div>
                  <div className="text-[11px] text-mist">road km · {m.orbitTotals.trips} dispatches</div>
                </div>
                <div className="rounded-lg border border-[#2dd4bf]/40 p-3">
                  <div className="text-[11px] text-dim">Milk runs</div>
                  <div className="font-display text-3xl font-semibold text-[#5eead4]">{m.orbitTotals.km.toFixed(0)}</div>
                  <div className="text-[11px] text-mist">road km · {m.orbitTotals.vehicles} vehicles</div>
                </div>
              </div>
              <p className="mt-3 text-[12px] text-mist">
                {m.orbitTotals.units} units over {m.orbitTotals.stops} stops. Heuristic (nearest feasible neighbour + 2-opt + relocate): improved feasible routes, not proven optimal.
              </p>
            </div>
          )}

          {act.n === 4 && act4 && <DecisionPanel decision={act4} compact={false} />}

          {act.n === 5 && (
            <div className="panel p-4">
              <div className="eyebrow mb-3">Measured in this demonstration</div>
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                {[
                  ['Emergency: authorisation → handoff', m?.act1?.responseMin != null ? `${m.act1.responseMin.toFixed(1)} min` : '—'],
                  ['Readiness margin (Act 1)', m?.act1?.margin != null ? `${m.act1.margin >= 0 ? '+' : ''}${m.act1.margin.toFixed(1)} min` : '—'],
                  ['On-time fulfilment (session)', fmtPct(metrics.onTimeRate)],
                  ['PT-2187 order (8 units)', `${m?.reservedForAppt ?? 0} reserved + ${plan?.onOrder ?? 0} on milk run`],
                  ['Milk-run road km', m?.orbitTotals ? `${m.orbitTotals.km.toFixed(0)} vs ${m.orbitTotals.iKm.toFixed(0)}` : '—'],
                  ['Drone utilisation (session)', fmtPct(metrics.droneUtilization, 1)],
                  ['Forecast MAE (held-out)', sim.model ? `${sim.model.metrics.mae.toFixed(3)} req/h` : '—'],
                  ['Lab: mean delivery AI vs ground', lab.result ? `${lab.result.summary.ai.avgMin.mean.toFixed(1)} vs ${lab.result.summary['ground-only'].avgMin.mean.toFixed(1)} min` : 'running…'],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-line bg-space/50 p-2.5">
                    <div className="text-dim">{k}</div>
                    <div className="mono mt-0.5 text-[15px] text-soft">{v}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-dim">Simulated results — synthetic Boston network. No claim about patient outcomes.</p>
            </div>
          )}
          <SimLabel>Research simulation · synthetic data · not for clinical use</SimLabel>
        </div>
      </div>

      {finale && (
        <div className="fixed inset-0 z-[2000] flex flex-col items-center justify-center bg-space/95 text-center rise">
          <Logo size={72} />
          <div className="mt-6 font-display text-[clamp(48px,8vw,120px)] font-bold leading-none tracking-[-0.03em]">
            BLOODWING<span className="text-signal"> AI</span>
          </div>
          <div className="mt-5 font-display text-[clamp(18px,2.4vw,32px)]">
            Predict the Need. <span className="text-signal">Optimize the Network.</span> <span className="text-[#ff9aa2]">Deliver in Time.</span>
          </div>
          <div className="mt-8 flex gap-2">
            <button className="btn" onClick={restart}>
              <RotateCcw size={14} /> Replay
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                store.demoLock = false;
                go('mission');
              }}
            >
              Explore mission control
            </button>
          </div>
          <p className="disclaimer mt-6 text-dim">Research prototype · synthetic data · not for clinical decision-making</p>
        </div>
      )}
    </div>
  );
}
