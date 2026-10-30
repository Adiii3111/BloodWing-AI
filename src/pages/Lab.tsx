import { Download, FlaskConical, RotateCcw } from 'lucide-react';
import { useEffect } from 'react';
import { Distribution, MetricBars, POLICY_COLOR } from '../components/LabCharts';
import { Bar, Panel, Section, SimLabel } from '../components/ui';
import { METRICS, POLICIES, toCSV, type LabParams } from '../engine/experiment';
import { useLab } from '../lib/lab';

type Num = { [K in keyof LabParams]: LabParams[K] extends number ? K : never }[keyof LabParams];

const SLIDERS: { k: Num; label: string; min: number; max: number; step: number; fmt?: (x: number) => string }[] = [
  { k: 'demandPerHour', label: 'Emergency demand intensity (req/h)', min: 0.4, max: 5, step: 0.2 },
  { k: 'dronesPerDepot', label: 'Drones per depot', min: 0, max: 5, step: 1 },
  { k: 'droneSpeedKmh', label: 'Drone cruise speed (km/h)', min: 40, max: 120, step: 5 },
  { k: 'droneRangeKm', label: 'Drone range (km)', min: 12, max: 60, step: 2 },
  { k: 'dronePayloadKg', label: 'Drone payload / fleet capacity (kg)', min: 1, max: 4, step: 0.25 },
  { k: 'groundDelay', label: 'Ground traffic delay (×)', min: 1, max: 3.5, step: 0.1 },
  { k: 'flyableShare', label: 'Flyable weather share', min: 0, max: 1, step: 0.05, fmt: (x) => `${Math.round(x * 100)}%` },
  { k: 'horizonHours', label: 'Horizon (h)', min: 6, max: 72, step: 6 },
  { k: 'replications', label: 'Replications', min: 2, max: 20, step: 1 },
  { k: 'seed', label: 'Seed', min: 1, max: 99, step: 1 },
];

export default function Lab() {
  const lab = useLab();
  const p = lab.params;
  const r = lab.result;
  useEffect(() => {
    if (!lab.result && !lab.running) lab.run();
  }, [lab]);

  const download = () => {
    if (!r) return;
    const blob = new Blob([toCSV(r)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bloodwing-lab-seed${r.params.seed}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Section
      num="08"
      eyebrow="AI optimisation laboratory"
      title={<>Three policies. <span className="text-signal">Identical</span> demand. Measured, not assumed.</>}
      lede="Each replication generates one seeded stream of synthetic requests and one initial inventory, then runs all three dispatch policies on exactly those inputs (common random numbers). Results show the mean and a 95% confidence interval across replications."
    >
      <div className="grid gap-3 xl:grid-cols-[340px_1fr]">
        <div className="space-y-3">
          <Panel title="Experiment parameters">
            <div className="space-y-3">
              {SLIDERS.map((sl) => (
                <label key={sl.k} className="block text-[12px]">
                  <span className="flex justify-between text-mist">
                    {sl.label}
                    <span className="mono text-soft">{sl.fmt ? sl.fmt(p[sl.k]) : p[sl.k]}</span>
                  </span>
                  <input type="range" min={sl.min} max={sl.max} step={sl.step} value={p[sl.k]} onChange={(e) => lab.set({ [sl.k]: +e.target.value })} />
                </label>
              ))}
              {(
                [
                  ['variability', 'Demand variability', ['low', 'medium', 'high']],
                  ['inventory', 'Inventory distribution', ['balanced', 'depot-heavy', 'hospital-heavy']],
                  ['priority', 'Dispatch priority (AI weights)', ['balanced', 'speed', 'cost']],
                ] as const
              ).map(([k, label, opts]) => (
                <label key={k} className="block text-[12px]">
                  <span className="text-mist">{label}</span>
                  <select className="field mt-1" value={p[k]} onChange={(e) => lab.set({ [k]: e.target.value } as Partial<LabParams>)}>
                    {opts.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="flex items-center gap-2 text-[12px] text-mist">
                <input type="checkbox" checked={p.airspaceTfr} onChange={(e) => lab.set({ airspaceTfr: e.target.checked })} /> Simulated downtown flight restriction
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button className="btn btn-primary flex-1" disabled={lab.running} onClick={() => lab.run()}>
                <FlaskConical size={15} /> {lab.running ? `Running ${Math.round(lab.progress * 100)}%` : 'Run experiment'}
              </button>
              <button className="btn" onClick={() => lab.reset()} aria-label="Reset parameters">
                <RotateCcw size={15} />
              </button>
            </div>
            {lab.running && (
              <div className="mt-2">
                <Bar value={lab.progress} max={1} />
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-3">
          {r ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <SimLabel>Simulated results — synthetic Boston network</SimLabel>
                <span className="mono text-[11px] text-dim">
                  {r.params.replications} replications × {POLICIES.length} policies · ~{Math.round(r.runs[0]?.requests ?? 0)} requests per run · {Math.round(r.ms)} ms
                </span>
                <button className="btn btn-sm ml-auto" onClick={download}>
                  <Download size={13} /> Export CSV
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <Panel title="Mean delivery time (min) · 95% CI">
                  <MetricBars r={r} metric="avgMin" />
                </Panel>
                <Panel title="90th percentile delivery (min)">
                  <MetricBars r={r} metric="p90Min" />
                </Panel>
                <Panel title="Deadline fulfilment (%)">
                  <MetricBars r={r} metric="onTimeRate" pct />
                </Panel>
              </div>
              <Panel title="All metrics — mean [95% CI]; paired difference vs Baseline A">
                <div className="scroll-thin overflow-x-auto">
                  <table className="tbl min-w-[760px]">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        {POLICIES.map((pp) => (
                          <th key={pp.id}>
                            <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: POLICY_COLOR[pp.id] }} />
                            {pp.name}
                          </th>
                        ))}
                        <th>C − A (paired)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {METRICS.map((m) => {
                        const d = r.pairedVsA.ai[m.key];
                        const excludesZero = Number.isFinite(d.lo) && (d.lo > 0 || d.hi < 0);
                        return (
                          <tr key={m.key}>
                            <td>
                              {m.label} <span className="text-[11px] text-dim">({m.unit})</span>
                            </td>
                            {POLICIES.map((pp) => {
                              const x = r.summary[pp.id][m.key];
                              return (
                                <td key={pp.id} className="mono text-[12px]">
                                  {Number.isFinite(x.mean) ? m.fmt(x.mean) : '—'} <span className="text-dim">[{Number.isFinite(x.lo) ? `${m.fmt(x.lo)}, ${m.fmt(x.hi)}` : '—'}]</span>
                                </td>
                              );
                            })}
                            <td className="mono text-[12px]">
                              {Number.isFinite(d.mean) ? m.fmt(d.mean) : '—'} <span className="text-dim">[{Number.isFinite(d.lo) ? `${m.fmt(d.lo)}, ${m.fmt(d.hi)}` : '—'}]</span>
                              {excludesZero && <span className="ml-1 text-[10.5px] text-signal">CI excludes 0</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-dim">
                  Paired differences use the same seeded demand per replication. "CI excludes 0" describes this synthetic experiment only — it is not evidence about real-world performance, and no multiple-comparison correction is applied.
                </p>
              </Panel>
              <Panel title="Delivery-time distribution (share of delivered requests)">
                <Distribution r={r} />
              </Panel>
            </>
          ) : (
            <div className="panel p-6 text-mist">Running the default experiment…</div>
          )}
          <Panel title="Methodology & assumptions">
            <ul className="list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-mist">
              <li>
                <b className="text-soft">Baseline A — ground only:</b> nearest depot holding enough eligible stock ships by courier. No cross-hospital visibility (a conventional supplier-based process).
              </li>
              <li>
                <b className="text-soft">Scenario B — drone available:</b> same nearest-depot rule; a drone flies whenever feasible, otherwise a courier.
              </li>
              <li>
                <b className="text-soft">Scenario C — AI multimodal:</b> the BLOODWING engine considers every depot and hospital (above local floors), drone or ground, and minimises the urgency-weighted objective under hard constraints.
              </li>
              <li>Demand: seeded Poisson arrivals with a diurnal profile, optional surge clusters; component, group, urgency and units drawn from synthetic mixes. Deadlines: critical 30, urgent 60, routine 180 min (synthetic targets).</li>
              <li>Weather: each hour is flyable with the chosen probability; otherwise wind exceeds the drone limit. Depots are resupplied every 12 h. Requests with no feasible option queue and are retried; after deadline + 60 min they count as unfulfilled.</li>
              <li>Costs are synthetic planning figures. Expiry counts units that reached end of shelf life inside the horizon. Nothing here is a claim about patient outcomes.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </Section>
  );
}
