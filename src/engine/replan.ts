import type { Delivery, DeliveryPlan, Minutes, RouteStop, UnassignedDelivery, UnassignedReason, Vehicle, VehicleRoute } from '../types'
import { buildMatrixAt, CLOSED_MIN, type TimedClosure, type World } from './disruptions'
import { computeStops, validateRoute } from './schedule'

function isLegBlockedByClosure(
  fromLoc: string,
  toLoc: string,
  roadEntry: Minutes,
  closures: TimedClosure[] | undefined,
): boolean {
  if (!closures || closures.length === 0) return false
  for (const c of closures) {
    const isThisRoad = (c.from === fromLoc && c.to === toLoc) || (c.from === toLoc && c.to === fromLoc)
    if (isThisRoad && roadEntry >= c.at) {
      return true
    }
  }
  return false
}

/**
 * Replan delivery routes from simulation minute `now`.
 *
 * Rules:
 * - Completed stops (departure <= now) stay fixed in place.
 * - Active vehicle in-progress stops (service underway or leg committed on open road) are preserved.
 * - Failed vehicles receive no stops after failure (retaining only stops completed before failure).
 * - Remaining / affected deliveries are greedily reassigned across active vehicles (urgent first, earliest window).
 * - Road closures active at `now` are respected via buildMatrixAt(world, now).
 * - Capacity, shift windows, and customer time windows are strictly validated; violations result in explicit unassigned records.
 *
 * Contract Limitation Note:
 * - RouteStop.status in src/types/index.ts is constrained to 'pending' | 'completed' | 'late' | 'skipped'.
 * - UnassignedReason is constrained to 'capacity' | 'time_window' | 'no_vehicle' | 'unreachable'.
 * - The contract does not have an 'interrupted' or 'stranded' status. Therefore:
 *   1. Interrupted deliveries (vehicle broke down during travel or service) cannot remain on the failed vehicle
 *      with a custom status without violating StopStatus contracts.
 *   2. Instead, failed vehicles retain only genuinely completed stops (departure <= failedAt).
 *   3. All interrupted and remaining deliveries are released into the candidate pool for reassignment.
 *   4. If an interrupted delivery cannot be reassigned (e.g. no active vehicles remain or capacity is full),
 *      it is explicitly recorded in `unassigned` using supported reasons ('no_vehicle', 'capacity', or 'time_window')
 *      so that no delivery is silently lost or falsely completed.
 */
export function replan(world: World, currentPlan: DeliveryPlan, now: Minutes): DeliveryPlan {
  const simNow = Math.max(0, Number.isFinite(now) ? now : 0)
  const matrix = buildMatrixAt(world, simNow)

  const deliveriesMap = new Map<string, Delivery>(world.deliveries.map((d) => [d.id, d]))
  const vehiclesMap = new Map<string, Vehicle>(world.vehicles.map((v) => [v.id, v]))
  const closures = world.activeClosures

  // Track failure times for failed vehicles
  const failureTimes = new Map<string, Minutes>()
  if (world.vehicleFailures) {
    for (const f of world.vehicleFailures) {
      const existing = failureTimes.get(f.vehicleId)
      if (existing === undefined || f.at < existing) {
        failureTimes.set(f.vehicleId, f.at)
      }
    }
  }
  for (const v of world.vehicles) {
    if ((v as { failedAt?: Minutes }).failedAt !== undefined && !failureTimes.has(v.id)) {
      failureTimes.set(v.id, (v as { failedAt?: Minutes }).failedAt!)
    }
  }

  // 1. Identify committed/fixed stops for each vehicle
  const committedStopsMap = new Map<string, RouteStop[]>()
  const committedDeliveryIds = new Set<string>()

  for (const vehicle of world.vehicles) {
    committedStopsMap.set(vehicle.id, [])
  }

  for (const route of currentPlan.routes) {
    const vehicle = vehiclesMap.get(route.vehicleId)
    if (!vehicle) continue

    const isFailed = vehicle.status === 'failed'
    const failedAt = failureTimes.get(vehicle.id)
    const cutoff = isFailed && failedAt !== undefined ? Math.min(simNow, failedAt) : simNow

    const committed: RouteStop[] = []

    for (let i = 0; i < route.stops.length; i++) {
      const stop = route.stops[i]
      const roadEntry: Minutes = i === 0 ? vehicle.shiftStart : route.stops[i - 1].departure

      if (stop.departure <= cutoff) {
        // Stop was genuinely completed before vehicle failure and before simNow
        committed.push({ ...stop, status: 'completed' })
        committedDeliveryIds.add(stop.deliveryId)
      } else if (!isFailed && roadEntry <= simNow) {
        // Active vehicle with work in progress at simNow
        const fromLoc = i === 0 ? vehicle.depotId : route.stops[i - 1].locationId
        const toLoc = stop.locationId

        // If service is already in progress, or inbound travel is not blocked by closure:
        const alreadyArrived = stop.arrival <= simNow
        const blocked = !alreadyArrived && isLegBlockedByClosure(fromLoc, toLoc, roadEntry, closures)

        if (!blocked) {
          committed.push({ ...stop, status: stop.status === 'completed' ? 'pending' : stop.status })
          committedDeliveryIds.add(stop.deliveryId)
        } else {
          // Blocked by road closure: cannot finish, must be reassigned
          break
        }
      } else {
        // Stop is in the future, or vehicle is failed and stop departure is after failure cutoff
        break
      }
    }

    committedStopsMap.set(vehicle.id, committed)
  }

  // 2. Pool of candidate deliveries to be scheduled
  const remainingDeliveries: Delivery[] = []
  for (const d of world.deliveries) {
    if (!committedDeliveryIds.has(d.id)) {
      remainingDeliveries.push(d)
    }
  }

  // Sort candidate deliveries: urgent first, then earliest window start, tie-break by ID
  const sorted = [...remainingDeliveries].sort((a, b) => {
    if (a.priority === 'urgent' && b.priority !== 'urgent') return -1
    if (a.priority !== 'urgent' && b.priority === 'urgent') return 1
    if (a.window.start !== b.window.start) return a.window.start - b.window.start
    return a.id.localeCompare(b.id)
  })

  // 3. Active vehicles available for new stops
  const activeVehicles = world.vehicles.filter((v) => v.status === 'active')
  const assignedNewIds = new Map<string, string[]>()
  for (const v of activeVehicles) {
    assignedNewIds.set(v.id, [])
  }

  const unassigned: UnassignedDelivery[] = []

  // 4. Greedy allocation of candidate deliveries across active vehicles
  for (const d of sorted) {
    if (activeVehicles.length === 0) {
      unassigned.push({
        deliveryId: d.id,
        reason: 'no_vehicle',
        detail: 'No active vehicles available to assign delivery',
      })
      continue
    }

    let best: { vehicle: Vehicle; end: number } | null = null
    const perVehicleFailures: Array<{ vehicle: Vehicle; reasons: string[] }> = []

    for (const v of activeVehicles) {
      const committed = committedStopsMap.get(v.id) ?? []
      const currentNewIds = assignedNewIds.get(v.id)!
      const testNewIds = [...currentNewIds, d.id]

      const startLoc = committed.length > 0 ? committed[committed.length - 1].locationId : v.depotId
      const startTime = committed.length > 0 ? Math.max(simNow, committed[committed.length - 1].departure) : Math.max(simNow, v.shiftStart)

      const newStops = computeStops(startLoc, startTime, testNewIds, deliveriesMap, matrix)
      const allStops = [...committed, ...newStops]
      const effectiveV: Vehicle = {
        ...v,
        depotId: startLoc,
        shiftStart: startTime,
      }
      const rawBadAll = validateRoute(v, allStops, deliveriesMap)
      const rawBadNew = validateRoute(effectiveV, newStops, deliveriesMap, matrix)

      // Filter out errors that belong to already-committed stops,
      // so a prior/in-progress stop does not disqualify the vehicle from valid future work.
      const bad = [
        ...rawBadAll.filter((err) => {
          for (const cs of committed) {
            if (err === `${cs.deliveryId}: misses time window`) {
              return false
            }
          }
          return true
        }),
        ...rawBadNew.filter((err) => !err.includes('exceeds capacity')),
      ]

      // Explicit check for closed-road legs in new stops (both current and future scheduled closures)
      let usesClosedRoad = false
      let prevLoc = startLoc
      let legDepartureTime = startTime
      for (const ns of newStops) {
        const travelMin = matrix[prevLoc]?.[ns.locationId]
        const blockedByClosure = isLegBlockedByClosure(prevLoc, ns.locationId, legDepartureTime, closures)
        if (travelMin === undefined || travelMin >= CLOSED_MIN || !Number.isFinite(travelMin) || blockedByClosure) {
          usesClosedRoad = true
          break
        }
        prevLoc = ns.locationId
        legDepartureTime = ns.departure
      }
      if (usesClosedRoad) {
        bad.push(`${d.id}: road closed`)
      }

      if (bad.length === 0) {
        const end = allStops[allStops.length - 1].departure
        if (!best || end < best.end) {
          best = { vehicle: v, end }
        }
      } else {
        perVehicleFailures.push({ vehicle: v, reasons: bad })
      }
    }

    if (best !== null) {
      assignedNewIds.get(best.vehicle.id)!.push(d.id)
    } else {
      // Classify blockers across all active vehicles (same as allocate.ts):
      // unreachable when all vehicles are blocked by unreachable routes;
      // capacity when capacity is the only blocking constraint;
      // otherwise time_window for time-window/shift failures or mixed constraints.
      const allUnreachable =
        activeVehicles.length > 0 &&
        activeVehicles.every((v) => {
          const f = perVehicleFailures.find((x) => x.vehicle.id === v.id)
          return f?.reasons.some((r) => r.includes('road closed') || r.includes('unreachable'))
        })
      const hasCapacity = perVehicleFailures.some((f) => f.reasons.some((r) => r.includes('capacity')))
      const hasUnreachable = perVehicleFailures.some((f) =>
        f.reasons.some((r) => r.includes('road closed') || r.includes('unreachable')),
      )
      const hasWindow = perVehicleFailures.some((f) =>
        f.reasons.some(
          (r) =>
            r.includes('time window') ||
            r.includes('shift overrun') ||
            r.includes('invalid arrival time') ||
            r.includes('invalid stop timing'),
        ),
      )

      const reason: UnassignedReason = allUnreachable
        ? 'unreachable'
        : hasCapacity && !hasUnreachable && !hasWindow
          ? 'capacity'
          : 'time_window'
      const detail =
        reason === 'unreachable'
          ? 'Destination unreachable or road is closed'
          : reason === 'capacity'
            ? 'Remaining vehicle capacity is too small'
            : 'No vehicle can complete this delivery within its time window or shift'
      unassigned.push({ deliveryId: d.id, reason, detail })
    }
  }

  // Also include any previously unassigned deliveries from currentPlan not in world.deliveries
  for (const prevUnassigned of currentPlan.unassigned) {
    if (!deliveriesMap.has(prevUnassigned.deliveryId) && !unassigned.some((u) => u.deliveryId === prevUnassigned.deliveryId)) {
      unassigned.push(prevUnassigned)
    }
  }

  // 5. Construct final routes
  const routes: VehicleRoute[] = []

  for (const v of world.vehicles) {
    const committed = committedStopsMap.get(v.id) ?? []

    if (v.status === 'failed') {
      routes.push({
        vehicleId: v.id,
        stops: committed,
        load: committed.reduce((sum, s) => sum + (deliveriesMap.get(s.deliveryId)?.size ?? 0), 0),
      })
    } else {
      const newIds = assignedNewIds.get(v.id) ?? []
      const startLoc = committed.length > 0 ? committed[committed.length - 1].locationId : v.depotId
      const startTime = committed.length > 0 ? Math.max(simNow, committed[committed.length - 1].departure) : Math.max(simNow, v.shiftStart)
      const newStops = computeStops(startLoc, startTime, newIds, deliveriesMap, matrix)
      const allStops = [...committed, ...newStops]

      routes.push({
        vehicleId: v.id,
        stops: allStops,
        load: allStops.reduce((sum, s) => sum + (deliveriesMap.get(s.deliveryId)?.size ?? 0), 0),
      })
    }
  }

  return {
    id: `plan-replanned-${simNow}`,
    label: `Replanned at ${simNow}m`,
    createdAt: simNow,
    routes,
    unassigned,
  }
}
