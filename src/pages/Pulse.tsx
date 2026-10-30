import { CalendarClock, ChevronLeft, ChevronRight, FastForward, PackageCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Panel, Section, SimLabel } from '../components/ui';
import { forecastNextHours, UNITS_PER_REQUEST } from '../engine/forecast';
import { simDate, siteById } from '../engine/network';
import { PULSE, type PulsePlan } from '../engine/pulse';
import { clock } from '../lib/format';
import { href } from '../lib/router';
import { useSim } from '../lib/store';

const STATUS_TONE: Record<PulsePlan['status'], 'ok' | 'warn' | 'crit' | 'blue' | 'default'> = {
  'on-track': 'ok',
  'at-risk': 'warn',
  late: 'crit',
  infeasible: 'crit',
  prediction: 'blue',
  cancelled: 'default',
};

const day = (t: number) => simDate(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export default function Pulse() {
  const sim = useSim();
  const s = sim.state;
  const plans = sim.plans();
  const [selId, setSelId] = useState(plans[0]?.appt.id);
  const sel = plans.find((p) => p.appt.id === selId) ?? plans[0];

  // 14-day planning calendar: scheduled units vs ML-expected emergency units
  const calendar = useMemo(() => {
    const startDay = Math.floor((s.t + 14 * 60) / 1440);
    const days = Array.from({ length: 14 }, (_, i) => {
      const dayStart = (startDay + i) * 1440 - 14 * 60;
      return { key: i, label: simDate(dayStart + 60).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), start: dayStart, confirmed: 0, pending: 0, forecast: 0 };
    });
    for (const a of s.appointments) {
      if (a.orderStatus === 'cancelled') continue;
      const d = days.find((x) => a.at >= x.start && a.at < x.start + 1440);
      if (d) d[a.orderStatus === 'confirmed' ? 'confirmed' : 'pending'] += a.units;
    }
    if (sim.model) {
      const f = forecastNextHours(sim.model, Math.max(s.t, days[0].start), {}, 24 * 14);
      for (const h of Object.values(f)) h.hourly.forEach((mu, k) => {
        const idx = Math.floor((Math.max(s.t, days[0].start) + k * 60 - days[0].start) / 1440);
        if (days[idx]) days[idx].forecast += mu * UNITS_PER_REQUEST;
      });
    }
    return days.map((d) => ({ ...d, forecast: Math.round(d.forecast) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.appointments.map((a) => `${a.at}${a.orderStatus}${a.units}`).join(), sim.model, Math.floor(s.t / 60)]);

  const steps = sel
    ? ([
        ['Now', s.t],
        ['Recommended dispatch', sel.recommendedDispatch],
        ['Latest feasible dispatch', sel.latestDispatch],
        ['Required availability', sel.requiredBy],
        ['Appointment', sel.appt.at],
      ] as [string, number | null][])
    : [];
  const span = sel ? Math.max(60, sel.appt.at - s.t) : 1;

  return (
    <div>
      <Section
        num="03"
        eyebrow="PULSE — Predictive transfusion intelligence"
        title={<>Anticipating tomorrow's demand, <span className="text-[#93c5fd]">today.</span></>}
        lede="Some patients with chronic conditions receive scheduled transfusions. With consent and hospital authorisation, a future system could use confirmed clinical orders to prepare inventory in advance — holding identical units locally, or scheduling a replenishment that arrives before it is needed. All patients and orders below are fictional."
      >
        <div className="mb-3 flex flex-wrap gap-2">
          <SimLabel>Fictional patients · synthetic orders</SimLabel>
          <Badge tone="blue">quantities come from the clinical order — never inferred from a diagnosis</Badge>
        </div>

        <div className="grid gap-3 xl:grid-cols-[1.25fr_1fr]">
          <Panel title="Scheduled transfusions — planning board" right={<span className="mono text-[11px] text-dim">sim clock {clock(s.t)}</span>}>
            <div className="scroll-thin overflow-x-auto">
              <table className="tbl min-w-[760px]">
                <thead>
                  <tr>
                    <th>Patient</th>
                    <th>Appointment</th>
                    <th>Order</th>
                    <th>Product</th>
                    <th>Plan</th>
                    <th>Dispatch by</th>
                    <th>Risk</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.appt.id} onClick={() => setSelId(p.appt.id)} className={`cursor-pointer ${sel?.appt.id === p.appt.id ? 'bg-med/10' : ''}`}>
                      <td>
                        <div className="mono text-soft">{p.appt.patientId}</div>
                        <div className="text-[11px] text-dim">{p.appt.condition}</div>
                      </td>
                      <td>
                        <div>{day(p.appt.at)}</div>
                        <div className="mono text-[11px] text-dim">{clock(p.appt.at).split(' ').pop()} · {siteById(s.sites, p.appt.hospitalId).short}</div>
                      </td>
                      <td>
                        <select
                          className="field !w-auto !py-1 !text-[12px]"
                          value={p.appt.orderStatus}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => sim.updateAppointment(p.appt.id, { orderStatus: e.target.value as never })}
                          aria-label={`Order status for ${p.appt.patientId}`}
                        >
                          <option value="confirmed">confirmed</option>
                          <option value="pending">pending confirmation</option>
                          <option value="cancelled">cancelled</option>
                        </select>
                      </td>
                      <td className="mono text-[12px]">
                        {p.appt.units} {p.appt.component} {p.appt.group.replace('-', '−')}
                      </td>
                      <td className="text-[12px]">
                        {p.alreadyReserved > 0 && <div className="text-ok">{p.alreadyReserved} reserved</div>}
                        {p.fromLocal > 0 && <div>{p.fromLocal} hold locally</div>}
                        {p.shortfall > 0 && <div className="text-[#93c5fd]">{p.shortfall} from {p.depotId ? siteById(s.sites, p.depotId).short : '—'}</div>}
                        {p.onOrder > 0 && <div className="text-[#5eead4]">{p.onOrder} on order</div>}
                        {p.action === 'cancelled' && <div className="text-dim">—</div>}
                      </td>
                      <td className="mono text-[12px]">{p.recommendedDispatch != null ? clock(p.recommendedDispatch) : '—'}</td>
                      <td className="mono text-[12px]">{p.action === 'cancelled' ? '—' : p.shortageRisk > 0.99 ? '>99%' : `${Math.round(p.shortageRisk * 100)}%`}</td>
                      <td>
                        <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
                        {p.appt.planned && <div className="mt-1 text-[10.5px] text-ok">executed</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-dim">
              Plans are computed in priority order — confirmed orders first, then by date — against one running view of inventory, so two appointments never count on the same units. Change an order's status or date and every plan recalculates.
            </p>
          </Panel>

          {sel && (
            <Panel title={`Plan detail · ${sel.appt.patientId}`} right={<Badge tone={STATUS_TONE[sel.status]}>{sel.status}</Badge>}>
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-mist">
                <CalendarClock size={15} className="text-[#93c5fd]" />
                {sel.appt.condition} · {siteById(s.sites, sel.appt.hospitalId).name} <span className="text-dim">(fictional association)</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-[12px] text-dim">Move appointment:</span>
                <button className="btn btn-sm" onClick={() => sim.updateAppointment(sel.appt.id, { at: sel.appt.at - 1440 })} aria-label="One day earlier">
                  <ChevronLeft size={13} /> 1 day
                </button>
                <button className="btn btn-sm" onClick={() => sim.updateAppointment(sel.appt.id, { at: sel.appt.at + 1440 })} aria-label="One day later">
                  1 day <ChevronRight size={13} />
                </button>
              </div>

              <div className="relative mt-5 h-[92px]">
                <div className="absolute left-0 right-0 top-[38px] h-[2px] bg-gradient-to-r from-med/30 via-signal/50 to-med" />
                {steps.map(([label, t], i) =>
                  t == null ? null : (
                    <div key={label} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: `${Math.min(96, Math.max(4, ((t - s.t) / span) * 100))}%` }}>
                      <div className={`mono text-[10px] ${i % 2 ? 'mt-[56px]' : ''} whitespace-nowrap text-dim`}>{clock(t)}</div>
                      <div className={`mx-auto my-1 h-3 w-3 rounded-full border-2 ${i === 4 ? 'border-[#93c5fd] bg-med' : i === 2 ? 'border-warn bg-ink' : 'border-signal bg-ink'}`} style={{ position: 'absolute', top: 32, left: '50%', transform: 'translateX(-50%)' }} />
                      <div className={`whitespace-nowrap text-[11px] ${i % 2 ? '' : 'mt-[32px]'} text-mist`}>{label}</div>
                    </div>
                  ),
                )}
              </div>

              <div className="mt-2 rounded-lg border border-line bg-space/60 p-3 font-mono text-[11.5px] leading-relaxed text-mist">
                latest feasible dispatch = required availability − transport lead − handling buffer
                <br />
                {sel.latestDispatch != null ? (
                  <span className="text-soft">
                    {clock(sel.latestDispatch)} = {clock(sel.requiredBy)} − {Math.round(sel.leadTimeMin!)} min − {PULSE.handlingBufferMin} min
                  </span>
                ) : (
                  <span>no replenishment needed for this appointment</span>
                )}
              </div>
              <ul className="mt-3 space-y-1.5">
                {sel.explanation.map((e, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] leading-snug">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#93c5fd]" />
                    {e}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn btn-primary" disabled={sel.appt.orderStatus !== 'confirmed' || !!sel.appt.planned || sel.action === 'infeasible'} onClick={() => sim.executePlan(sel.appt.id)}>
                  <PackageCheck size={15} /> {sel.appt.planned ? 'Plan executed' : 'Execute plan (reserve + order)'}
                </button>
                {sel.recommendedDispatch != null && sel.recommendedDispatch > s.t && (
                  <button className="btn" onClick={() => sim.advanceTo(sel.recommendedDispatch!)}>
                    <FastForward size={15} /> Advance clock to dispatch time
                  </button>
                )}
                {s.orders.some((o) => o.reservedFor === sel.appt.id) && (
                  <a className="btn" href={href('orbit')}>
                    Route it in ORBIT →
                  </a>
                )}
              </div>
              {sel.appt.orderStatus !== 'confirmed' && <p className="mt-2 text-[11px] text-warn">Pending orders are predictions: nothing is reserved until the clinical order is confirmed.</p>}
              <p className="mt-2 text-[11px] text-dim">
                Planning assumptions (synthetic): units on shelf {PULSE.availabilityLeadMin / 60} h before the appointment, {PULSE.handlingBufferMin}-min handling buffer, {PULSE.safetyMarginMin}-min safety margin, planning traffic ×{PULSE.planningTraffic}, units must stay in date 24 h past the appointment, ABO/RhD-identical units only. Local emergency floors are never used.
              </p>
            </Panel>
          )}
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <Panel title="14-day demand outlook — scheduled orders vs ML-expected emergency use (RBC-equivalent units)">
            <div className="h-[260px]">
              <ResponsiveContainer>
                <BarChart data={calendar} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap="22%">
                  <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: 'rgba(148,163,184,.06)' }} contentStyle={{ background: '#07111f', border: '1px solid rgba(148,163,184,.2)', borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                  <Bar dataKey="confirmed" name="Scheduled · confirmed" stackId="s" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="pending" name="Scheduled · pending" stackId="s" fill="#8f6ee8" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="forecast" name="ML-expected emergency use" fill="#0ea5bf" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-[11px] text-dim">Scheduled bars are fictional confirmed/pending orders. The forecast bar is the Poisson model's expected unit demand across the six hospitals — a prediction, not an order.</p>
          </Panel>
          <Panel title="Forecast model — held-out evaluation">
            {sim.model ? (
              <div className="space-y-2 text-[12.5px]">
                <p className="text-mist">
                  Poisson regression (log link) on hourly synthetic request counts: hour-of-day harmonics, weekend flag, hospital, and recent demand. Trained on {sim.model.trainDays} days ({sim.model.trainRows.toLocaleString()} rows), tested on the following {sim.model.testDays} days ({sim.model.testRows.toLocaleString()} rows).
                </p>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>MAE (requests / hour)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Poisson GLM (ours)</td>
                      <td className="mono">{sim.model.metrics.mae.toFixed(3)}</td>
                    </tr>
                    <tr>
                      <td>Hospital × hour mean (seasonal baseline)</td>
                      <td className="mono">{sim.model.metrics.maeHourMean.toFixed(3)}</td>
                    </tr>
                    <tr>
                      <td>Global mean baseline</td>
                      <td className="mono">{sim.model.metrics.maeGlobalMean.toFixed(3)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-[11.5px] text-mist">
                  Deviance ratio vs seasonal baseline: <span className="mono text-soft">{sim.model.metrics.devianceRatio.toFixed(3)}</span> (below 1 = better fit). On held-out data the model {sim.model.metrics.mae < sim.model.metrics.maeGlobalMean ? 'beats' : 'does not beat'} the global mean and is{' '}
                  {sim.model.metrics.mae < sim.model.metrics.maeHourMean ? 'slightly better than' : 'no better than'} the seasonal mean on MAE{sim.model.metrics.devianceRatio < 1 ? ', with a slightly better deviance' : ''} — reported as is.
                </p>
              </div>
            ) : (
              <p className="text-[12.5px] text-mist">Training…</p>
            )}
          </Panel>
        </div>
      </Section>
    </div>
  );
}
