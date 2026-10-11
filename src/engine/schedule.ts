import type { Delivery, DeliveryPlan, Minutes, RouteStop, TravelMatrix, Vehicle } from '../types'

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
export function validateRoute(
  v: Vehicle,
  stops: RouteStop[],
  deliveries: Map<string, Delivery>,
  matrix?: TravelMatrix,
): string[] {
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

  let loc = v.depotId
  let prevDep = v.shiftStart
  let broken = false

  for (const s of stops) {
    const d = deliveries.get(s.deliveryId)
    if (!d) continue
    const unreachable = broken ||
      s.status === 'skipped' ||
      !Number.isFinite(s.arrival) ||
      !Number.isFinite(s.waitMin) ||
      !Number.isFinite(s.serviceStart) ||
      !Number.isFinite(s.departure)
    if (unreachable) {
      out.push(`${s.deliveryId}: unreachable`)
      broken = true
      loc = s.locationId
      prevDep = Infinity
      continue
    }

    if (matrix) {
      const travel = matrix[loc]?.[s.locationId]
      if (travel === undefined) {
        out.push(`${s.deliveryId}: unreachable`)
        broken = true
        loc = s.locationId
        prevDep = Infinity
        continue
      }
      if (s.arrival !== prevDep + travel) {
        out.push(`${s.deliveryId}: invalid arrival time`)
        loc = s.locationId
        prevDep = s.departure
        continue
      }
    }

    if (
      s.arrival < 0 ||
      s.waitMin < 0 ||
      s.serviceStart < 0 ||
      s.departure < 0 ||
      s.serviceStart !== s.arrival + s.waitMin ||
      s.departure !== s.serviceStart + d.serviceMin
    ) {
      out.push(`${s.deliveryId}: invalid stop timing`)
      loc = s.locationId
      prevDep = s.departure
      continue
    }

    if (s.status === 'late' && s.serviceStart <= d.window.end && s.serviceStart >= d.window.start) {
      out.push(`${s.deliveryId}: inconsistent stop status`)
      loc = s.locationId
      prevDep = s.departure
      continue
    }

    const late = s.status === 'late' || s.arrival > d.window.end || s.serviceStart > d.window.end || s.serviceStart < d.window.start
    if (late) {
      out.push(`${s.deliveryId}: misses time window`)
    }

    loc = s.locationId
    prevDep = s.departure
  }

  const last = stops[stops.length - 1]
  if (last && Number.isFinite(last.departure) && last.departure > v.shiftEnd)
    out.push(`${v.name}: shift overrun`)
  return out
}

/** Validates a whole plan against vehicles and deliveries. Empty array = valid.
 *  Checks duplicate/missing delivery accounting, unknown vehicle/delivery IDs,
 *  assignments to failed vehicles, capacity violations, unreachable/invalid stops,
 *  time-window violations, and shift overruns. Unassigned deliveries with valid typed
 *  reasons are allowed. */
export function validatePlan(
  plan: DeliveryPlan,
  vehicles: Vehicle[],
  deliveries: Delivery[],
  matrix?: TravelMatrix,
): string[]
export function validatePlan(
  vehicles: Vehicle[],
  deliveries: Delivery[],
  plan: DeliveryPlan,
  matrix?: TravelMatrix,
): string[]
export function validatePlan(
  a: DeliveryPlan | Vehicle[],
  b: Vehicle[] | Delivery[],
  c?: Delivery[] | DeliveryPlan,
  d?: TravelMatrix,
): string[] {
  let plan: DeliveryPlan
  let vehicles: Vehicle[]
  let deliveries: Delivery[]
  let matrix: TravelMatrix | undefined

  if ('routes' in (a as object) && Array.isArray((a as DeliveryPlan).routes)) {
    plan = a as DeliveryPlan
    vehicles = b as Vehicle[]
    deliveries = (c as Delivery[]) ?? []
    matrix = d
  } else {
    vehicles = a as Vehicle[]
    deliveries = b as Delivery[]
    plan = c as DeliveryPlan
    matrix = d
  }

  const out: string[] = []

  // 1. Check for duplicate vehicle IDs and duplicate delivery IDs in input
  const seenVehicleIds = new Set<string>()
  for (const v of vehicles) {
    if (seenVehicleIds.has(v.id)) {
      out.push(`${v.id}: duplicate vehicle ID in input`)
    }
    seenVehicleIds.add(v.id)
  }

  const seenDeliveryIds = new Set<string>()
  for (const del of deliveries) {
    if (seenDeliveryIds.has(del.id)) {
      out.push(`${del.id}: duplicate delivery ID in input`)
    }
    seenDeliveryIds.add(del.id)
  }

  const vMap = new Map<string, Vehicle>(vehicles.map(v => [v.id, v]))
  const dMap = new Map<string, Delivery>(deliveries.map(del => [del.id, del]))

  // 2. Vehicle validation and route-level constraint validation
  for (const r of plan.routes) {
    const v = vMap.get(r.vehicleId)
    if (!v) {
      out.push(`${r.vehicleId}: unknown vehicle`)
      continue
    }
    if (v.status === 'failed' && (r.stops.length > 0 || r.load > 0)) {
      out.push(`${v.id}: assigned to failed vehicle`)
    }

    // Validate declared route load against actual sum of assigned delivery sizes
    const actualLoad = r.stops.reduce((sum, s) => {
      const del = dMap.get(s.deliveryId)
      return sum + (del?.size ?? 0)
    }, 0)
    if (r.load !== actualLoad) {
      out.push(`${v.name}: mismatched route load (declared ${r.load}, actual ${actualLoad})`)
    }

    const routeViolations = validateRoute(v, r.stops, dMap, matrix)
    out.push(...routeViolations)
    if (r.load > v.capacity && !routeViolations.some(viol => viol.includes('capacity'))) {
      out.push(`${v.name}: load ${r.load} exceeds capacity ${v.capacity}`)
    }
  }

  // 3. Delivery accounting across route stops and unassigned deliveries
  const counts = new Map<string, number>()
  for (const r of plan.routes) {
    for (const s of r.stops) {
      counts.set(s.deliveryId, (counts.get(s.deliveryId) ?? 0) + 1)
    }
  }

  const validReasons = new Set<string>(['capacity', 'time_window', 'no_vehicle', 'unreachable'])
  for (const u of plan.unassigned) {
    if (!dMap.has(u.deliveryId)) {
      out.push(`${u.deliveryId}: unknown delivery`)
    }
    if (!validReasons.has(u.reason)) {
      out.push(`${u.deliveryId}: invalid unassigned reason '${u.reason}'`)
    }
    counts.set(u.deliveryId, (counts.get(u.deliveryId) ?? 0) + 1)
  }

  // Detect duplicate deliveries
  for (const [id, count] of counts.entries()) {
    if (count > 1) {
      out.push(`${id}: duplicate delivery accounting`)
    }
  }

  // Detect missing deliveries
  for (const del of deliveries) {
    if (!counts.has(del.id) || counts.get(del.id) === 0) {
      out.push(`${del.id}: missing delivery accounting`)
    }
  }

  return out
}
