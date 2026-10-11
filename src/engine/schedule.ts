import type { Delivery, Minutes, RouteStop, TravelMatrix, Vehicle } from '../types'
/** Arrival times with waiting for window opening. Late stops are flagged, never hidden. */
export function computeStops(startLoc: string, startTime: Minutes, ids: string[], deliveries: Map<string, Delivery>, matrix: TravelMatrix): RouteStop[] {
  const stops: RouteStop[] = []; let loc = startLoc, t = startTime
  for (const id of ids) {
    const d = deliveries.get(id); if (!d) throw new Error(`Unknown delivery ${id}`)
    const arrival = t + (matrix[loc]?.[d.locationId] ?? Infinity)
    const serviceStart = Math.max(arrival, d.window.start)
    stops.push({ deliveryId: id, locationId: d.locationId, arrival, serviceStart, departure: serviceStart + d.serviceMin, waitMin: serviceStart - arrival, status: serviceStart > d.window.end ? 'late' : 'pending' })
    loc = d.locationId; t = serviceStart + d.serviceMin
  }
  return stops
}
/** Returns human-readable violations; empty array = valid. */
export function validateRoute(v: Vehicle, stops: RouteStop[], deliveries: Map<string, Delivery>): string[] {
  const out: string[] = []
  const load = stops.reduce((s, x) => s + (deliveries.get(x.deliveryId)?.size ?? 0), 0)
  if (load > v.capacity) out.push(`${v.name}: load ${load} exceeds capacity ${v.capacity}`)
  for (const s of stops) { if (s.status === 'late') out.push(`${s.deliveryId}: misses time window`); if (!Number.isFinite(s.arrival)) out.push(`${s.deliveryId}: unreachable`) }
  const last = stops[stops.length - 1]; if (last && last.departure > v.shiftEnd) out.push(`${v.name}: shift overrun`)
  return out
}
