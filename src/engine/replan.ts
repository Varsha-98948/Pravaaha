import type { Delivery, DeliveryPlan, Minutes, RouteStop, UnassignedDelivery, Vehicle, VehicleRoute } from '../types'
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
 */
export function replan(world: World, currentPlan: DeliveryPlan, now: Minutes): DeliveryPlan {
  const simNow = Math.max(0, Number.isFinite(now) ? now : 0)
  const matrix = buildMatrixAt(world, simNow)

  const deliveriesMap = new Map<string, Delivery>(world.deliveries.map((d) => [d.id, d]))
  const vehiclesMap = new Map<string, Vehicle>(world.vehicles.map((v) => [v.id, v]))
  const closures = world.activeClosures

  // 1. Identify committed/fixed stops for each vehicle
  const committedStopsMap = new Map<string, RouteStop[]>()
  const committedDeliveryIds = new Set<string>()

  for (const vehicle of world.vehicles) {
    committedStopsMap.set(vehicle.id, [])
  }

  for (const route of currentPlan.routes) {
    const vehicle = vehiclesMap.get(route.vehicleId)
    if (!vehicle) continue

    const committed: RouteStop[] = []

    for (let i = 0; i < route.stops.length; i++) {
      const stop = route.stops[i]
      const roadEntry: Minutes = i === 0 ? vehicle.shiftStart : route.stops[i - 1].departure

      if (stop.departure <= simNow) {
        // Stop is already completed in the past
        committed.push({ ...stop, status: 'completed' })
        committedDeliveryIds.add(stop.deliveryId)
      } else if (vehicle.status === 'active' && roadEntry <= simNow) {
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
        // Stop is in the future or vehicle is failed: cannot be completed under current assignment
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
    const failureReasons: string[] = []

    for (const v of activeVehicles) {
      const committed = committedStopsMap.get(v.id) ?? []
      const currentNewIds = assignedNewIds.get(v.id)!
      const testNewIds = [...currentNewIds, d.id]

      const startLoc = committed.length > 0 ? committed[committed.length - 1].locationId : v.depotId
      const startTime = committed.length > 0 ? Math.max(simNow, committed[committed.length - 1].departure) : Math.max(simNow, v.shiftStart)

      const newStops = computeStops(startLoc, startTime, testNewIds, deliveriesMap, matrix)
      const allStops = [...committed, ...newStops]
      const bad = validateRoute(v, allStops, deliveriesMap)

      // Explicit check for closed-road legs in new stops
      let usesClosedRoad = false
      let prevLoc = startLoc
      for (const ns of newStops) {
        const travelMin = matrix[prevLoc]?.[ns.locationId]
        if (travelMin === undefined || travelMin >= CLOSED_MIN || !Number.isFinite(travelMin)) {
          usesClosedRoad = true
          break
        }
        prevLoc = ns.locationId
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
        failureReasons.push(...bad)
      }
    }

    if (best !== null) {
      assignedNewIds.get(best.vehicle.id)!.push(d.id)
    } else {
      // Determine truthful unassigned reason
      if (failureReasons.some((r) => r.includes('road closed') || r.includes('unreachable'))) {
        unassigned.push({
          deliveryId: d.id,
          reason: 'unreachable',
          detail: 'Destination unreachable or road is closed',
        })
      } else if (failureReasons.every((r) => r.includes('capacity'))) {
        unassigned.push({
          deliveryId: d.id,
          reason: 'capacity',
          detail: 'Remaining vehicle capacity is too small',
        })
      } else if (failureReasons.some((r) => r.includes('time window') || r.includes('shift overrun'))) {
        unassigned.push({
          deliveryId: d.id,
          reason: 'time_window',
          detail: 'No vehicle can arrive within the delivery window or shift',
        })
      } else {
        unassigned.push({
          deliveryId: d.id,
          reason: 'time_window',
          detail: 'Cannot be scheduled without constraint violations',
        })
      }
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
