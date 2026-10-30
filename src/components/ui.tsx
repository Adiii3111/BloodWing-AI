import type { ReactNode } from 'react';

export function Section({ num, eyebrow, title, lede, children, id }: { num: string; eyebrow: string; title: ReactNode; lede?: ReactNode; children?: ReactNode; id?: string }) {
  return (
    <section id={id} className="mx-auto w-full max-w-[1500px] px-4 py-10 sm:px-8 md:py-14">
      <header className="mb-8 grid gap-4 md:grid-cols-[120px_1fr]">
        <div className="font-display text-5xl font-semibold leading-none text-signal/80 md:text-6xl">{num}</div>
        <div>
          <div className="eyebrow mb-2">{eyebrow}</div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-soft md:text-[44px] md:leading-[1.05]">{title}</h1>
          {lede && <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-mist">{lede}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

export function Panel({ title, right, children, className = '', tone }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; tone?: 'hot' | 'signal' }) {
  return (
    <div className={`panel ${tone === 'hot' ? 'panel-hot' : tone === 'signal' ? 'panel-signal' : ''} ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="eyebrow !text-[10.5px]">{title}</div>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function Stat({ label, value, unit, sub, tone }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; tone?: 'crit' | 'ok' | 'signal' | 'warn' }) {
  const color = tone === 'crit' ? 'text-crimson' : tone === 'ok' ? 'text-ok' : tone === 'signal' ? 'text-signal' : tone === 'warn' ? 'text-warn' : 'text-soft';
  return (
    <div className="panel px-4 py-3">
      <div className="eyebrow !text-[10px] !tracking-[0.14em]">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`font-display text-2xl font-semibold tabular ${color}`}>{value}</span>
        {unit && <span className="mono text-xs text-mist">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-dim">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'crit' | 'ok' | 'warn' | 'signal' | 'blue' }) {
  const map = {
    default: 'border-line text-mist',
    crit: 'border-crimson/50 text-[#ff9aa2] bg-crimson/10',
    ok: 'border-ok/40 text-ok bg-ok/10',
    warn: 'border-warn/40 text-warn bg-warn/10',
    signal: 'border-signal/40 text-signal bg-signal/10',
    blue: 'border-med/40 text-[#93c5fd] bg-med/10',
  } as const;
  return <span className={`chip ${map[tone]}`}>{children}</span>;
}

export function SimLabel({ children = 'Simulated · synthetic data' }: { children?: ReactNode }) {
  return (
    <span className="chip border-warn/30 text-warn/90">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-warn" />
      {children}
    </span>
  );
}

export function Bar({ value, max, color = '#22d3ee', h = 6 }: { value: number; max: number; color?: string; h?: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="w-full overflow-hidden rounded-full bg-white/5" style={{ height: h }}>
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
