import { Check, Pause, Play, RotateCcw, ShieldCheck, Siren, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { MapView } from '../components/MapView';
import { DecisionPanel, EventLog, SafetyNote } from '../components/Panels';
import { Race } from '../components/Race';
import { Badge, Panel, SimLabel } from '../components/ui';
import { COMPONENT_LABEL } from '../engine/assumptions';
import { recipientLabel } from '../engine/compatibility';
import { siteById } from '../engine/network';
import { SENTINEL_SCENARIOS } from '../engine/sentinel';
import { clock } from '../lib/format';
import { useSim, type Speed } from '../lib/store';

export default function Sentinel() {
  const sim = useSim();
  const s = sim.state;
  const [sel, setSel] = useState(0);
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    if (!sim.sentinel) sim.loadSentinel(SENTINEL_SCENARIOS[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const incident = s.incidents[Math.min(sel, s.incidents.length - 1)];
  const req = incident ? s.requests.find((r) => r.incidentId === incident.id) : undefined;
  const decision = req ? s.decisions.find((d) => d.id === req.decisionId) : null;
  const alertOn = s.incidents.some((i) => s.t - i.t < 4);
  const hosp = incident ? siteById(s.sites, incident.hospitalId) : null;
  const fitKey = s.incidents.map((i) => i.id).join() + (sim.sentinel?.id ?? '');
  const fit = useMemo(
    () => (s.incidents.length ? [...s.incidents.flatMap((i) => [i, siteById(s.sites, i.hospitalId)]), ...s.sites.filter((x) => x.kind === 'depot')] : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fitKey],
  );

  return (
    <div className="mx-auto max-w-[1700px] px-3 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow !text-[#ff9aa2]">02 · SENTINEL — Emergency response intelligence</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">From incident alert to blood readiness.</h1>
        </div>
        <SimLabel />
      </div>

      <div className="scroll-thin mb-3 flex gap-2 overflow-x-auto pb-1">
        {SENTINEL_SCENARIOS.map((sc) => (
          <button
            key={sc.id}
            onClick={() => {
              sim.loadSentinel(sc);
              setSel(0);
            }}
            className={`min-w-[190px] rounded-lg border p-2.5 text-left transition-colors ${sim.sentinel?.id === sc.id ? 'border-crimson/60 bg-crimson/10' : 'border-line hover:border-crimson/40'}`}
          >
            <div className="text-[13px] font-semibold">{sc.title}</div>
            <div className="text-[11px] text-mist">{sc.tagline}</div>
          </button>
        ))}
      </div>

      {alertOn && (
        <div className="panel panel-hot scanline mb-3 flex items-center gap-3 px-4 py-3">
          <Siren className="text-crimson" />
          <div className="font-display text-lg font-semibold tracking-[0.14em] text-[#ff9aa2]">CRITICAL INCIDENT DETECTED</div>
          <div className="text-[12px] text-mist">Simulated authorised alert · EMS notified · no blood is ordered from an alert alone</div>
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[1fr_430px]">
        <div className="space-y-3">
          {incident ? (
            <Race incident={incident} big />
          ) : (
            <div className="panel p-6">
              <div className="eyebrow mb-2">{sim.sentinel?.title}</div>
              <p className="max-w-3xl text-[15px] leading-relaxed text-soft/90">{sim.sentinel?.story}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button className="btn btn-danger !px-5 !py-3" onClick={() => sim.startSentinel(auto)}>
                  <Siren size={17} /> START INCIDENT
                </button>
                <label className="flex items-center gap-2 text-[12px] text-mist">
                  <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-authorise (for unattended runs)
                </label>
              </div>
            </div>
          )}
          <MapView height="min(52vh, 560px)" decision={decision} fit={fit} />
        </div>

        <div className="space-y-3">
          <div className="panel p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {sim.scenarioStarted && (sim.running ? (
                <button className="btn btn-sm" onClick={() => sim.pause()}>
                  <Pause size={13} /> Pause
                </button>
              ) : (
                <button className="btn btn-sm btn-primary" onClick={() => sim.resume()}>
                  <Play size={13} /> Resume
                </button>
              ))}
              <button className="btn btn-sm" onClick={() => sim.reset()}>
                <RotateCcw size={13} /> Reset
              </button>
              <div className="seg ml-auto" role="group" aria-label="Simulation speed">
                {([1, 5, 20] as Speed[]).map((x) => (
                  <button key={x} aria-pressed={sim.speed === x} onClick={() => sim.setSpeed(x)}>
                    {x}×
                  </button>
                ))}
              </div>
            </div>
            {s.incidents.length > 1 && (
              <div className="mt-2 flex gap-1.5">
                {s.incidents.map((i, k) => (
                  <button key={i.id} className={`chip ${k === sel ? 'border-crimson/50 text-[#ff9aa2]' : ''}`} onClick={() => setSel(k)}>
                    {i.ref}
                  </button>
                ))}
              </div>
            )}
          </div>

          {incident && hosp && (
            <Panel title={<span className="text-[#ff9aa2]">Incident record</span>} right={<Badge tone="crit">{incident.ref}</Badge>}>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
                <dt className="text-dim">Location</dt>
                <dd>{incident.label}</dd>
                <dt className="text-dim">Timestamp</dt>
                <dd className="mono">{clock(incident.t)}</dd>
                <dt className="text-dim">EMS status</dt>
                <dd className="capitalize">{incident.emsStatus.replace('-', ' ')}</dd>
                <dt className="text-dim">Receiving hospital</dt>
                <dd>{hosp.name} <span className="text-dim">(chosen by EMS)</span></dd>
                <dt className="text-dim">Est. patient arrival</dt>
                <dd className="mono">{clock(incident.patientArriveAt)}</dd>
                <dt className="text-dim">Clinical request</dt>
                <dd>
                  {s.t < incident.assessedAt ? (
                    <span className="text-dim">pending EMS assessment ({clock(incident.assessedAt)})</span>
                  ) : (
                    <>
                      {incident.requestedUnits} × {COMPONENT_LABEL.RBC.toLowerCase()}, {recipientLabel('UNKNOWN')}
                    </>
                  )}
                </dd>
                <dt className="text-dim">Held locally</dt>
                <dd>{s.t < incident.assessedAt ? '—' : `${incident.localUnits} units at ${hosp.short}`}</dd>
                <dt className="text-dim">From network</dt>
                <dd>{req ? `${req.units} units · ${req.status}` : s.t < incident.assessedAt ? '—' : 'none needed'}</dd>
              </dl>
            </Panel>
          )}

          {req?.status === 'awaiting-auth' && (
            <div className="panel panel-hot rise p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="text-warn" size={18} />
                <div className="font-display text-[15px] font-semibold">Authorisation required</div>
              </div>
              <p className="mt-1.5 text-[12.5px] text-mist">
                {decision?.chosen
                  ? `BLOODWING recommends ${siteById(s.sites, decision.chosen.sourceId).short} by ${decision.chosen.mode} (${decision.chosen.vehicleIds.join('+')}), ETA ${decision.chosen.etaMin.toFixed(1)} min if authorised now. The engine re-checks every constraint at the moment of authorisation.`
                  : 'No feasible option exists right now. Authorising will queue the request for re-evaluation every 2 minutes and escalate to a coordinator.'}
              </p>
              <div className="mt-3 flex gap-2">
                <button className="btn btn-primary flex-1" onClick={() => sim.authorize(req.id)}>
                  <Check size={15} /> Authorise dispatch
                </button>
                <button className="btn" onClick={() => sim.decline(req.id)}>
                  <X size={15} /> Decline
                </button>
              </div>
              <p className="mt-2 text-[11px] text-dim">Simulated human-in-the-loop step. In a real system this belongs to the blood bank / transfusion service under clinical authority.</p>
            </div>
          )}

          <DecisionPanel decision={decision} />
          <Panel title="Event log">
            <EventLog max={12} />
          </Panel>
          <SafetyNote />
        </div>
      </div>
    </div>
  );
}
