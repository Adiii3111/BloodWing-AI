import { ExternalLink } from 'lucide-react';
import { Panel, Section } from '../components/ui';

const MAP = [
  ['Demand variability', 'SENTINEL emergency events'],
  ['Replenishment planning', 'PULSE scheduled demand'],
  ['Delivery frequency', 'ORBIT milk-run routing'],
  ['Transportation lead times', 'Drone and ground dispatch'],
  ['Inventory uncertainty', 'Shared digital twin'],
  ['Cross-hospital transfers', 'Network reallocation (above local floors)'],
  ['Discrete-event simulation', 'Scenario experimentation (Lab)'],
  ['Supply chain performance', 'Simulated operational analytics (Impact)'],
];

function Architecture() {
  const tiers = [
    { y: 60, label: 'Blood Supply Centers', sub: 'regional supplier (upper echelon)', color: '#e63946' },
    { y: 190, label: 'Regional Inventory Hubs', sub: 'fictional depots Alpha · Bravo · Charlie', color: '#22d3ee' },
    { y: 320, label: 'Hospitals', sub: 'six illustrative Boston nodes', color: '#3b82f6' },
  ];
  const layer = ['Demand forecasting', 'Dispatch optimisation', 'Drone / ground transport', 'Delivery monitoring', 'Feedback'];
  return (
    <svg viewBox="0 0 1000 420" className="h-auto w-full" role="img" aria-label="System architecture: supply centers to hubs to hospitals, with the BLOODWING decision layer">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10z" fill="#94a3b8" />
        </marker>
        <linearGradient id="lay" x1="0" x2="1">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0.16" />
          <stop offset="1" stopColor="#3b82f6" stopOpacity="0.08" />
        </linearGradient>
      </defs>
      {/* physical network */}
      {tiers.map((t, i) => (
        <g key={t.label}>
          <rect x="40" y={t.y - 34} width="360" height="68" rx="12" fill="#0b1626" stroke={t.color} strokeOpacity="0.7" />
          <text x="62" y={t.y - 4} fill="#f8fafc" fontFamily="Space Grotesk" fontSize="20" fontWeight="600">
            {t.label}
          </text>
          <text x="62" y={t.y + 18} fill="#94a3b8" fontFamily="Inter" fontSize="13">
            {t.sub}
          </text>
          {i < 2 && <line x1="220" y1={t.y + 36} x2="220" y2={t.y + 94} stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#arr)" />}
        </g>
      ))}
      <path d="M400 320 C 450 320, 450 300, 400 290" stroke="#3b82f6" strokeOpacity="0.5" fill="none" strokeDasharray="4 5" markerEnd="url(#arr)" />
      <text x="430" y="344" fill="#64748b" fontSize="12" fontFamily="Inter">
        cross-hospital transfers
      </text>
      {/* decision layer */}
      <rect x="520" y="24" width="440" height="372" rx="16" fill="url(#lay)" stroke="#22d3ee" strokeOpacity="0.35" />
      <text x="544" y="56" fill="#22d3ee" fontFamily="JetBrains Mono" fontSize="12" letterSpacing="2">
        BLOODWING DECISION LAYER (NEW)
      </text>
      {layer.map((l, i) => (
        <g key={l}>
          <rect x="560" y={78 + i * 62} width="360" height="44" rx="10" fill="#07111f" stroke="#22d3ee" strokeOpacity={0.25 + i * 0.1} />
          <text x="580" y={106 + i * 62} fill="#f8fafc" fontFamily="Space Grotesk" fontSize="16">
            {String(i + 1).padStart(2, '0')} · {l}
          </text>
          {i < layer.length - 1 && <line x1="740" y1={122 + i * 62} x2="740" y2={140 + i * 62} stroke="#22d3ee" strokeOpacity="0.6" markerEnd="url(#arr)" />}
        </g>
      ))}
      <path d="M920 344 C 990 300, 990 120, 920 100" stroke="#22d3ee" strokeOpacity="0.4" fill="none" strokeDasharray="4 5" markerEnd="url(#arr)" />
      <line x1="520" y1="200" x2="404" y2="200" stroke="#22d3ee" strokeOpacity="0.5" strokeDasharray="3 5" markerEnd="url(#arr)" />
      <text x="420" y="188" fill="#22d3ee" fillOpacity="0.8" fontSize="12" fontFamily="Inter">
        decisions
      </text>
    </svg>
  );
}

export default function Research() {
  return (
    <div>
      <Section
        num="09"
        eyebrow="Research foundation"
        title={<>From understanding a network to <span className="text-signal">deciding inside it.</span></>}
        lede="The underlying research explores how blood supply networks respond to uncertainty in demand, supply, transportation, and inventory. BLOODWING AI introduces a new experimental layer: AI-assisted dispatch decisions and simulated autonomous aerial transportation."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="panel p-6">
            <div className="eyebrow mb-2">Existing research</div>
            <div className="font-display text-2xl font-semibold">Understanding and simulating blood supply chain performance.</div>
            <p className="mt-3 text-[14px] leading-relaxed text-mist">
              Discrete-event simulation of a multi-echelon blood supply chain — regional blood centers and hospitals; red blood cells, platelets and plasma; demand and supply variability; inventory levels; replenishment and delivery
              frequency; transportation lead times; cross-hospital transfers; shortages, expiry and wastage.
            </p>
            <p className="mt-3 text-[13px] text-dim">
              Co-authored by Krithik Reddy Chilkuri and Aditya Kadlabal Sripad under the guidance of Professor Tugce Martagan (Northeastern University). Accepted to the Winter Simulation Conference 2026.
            </p>
          </div>
          <div className="panel panel-signal p-6">
            <div className="eyebrow mb-2 !text-signal">BLOODWING AI (this prototype)</div>
            <div className="font-display text-2xl font-semibold">Experimenting with intelligent decisions about when, where, and how blood products should move.</div>
            <p className="mt-3 text-[14px] leading-relaxed text-mist">
              An independent hackathon prototype inspired by those research questions. It is not a published result, nor an officially validated extension of the paper, and it reports none of the paper's findings.
            </p>
          </div>
        </div>

        <Panel title="System architecture" className="mt-3">
          <Architecture />
        </Panel>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.2fr]">
          <Panel title="Research concept → BLOODWING application">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Research concept</th>
                  <th>BLOODWING application</th>
                </tr>
              </thead>
              <tbody>
                {MAP.map(([a, b]) => (
                  <tr key={a}>
                    <td>{a}</td>
                    <td className="text-signal">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="How it builds on discrete-event simulation">
            <p className="text-[13.5px] leading-relaxed text-mist">
              The live engine is itself a time-stepped discrete-event model: requests arrive, decisions are evaluated, missions move through preparation, transit, handoff and return; lots expire; depots are resupplied. BLOODWING adds a
              decision policy at the moment each event happens — and the Lab compares policies on identical seeded event streams, the way simulation studies compare operating conditions. Operations research supplies the constraints
              and objectives, simulation supplies the uncertainty, and machine learning supplies demand expectations.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="eyebrow mb-1.5">Central question</div>
                <p className="text-[13px] text-soft">Can an AI-assisted system coordinate blood inventory and multimodal transport to reduce emergency delivery delays, avoid shortages and improve resilience?</p>
              </div>
              <div>
                <div className="eyebrow mb-1.5">Hypotheses (tested only in simulation)</div>
                <ul className="list-disc space-y-1 pl-4 text-[13px] text-mist">
                  <li>H1: Network-wide visibility + multimodal choice lowers mean and P90 delivery time versus nearest-depot ground dispatch.</li>
                  <li>H2: Consolidated milk runs cut routine transport distance without breaking delivery windows.</li>
                  <li>H3: Planning confirmed scheduled orders ahead avoids emergency-style rush shipments for them.</li>
                </ul>
              </div>
            </div>
          </Panel>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <Panel title="Limitations">
            <ul className="list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed text-mist">
              <li>All demand, inventory, specifications, costs and routes are synthetic. Hospitals are illustrative nodes only.</li>
              <li>Compatibility rules are simplified and scoped; antigen matching, crossmatching and local transfusion policy are not modelled.</li>
              <li>Road travel uses a circuity factor, not a road network. Drone paths are straight-line illustrations, not authorised flight paths; airspace is a simplified no-fly circle.</li>
              <li>The forecaster is trained on synthetic data; its accuracy says nothing about real hospitals.</li>
              <li>ORBIT uses a heuristic with no optimality certificate.</li>
            </ul>
          </Panel>
          <Panel title="Next steps">
            <ul className="list-disc space-y-1 pl-4 text-[12.5px] leading-relaxed text-mist">
              <li>Calibrate against published, de-identified aggregate data under appropriate agreements.</li>
              <li>Replace the heuristic with an exact CVRPTW model (e.g. OR-Tools) and report optimality gaps.</li>
              <li>Real road-network travel times and stochastic lead times.</li>
              <li>Joint inventory–transport optimisation across a planning horizon.</li>
              <li>Real deployment would require EMS integration, hospital and blood-bank partnerships, clinical ordering and product release, validated cold chain, aviation authorisation, security, privacy, consent and clinical validation.</li>
            </ul>
          </Panel>
          <Panel title="Research & evidence">
            <p className="text-[12.5px] leading-relaxed text-mist">
              Nisingizwe MP, et al. (2022). Effect of unmanned aerial vehicle (drone) delivery on blood product delivery time and wastage in Rwanda: a retrospective, cross-sectional study and time series analysis.{' '}
              <i>The Lancet Global Health</i>.
            </p>
            <a className="mt-1 inline-flex items-center gap-1 text-[12.5px] text-signal hover:underline" href="https://doi.org/10.1016/S2214-109X(22)00048-1" target="_blank" rel="noreferrer">
              doi.org/10.1016/S2214-109X(22)00048-1 <ExternalLink size={12} />
            </a>
            <p className="mt-3 text-[12.5px] leading-relaxed text-mist">
              <b className="text-soft">Published finding:</b> across 12,733 blood product deliveries, the study reported a mean drone delivery time of 49.6 minutes, faster than the estimated road-based comparison.
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-warn/90">
              Distinct from BLOODWING results: Rwanda's geography, distances and operating model differ greatly from Boston. Those figures are cited as evidence that drone blood delivery has been studied at scale — never as Boston expectations or as BLOODWING outputs.
            </p>
          </Panel>
        </div>
      </Section>
    </div>
  );
}
