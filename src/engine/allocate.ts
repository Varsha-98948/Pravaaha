import type { Delivery, DeliveryPlan, TravelMatrix, Vehicle, VehicleRoute, UnassignedDelivery } from '../types'
import { computeStops, validatePlan, validateRoute } from './schedule'

/**
 * Deterministic greedy allocator.
 *
 * Sort order: urgent deliveries first, then earliest window.end, then delivery ID.
 * Vehicle selection: among feasible vehicles (no violations), pick the one whose route
 * finishes earliest; break ties by vehicle ID (lexicographic).
 * Unassigned reasons are honest: capacity | time_window | unreachable | no_vehicle.
 * Inputs are never mutated.
 */
export function allocate(
  vehicles: Vehicle[],
  deliveries: Delivery[],
  matrix: TravelMatrix,
  label = 'Baseline plan',
): DeliveryPlan {
  const dMap = new Map(deliveries.map(d => [d.id, d]))
  const active = vehicles.filter(v => v.status === 'active')

  // Deterministic assignment order: urgent first, then earliest window.end, then id.
  const sorted = [...deliveries].sort((a, b) => {
    const pA = a.priority === 'urgent' ? 0 : 1
    const pB = b.priority === 'urgent' ? 0 : 1
    if (pA !== pB) return pA - pB
    if (a.window.end !== b.window.end) return a.window.end - b.window.end
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  // Track assigned IDs per vehicle (in insertion order — preserves scheduling determinism).
  const assigned = new Map<string, string[]>(active.map(v => [v.id, []]))
  const unassigned: UnassignedDelivery[] = []

  for (const d of sorted) {
    if (active.length === 0) {
      unassigned.push({ deliveryId: d.id, reason: 'no_vehicle', detail: 'No active vehicles' })
      continue
    }

    let best: { v: Vehicle; end: number } | null = null
    const vehicleBlocked = new Map<string, { unreachable: boolean; capacity: boolean; window: boolean }>()

    // Try vehicles in deterministic order (stable — active preserves input order).
    for (const v of active) {
      const candidateIds = [...assigned.get(v.id)!, d.id]
      const stops = computeStops(v.depotId, v.shiftStart, candidateIds, dMap, matrix)
      const violations = validateRoute(v, stops, dMap, matrix)

      if (violations.length === 0) {
        const end = stops[stops.length - 1].departure
        // Prefer earliest completion; break ties by vehicle ID.
        if (!best || end < best.end || (end === best.end && v.id < best.v.id)) {
          best = { v, end }
        }
      } else {
        const capacity = violations.some(viol => viol.includes('capacity'))
        const unreachable = violations.some(viol => viol.includes('unreachable'))
        const window = violations.some(viol => viol.includes('time window') || viol.includes('shift overrun'))
        vehicleBlocked.set(v.id, { capacity, unreachable, window })
      }
    }

    if (best) {
      assigned.get(best.v.id)!.push(d.id)
    } else {
      // Classify blockers across all active vehicles:
      // unreachable when all vehicles are blocked by unreachable routes;
      // capacity when capacity is the only blocking constraint;
      // otherwise time_window for time-window/shift failures or mixed constraints.
      const allUnreachable = active.every(v => vehicleBlocked.get(v.id)?.unreachable)
      const hasCapacity = active.some(v => vehicleBlocked.get(v.id)?.capacity)
      const hasUnreachable = active.some(v => vehicleBlocked.get(v.id)?.unreachable)
      const hasWindow = active.some(v => vehicleBlocked.get(v.id)?.window)

      const reason = allUnreachable
        ? 'unreachable'
        : hasCapacity && !hasUnreachable && !hasWindow
          ? 'capacity'
          : 'time_window'
      const detail = reason === 'unreachable'
        ? 'No route exists to the delivery location from any vehicle'
        : reason === 'capacity'
          ? 'Remaining vehicle capacity is too small'
          : 'No vehicle can complete this delivery within its time window or shift'
      unassigned.push({ deliveryId: d.id, reason, detail })
    }
  }

  const routes: VehicleRoute[] = active.map(v => {
    const ids = assigned.get(v.id)!
    const stops = computeStops(v.depotId, v.shiftStart, ids, dMap, matrix)
    const load = ids.reduce((sum, id) => sum + (dMap.get(id)?.size ?? 0), 0)
    return { vehicleId: v.id, stops, load }
  })

  const plan: DeliveryPlan = { id: `plan-${label}`, label, createdAt: 0, routes, unassigned }
  const violations = validatePlan(plan, vehicles, deliveries, matrix)
  if (violations.length > 0) {
    throw new Error(`Generated plan is invalid: ${violations.join('; ')}`)
  }

  return plan
}

export { validatePlan }
