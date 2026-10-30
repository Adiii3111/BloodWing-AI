import { Bar, BarChart, CartesianGrid, Cell as CellFill, ErrorBar, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { METRICS, POLICIES, type LabResult, type MetricKey } from '../engine/experiment';

export const POLICY_COLOR: Record<string, string> = { 'ground-only': '#c47a32', 'drone-first': '#8f6ee8', ai: '#0ea5bf' };

const tip = { background: '#07111f', border: '1px solid rgba(148,163,184,.2)', borderRadius: 8, fontSize: 12 };

export function MetricBars({ r, metric, height = 220, pct }: { r: LabResult; metric: MetricKey; height?: number; pct?: boolean }) {
  const f = pct ? 100 : 1;
  const data = POLICIES.map((p) => {
    const s = r.summary[p.id][metric];
    return { name: p.short, id: p.id, mean: +(s.mean * f).toFixed(2), err: [+((s.mean - s.lo) * f).toFixed(2), +((s.hi - s.mean) * f).toFixed(2)] };
  });
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 18, right: 8, left: -14, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: 'rgba(148,163,184,.06)' }} contentStyle={tip} formatter={(v: number) => [v, METRICS.find((m) => m.key === metric)!.label]} />
          <Bar dataKey="mean" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <CellFill key={d.id} fill={POLICY_COLOR[d.id]} />
            ))}
            <ErrorBar dataKey="err" width={6} stroke="#cbd5e1" strokeWidth={1.2} />
            <LabelList dataKey="mean" position="top" fill="#cbd5e1" fontSize={11} offset={10} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Distribution({ r, height = 240 }: { r: LabResult; height?: number }) {
  const edges = [0, 10, 15, 20, 25, 30, 40, 60, 90, 120, Infinity];
  const labels = ['<10', '10–15', '15–20', '20–25', '25–30', '30–40', '40–60', '60–90', '90–120', '120+'];
  const rows = labels.map((l) => ({ bin: l, 'ground-only': 0, 'drone-first': 0, ai: 0 }) as Record<string, number | string>);
  for (const p of POLICIES) {
    const times = r.runs.filter((x) => x.policy === p.id).flatMap((x) => x.responseTimes);
    for (const t of times) {
      const i = edges.findIndex((e, k) => t >= e && t < edges[k + 1]);
      (rows[i][p.id] as number)++;
    }
    for (const row of rows) row[p.id] = +(((row[p.id] as number) / Math.max(1, times.length)) * 100).toFixed(1);
  }
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 6, right: 8, left: -14, bottom: 0 }} barGap={2} barCategoryGap="18%">
          <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
          <XAxis dataKey="bin" tick={{ fill: '#94a3b8', fontSize: 10.5 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
          <Tooltip cursor={{ fill: 'rgba(148,163,184,.06)' }} contentStyle={tip} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {POLICIES.map((p) => (
            <Bar key={p.id} dataKey={p.id} name={p.short} fill={POLICY_COLOR[p.id]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
