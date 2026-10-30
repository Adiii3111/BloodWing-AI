import { Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Panel, Section, SimLabel } from '../components/ui';
import { DecisionPanel } from '../components/Panels';
import { DEFAULT_DEADLINE, WEIGHTS } from '../engine/assumptions';
import { ALL_GROUPS } from '../engine/compatibility';
import { HOSPITALS, siteById } from '../engine/network';
import { previewDecision } from '../engine/simulation';
import type { Component, Decision, RecipientGroup, Urgency } from '../engine/types';
import { fmtUsd } from '../lib/format';
import { useSim } from '../lib/store';

const STAGES = [
  ['1', 'Hard feasibility', 'Compatibility, release status, shelf life, local reserve floors, payload, range & battery reserve, weather, airspace, container hold time, vehicle availability, existing commitments. Fail → rejected with a reason.'],
  ['2', 'Candidate evaluation', 'For every feasible source × mode: ETA, deadline slack, +30% robustness ETA, synthetic cost, inventory consequences, fleet impact.'],
  ['3', 'Optimisation', 'Minimise Σ wᵢ · termᵢ over normalised terms. Weights depend on urgency. Safety constraints are never traded against score.'],
  ['4', 'Prediction (ML)', 'Poisson regression forecasts 6-hour demand per hospital; it raises the inventory-risk term when a hospital is considered as a transfer source.'],
  ['5', 'Explanation', 'Deterministic templates turn the numbers into "why this route" — no language model, nothing invented.'],
] as const;

export default function Dispatch() {
  const sim = useSim();
  const [hospitalId, setHospital] = useState('MGH');
  const [component, setComponent] = useState<Component>('RBC');
  const [group, setGroup] = useState<RecipientGroup>('O+');
  const [units, setUnits] = useState(3);
  const [urgency, setUrgency] = useState<Urgency>('urgent');
  const [deadline, setDeadline] = useState(60);
  const input = { hospitalId, component, recipientGroup: group, units, urgency, deadlineMin: deadline };
  const preview: Decision = useMemo(() => previewDecision(sim.state, input), [sim.state, sim.getVersion(), hospitalId, component, group, units, urgency, deadline]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = sim.state;
  const rows = [...(preview.chosen ? [preview.chosen] : []), ...preview.alternatives];

  return (
    <Section
      num="05"
      eyebrow="AI dispatch intelligence"
      title={<>The decision engine — <span className="text-signal">inspectable</span>, not magic.</>}
      lede="Every request runs the same pipeline. Build any request below and watch the full evaluation matrix update live against the current network state; dispatch it to make it real."
    >
      <div className="mb-4 grid gap-2 md:grid-cols-5">
        {STAGES.map(([n, t, d]) => (
          <div key={n} className="panel p-4">
            <div className="mono text-[11px] text-signal">STAGE {n}</div>
            <div className="mt-1 font-display text-[15px] font-semibold">{t}</div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-mist">{d}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[360px_1fr]">
        <div className="space-y-3">
          <Panel title="Request builder">
            <div className="grid grid-cols-2 gap-2.5 text-[12px]">
              <label className="col-span-2">
                <span className="text-dim">Hospital</span>
                <select className="field mt-1" value={hospitalId} onChange={(e) => setHospital(e.target.value)}>
                  {HOSPITALS.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-dim">Component</span>
                <select className="field mt-1" value={component} onChange={(e) => setComponent(e.target.value as Component)}>
                  <option value="RBC">Red blood cells</option>
                  <option value="PLT">Platelets</option>
                  <option value="PLASMA">Plasma</option>
                </select>
              </label>
              <label>
                <span className="text-dim">Recipient group</span>
                <select className="field mt-1" value={group} onChange={(e) => setGroup(e.target.value as RecipientGroup)}>
                  <option value="UNKNOWN">Unknown (emergency)</option>
                  {ALL_GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g.replace('-', '−')}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-dim">Units</span>
                <input className="field mt-1" type="number" min={1} max={20} value={units} onChange={(e) => setUnits(Math.max(1, Math.min(20, Math.round(+e.target.value || 1))))} />
              </label>
              <label>
                <span className="text-dim">Urgency</span>
                <select
                  className="field mt-1"
                  value={urgency}
                  onChange={(e) => {
                    setUrgency(e.target.value as Urgency);
                    setDeadline(DEFAULT_DEADLINE[e.target.value as Urgency]);
                  }}
                >
                  <option value="critical">Critical</option>
                  <option value="urgent">Urgent</option>
                  <option value="routine">Routine</option>
                </select>
              </label>
              <label className="col-span-2">
                <span className="text-dim">Deadline: {deadline} min</span>
                <input type="range" min={10} max={240} step={5} value={deadline} onChange={(e) => setDeadline(+e.target.value)} />
              </label>
            </div>
            <button className="btn btn-primary mt-3 w-full" onClick={() => sim.submit(input)}>
              <Send size={14} /> Dispatch on live network
            </button>
            <p className="mt-2 text-[11px] text-dim">Preview commits nothing. Dispatch deducts inventory, assigns vehicles and starts the mission on the shared simulation.</p>
          </Panel>
          <Panel title="Objective weights by urgency">
            <table className="tbl">
              <thead>
                <tr>
                  <th />
                  <th>delay</th>
                  <th>late</th>
                  <th>cost</th>
                  <th>inv.</th>
                  <th>ops</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(WEIGHTS) as Urgency[]).map((u) => (
                  <tr key={u} className={u === urgency ? 'bg-signal/5' : ''}>
                    <td className="capitalize">{u}</td>
                    {Object.values(WEIGHTS[u]).map((w, i) => (
                      <td key={i} className="mono">
                        {w.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] leading-relaxed text-dim">
              delay = ETA ÷ deadline · late = max(0, ETA − deadline) ÷ deadline · cost = USD ÷ 120 · inventory = 0.45 depletion + 0.30 universal-donor use + 0.25 forecast local-shortage risk · ops = share of base fleet committed + battery margin tightness.
            </p>
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel title="Evaluation matrix — live preview" right={<SimLabel />}>
            <div className="scroll-thin overflow-x-auto">
              <table className="tbl min-w-[860px]">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Source</th>
                    <th>Mode</th>
                    <th>Vehicle</th>
                    <th>ETA</th>
                    <th>Slack</th>
                    <th>+30%</th>
                    <th>Cost</th>
                    <th>delay</th>
                    <th>inv</th>
                    <th>ops</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o, i) => (
                    <tr key={o.id} className={i === 0 && preview.chosen ? 'bg-signal/8' : ''}>
                      <td>{i === 0 && preview.chosen ? <Badge tone="signal">chosen</Badge> : <span className="mono text-dim">{i + 1}</span>}</td>
                      <td>{siteById(s.sites, o.sourceId).short}</td>
                      <td>{o.mode}</td>
                      <td className="mono text-[11.5px]">{o.vehicleIds.join('+')}</td>
                      <td className="mono">{o.etaMin.toFixed(1)}</td>
                      <td className={`mono ${o.slackMin >= 0 ? 'text-ok' : 'text-crimson'}`}>{o.slackMin.toFixed(1)}</td>
                      <td className="mono text-dim">{o.robustEtaMin.toFixed(1)}</td>
                      <td className="mono">{fmtUsd(o.costUsd)}</td>
                      <td className="mono text-dim">{o.terms.delay.toFixed(2)}</td>
                      <td className="mono text-dim">{o.terms.inventory.toFixed(2)}</td>
                      <td className="mono text-dim">{o.terms.operational.toFixed(2)}</td>
                      <td className="mono text-soft">{o.score.toFixed(3)}</td>
                    </tr>
                  ))}
                  {preview.rejected.map((r, i) => (
                    <tr key={`r${i}`} className="opacity-70">
                      <td>
                        <Badge tone="crit">rejected</Badge>
                      </td>
                      <td>{siteById(s.sites, r.sourceId).short}</td>
                      <td>{r.mode}</td>
                      <td colSpan={9} className="text-[12px] text-mist">
                        {r.reasons.join('; ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          <DecisionPanel decision={preview} />
        </div>
      </div>
    </Section>
  );
}
