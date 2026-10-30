import { Ambulance, CheckCircle2, Circle, Droplets, Plane, Truck } from 'lucide-react';
import { readiness } from '../engine/sentinel';
import { siteById } from '../engine/network';
import type { Incident } from '../engine/types';
import { clock } from '../lib/format';
import { useSim } from '../lib/store';

function Countdown({ min }: { min: number | null }) {
  if (min == null) return <span className="text-dim">—</span>;
  const v = Math.max(0, min);
  const m = Math.floor(v);
  const s = Math.floor((v - m) * 60);
  return (
    <span className="tabular">
      {String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
    </span>
  );
}

/** THE RACE AGAINST TIME — patient transport vs blood delivery, each with its own ETA. */
export function Race({ incident, big }: { incident: Incident; big?: boolean }) {
  const sim = useSim();
  const s = sim.state;
  const r = readiness(s, incident);
  const hosp = siteById(s.sites, incident.hospitalId);
  const req = s.requests.find((x) => x.incidentId === incident.id);
  const mission = req?.missionId ? s.missions.find((m) => m.id === req.missionId) : undefined;
  const decision = req ? s.decisions.find((d) => d.id === req.decisionId) : undefined;

  const pTotal = incident.patientArriveAt - incident.t;
  const pProg = Math.min(1, Math.max(0, (s.t - incident.t) / pTotal));
  const pLeft = incident.patientArriveAt - s.t;
  const emsLabel = { alert: 'Alert received · EMS en route', 'on-scene': 'EMS on scene · assessing', assessed: 'Assessed · preparing transport', transporting: 'Transporting patient', arrived: 'Patient arrived' }[incident.emsStatus];

  let bProg = 0;
  let bLeft: number | null = null;
  let bLabel = 'Awaiting EMS assessment — nothing ordered yet';
  if (r.status === 'awaiting-auth') {
    bLabel = decision?.chosen ? `Recommendation ready · awaiting authorisation (projected ${decision.chosen.etaMin.toFixed(1)} min)` : 'No feasible option · human review';
  } else if (mission) {
    bProg = Math.min(1, Math.max(0, (s.t - mission.dispatchedAt) / (mission.handoffDoneAt - mission.dispatchedAt)));
    bLeft = mission.handoffDoneAt - s.t;
    bLabel = { preparing: 'Picking, packing, pre-departure checks', enroute: mission.mode === 'drone' ? 'In flight' : 'On the road', handoff: 'Handoff at hospital', returning: 'Delivered', complete: 'Delivered' }[mission.phase];
  } else if (r.status === 'no-feasible') bLabel = 'No feasible delivery — escalated for human review';
  else if (r.status === 'local-only') bLabel = 'Receiving hospital stock covers the request — no shipment';
  else if (r.status === 'declined') bLabel = 'Declined at authorisation';

  const margin = r.marginMin;
  const final = r.status === 'received' || (mission && incident.emsStatus === 'arrived');
  const marginTone = margin == null ? 'text-mist' : margin >= 0 ? 'text-ok' : 'text-crimson';
  const size = big ? 'text-5xl md:text-6xl' : 'text-4xl';

  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="eyebrow !text-[#ff9aa2]">The race against time · {incident.ref}</div>
        <span className="mono text-[11px] text-dim">alert {clock(incident.t)} · receiving {hosp.short} (EMS decision)</span>
      </div>
      <div className="grid md:grid-cols-[1fr_auto_1fr]">
        <div className="p-4">
          <div className="flex items-center gap-2 text-[12px] text-[#ff9aa2]">
            <Ambulance size={16} /> PATIENT ARRIVAL ETA
          </div>
          <div className={`mt-1 font-display font-semibold ${size}`}>
            <Countdown min={pLeft} />
          </div>
          <div className="mt-1 text-[12px] text-mist">{emsLabel}</div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-crimson transition-[width] duration-200" style={{ width: `${pProg * 100}%` }} />
          </div>
          <div className="mono mt-1 text-[10.5px] text-dim">arrives {clock(incident.patientArriveAt)} · independent ambulance model</div>
        </div>
        <div className="flex flex-col items-center justify-center border-y border-line px-6 py-4 md:border-x md:border-y-0">
          <div className="eyebrow !text-[9.5px]">Readiness margin</div>
          <div className={`font-display font-semibold tabular ${size} ${marginTone}`}>{margin == null ? '—' : `${margin >= 0 ? '+' : '−'}${Math.abs(margin).toFixed(1)}`}</div>
          <div className="text-[11px] text-mist">min · patient − blood</div>
          {margin != null && (
            <div className={`mt-1 text-[11px] ${marginTone}`}>{margin >= 0 ? 'shipment expected before patient' : 'shipment expected after patient'}</div>
          )}
          {final && <div className="mt-1 text-[10.5px] text-dim">recorded</div>}
        </div>
        <div className="p-4">
          <div className="flex items-center gap-2 text-[12px] text-signal">
            {mission?.mode === 'ground' ? <Truck size={16} /> : mission?.mode === 'drone' ? <Plane size={16} /> : <Droplets size={16} />} BLOOD DELIVERY ETA
          </div>
          <div className={`mt-1 font-display font-semibold ${size}`}>
            <Countdown min={bLeft} />
          </div>
          <div className="mt-1 text-[12px] text-mist">
            {bLabel}
            {mission && ` · ${siteById(s.sites, mission.sourceId).short} by ${mission.mode} (${mission.vehicleIds.join('+')})`}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-signal transition-[width] duration-200" style={{ width: `${bProg * 100}%` }} />
          </div>
          <div className="mono mt-1 text-[10.5px] text-dim">
            {mission ? `handoff ${clock(mission.handoffDoneAt)} · ${req!.units} units from network + ${incident.localUnits} held locally` : `${incident.localUnits} units held locally for the patient`}
          </div>
        </div>
      </div>
      <div className="grid gap-x-4 gap-y-1 border-t border-line px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
        {r.stages.map((st) => (
          <div key={st.key} className="flex items-start gap-1.5 text-[11.5px]">
            {st.done ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-ok" /> : <Circle size={13} className="mt-0.5 shrink-0 text-dim" />}
            <span className={st.done ? 'text-soft' : 'text-dim'}>
              {st.label}
              {st.at != null && <span className="mono text-dim"> · {clock(st.at)}</span>}
              {st.note && <span className="text-dim"> ({st.note})</span>}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t border-line bg-space/40 px-4 py-2 text-[11px] text-dim">
        A positive margin means the shipment is expected to be received before the patient arrives. It does not mean blood is ready to transfuse — receipt check-in, compatibility testing and preparation follow, under hospital control.
      </div>
    </div>
  );
}
