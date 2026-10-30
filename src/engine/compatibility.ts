// Component-specific eligibility rules — SIMPLIFIED and explicitly scoped for a research prototype.
// They are not clinical guidance; real transfusion decisions belong to qualified staff and local policy.
//
// RBC     : ABO and RhD compatible red cells. Unknown group → O-negative only (emergency release).
// PLASMA  : ABO plasma compatibility (reverse of red cells). RhD ignored. Unknown group → AB only.
// PLT     : Any ABO accepted (ABO-identical, then plasma-compatible preferred).
//           RhD-negative recipients restricted to RhD-negative platelets (conservative simplification).

import type { ABO, BloodGroup, Component, RecipientGroup } from './types';

export const ALL_GROUPS: BloodGroup[] = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];

const abo = (g: BloodGroup): ABO => g.slice(0, -1) as ABO;
const rh = (g: BloodGroup) => g.slice(-1) as '+' | '-';

const RBC_ABO: Record<ABO, ABO[]> = { O: ['O'], A: ['A', 'O'], B: ['B', 'O'], AB: ['AB', 'A', 'B', 'O'] };
const PLASMA_ABO: Record<ABO, ABO[]> = { O: ['O', 'A', 'B', 'AB'], A: ['A', 'AB'], B: ['B', 'AB'], AB: ['AB'] };

export function isCompatible(component: Component, recipient: RecipientGroup, donor: BloodGroup): boolean {
  if (component === 'RBC') {
    if (recipient === 'UNKNOWN') return donor === 'O-';
    if (!RBC_ABO[abo(recipient)].includes(abo(donor))) return false;
    return rh(recipient) === '+' || rh(donor) === '-';
  }
  if (component === 'PLASMA') {
    if (recipient === 'UNKNOWN') return abo(donor) === 'AB';
    return PLASMA_ABO[abo(recipient)].includes(abo(donor));
  }
  // Platelets
  if (recipient === 'UNKNOWN') return true; // any ABO/RhD; RhD-negative preferred via preferenceRank
  return rh(recipient) === '+' || rh(donor) === '-';
}

export function compatibleGroups(component: Component, recipient: RecipientGroup): BloodGroup[] {
  return ALL_GROUPS.filter((g) => isCompatible(component, recipient, g));
}

/**
 * Lower = preferred. Identical group first; universal-donor units (O− red cells, AB plasma)
 * last so they stay available for patients whose group is unknown.
 */
export function preferenceRank(component: Component, recipient: RecipientGroup, donor: BloodGroup): number {
  if (recipient !== 'UNKNOWN' && donor === recipient) return 0;
  if (component === 'RBC') return donor === 'O-' ? 3 : abo(donor) === 'O' ? 2 : 1;
  if (component === 'PLASMA') return abo(donor) === 'AB' ? 3 : 1;
  if (recipient === 'UNKNOWN') return rh(donor) === '-' ? 1 : 2;
  if (PLASMA_ABO[abo(recipient)].includes(abo(donor))) return 1;
  return 2;
}

/** Units that are "universal" for this component and should be conserved when possible. */
export function isUniversalDonor(component: Component, donor: BloodGroup): boolean {
  if (component === 'RBC') return donor === 'O-';
  if (component === 'PLASMA') return abo(donor) === 'AB';
  return false;
}

export function recipientLabel(g: RecipientGroup): string {
  return g === 'UNKNOWN' ? 'group unknown (emergency release)' : g.replace('-', '−');
}

export function groupLabel(g: BloodGroup): string {
  return g.replace('-', '−');
}
