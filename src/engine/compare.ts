import type { DeliveryDecision, DeliveryPlan, PlanComparison } from '../types'

export type { PlanComparison }

interface StopInfo {
  vehicleId: string
  serviceStart: number
  departure: number
  arrival: number
}

interface UnassignedInfo {
  reason: string
  detail: string
}

function extractPlanDeliveryMap(plan: DeliveryPlan) {
  const assigned = new Map<string, StopInfo>()
  const unassigned = new Map<string, UnassignedInfo>()

  for (const route of plan.routes) {
    for (const stop of route.stops) {
      assigned.set(stop.deliveryId, {
        vehicleId: route.vehicleId,
        serviceStart: stop.serviceStart,
        departure: stop.departure,
        arrival: stop.arrival,
      })
    }
  }

  for (const u of plan.unassigned) {
    unassigned.set(u.deliveryId, {
      reason: u.reason,
      detail: u.detail,
    })
  }

  return { assigned, unassigned }
}

/**
 * Compare original (a) and revised (b) delivery plans by stable delivery ID.
 * Returns kept, moved, or broken for every delivery present in either plan,
 * along with truthful reasons and summary counts.
 * Output is deterministic: deliveries are evaluated in lexicographic ID order.
 */
export function comparePlans(a: DeliveryPlan, b: DeliveryPlan): PlanComparison {
  const planA = extractPlanDeliveryMap(a)
  const planB = extractPlanDeliveryMap(b)

  // Collect all delivery IDs from both plans (scheduled and unassigned)
  const allIdsSet = new Set<string>()
  for (const id of planA.assigned.keys()) allIdsSet.add(id)
  for (const id of planA.unassigned.keys()) allIdsSet.add(id)
  for (const id of planB.assigned.keys()) allIdsSet.add(id)
  for (const id of planB.unassigned.keys()) allIdsSet.add(id)

  const sortedIds = Array.from(allIdsSet).sort()

  const decisions: Record<string, DeliveryDecision> = {}
  const reasons: Record<string, string> = {}
  const counts = { kept: 0, moved: 0, broken: 0 }

  for (const id of sortedIds) {
    const stopA = planA.assigned.get(id)
    const unassignedA = planA.unassigned.get(id)
    const stopB = planB.assigned.get(id)
    const unassignedB = planB.unassigned.get(id)

    let decision: DeliveryDecision
    let reason: string

    if (stopA !== undefined) {
      // Delivery was scheduled in original plan A
      if (stopB !== undefined) {
        // Scheduled in both plans
        if (stopA.vehicleId === stopB.vehicleId && stopA.serviceStart === stopB.serviceStart) {
          decision = 'kept'
          reason = `Retained on ${stopA.vehicleId} at ${stopA.serviceStart}m`
        } else if (stopA.vehicleId === stopB.vehicleId) {
          decision = 'moved'
          reason = `Rescheduled on ${stopA.vehicleId} from ${stopA.serviceStart}m to ${stopB.serviceStart}m`
        } else {
          decision = 'moved'
          reason = `Reassigned from ${stopA.vehicleId} (${stopA.serviceStart}m) to ${stopB.vehicleId} (${stopB.serviceStart}m)`
        }
      } else {
        // Was scheduled in A, but dropped / unassigned in B
        decision = 'broken'
        if (unassignedB !== undefined) {
          reason = `Unassigned in revised plan: ${unassignedB.detail || unassignedB.reason}`
        } else {
          reason = 'Dropped from revised plan'
        }
      }
    } else if (unassignedA !== undefined) {
      // Delivery was unassigned in original plan A
      if (stopB !== undefined) {
        decision = 'moved'
        reason = `Assigned to ${stopB.vehicleId} at ${stopB.serviceStart}m (previously unassigned)`
      } else {
        decision = 'broken'
        reason = unassignedB !== undefined
          ? `Remained unassigned: ${unassignedB.detail || unassignedB.reason}`
          : 'Remained unassigned'
      }
    } else {
      // Newly introduced delivery in revised plan B (e.g. urgent delivery)
      if (stopB !== undefined) {
        decision = 'moved'
        reason = `New delivery assigned to ${stopB.vehicleId} at ${stopB.serviceStart}m`
      } else {
        decision = 'broken'
        reason = unassignedB !== undefined
          ? `New delivery could not be assigned: ${unassignedB.detail || unassignedB.reason}`
          : 'New delivery unassigned'
      }
    }

    decisions[id] = decision
    reasons[id] = reason
    counts[decision]++
  }

  return { decisions, counts, reasons }
}
