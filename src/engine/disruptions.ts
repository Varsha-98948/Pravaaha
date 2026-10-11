import type { Delivery, DisruptionEvent, TravelMatrix, Vehicle } from '../types'
export interface World { vehicles: Vehicle[]; deliveries: Delivery[]; matrix: TravelMatrix }
export const CLOSED_MIN = 9999
/** Pure: returns a new world with the disruption applied. Does not replan. */
export function applyDisruption(w: World, e: DisruptionEvent): World {
  switch (e.type) {
    case 'vehicle_failure': return { ...w, vehicles: w.vehicles.map(v => v.id === e.vehicleId ? { ...v, status: 'failed' } : v) }
    case 'urgent_delivery': return { ...w, deliveries: [...w.deliveries, e.delivery] }
    case 'road_closure': { const m = structuredClone(w.matrix); if (m[e.from]?.[e.to] !== undefined) { m[e.from][e.to] = CLOSED_MIN; m[e.to][e.from] = CLOSED_MIN } return { ...w, matrix: m } }
  }
}
