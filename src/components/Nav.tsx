import { Menu, Play, Presentation, X } from 'lucide-react';
import { useState } from 'react';
import { href, type Route } from '../lib/router';
import { useSim } from '../lib/store';
import { clock } from '../lib/format';
import { Logo } from './Logo';

const LINKS: { r: Route; n: string; label: string; tone?: string }[] = [
  { r: 'mission', n: '01', label: 'Command' },
  { r: 'sentinel', n: '02', label: 'SENTINEL', tone: 'text-[#ff9aa2]' },
  { r: 'pulse', n: '03', label: 'PULSE', tone: 'text-[#93c5fd]' },
  { r: 'orbit', n: '04', label: 'ORBIT', tone: 'text-[#5eead4]' },
  { r: 'dispatch', n: '05', label: 'Engine' },
  { r: 'inventory', n: '06', label: 'Twin' },
  { r: 'fleet', n: '07', label: 'Fleet' },
  { r: 'lab', n: '08', label: 'Lab' },
  { r: 'research', n: '09', label: 'Research' },
  { r: 'impact', n: '10', label: 'Impact' },
  { r: 'about', n: '11', label: 'About' },
];

export function Nav({ route }: { route: Route }) {
  const sim = useSim();
  const [open, setOpen] = useState(false);
  const active = sim.state.requests.some((r) => r.status === 'queued' || r.status === 'dispatched');
  return (
    <header className="sticky top-0 z-[1000] border-b border-line bg-space/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1700px] items-center gap-4 px-4 sm:px-6">
        <a href={href('home')} className="flex shrink-0 items-center gap-2.5 whitespace-nowrap" aria-label="BLOODWING AI home">
          <Logo size={26} />
          <span className="font-display text-[14px] font-semibold tracking-[0.12em] sm:text-[15px] sm:tracking-[0.14em]">
            BLOODWING<span className="text-signal"> AI</span>
          </span>
        </a>
        <nav className="ml-2 hidden items-center gap-0 2xl:flex" aria-label="Sections">
          {LINKS.map((l) => (
            <a
              key={l.r}
              href={href(l.r)}
              className={`rounded-md px-2 py-1.5 text-[12.5px] transition-colors ${route === l.r ? 'bg-signal/10 text-signal' : `${l.tone ?? 'text-mist'} hover:text-soft`} ${l.tone ? 'font-display font-semibold tracking-[0.08em]' : ''}`}
            >
              <span className="mono mr-1 text-[9.5px] text-dim">{l.n}</span>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-2 md:flex">
            <span className={`live-dot ${active ? 'crit' : sim.running ? '' : 'idle'}`} />
            <span className="mono text-[11px] text-mist">SIM {clock(sim.state.t)}</span>
          </div>
          <a href={href('pitch')} className="btn btn-sm btn-ghost hidden sm:inline-flex">
            <Presentation size={14} /> Pitch
          </a>
          <a href={href('demo')} className="btn btn-sm btn-primary">
            <Play size={14} /> <span className="hidden sm:inline">Start live demo</span>
            <span className="sm:hidden">Demo</span>
          </a>
          <button className="btn btn-sm 2xl:hidden" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="grid grid-cols-2 gap-1 border-t border-line px-4 py-3 sm:grid-cols-4 2xl:hidden" aria-label="Sections">
          {[...LINKS, { r: 'pitch' as Route, n: '—', label: 'Pitch mode' }].map((l) => (
            <a key={l.r} href={href(l.r)} onClick={() => setOpen(false)} className={`rounded-md px-3 py-2 text-sm ${route === l.r ? 'bg-signal/10 text-signal' : 'text-mist'}`}>
              <span className="mono mr-1.5 text-[10px] text-dim">{l.n}</span>
              {l.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
