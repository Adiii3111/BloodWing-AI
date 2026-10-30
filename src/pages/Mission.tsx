import { Pause, Play, RotateCcw, Shuffle, Siren } from 'lucide-react';
import { MapView } from '../components/MapView';
import { DecisionPanel, EventLog, KpiBar, MissionList } from '../components/Panels';
import { Badge, Panel, SimLabel } from '../components/ui';
import { SCENARIOS } from '../engine/scenarios';
import { planPulse } from '../engine/pulse';
import { clock } from '../lib/format';
import { href } from '../lib/router';
import { useSim, type Speed } from '../lib/store';

export default function Mission() {
  const sim = useSim();
  const s = sim.state;
  const decision = s.decisions.find((d) => d.id === sim.focusDecisionId) ?? s.decisions[s.decisions.length - 1] ?? null;
  const plans = planPulse(s);
  const runs = s.missions.filter((m) => m.kind === 'milkrun');
  return (
    <div className="mx-auto max-w-[1700px] px-3 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">01 · BLOODWING Command Center</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">Mission Control — synthetic Boston network</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SimLabel />
          <Badge tone="signal">sim clock {clock(s.t)}</Badge>
          {sim.sentinel ? <Badge tone="crit">SENTINEL · {sim.sentinel.title}</Badge> : sim.scenario && <Badge>Scenario {sim.scenario.code} · {sim.scenario.title}</Badge>}
        </div>
      </div>

      <KpiBar />

      <div className="mt-3 grid gap-3 xl:grid-cols-[1fr_420px]">
        <div className="space-y-3">
          <MapView height="min(68vh, 720px)" decision={decision} />
          <div className="grid gap-3 md:grid-cols-3">
            <Panel title={<span className="text-[#ff9aa2]">SENTINEL · emergency</span>} right={<a className="text-[11px] text-signal hover:underline" href={href('sentinel')}>Open →</a>}>
              {s.incidents.length ? (
                s.incidents.map((i) => (
                  <div key={i.id} className="text-[12.5px] text-mist">
                    <span className="mono text-soft">{i.ref}</span> · EMS {i.emsStatus} → {i.hospitalId}
                  </div>
                ))
              ) : (
                <p className="text-[12.5px] text-mist">No active incidents. Run the ambulance-versus-blood race on the SENTINEL page.</p>
              )}
            </Panel>
            <Panel title={<span className="text-[#93c5fd]">PULSE · scheduled demand</span>} right={<a className="text-[11px] text-signal hover:underline" href={href('pulse')}>Open →</a>}>
              <div className="space-y-0.5 text-[12.5px] text-mist">
                {plans.slice(0, 3).map((p) => (
                  <div key={p.appt.id} className="flex justify-between gap-2">
                    <span>
                      <span className="mono text-soft">{p.appt.patientId}</span> · {p.appt.hospitalId}
                    </span>
                    <span className={p.status === 'at-risk' || p.status === 'late' || p.status === 'infeasible' ? 'text-warn' : 'text-dim'}>{p.status}</span>
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title={<span className="text-[#5eead4]">ORBIT · milk runs</span>} right={<a className="text-[11px] text-signal hover:underline" href={href('orbit')}>Open →</a>}>
              <p className="text-[12.5px] text-mist">
                {runs.length ? `${runs.filter((r) => r.phase !== 'complete').length} active · ${runs.length} dispatched this session` : 'No consolidated routes dispatched yet.'} {s.orders.filter((o) => o.status === 'open').length > 0 && `${s.orders.filter((o) => o.status === 'open').length} PULSE orders waiting.`}
              </p>
            </Panel>
          </div>
        </div>

        <div className="space-y-3">
          <div className="panel p-4">
            <div className="eyebrow mb-3">04 · Emergency simulator</div>
            <button className="btn btn-danger w-full !py-3.5 text-[15px]" onClick={() => sim.triggerEmergency()}>
              <Siren size={18} /> TRIGGER EMERGENCY
            </button>
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {SCENARIOS.map((sc) => (
                <button
                  key={sc.id}
                  className={`rounded-lg border p-2 text-left transition-colors ${sim.scenario?.id === sc.id ? 'border-signal/50 bg-signal/10' : 'border-line hover:border-signal/30'}`}
                  onClick={() => {
                    sim.loadScenario(sc);
                    sim.start();
                  }}
                >
                  <div className="mono text-[10px] text-dim">SCENARIO {sc.code}</div>
                  <div className="text-[13px] font-semibold">{sc.title}</div>
                  <div className="text-[11px] text-mist">{sc.tagline}</div>
                </button>
              ))}
            </div>
            {sim.scenario && <p className="mt-2.5 text-[12px] leading-relaxed text-mist">{sim.scenario.story}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {!sim.scenarioStarted ? (
                <button className="btn btn-sm btn-primary" onClick={() => sim.start()}>
                  <Play size={13} /> Start
                </button>
              ) : sim.running ? (
                <button className="btn btn-sm" onClick={() => sim.pause()}>
                  <Pause size={13} /> Pause
                </button>
              ) : (
                <button className="btn btn-sm btn-primary" onClick={() => sim.resume()}>
                  <Play size={13} /> Resume
                </button>
              )}
              <button className="btn btn-sm" onClick={() => sim.reset()}>
                <RotateCcw size={13} /> Reset
              </button>
              <button className="btn btn-sm" onClick={() => sim.newScenario()}>
                <Shuffle size={13} /> New scenario
              </button>
              <div className="seg ml-auto" role="group" aria-label="Simulation speed">
                {([1, 5, 20] as Speed[]).map((x) => (
                  <button key={x} aria-pressed={sim.speed === x} onClick={() => sim.setSpeed(x)}>
                    {x}×
                  </button>
                ))}
              </div>
            </div>
            <label className="mt-2.5 flex items-center gap-2 text-[12px] text-mist">
              <input type="checkbox" checked={sim.ambient} onChange={(e) => sim.setAmbient(e.target.checked)} /> Background demand (4 seeded requests / hour)
            </label>
            <p className="mt-1 text-[11px] text-dim">1× = one simulated minute per second.</p>
          </div>

          <DecisionPanel decision={decision} />

          <Panel title="Missions">
            <MissionList />
          </Panel>
          <Panel title="Event log">
            <EventLog />
          </Panel>
        </div>
      </div>
    </div>
  );
}
