import { Activity, ArrowRight, BookOpen, CalendarClock, Network, Play, Siren } from 'lucide-react';
import { HeroScene } from '../components/HeroScene';
import { href } from '../lib/router';

const CHAPTERS = [
  ['01', 'Command Center', 'mission', 'One live map: inventory, fleet, missions, metrics.'],
  ['02', 'SENTINEL', 'sentinel', 'Emergency response — ambulance vs blood, authorised dispatch.'],
  ['03', 'PULSE', 'pulse', 'Scheduled transfusions planned before they become urgent.'],
  ['04', 'ORBIT', 'orbit', 'Milk-run routing that consolidates routine replenishment.'],
  ['05', 'Dispatch engine', 'dispatch', 'Hard constraints, weighted optimisation, explanations.'],
  ['06', 'Inventory twin', 'inventory', 'Lot-level stock, expiry, reservations, ML shortage risk.'],
  ['07', 'Fleet', 'fleet', 'Drone energy model, couriers, feasibility calculator.'],
  ['08', 'Optimisation lab', 'lab', 'Ground-only vs drone vs AI on identical seeded demand.'],
  ['09', 'Research foundation', 'research', 'From discrete-event simulation to a decision layer.'],
  ['10', 'Impact', 'impact', 'Simulated results with confidence intervals.'],
] as const;

export default function Landing() {
  return (
    <div>
      <section className="relative flex min-h-[calc(100vh-56px)] items-center overflow-hidden">
        <HeroScene />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-space" />
        <div className="relative z-10 mx-auto w-full max-w-[1500px] px-4 pt-[30vh] sm:px-8 md:pt-[34vh]">
          <div className="eyebrow mb-4 flex items-center gap-2">
            <span className="live-dot" /> Northeastern University · AI in Healthcare Builder Blitz · Oct 30, 2026
          </div>
          <h1 className="font-display text-[clamp(52px,9vw,148px)] font-bold leading-[0.9] tracking-[-0.03em]">
            BLOODWING<span className="text-signal"> AI</span>
          </h1>
          <p className="mt-4 font-display text-[clamp(20px,2.4vw,34px)] font-medium text-soft">
            Predict the Need. <span className="text-signal">Optimize the Network.</span> <span className="text-[#ff9aa2]">Deliver in Time.</span>
          </p>
          <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-mist">
            An intelligent blood logistics network designed to move critical resources where they are needed, when they are needed — coordinating emergency response, scheduled transfusions and routine replenishment on one
            shared digital twin. <span className="mono text-[12px] text-dim">Every second circulates.</span>
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href={href('demo')} className="btn btn-primary !px-5 !py-3 text-[15px]">
              <Play size={17} /> Start live demo
            </a>
            <a href={href('sentinel')} className="btn btn-danger !px-5 !py-3 text-[15px]">
              <Siren size={17} /> Launch emergency simulation
            </a>
            <a href={href('mission')} className="btn !px-5 !py-3 text-[15px]">
              Enter mission control <ArrowRight size={16} />
            </a>
            <a href={href('research')} className="btn btn-ghost !px-5 !py-3 text-[15px]">
              <BookOpen size={16} /> Explore the research
            </a>
          </div>
          <p className="disclaimer mt-6 max-w-2xl text-dim">Research prototype · synthetic data only · not connected to any hospital, EMS, traffic or aviation system · not for clinical decision-making.</p>
        </div>
      </section>

      <section className="mx-auto max-w-[1500px] px-4 py-14 sm:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          {[
            [Siren, 'SENTINEL', 'From incident alert to blood readiness.', 'Responds to urgent needs — after EMS assessment and human authorisation, never from an alert alone.', 'sentinel', 'text-[#ff9aa2]', 'panel-hot'],
            [CalendarClock, 'PULSE', "Anticipating tomorrow's demand, today.", 'Prepares for predictable needs — confirmed transfusion orders planned against shared stock.', 'pulse', 'text-[#93c5fd]', ''],
            [Network, 'ORBIT', 'One network. Smarter movement.', 'Optimises the network — consolidated milk runs instead of one trip per request.', 'orbit', 'text-[#5eead4]', 'panel-signal'],
          ].map(([Icon, name, tag, body, r, tone, panel]) => {
            const I = Icon as typeof Siren;
            return (
              <a key={name as string} href={href(r as never)} className={`panel ${panel} group p-6 transition-transform hover:-translate-y-0.5`}>
                <I className={tone as string} size={22} />
                <div className={`mt-3 font-display text-2xl font-bold tracking-[0.12em] ${tone}`}>{name as string}</div>
                <div className="mt-1 font-display text-[17px] text-soft">{tag as string}</div>
                <p className="mt-2 text-[14px] leading-relaxed text-mist">{body as string}</p>
                <div className="mt-4 text-[13px] text-signal opacity-70 group-hover:opacity-100">Open →</div>
              </a>
            );
          })}
        </div>

        <div className="mt-14 grid gap-10 md:grid-cols-[1fr_1.2fr]">
          <div>
            <div className="eyebrow mb-3">The problem</div>
            <h2 className="font-display text-3xl font-semibold leading-tight md:text-4xl">
              Blood may be available. <span className="text-[#ff9aa2]">Time may not be.</span>
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-mist">
              Blood is critical and perishable. Demand arrives unpredictably — trauma, emergency surgery, obstetric haemorrhage — while stock is spread across facilities with different shelf lives, handling rules and compatibility
              constraints. The challenge is not only whether blood exists, but whether an appropriate, released, transportable product can reach the right hospital safely and in time.
            </p>
            <p className="mt-3 text-[15px] leading-relaxed text-mist">
              BLOODWING never assumes a drone is the answer. Sometimes the right move is a courier, a nearby hospital, a consolidated run — or an honest "no feasible option, escalate to a human".
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CHAPTERS.map(([n, t, r, d]) => (
              <a key={n} href={href(r)} className="group flex gap-3 rounded-xl border border-line p-3 transition-colors hover:border-signal/40 hover:bg-signal/5">
                <span className="font-display text-xl font-semibold text-signal/70">{n}</span>
                <span>
                  <span className="block text-[14px] font-semibold">{t}</span>
                  <span className="block text-[12.5px] text-mist">{d}</span>
                </span>
              </a>
            ))}
            <a href={href('pitch')} className="flex items-center gap-3 rounded-xl border border-signal/30 bg-signal/5 p-3 sm:col-span-2">
              <Activity size={18} className="text-signal" />
              <span className="text-[14px]">
                <b>Pitch mode</b> <span className="text-mist">— five cinematic screens for the Shark Tank round.</span>
              </span>
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
