import type { DeliveryDecision, DeliveryPlan } from '../types'
const where = (p: DeliveryPlan) => { const m = new Map<string, { v: string; t: number }>(); p.routes.forEach(r => r.stops.forEach(s => m.set(s.deliveryId, { v: r.vehicleId, t: s.serviceStart }))); return m }
/** kept = same vehicle and time; moved = different vehicle/time; broken = dropped from the revised plan. */
export function comparePlans(a: DeliveryPlan, b: DeliveryPlan) {
  const A = where(a), B = where(b); const decisions: Record<string, DeliveryDecision> = {}
  A.forEach((x, id) => { const y = B.get(id); decisions[id] = !y ? 'broken' : x.v === y.v && x.t === y.t ? 'kept' : 'moved' })
  const counts = { kept: 0, moved: 0, broken: 0 }; Object.values(decisions).forEach(d => counts[d]++)
  return { decisions, counts }
}
