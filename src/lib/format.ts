import { clockLabel } from '../engine/network';

export const fmtMin = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${x.toFixed(d)}`);
export const fmtPct = (x: number | null | undefined, d = 0) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);
export const fmtUsd = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`;
export const clock = clockLabel;
export function tPlus(t: number): string {
  const m = Math.floor(t);
  const s = Math.floor((t - m) * 60);
  return `T+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
