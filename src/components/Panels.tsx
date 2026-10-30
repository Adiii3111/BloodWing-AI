import { AlertTriangle, CheckCircle2, Plane, ShieldAlert, Truck, XCircle } from 'lucide-react';
import { COMPONENT_LABEL } from '../engine/assumptions';
import { recipientLabel } from '../engine/compatibility';
import { siteById } from '../engine/network';
import { computeMetrics } from '../engine/simulation';
import type { Decision } from '../engine/types';
import { clock, fmtMin, fmtPct, fmtUsd } from '../lib/format';
import { useSim } from '../lib/store';
import { Badge, Bar, Stat } from './ui';

export function KpiBar() {
  const sim = useSim();
  const m = computeMetrics(sim.state);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      <Stat label="Active emergency requests" value={m.activeEmergencies} tone={m.activeEmergencies ? 'crit' : undefined} sub={m.queued ? `${m.queued} queued for review` : 'none queued'} />
      <Stat label="Available blood units" value={m.availableUnits} sub={`RBC ${m.availableByComponent.RBC} · PLT ${m.availableByComponent.PLT} · FFP ${m.availableByComponent.PLASMA}`} />
      <Stat label="Available drones" value={`${m.dronesAvailable}/${m.dronesTotal}`} tone="signal" sub="idle with ≥40% battery" />
      <Stat label="Avg simulated response" value={fmtMin(m.avgResponseMin)} unit="min" sub={m.delivered ? `request → handoff, n=${m.delivered}` : 'no deliveries yet'} />
      <Stat label="Est. time saved" value={fmtMin(m.timeSavedMin)} unit="min" tone={m.timeSavedMin && m.timeSavedMin > 0 ? 'ok' : undefined} sub="vs nearest-depot ground baseline" />
      <Stat label="At-risk inventory" value={m.atRiskUnits} unit="units" tone={m.atRiskUnits > 20 ? 'warn' : undefined} sub="expiring within 48 h" />
      <Stat label="On-time fulfilment" value={fmtPct(m.onTimeRate)} tone="ok" sub={`${m.unfulfilled} unfulfilled`} />
      <Stat label="Missions completed" value={m.delivered} sub={`${m.missionsActive} active`} />
    </div>
  );
}

export function DecisionPanel({ decision, compact }: { decision: Decision | null | undefined; compact?: boolean }) {
  const sim = useSim();
  if (!decision) {
    return (
      <div className="panel p-5">
        <div className="eyebrow mb-2">Why this route?</div>
        <p className="text-sm text-mist">Trigger an emergency or start a scenario. Every recommendation the engine makes is explained here — sources, constraints, alternatives and trade-offs.</p>
      </div>
    );
  }
  const s = sim.state;
  const req = s.requests.find((r) => r.id === decision.requestId);
  const o = decision.chosen;
  const src = o ? siteById(s.sites, o.sourceId) : null;
  const dest = req ? siteById(s.sites, req.hospitalId) : null;
  const tone = decision.status === 'dispatch' ? 'panel-signal' : 'panel-hot';
  return (
    <div className={`panel ${tone} rise`} key={decision.id + decision.at}>
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="eyebrow !text-signal">Why this route?</div>
        <div className="flex gap-1.5">
          <Badge>{decision.id}</Badge>
          {decision.status === 'dispatch' && <Badge tone="ok">feasible · on time</Badge>}
          {decision.status === 'dispatch-late' && <Badge tone="warn">late · human review</Badge>}
          {decision.status === 'no-feasible' && <Badge tone="crit">no feasible option</Badge>}
          {req?.status === 'awaiting-auth' && <Badge tone="warn">awaiting authorisation</Badge>}
        </div>
      </div>
      <div className="space-y-3 p-4">
        {req && dest && (
          <div className="text-[13px] text-mist">
            <span className="mono text-soft">{req.id}</span> · {dest.name} · {req.units} × {COMPONENT_LABEL[req.component].toLowerCase()} · {recipientLabel(req.recipientGroup)} · {req.urgency} · deadline {req.deadlineMin} min
          </div>
        )}
        {o && src && (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-line bg-space/60 p-2.5">
              <div className="eyebrow !text-[9.5px]">Source</div>
              <div className="font-display text-[15px] font-semibold">{src.short}</div>
            </div>
            <div className="rounded-lg border border-line bg-space/60 p-2.5">
              <div className="eyebrow !text-[9.5px]">Mode · vehicle</div>
              <div className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
                {o.mode === 'drone' ? <Plane size={14} className="text-signal" /> : <Truck size={14} className="text-med" />}
                <span className="truncate">{o.vehicleIds.join('+')}</span>
              </div>
            </div>
            <div className="rounded-lg border border-line bg-space/60 p-2.5">
              <div className="eyebrow !text-[9.5px]">ETA · slack</div>
              <div className="font-display text-[15px] font-semibold tabular">
                {o.etaMin.toFixed(1)}m <span className={o.slackMin >= 0 ? 'text-ok' : 'text-crimson'}>{o.slackMin >= 0 ? '+' : ''}{o.slackMin.toFixed(1)}</span>
              </div>
            </div>
          </div>
        )}
        <ul className="space-y-1.5">
          {decision.explanation.slice(0, compact ? 4 : 12).map((e, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-snug text-soft/90">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-signal" />
              <span>{e}</span>
            </li>
          ))}
        </ul>
        {!compact && (decision.alternatives.length > 0 || decision.rejected.length > 0) && (
          <details className="group">
            <summary className="cursor-pointer text-[12px] text-mist hover:text-soft">
              {decision.alternatives.length} feasible alternatives · {decision.rejected.length} rejected options
            </summary>
            <div className="mt-2 space-y-1">
              {decision.alternatives.slice(0, 6).map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="flex items-center gap-1.5 text-mist">
                    <CheckCircle2 size={12} className="text-ok" /> {siteById(s.sites, a.sourceId).short} by {a.mode}
                  </span>
                  <span className="mono text-dim">
                    ETA {a.etaMin.toFixed(1)} · {fmtUsd(a.costUsd)} · score {a.score.toFixed(3)}
                  </span>
                </div>
              ))}
              {decision.rejected.slice(0, 8).map((r, i) => (
                <div key={i} className="flex gap-1.5 text-[12px] text-dim">
                  <XCircle size={12} className="mt-0.5 shrink-0 text-crimson/70" />
                  <span>
                    {siteById(s.sites, r.sourceId).short} by {r.mode}: {r.reasons.join('; ')}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
        <p className="text-[11px] text-dim">Explanations are generated deterministically from the engine's numbers — no language model is involved.</p>
      </div>
    </div>
  );
}

export function EventLog({ max = 14 }: { max?: number }) {
  const sim = useSim();
  const ev = sim.state.events.slice(-max).reverse();
  return (
    <div className="scroll-thin max-h-[300px] space-y-1 overflow-auto pr-1">
      {ev.map((e, i) => (
        <div key={`${e.t}-${i}`} className="flex gap-2 text-[12px] leading-snug">
          <span className="mono shrink-0 text-dim">{clock(e.t)}</span>
          <span className={e.severity === 'crit' ? 'text-[#ff9aa2]' : e.severity === 'warn' ? 'text-warn' : e.severity === 'ok' ? 'text-ok' : 'text-mist'}>{e.text}</span>
        </div>
      ))}
    </div>
  );
}

export function MissionList() {
  const sim = useSim();
  const s = sim.state;
  const ms = [...s.missions].reverse().slice(0, 6);
  if (!ms.length) return <p className="text-[13px] text-dim">No missions yet.</p>;
  return (
    <div className="space-y-2">
      {ms.map((m) => {
        const total = m.returnAt - m.dispatchedAt;
        const end = m.kind === 'milkrun' ? m.handoffDoneAt : m.handoffDoneAt;
        const progress = Math.min(1, Math.max(0, (s.t - m.dispatchedAt) / Math.max(1, end - m.dispatchedAt)));
        const eta = Math.max(0, end - s.t);
        return (
          <button key={m.id} className="w-full rounded-lg border border-line bg-space/50 p-2.5 text-left hover:border-signal/40" onClick={() => sim.focus(m.decisionId || null)}>
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="flex items-center gap-1.5">
                {m.mode === 'drone' ? <Plane size={12} className="text-signal" /> : <Truck size={12} className={m.kind === 'milkrun' ? 'text-[#2dd4bf]' : 'text-med'} />}
                <span className="mono text-soft">{m.id}</span>
                <span className="text-mist">
                  {siteById(s.sites, m.sourceId).short} → {m.kind === 'milkrun' ? `${m.stops!.length} stops` : siteById(s.sites, m.destId).short}
                </span>
              </span>
              <span className="mono text-dim">{m.phase === 'complete' ? (m.onTime === false ? 'late' : 'done') : m.phase === 'returning' ? 'returning' : `ETA ${eta.toFixed(1)}m`}</span>
            </div>
            <div className="mt-1.5">
              <Bar value={progress} max={1} color={m.phase === 'complete' || m.phase === 'returning' ? '#34d399' : m.mode === 'drone' ? '#22d3ee' : '#3b82f6'} h={4} />
            </div>
            {total > 0 && null}
          </button>
        );
      })}
    </div>
  );
}

export function SafetyNote() {
  return (
    <div className="flex gap-2 rounded-lg border border-warn/25 bg-warn/5 p-3 text-[12px] leading-relaxed text-warn/90">
      <ShieldAlert size={15} className="mt-0.5 shrink-0" />
      <span>Research simulation using synthetic data. Not for clinical decision-making. No real dispatch, drone control, clinical ordering or hospital system is involved.</span>
    </div>
  );
}

export function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[12px] text-warn">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
