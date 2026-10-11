import type { Delivery, DeliveryPlan, TravelMatrix, Vehicle, VehicleRoute, UnassignedDelivery } from '../types'
import { computeStops, validateRoute } from './schedule'
/** BASELINE greedy allocator (urgent/earliest-window first, append-only). Every route is validated; not an optimizer. */
export function allocate(vehicles: Vehicle[], deliveries: Delivery[], matrix: TravelMatrix, label = 'Baseline plan'): DeliveryPlan {
  const map = new Map(deliveries.map(d => [d.id, d])); const active = vehicles.filter(v => v.status === 'active')
  const ids = new Map<string, string[]>(active.map(v => [v.id, []])); const unassigned: UnassignedDelivery[] = []
  const sorted = [...deliveries].sort((a, b) => a.window.start - b.window.start)
  for (const d of sorted) {
    let best: { v: Vehicle; end: number } | null = null; let capacityBlocked = false
    for (const v of active) {
      const stops = computeStops(v.depotId, v.shiftStart, [...ids.get(v.id)!, d.id], map, matrix); const bad = validateRoute(v, stops, map)
      if (bad.length === 0) { const end = stops[stops.length - 1].departure; if (!best || end < best.end) best = { v, end } }
      else if (bad.some(b => b.includes('capacity'))) capacityBlocked = true
    }
    if (best) ids.get(best.v.id)!.push(d.id)
    else unassigned.push(active.length === 0 ? { deliveryId: d.id, reason: 'no_vehicle', detail: 'No active vehicles' } : capacityBlocked ? { deliveryId: d.id, reason: 'capacity', detail: 'Remaining vehicle capacity is too small' } : { deliveryId: d.id, reason: 'time_window', detail: 'No vehicle can arrive within the window' })
  }
  const routes: VehicleRoute[] = active.map(v => ({ vehicleId: v.id, stops: computeStops(v.depotId, v.shiftStart, ids.get(v.id)!, map, matrix), load: ids.get(v.id)!.reduce((s, i) => s + map.get(i)!.size, 0) }))
  return { id: `plan-${label}`, label, createdAt: 0, routes, unassigned }
}
