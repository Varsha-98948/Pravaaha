import type { Delivery, Minutes, RouteStop, TravelMatrix, Vehicle } from '../types'

/** Arrival times with waiting for window opening. Late stops are flagged, never hidden.
 *  A missing matrix entry produces arrival=Infinity and status='skipped' (unreachable). */
export function computeStops(
  startLoc: string,
  startTime: Minutes,
  ids: string[],
  deliveries: Map<string, Delivery>,
  matrix: TravelMatrix,
): RouteStop[] {
  const stops: RouteStop[] = []
  let loc = startLoc, t = startTime
  let broken = false
  for (const id of ids) {
    const d = deliveries.get(id)
    if (!d) throw new Error(`Unknown delivery ${id}`)
    if (broken) {
      // Once a leg is unreachable the route cannot continue; all later stops are unserviceable.
      stops.push({ deliveryId: id, locationId: d.locationId, arrival: Infinity, waitMin: 0, serviceStart: Infinity, departure: Infinity, status: 'skipped' })
      continue
    }
    const travel = matrix[loc]?.[d.locationId]
    const arrival = travel !== undefined ? t + travel : Infinity
    const reachable = Number.isFinite(arrival)
    const serviceStart = reachable ? Math.max(arrival, d.window.start) : Infinity
    const departure = reachable ? serviceStart + d.serviceMin : Infinity
    const waitMin = reachable ? serviceStart - arrival : 0
    const status = !reachable
      ? 'skipped'
      : serviceStart > d.window.end
        ? 'late'
        : 'pending'
    stops.push({ deliveryId: id, locationId: d.locationId, arrival, waitMin, serviceStart, departure, status })
    if (reachable) { loc = d.locationId; t = departure } else broken = true
  }
  return stops
}

/** Returns human-readable violations; empty array = valid.
 *  Each stop produces at most one violation (unreachable takes precedence over late). */
export function validateRoute(v: Vehicle, stops: RouteStop[], deliveries: Map<string, Delivery>): string[] {
  const out: string[] = []
  let load = 0
  for (const s of stops) {
    const d = deliveries.get(s.deliveryId)
    if (!d) {
      out.push(`${s.deliveryId}: unknown delivery`)
      continue
    }
    load += d.size
  }
  if (load > v.capacity) out.push(`${v.name}: load ${load} exceeds capacity ${v.capacity}`)
  for (const s of stops) {
    const d = deliveries.get(s.deliveryId)
    if (!d) continue
    const unreachable = s.status === 'skipped' ||
      !Number.isFinite(s.arrival) ||
      !Number.isFinite(s.waitMin) ||
      !Number.isFinite(s.serviceStart) ||
      !Number.isFinite(s.departure)
    if (unreachable) {
      out.push(`${s.deliveryId}: unreachable`)
      continue
    }
    const late = s.status === 'late' || s.arrival > d.window.end || s.serviceStart > d.window.end
    if (late) {
      out.push(`${s.deliveryId}: misses time window`)
    }
  }
  const last = stops[stops.length - 1]
  if (last && Number.isFinite(last.departure) && last.departure > v.shiftEnd)
    out.push(`${v.name}: shift overrun`)
  return out
}
