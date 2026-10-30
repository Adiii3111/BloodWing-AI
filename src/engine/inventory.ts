import { GROUP_FREQ, MIN_REMAINING_MIN, SHELF_LIFE_DAYS } from './assumptions';
import { isCompatible, preferenceRank } from './compatibility';
import { Rng } from './rng';
import type { Allocation, BloodGroup, Component, Lot, RecipientGroup, Site } from './types';

const COMPONENTS: Component[] = ['RBC', 'PLT', 'PLASMA'];

/** A unit can leave a site only if it is released, unexpired and has enough shelf life left. */
export function isDispatchable(lot: Lot, t: number): boolean {
  return lot.status === 'released' && lot.units > 0 && lot.expiresAt - t >= MIN_REMAINING_MIN[lot.component];
}

/** Eligible lots for a request at a site, ordered by group preference then first-expiring-first-out. */
export function eligibleLots(lots: Lot[], siteId: string, component: Component, recipient: RecipientGroup, t: number): Lot[] {
  return lots
    .filter((l) => l.siteId === siteId && l.component === component && isDispatchable(l, t) && isCompatible(component, recipient, l.group))
    .sort(
      (a, b) =>
        preferenceRank(component, recipient, a.group) - preferenceRank(component, recipient, b.group) || a.expiresAt - b.expiresAt,
    );
}

export function sumUnits(lots: Lot[]): number {
  return lots.reduce((s, l) => s + l.units, 0);
}

/** Pick `units` from already-ordered eligible lots. Returns null if there are not enough. */
export function pickUnits(ordered: Lot[], units: number): Allocation[] | null {
  const out: Allocation[] = [];
  let need = units;
  for (const lot of ordered) {
    if (need <= 0) break;
    const take = Math.min(lot.units, need);
    out.push({ lotId: lot.id, group: lot.group, units: take, expiresAt: lot.expiresAt });
    need -= take;
  }
  return need > 0 ? null : out;
}

/** Deduct allocations from lots. Throws rather than ever producing negative stock. */
export function commitAllocations(lots: Lot[], allocations: Allocation[], t: number): void {
  for (const a of allocations) {
    const lot = lots.find((l) => l.id === a.lotId);
    if (!lot) throw new Error(`Lot ${a.lotId} not found`);
    if (!isDispatchable(lot, t)) throw new Error(`Lot ${a.lotId} is not dispatchable`);
    if (lot.units < a.units) throw new Error(`Lot ${a.lotId} has ${lot.units} units, ${a.units} requested`);
  }
  for (const a of allocations) {
    const lot = lots.find((l) => l.id === a.lotId)!;
    lot.units -= a.units;
  }
}

/** Eligible (dispatchable) units by component at a site. */
export function siteTotals(lots: Lot[], siteId: string, t: number): Record<Component, number> {
  const r: Record<Component, number> = { RBC: 0, PLT: 0, PLASMA: 0 };
  for (const l of lots) if (l.siteId === siteId && isDispatchable(l, t)) r[l.component] += l.units;
  return r;
}

export function eligibleComponentUnits(lots: Lot[], siteId: string, component: Component, t: number): number {
  let n = 0;
  for (const l of lots) if (l.siteId === siteId && l.component === component && isDispatchable(l, t)) n += l.units;
  return n;
}

/** Why a site cannot cover a request — used in the explanation panel. */
export function shortageDiagnosis(lots: Lot[], siteId: string, component: Component, recipient: RecipientGroup, t: number): string[] {
  const here = lots.filter((l) => l.siteId === siteId && l.component === component && l.units > 0 && l.status !== 'expired');
  const compat = here.filter((l) => isCompatible(component, recipient, l.group));
  const incompatible = sumUnits(here) - sumUnits(compat);
  const held = sumUnits(compat.filter((l) => l.status === 'quarantine' || l.status === 'reserved'));
  const shortLife = sumUnits(compat.filter((l) => l.status === 'released' && l.expiresAt - t < MIN_REMAINING_MIN[component]));
  const out: string[] = [];
  if (incompatible > 0) out.push(`${incompatible} units on hand are not compatible`);
  if (held > 0) out.push(`${held} compatible units are quarantined or reserved`);
  if (shortLife > 0) out.push(`${shortLife} compatible units are too close to expiry`);
  return out;
}

// ---------------------------------------------------------------- synthetic stock generation

export const SYNTHETIC_STOCK: Record<'depot' | 'hospital', Record<Component, [number, number]>> = {
  depot: { RBC: [60, 90], PLT: [10, 18], PLASMA: [24, 40] },
  hospital: { RBC: [16, 28], PLT: [3, 6], PLASMA: [8, 14] },
};

function groupFor(rng: Rng): BloodGroup {
  return rng.weighted(GROUP_FREQ as unknown as (readonly [BloodGroup, number])[]);
}

/** Lot-level synthetic inventory. Deterministic for a given seed. */
export function generateInventory(sites: Site[], seed: number, counter: { lot: number }): Lot[] {
  const rng = new Rng(seed ^ 0x9e3779b9);
  const lots: Lot[] = [];
  for (const site of sites) {
    for (const component of COMPONENTS) {
      const [lo, hi] = SYNTHETIC_STOCK[site.kind][component];
      let remaining = rng.int(lo, hi);
      // Guarantee some O− red cells and AB plasma everywhere so emergency release is possible.
      if (component === 'RBC') {
        const oNeg = site.kind === 'depot' ? rng.int(6, 10) : rng.int(3, 5);
        lots.push(makeLot(counter, site.id, component, 'O-', oNeg, rng, false));
        remaining -= oNeg;
      }
      if (component === 'PLASMA') {
        const ab = site.kind === 'depot' ? rng.int(4, 6) : rng.int(2, 3);
        lots.push(makeLot(counter, site.id, component, 'AB+', ab, rng, false));
        remaining -= ab;
      }
      while (remaining > 0) {
        const units = Math.min(remaining, rng.int(1, component === 'RBC' ? 6 : 3));
        lots.push(makeLot(counter, site.id, component, groupFor(rng), units, rng, true));
        remaining -= units;
      }
    }
  }
  return lots;
}

function makeLot(counter: { lot: number }, siteId: string, component: Component, group: BloodGroup, units: number, rng: Rng, allowHold: boolean): Lot {
  const life = SHELF_LIFE_DAYS[component];
  // Remaining shelf life spread across the product's life (fresh platelets arrive after ~1 day of testing).
  const days = component === 'PLT' ? rng.range(0.4, 4.2) : component === 'RBC' ? rng.range(1.5, life - 2) : rng.range(30, life - 10);
  const roll = rng.next();
  const status = allowHold ? (roll < 0.05 ? 'quarantine' : roll < 0.1 ? 'reserved' : 'released') : 'released';
  counter.lot++;
  return { id: `L${String(counter.lot).padStart(4, '0')}`, siteId, component, group, units, expiresAt: Math.round(days * 1440), status };
}

/** Fresh units from the regional blood supplier (resupply of a depot). */
export function freshLot(counter: { lot: number }, siteId: string, component: Component, group: BloodGroup, units: number, t: number): Lot {
  counter.lot++;
  const days = component === 'PLT' ? 4 : SHELF_LIFE_DAYS[component] - 5;
  return { id: `L${String(counter.lot).padStart(4, '0')}`, siteId, component, group, units, expiresAt: t + days * 1440, status: 'released' };
}
