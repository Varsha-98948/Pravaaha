import type { DeliveryPlan, TravelMatrix, Vehicle } from '../types'
import { ValidationError } from './errors'

/**
 * The database schema stores route stops, but no standalone travel-time matrix.
 * Build only directed legs whose elapsed travel time is observable in the
 * persisted plan; never fill unknown links with demo or estimated values.
 */
export function travelMatrixFromPersistedPlan(plan: DeliveryPlan, vehicles: Vehicle[]): TravelMatrix {
  const vehiclesById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]))
  const matrix: TravelMatrix = {}

  for (const route of plan.routes) {
    const vehicle = vehiclesById.get(route.vehicleId)
    if (!vehicle) throw new ValidationError(`Persisted plan references unknown vehicle '${route.vehicleId}'.`)

    let from = vehicle.depotId
    let departedAt = vehicle.shiftStart
    for (const stop of route.stops) {
      const travelTime = stop.arrival - departedAt
      if (Number.isFinite(travelTime) && travelTime >= 0 && from && stop.locationId) {
        const existing = matrix[from]?.[stop.locationId]
        if (existing !== undefined && existing !== travelTime) {
          throw new ValidationError(`Persisted plan contains conflicting travel times for '${from}' to '${stop.locationId}'.`)
        }
        matrix[from] = { ...(matrix[from] ?? {}), [stop.locationId]: travelTime }
      }
      from = stop.locationId
      departedAt = stop.departure
    }
  }

  return matrix
}
