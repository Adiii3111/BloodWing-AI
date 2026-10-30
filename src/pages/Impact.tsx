import { useEffect } from 'react';
import { Distribution, MetricBars } from '../components/LabCharts';
import { Panel, Section, SimLabel, Stat } from '../components/ui';
import { routineOrders, solveNetwork } from '../engine/orbit';
import { createSimulation } from '../engine/simulation';
import { useLab } from '../lib/lab';
import { href } from '../lib/router';
import { useSim } from '../lib/store';

// ORBIT comparison on the seeded baseline network (independent of whatever the live sim is doing).
function orbitBaseline() {
  const s = createSimulation();
  const sols = solveNetwork(s, routineOrders(s));
  const km = sols.reduce((a, x) => a + x.totalKm, 0);
  const iKm = sols.reduce((a, x) => a + x.individual.totalKm, 0);
  return { km, iKm, vehicles: sols.reduce((a, x) => a + x.vehicles, 0), trips: sols.reduce((a, x) => a + x.individual.trips, 0) };
}
const ORBIT_BASE = orbitBaseline();

export default function Impact() {
  const lab = useLab();
  const sim = useSim();
  const r = lab.result;
  useEffect(() => {
    if (!lab.result && !lab.running) lab.run();
  }, [lab]);

  const a = r?.summary['ground-only'];
  const c = r?.summary.ai;
  const d = r?.pairedVsA.ai;
  const model = sim.model;

  return (
    <Section
      num="10"
      eyebrow="Impact & results"
      title={<>What the simulation <span className="text-signal">measured.</span></>}
      lede="Executive summary of completed simulation runs. Every number on this page is computed by the application from its own runs; where the model cannot support a metric, it is not shown."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SimLabel>Simulated results — synthetic Boston network</SimLabel>
        <a className="text-[12px] text-signal hover:underline" href={href('lab')}>
          Change parameters in the Lab →
        </a>
      </div>
      {r && a && c && d ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Mean delivery · AI" value={c.avgMin.mean.toFixed(1)} unit="min" tone="signal" sub={`ground-only ${a.avgMin.mean.toFixed(1)} min`} />
            <Stat label="Δ mean delivery (paired)" value={`${d.avgMin.mean.toFixed(1)}`} unit="min" tone={d.avgMin.hi < 0 ? 'ok' : undefined} sub={`95% CI ${d.avgMin.lo.toFixed(1)} to ${d.avgMin.hi.toFixed(1)}`} />
            <Stat label="P90 delivery · AI" value={c.p90Min.mean.toFixed(1)} unit="min" sub={`ground-only ${a.p90Min.mean.toFixed(1)} min`} />
            <Stat label="On-time · AI" value={`${(c.onTimeRate.mean * 100).toFixed(1)}%`} tone="ok" sub={`ground-only ${(a.onTimeRate.mean * 100).toFixed(1)}%`} />
            <Stat label="Transport cost Δ (paired)" value={`${d.costUsd.mean >= 0 ? '+' : ''}${d.costUsd.mean.toFixed(0)}`} unit="USD/run" sub="synthetic cost model" />
            <Stat label="ORBIT road km" value={`${ORBIT_BASE.km.toFixed(0)}`} unit="km" tone="signal" sub={`vs ${ORBIT_BASE.iKm.toFixed(0)} km individual (${ORBIT_BASE.vehicles} vs ${ORBIT_BASE.trips} dispatches)`} />
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <Panel title="Mean delivery time (min)">
              <MetricBars r={r} metric="avgMin" />
            </Panel>
            <Panel title="Drone utilisation (%)">
              <MetricBars r={r} metric="droneUtil" pct />
            </Panel>
            <Panel title="Units expired in horizon">
              <MetricBars r={r} metric="expiredUnits" />
            </Panel>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <Panel title="Delivery-time distribution">
              <Distribution r={r} />
            </Panel>
            <Panel title="Forecast vs actual synthetic demand (held-out)">
              {model ? (
                <>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Predicted bucket (req/h)</th>
                        <th>Mean predicted</th>
                        <th>Mean observed</th>
                        <th>n</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.metrics.calibration
                        .filter((x) => x.n > 0)
                        .map((x) => (
                          <tr key={x.bucket}>
                            <td className="mono">{x.bucket}</td>
                            <td className="mono">{x.predicted.toFixed(3)}</td>
                            <td className="mono">{x.observed.toFixed(3)}</td>
                            <td className="mono text-dim">{x.n}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[11.5px] text-mist">
                    Held-out MAE {model.metrics.mae.toFixed(3)} vs seasonal baseline {model.metrics.maeHourMean.toFixed(3)} and global mean {model.metrics.maeGlobalMean.toFixed(3)}.
                  </p>
                </>
              ) : (
                <p className="text-mist">Training…</p>
              )}
            </Panel>
          </div>
          <Panel title="How to read this" className="mt-3">
            <ul className="list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-mist">
              <li>All comparisons use identical seeded demand and inventory per replication; confidence intervals are across {r.params.replications} replications of a {r.params.horizonHours}-hour horizon.</li>
              <li>Improvements reflect this model's synthetic assumptions (speeds, distances, costs, weather). They are not predictions for Boston and say nothing about patient outcomes.</li>
              <li>The Rwanda drone-delivery study (Nisingizwe et al., 2022) is real-world evidence from a very different setting; its figures are not used as Boston expectations anywhere in this app.</li>
            </ul>
          </Panel>
        </>
      ) : (
        <div className="panel p-6 text-mist">Running the default experiment ({Math.round(lab.progress * 100)}%)…</div>
      )}
    </Section>
  );
}
