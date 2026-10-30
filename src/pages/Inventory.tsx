import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Panel, Section, SimLabel } from '../components/ui';
import { COMPONENT_LABEL, HOSPITAL_FLOOR, MIN_REMAINING_MIN, PACKAGING, SHELF_LIFE_DAYS } from '../engine/assumptions';
import { ALL_GROUPS, groupLabel } from '../engine/compatibility';
import { poissonTail } from '../engine/dispatch';
import { eligibleComponentUnits, isDispatchable } from '../engine/inventory';
import { DEPOTS, HOSPITALS, siteById } from '../engine/network';
import type { Component } from '../engine/types';
import { clock } from '../lib/format';
import { useSim } from '../lib/store';

const COMPONENTS: Component[] = ['RBC', 'PLT', 'PLASMA'];
const CCOL: Record<Component, string> = { RBC: '#e63946', PLT: '#c47a32', PLASMA: '#8f6ee8' };

export default function Inventory() {
  const sim = useSim();
  const s = sim.state;
  const [siteId, setSite] = useState('DA');
  const site = siteById(s.sites, siteId);
  const lots = s.lots.filter((l) => l.siteId === siteId && l.units > 0 && l.status !== 'expired');

  const grid = COMPONENTS.map((c) => ({
    c,
    cells: ALL_GROUPS.map((g) => {
      const ls = lots.filter((l) => l.component === c && l.group === g);
      return { g, ok: ls.filter((l) => isDispatchable(l, s.t)).reduce((a, l) => a + l.units, 0), held: ls.filter((l) => l.status === 'reserved' || l.status === 'quarantine').reduce((a, l) => a + l.units, 0) };
    }),
  }));

  const expiry = useMemo(() => {
    const buckets = ['<1 d', '1–2 d', '2–3 d', '3–7 d', '7–14 d', '14–28 d', '>28 d'];
    const edges = [1, 2, 3, 7, 14, 28, Infinity];
    const rows = buckets.map((b) => ({ bucket: b, RBC: 0, PLT: 0, PLASMA: 0 }));
    for (const l of lots) {
      if (l.status === 'quarantine') continue;
      const d = (l.expiresAt - s.t) / 1440;
      const i = edges.findIndex((e) => d < e);
      rows[i][l.component] += l.units;
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, sim.getVersion()]);

  // Network-wide alerts and ML risk
  const alerts: { tone: 'crit' | 'warn'; text: string }[] = [];
  for (const h of HOSPITALS) {
    for (const c of COMPONENTS) {
      const n = eligibleComponentUnits(s.lots, h.id, c, s.t);
      if (n < HOSPITAL_FLOOR[c]) alerts.push({ tone: 'crit', text: `${h.short}: ${n} eligible ${c} — below the ${HOSPITAL_FLOOR[c]}-unit floor` });
      else if (n < HOSPITAL_FLOOR[c] * 1.5) alerts.push({ tone: 'warn', text: `${h.short}: ${n} eligible ${c} — approaching floor` });
    }
  }
  const risk = HOSPITALS.map((h) => {
    const exp = sim.forecast?.[h.id]?.units ?? null;
    const stock = eligibleComponentUnits(s.lots, h.id, 'RBC', s.t);
    const slack = stock - HOSPITAL_FLOOR.RBC;
    const p = exp == null ? null : poissonTail(exp, Math.max(0, slack));
    const bestDepot = DEPOTS.map((d) => ({ d, n: eligibleComponentUnits(s.lots, d.id, 'RBC', s.t) })).sort((a, b) => b.n - a.n)[0];
    return { h, exp, stock, p, bestDepot };
  });

  return (
    <Section
      num="06"
      eyebrow="Blood inventory digital twin"
      title={<>Every unit, every lot, <span className="text-signal">every expiry.</span></>}
      lede="Synthetic lot-level inventory shared by SENTINEL, PULSE and ORBIT. Dispatch removes units; milk runs add them; reservations hold them; expiry retires them. Stock can never go negative and held or expired units are never dispatched."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SimLabel>Research simulation using synthetic data. Not for clinical decision-making.</SimLabel>
        <span className="mono text-[11px] text-dim">sim clock {clock(s.t)}</span>
      </div>
      <div className="scroll-thin mb-3 flex gap-1.5 overflow-x-auto pb-1">
        {s.sites.map((x) => (
          <button key={x.id} className={`chip !py-1 ${x.id === siteId ? 'border-signal/60 text-signal' : ''}`} onClick={() => setSite(x.id)}>
            {x.kind === 'depot' ? '◆' : 'H'} {x.short}
          </button>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
        <Panel title={`${site.name} · eligible units by component × group`} right={<Badge>{site.kind === 'depot' ? 'fictional depot' : 'illustrative hospital node'}</Badge>}>
          <div className="scroll-thin overflow-x-auto">
            <table className="tbl min-w-[640px]">
              <thead>
                <tr>
                  <th>Component</th>
                  {ALL_GROUPS.map((g) => (
                    <th key={g}>{groupLabel(g)}</th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {grid.map((row) => (
                  <tr key={row.c}>
                    <td>
                      <span className="inline-block h-2 w-2 rounded-sm" style={{ background: CCOL[row.c] }} /> {COMPONENT_LABEL[row.c]}
                    </td>
                    {row.cells.map((c) => (
                      <td key={c.g} className="mono">
                        <span className={c.ok === 0 ? 'text-dim' : 'text-soft'}>{c.ok}</span>
                        {c.held > 0 && <span className="text-warn"> +{c.held}h</span>}
                      </td>
                    ))}
                    <td className="mono text-signal">{row.cells.reduce((a, c) => a + c.ok, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-dim">"+Nh" = units held (reserved for a patient/appointment or quarantined) — visible but not dispatchable.</p>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {COMPONENTS.map((c) => (
              <div key={c} className="rounded-lg border border-line bg-space/50 p-3 text-[11.5px] leading-relaxed text-mist">
                <div className="font-semibold text-soft">{COMPONENT_LABEL[c]}</div>
                <div>Shelf life ≈ {SHELF_LIFE_DAYS[c]} d (simplified)</div>
                <div>Transport: {PACKAGING[c].container}</div>
                <div>Min. remaining life to dispatch: {MIN_REMAINING_MIN[c] / 60} h</div>
                <div>
                  Rule: {c === 'RBC' ? 'ABO/RhD compatible; unknown → O− only' : c === 'PLASMA' ? 'reverse ABO; unknown → AB only' : 'any ABO; RhD− recipients → RhD− units'}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Expiration timeline (units by days remaining)">
          <div className="h-[250px]">
            <ResponsiveContainer>
              <BarChart data={expiry} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="rgba(148,163,184,.08)" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'rgba(148,163,184,.06)' }} contentStyle={{ background: '#07111f', border: '1px solid rgba(148,163,184,.2)', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {COMPONENTS.map((c) => (
                  <Bar key={c} dataKey={c} name={COMPONENT_LABEL[c]} stackId="x" fill={CCOL[c]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-dim">Units within the minimum remaining-life window cannot be dispatched (first-expiring-first-out is used for everything else). Expired: {s.expiredUnits.RBC + s.expiredUnits.PLT + s.expiredUnits.PLASMA} units this run.</p>
          <div className="mt-3">
            <div className="eyebrow mb-1.5">Held lots</div>
            <div className="scroll-thin max-h-[120px] space-y-0.5 overflow-auto text-[12px] text-mist">
              {lots.filter((l) => l.status === 'reserved' || l.status === 'quarantine').map((l) => (
                <div key={l.id}>
                  <span className="mono text-dim">{l.id}</span> {l.units} {l.component} {groupLabel(l.group)} · {l.status}
                  {l.reservedFor && <span className="text-[#93c5fd]"> for {l.reservedFor}</span>}
                </div>
              ))}
              {!lots.some((l) => l.status === 'reserved' || l.status === 'quarantine') && <div className="text-dim">None.</div>}
            </div>
          </div>
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="ML shortage risk — next 6 hours (red cells)" right={<Badge tone="blue">prediction</Badge>}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Hospital</th>
                <th>Eligible RBC</th>
                <th>Forecast demand (6 h)</th>
                <th>P(demand &gt; stock above floor)</th>
                <th>Transfer recommendation</th>
              </tr>
            </thead>
            <tbody>
              {risk.map((r) => (
                <tr key={r.h.id}>
                  <td>{r.h.short}</td>
                  <td className="mono">{r.stock}</td>
                  <td className="mono">{r.exp == null ? '…' : r.exp.toFixed(1)}</td>
                  <td className={`mono ${r.p != null && r.p > 0.2 ? 'text-warn' : ''}`}>{r.p == null ? '…' : `${(r.p * 100).toFixed(1)}%`}</td>
                  <td className="text-[12px] text-mist">{r.p != null && r.p > 0.2 ? `Top up from ${r.bestDepot.d.short} (${r.bestDepot.n} eligible) via ORBIT` : 'No action'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-dim">Forecast = Poisson regression expected requests × {`2.6`} units/request (synthetic). Risk = P(Poisson(forecast) &gt; eligible − floor). A prediction to support positioning, not an order.</p>
        </Panel>
        <Panel title="Low-stock alerts (network)">
          <div className="space-y-1">
            {alerts.length ? (
              alerts.map((a, i) => (
                <div key={i} className={`text-[12.5px] ${a.tone === 'crit' ? 'text-[#ff9aa2]' : 'text-warn'}`}>
                  {a.text}
                </div>
              ))
            ) : (
              <div className="text-[12.5px] text-mist">All hospitals above their floors.</div>
            )}
          </div>
          {s.decisions.length > 0 && (
            <div className="mt-4">
              <div className="eyebrow mb-1.5">Projected inventory after dispatch (latest decisions)</div>
              {s.decisions
                .filter((d) => d.chosen)
                .slice(-5)
                .reverse()
                .map((d) => (
                  <div key={d.id} className="text-[12px] text-mist">
                    <span className="mono text-dim">{d.id}</span> {siteById(s.sites, d.chosen!.sourceId).short}: {d.sourceBefore} → <span className="text-soft">{d.sourceAfter}</span> eligible
                  </div>
                ))}
            </div>
          )}
        </Panel>
      </div>
    </Section>
  );
}
