import { ArrowLeft, ArrowRight, Siren, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Logo } from '../components/Logo';
import { MapView } from '../components/MapView';
import { MetricBars } from '../components/LabCharts';
import { Race } from '../components/Race';
import { SENTINEL_SCENARIOS } from '../engine/sentinel';
import { useLab } from '../lib/lab';
import { go, href } from '../lib/router';
import { store, useSim } from '../lib/store';

const N = 5;

export default function Pitch() {
  const [i, setI] = useState(0);
  const sim = useSim();
  const lab = useLab();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') setI((x) => Math.min(N - 1, x + 1));
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setI((x) => Math.max(0, x - 1));
      if (e.key === 'Escape') go('home');
    };
    window.addEventListener('keydown', on);
    if (!lab.result && !lab.running) void lab.run();
    return () => window.removeEventListener('keydown', on);
  }, [lab]);

  const launch = () => {
    store.demoLock = false;
    store.loadSentinel(SENTINEL_SCENARIOS[0]);
    store.setSpeed(5);
    store.startSentinel(true);
  };
  const inc = sim.state.incidents[0];
  const r = lab.result;

  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <Logo size={24} />
          <span className="font-display text-[13px] font-semibold tracking-[0.16em]">BLOODWING AI · PITCH</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="mono text-[12px] text-dim">
            {i + 1} / {N} · ← → keys
          </span>
          <a className="btn btn-sm btn-ghost" href={href('home')} aria-label="Exit pitch mode">
            <X size={14} />
          </a>
        </div>
      </div>

      <div key={i} className="rise mx-auto flex w-full max-w-[1500px] flex-1 flex-col justify-center px-6 pb-16 md:px-12">
        {i === 0 && (
          <div>
            <div className="eyebrow mb-4">01 · The problem</div>
            <h1 className="font-display text-[clamp(44px,7vw,108px)] font-bold leading-[0.95] tracking-[-0.03em]">
              Blood may be available.
              <br />
              <span className="text-[#ff9aa2]">Time may not be.</span>
            </h1>
            <p className="mt-8 max-w-3xl text-[clamp(16px,1.5vw,22px)] leading-relaxed text-mist">
              Emergency demand is uncertain. Inventory is perishable and spread across facilities. Recurring transfusions and routine replenishment compete for the same stock and the same vehicles. The question isn't only <i>whether</i> blood
              exists — it's whether the right, released, transportable product reaches the right hospital in time.
            </p>
          </div>
        )}
        {i === 1 && (
          <div>
            <div className="eyebrow mb-4">02 · The solution</div>
            <h1 className="font-display text-[clamp(38px,5.4vw,84px)] font-bold leading-[1] tracking-[-0.02em]">
              BLOODWING AI connects blood inventory, intelligent dispatch, and <span className="text-signal">aerial logistics.</span>
            </h1>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {[
                ['SENTINEL', 'responds to urgent needs', '#ff9aa2'],
                ['PULSE', 'prepares for predictable needs', '#93c5fd'],
                ['ORBIT', 'optimises the network', '#5eead4'],
              ].map(([a, b, c]) => (
                <div key={a} className="panel p-6">
                  <div className="font-display text-3xl font-bold tracking-[0.12em]" style={{ color: c }}>
                    {a}
                  </div>
                  <div className="mt-2 text-[18px] text-soft">{b}</div>
                </div>
              ))}
            </div>
            <p className="mt-6 text-[16px] text-mist">One shared digital twin: one inventory, one fleet, one clock.</p>
          </div>
        )}
        {i === 2 && (
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <div className="eyebrow mb-4">03 · The intelligence</div>
              <h1 className="font-display text-[clamp(36px,4.6vw,72px)] font-bold leading-[1.02]">
                It chooses the <span className="text-signal">right action</span> — not automatically a drone.
              </h1>
              <p className="mt-6 text-[18px] leading-relaxed text-mist">Every option is checked against hard constraints first, then scored. Every recommendation is traceable to inventory, transport and operating constraints.</p>
            </div>
            <div className="space-y-3">
              {[
                ['Predict', 'Poisson regression forecasts hospital demand; evaluated on held-out synthetic data.'],
                ['Constrain', 'Compatibility · shelf life · reserves · payload · battery reserve · weather · airspace · vehicle availability · commitments.'],
                ['Optimise', 'Urgency-weighted objective over delay, lateness, cost, inventory and fleet risk. Milk runs via CVRPTW heuristic.'],
                ['Explain', 'Why this source, why this mode, what was rejected and why — generated from the numbers, no LLM.'],
                ['Authorise', 'A human approves every emergency dispatch.'],
              ].map(([a, b], k) => (
                <div key={a} className="panel flex gap-4 p-4">
                  <span className="font-display text-2xl font-semibold text-signal/70">{String(k + 1).padStart(2, '0')}</span>
                  <div>
                    <div className="font-display text-[18px] font-semibold">{a}</div>
                    <div className="text-[14px] text-mist">{b}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {i === 3 && (
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="eyebrow mb-2">04 · The live demonstration</div>
                <h1 className="font-display text-[clamp(30px,3.6vw,56px)] font-bold">The race against time.</h1>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-danger !px-5 !py-3" onClick={launch}>
                  <Siren size={17} /> Trigger emergency
                </button>
                <a className="btn !px-5 !py-3" href={href('demo')}>
                  Full 120-s demo →
                </a>
              </div>
            </div>
            {inc ? (
              <div className="grid gap-3 xl:grid-cols-[1.1fr_1fr]">
                <Race incident={inc} big />
                <MapView height={420} compact />
              </div>
            ) : (
              <p className="text-[18px] text-mist">Press “Trigger emergency”: a simulated collision, EMS assessment, engine recommendation (auto-authorised for the pitch), then ambulance and blood race to the hospital at 5× speed.</p>
            )}
          </div>
        )}
        {i === 4 && (
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
            <div>
              <div className="eyebrow mb-4">05 · Impact & vision</div>
              <h1 className="font-display text-[clamp(34px,4.4vw,68px)] font-bold leading-[1.02]">Measured in simulation. Ready to be tested for real.</h1>
              <p className="mt-6 text-[17px] leading-relaxed text-mist">
                On identical seeded demand, the AI multimodal policy is compared with ground-only and drone-first baselines, with 95% confidence intervals. Next: calibrate with real aggregate data, partner with a blood bank, and
                evaluate in a shadow-mode pilot — with EMS integration, clinical oversight, validated cold chain and aviation authorisation.
              </p>
              <div className="mt-10">
                <div className="font-display text-[clamp(40px,5vw,80px)] font-bold leading-none">
                  BLOODWING<span className="text-signal"> AI</span>
                </div>
                <div className="mt-3 font-display text-[clamp(18px,2vw,28px)] text-mist">Every Second Circulates.</div>
              </div>
            </div>
            <div className="panel p-5">
              <div className="eyebrow mb-2">Simulated results — synthetic Boston network</div>
              {r ? (
                <>
                  <div className="text-[13px] text-mist">Mean delivery time (min), 95% CI</div>
                  <MetricBars r={r} metric="avgMin" height={240} />
                  <div className="mt-3 text-[13px] text-mist">Deadline fulfilment (%)</div>
                  <MetricBars r={r} metric="onTimeRate" pct height={200} />
                </>
              ) : (
                <p className="text-mist">Running experiment…</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-5 left-0 right-0 flex items-center justify-center gap-3">
        <button className="btn btn-sm" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="Previous slide">
          <ArrowLeft size={14} />
        </button>
        {Array.from({ length: N }, (_, k) => (
          <button key={k} onClick={() => setI(k)} className={`h-1.5 rounded-full transition-all ${k === i ? 'w-8 bg-signal' : 'w-3 bg-white/20'}`} aria-label={`Slide ${k + 1}`} />
        ))}
        <button className="btn btn-sm" disabled={i === N - 1} onClick={() => setI(i + 1)} aria-label="Next slide">
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
