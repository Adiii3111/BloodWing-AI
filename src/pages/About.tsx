import { ExternalLink } from 'lucide-react';
import { Panel, Section } from '../components/ui';

export default function About() {
  return (
    <Section num="11" eyebrow="About the creator" title="Aditya Kadlabal Sripad" lede="M.S. Engineering Management · Northeastern University, Boston">
      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        <Panel title="Focus">
          <ul className="space-y-2.5 text-[14px] leading-relaxed text-mist">
            <li>
              <b className="text-soft">Blood supply chain research</b> — co-author of a discrete-event simulation study of a multi-echelon blood supply chain, accepted to the Winter Simulation Conference 2026.
            </li>
            <li>
              <b className="text-soft">Healthcare systems modelling</b> and <b className="text-soft">operations research</b> — simulation, optimisation and decision-assist analytics.
            </li>
            <li>
              <b className="text-soft">Supply chain analytics</b> — Data Analyst Co-op at Vaxxinova US, working on Project MERCURY, a decision-assist analytics initiative. (Described at a high level only; no MERCURY code, data or business logic is used here.)
            </li>
            <li>
              <b className="text-soft">Practical healthcare innovation</b> — building tools that make operational decisions in healthcare more transparent and timely.
            </li>
          </ul>
          <a className="btn btn-primary mt-5" href="https://adiii3111.github.io/Portfolio/" target="_blank" rel="noreferrer">
            Portfolio <ExternalLink size={14} />
          </a>
        </Panel>
        <Panel title="Attribution">
          <p className="text-[13.5px] leading-relaxed text-mist">
            The Winter Simulation Conference 2026 research was carried out with <b className="text-soft">Krithik Reddy Chilkuri</b> under the guidance of <b className="text-soft">Professor Tugce Martagan</b>, Northeastern University.
          </p>
          <p className="mt-3 text-[13.5px] leading-relaxed text-mist">
            BLOODWING AI is an independent hackathon prototype built for Northeastern University's AI in Healthcare Builder Blitz (October 30, 2026). It is inspired by the research questions but is not part of, endorsed by, or a
            validated extension of that work.
          </p>
          <p className="mt-3 text-[12px] text-dim">No hospital, EMS agency, blood supplier or aviation authority is affiliated with this prototype.</p>
        </Panel>
      </div>
    </Section>
  );
}
