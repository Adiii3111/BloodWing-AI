// PULSE — predictive transfusion intelligence.
//
// Inputs:  fictional patient appointments with fictional clinical orders (component, group, units
//          come from the ORDER — never inferred from a diagnosis), the shared inventory twin,
//          and the ML demand forecast for emergency use at each hospital.
// Output:  for each appointment, a plan: hold locally, or replenish from a depot with a
//          latest-feasible dispatch time, a shortage-risk estimate, and an explanation.
//
//   Latest feasible dispatch = required availability − transport lead time − handling buffer
//
// Pending orders are PREDICTIONS ONLY: units are earmarked in the plan, never reserved.

import { HOSPITAL_FLOOR } from './assumptions';
import { groupLabel, recipientLabel } from './compatibility';
import { poissonTail } from './dispatch';
import { groundMinutes } from './fleet';
import { haversineKm } from './geo';
import { eligibleComponentUnits, eligibleLots, pickUnits } from './inventory';
import { DEPOTS, simMinuteOf, siteById } from './network';
import { log } from './simulation';
import { GROUND } from './assumptions';
import type { Appointment, BloodGroup, Component, Lot, RecipientGroup, ReplenOrder, SimState } from './types';

export const PULSE = {
  /** Units must be on the shelf this long before the appointment (receipt, compatibility testing, issue). */
  availabilityLeadMin: 240,
  /** Packing / receipt handling buffer added to transport lead time. */
  handlingBufferMin: 60,
  /** Extra safety margin before the latest feasible dispatch. */
  safetyMarginMin: 120,
  /** Traffic assumed when planning ahead (conservative). */
  planningTraffic: 1.5,
  /** Units must remain usable this long after the appointment. */
  shelfAfterMin: 24 * 60,
  /** Emergency demand competes for the same shelf until the next routine replenishment (ORBIT cycle). */
  riskHorizonMaxMin: 6 * 60,
  /** Forecast emergency-shortage risk a plan may leave at the hospital before it replenishes instead. */
  riskThreshold: 0.2,
};

const COMPONENT_SHARE: Record<Component, number> = { RBC: 1, PLT: 0.18, PLASMA: 0.3 };

/** Fictional patients and orders. Hospital associations are fictional illustrations. */
export function defaultAppointments(): Appointment[] {
  const at = (m: number, d: number, h: number, min = 0) => simMinuteOf(new Date(2026, m, d, h, min));
  return [
    { id: 'APT-2187', patientId: 'PT-2187', condition: 'Sickle cell disease — red cell exchange', hospitalId: 'BMC', at: at(9, 31, 9), component: 'RBC', group: 'O+', units: 8, orderStatus: 'pending' },
    { id: 'APT-2402', patientId: 'PT-2402', condition: 'Aplastic anaemia', hospitalId: 'BIDMC', at: at(9, 31, 15), component: 'PLT', group: 'A+', units: 1, orderStatus: 'confirmed' },
    { id: 'APT-2310', patientId: 'PT-2310', condition: 'Myelodysplastic syndrome', hospitalId: 'BIDMC', at: at(10, 2, 13), component: 'RBC', group: 'A-', units: 2, orderStatus: 'pending' },
    { id: 'APT-2263', patientId: 'PT-2263', condition: 'Transfusion-dependent thalassaemia', hospitalId: 'MGH', at: at(10, 3, 8, 30), component: 'RBC', group: 'B+', units: 2, orderStatus: 'confirmed' },
    { id: 'APT-2378', patientId: 'PT-2378', condition: 'Sickle cell disease', hospitalId: 'BWH', at: at(10, 5, 11), component: 'RBC', group: 'O-', units: 2, orderStatus: 'confirmed' },
    { id: 'APT-2041', patientId: 'PT-2041', condition: 'Transfusion-dependent thalassaemia', hospitalId: 'BCH', at: at(10, 12, 10), component: 'RBC', group: 'A+', units: 2, orderStatus: 'pending' },
  ];
}

/** Move `units` of eligible stock into reserved lots tagged with `tag`. Never touches held stock. */
export function reserveUnits(s: SimState, siteId: string, component: Component, recipient: RecipientGroup, units: number, tag: string, minExpiry = 0, identical = false): number {
  const lots = eligibleLots(s.lots, siteId, component, recipient, s.t).filter((l) => l.expiresAt >= minExpiry && (!identical || l.group === recipient));
  const alloc = pickUnits(lots, units);
  if (!alloc) throw new Error(`Cannot reserve ${units} units at ${siteId}`);
  for (const a of alloc) {
    const lot = s.lots.find((l) => l.id === a.lotId)!;
    if (a.units === lot.units) {
      lot.status = 'reserved';
      lot.reservedFor = tag;
    } else {
      lot.units -= a.units;
      s.counters.lot++;
      s.lots.push({ ...lot, id: `L${String(s.counters.lot).padStart(4, '0')}`, units: a.units, status: 'reserved', reservedFor: tag });
    }
  }
  return units;
}

export function reservedFor(s: SimState, tag: string): Lot[] {
  return s.lots.filter((l) => l.reservedFor === tag && l.status === 'reserved' && l.units > 0);
}

export interface PulsePlan {
  appt: Appointment;
  requiredBy: number;
  alreadyReserved: number;
  /** Units already on a replenishment order for this appointment (ORBIT). */
  onOrder: number;
  localUsable: number;
  fromLocal: number;
  shortfall: number;
  depotId: string | null;
  depotEligible: number;
  leadTimeMin: number | null;
  latestDispatch: number | null;
  recommendedDispatch: number | null;
  shortageRisk: number;
  action: 'hold-local' | 'replenish' | 'already-reserved' | 'infeasible' | 'cancelled';
  status: 'on-track' | 'at-risk' | 'late' | 'infeasible' | 'prediction' | 'cancelled';
  explanation: string[];
}

/**
 * Plans every appointment in priority order (confirmed first, then by time) against a running
 * picture of local availability, so two appointments never count on the same units.
 */
export function planPulse(s: SimState, appointments: Appointment[] = s.appointments): PulsePlan[] {
  const t = s.t;
  const ordered = [...appointments].sort((a, b) => (a.orderStatus === 'confirmed' ? 0 : 1) - (b.orderStatus === 'confirmed' ? 0 : 1) || a.at - b.at);
  const usedLocal = new Map<string, number>(); // site|component → units already counted by earlier plans
  const usedDepot = new Map<string, number>();
  const plans: PulsePlan[] = [];
  for (const appt of ordered) {
    const hosp = siteById(s.sites, appt.hospitalId);
    const requiredBy = appt.at - PULSE.availabilityLeadMin;
    const explanation: string[] = [];
    if (appt.orderStatus === 'cancelled') {
      plans.push({ appt, requiredBy, alreadyReserved: 0, onOrder: 0, localUsable: 0, fromLocal: 0, shortfall: 0, depotId: null, depotEligible: 0, leadTimeMin: null, latestDispatch: null, recommendedDispatch: null, shortageRisk: 0, action: 'cancelled', status: 'cancelled', explanation: ['Appointment cancelled — no inventory is held.'] });
      continue;
    }
    const reserved = reservedFor(s, appt.id).reduce((a, l) => a + l.units, 0);
    const onOrder = s.orders.filter((o) => o.reservedFor === appt.id && o.status !== 'delivered').reduce((a, o) => a + o.units, 0);
    const need = Math.max(0, appt.units - reserved - onOrder);
    const minExpiry = appt.at + PULSE.shelfAfterMin;
    const key = `${appt.hospitalId}|${appt.component}`;
    // Scheduled (chronically transfused) patients: plan ABO/RhD-identical units only — universal donor stock stays for emergencies.
    const lots = eligibleLots(s.lots, appt.hospitalId, appt.component, appt.group, t).filter((l) => l.expiresAt >= minExpiry && l.group === appt.group);
    const compat = lots.reduce((a, l) => a + l.units, 0);
    const componentTotal = eligibleComponentUnits(s.lots, appt.hospitalId, appt.component, t) - (usedLocal.get(key) ?? 0);
    const floor = HOSPITAL_FLOOR[appt.component];
    const localUsable = Math.max(0, Math.min(compat - (usedLocal.get(key) ?? 0), componentTotal - floor));
    // Emergency demand competing for the same shelf before the appointment (ML forecast)
    const horizon = Math.max(0, Math.min(PULSE.riskHorizonMaxMin, requiredBy - t));
    const perHour = ((s.forecastUnits6h?.[appt.hospitalId] ?? 4) / 6) * COMPONENT_SHARE[appt.component];
    const lambda = perHour * (horizon / 60);
    const riskIf = (held: number) => poissonTail(lambda, Math.max(0, Math.floor(componentTotal - held - floor)));

    const depots = DEPOTS.map((d) => {
      const dl = eligibleLots(s.lots, d.id, appt.component, appt.group, t).filter((l) => l.expiresAt >= minExpiry && l.group === appt.group);
      const avail = dl.reduce((a, l) => a + l.units, 0) - (usedDepot.get(`${d.id}|${appt.component}|${appt.group}`) ?? 0);
      const lead = GROUND.prepMin + groundMinutes(haversineKm(d, hosp), PULSE.planningTraffic) + GROUND.handoffMin;
      return { d, avail, lead };
    }).sort((x, y) => x.lead - y.lead);
    const depotCan = (units: number) => units <= 0 || depots.some((c) => c.avail >= units);

    // Hold as many units locally as possible WITHOUT pushing the hospital's forecast emergency
    // shortage risk above the threshold; replenish the rest if a depot can.
    const maxLocal = Math.min(need, localUsable);
    let fromLocal = maxLocal;
    if (riskIf(maxLocal) > PULSE.riskThreshold) {
      let best = -1;
      for (let k = maxLocal; k >= 0; k--) {
        if (!depotCan(need - k)) continue;
        if (riskIf(k) <= PULSE.riskThreshold) {
          best = k;
          break;
        }
      }
      if (best < 0) for (let k = 0; k <= maxLocal; k++) if (depotCan(need - k)) {
        best = k; // risk cannot be brought under threshold — minimise it
        break;
      }
      if (best >= 0 && best < maxLocal) {
        explanation.push(
          `Holding all ${maxLocal} locally would leave ${hosp.short} with a ${(riskIf(maxLocal) * 100).toFixed(0)}% forecast risk of running short for emergencies; holding ${best} and replenishing ${need - best} brings it to ${(riskIf(best) * 100).toFixed(0)}%.`,
        );
        fromLocal = best;
      }
    }
    usedLocal.set(key, (usedLocal.get(key) ?? 0) + fromLocal);
    const shortfall = need - fromLocal;
    const slack = componentTotal - fromLocal - floor;
    const shortageRisk = riskIf(fromLocal);

    let depotId: string | null = null;
    let depotEligible = 0;
    let leadTimeMin: number | null = null;
    let latestDispatch: number | null = null;
    let recommendedDispatch: number | null = null;
    let action: PulsePlan['action'] = reserved + onOrder >= appt.units ? 'already-reserved' : 'hold-local';

    if (reserved > 0) explanation.unshift(`${reserved} unit${reserved > 1 ? 's are' : ' is'} already reserved for ${appt.patientId}.`);
    if (onOrder > 0) explanation.push(`${onOrder} unit${onOrder > 1 ? 's are' : ' is'} on a consolidated replenishment order (ORBIT), reserved on arrival.`);
    if (fromLocal > 0) explanation.push(`${hosp.short} holds ${fromLocal} identical ${appt.component} unit${fromLocal > 1 ? 's' : ''} that stay in date past the appointment, keeping its ${floor}-unit emergency floor.`);

    if (shortfall > 0) {
      const best = depots.find((c) => c.avail >= shortfall);
      if (!best) {
        action = 'infeasible';
        explanation.push(`No depot holds ${shortfall} identical ${appt.component} units that remain in date past the appointment — requires human review.`);
      } else {
        action = 'replenish';
        depotId = best.d.id;
        depotEligible = best.avail;
        usedDepot.set(`${best.d.id}|${appt.component}|${appt.group}`, (usedDepot.get(`${best.d.id}|${appt.component}|${appt.group}`) ?? 0) + shortfall);
        leadTimeMin = best.lead;
        latestDispatch = requiredBy - best.lead - PULSE.handlingBufferMin;
        recommendedDispatch = Math.max(t, latestDispatch - PULSE.safetyMarginMin);
        explanation.push(`Replenish ${shortfall} unit${shortfall > 1 ? 's' : ''} from ${best.d.name} (${best.avail} eligible). Lead time ${Math.round(best.lead)} min at planning traffic ×${PULSE.planningTraffic}.`);
        explanation.push(`Latest feasible dispatch = availability time − ${Math.round(best.lead)} min transport − ${PULSE.handlingBufferMin} min handling. Recommended dispatch adds a ${PULSE.safetyMarginMin}-min safety margin.`);
      }
    }
    let status: PulsePlan['status'] = 'on-track';
    if (action === 'infeasible') status = 'infeasible';
    else if (latestDispatch != null && latestDispatch < t) status = 'late';
    else if (shortageRisk > PULSE.riskThreshold) status = 'at-risk';
    if (appt.orderStatus === 'pending' && status === 'on-track') status = 'prediction';
    if (appt.orderStatus === 'pending') explanation.push('Order not yet confirmed: this is a planning prediction. Units are earmarked in the plan, not reserved.');
    explanation.push(`Emergency demand at ${hosp.short} before the availability time is forecast at ${lambda.toFixed(1)} ${appt.component} units (ML) — probability it exceeds the remaining slack of ${Math.max(0, Math.floor(slack))}: ${(shortageRisk * 100).toFixed(0)}%.`);
    plans.push({ appt, requiredBy, alreadyReserved: reserved, onOrder, localUsable, fromLocal, shortfall, depotId, depotEligible, leadTimeMin, latestDispatch, recommendedDispatch, shortageRisk, action, status, explanation });
  }
  return plans;
}

/**
 * Act on a CONFIRMED order: reserve the local units now and raise a replenishment order
 * (served by ORBIT) for any shortfall. Pending orders are refused.
 */
export function executePulsePlan(s: SimState, plan: PulsePlan): { reserved: number; order?: ReplenOrder } {
  const appt = s.appointments.find((a) => a.id === plan.appt.id);
  if (!appt) throw new Error('Unknown appointment');
  if (appt.orderStatus !== 'confirmed') throw new Error('Only confirmed clinical orders can reserve inventory');
  let reserved = 0;
  if (plan.fromLocal > 0) {
    reserved = reserveUnits(s, appt.hospitalId, appt.component, appt.group, plan.fromLocal, appt.id, appt.at + PULSE.shelfAfterMin, true);
  }
  let order: ReplenOrder | undefined;
  if (plan.shortfall > 0 && plan.depotId && !s.orders.some((o) => o.reservedFor === appt.id && o.status !== 'delivered')) {
    order = {
      id: `ORD-${String(s.orders.length + 1).padStart(3, '0')}`,
      hospitalId: appt.hospitalId,
      component: appt.component,
      group: appt.group,
      units: plan.shortfall,
      latest: plan.requiredBy - PULSE.handlingBufferMin,
      source: 'pulse',
      reservedFor: appt.id,
      status: 'open',
    };
    s.orders.push(order);
  }
  appt.planned = true;
  log(s, 'ok', `PULSE: ${appt.patientId} plan executed — ${reserved} unit${reserved === 1 ? '' : 's'} reserved locally${order ? `, ${order.units} ordered for consolidated delivery (${order.id})` : ''}`);
  return { reserved, order };
}

export function describeAppt(a: Appointment): string {
  return `${a.patientId} · ${a.units} ${a.component} ${a.component === 'PLT' ? '' : groupLabel(a.group as BloodGroup)} for ${recipientLabel(a.group)}`.replace(/\s+/g, ' ');
}
