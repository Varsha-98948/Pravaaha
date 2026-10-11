import type { Delivery, DeliveryPlan, Location, Vehicle } from '../types'
import { getDeliveries, getDeliveryPlan, getLocations, getVehicles, listDeliveryPlans } from './persistenceService'

export interface DashboardMetrics {
  activeVehicles: number
  deliveries: number
  scheduledStops: number | null
  unassigned: number | null
  lateStops: number | null
}

export interface DashboardData {
  vehicles: Vehicle[]
  deliveries: Delivery[]
  locations: Location[]
  latestPlan: DeliveryPlan | null
  metrics: DashboardMetrics
}

export interface PlanComparisonData {
  deliveries: Delivery[]
  vehicles: Vehicle[]
  locations: Location[]
  originalPlan: DeliveryPlan
  revisedPlan: DeliveryPlan
}

export function dashboardMetrics(vehicles: Vehicle[], deliveries: Delivery[], plan: DeliveryPlan | null): DashboardMetrics {
  const stops = plan?.routes.flatMap(route => route.stops) ?? []
  return {
    activeVehicles: vehicles.filter(vehicle => vehicle.status === 'active').length,
    deliveries: deliveries.length,
    scheduledStops: plan ? stops.length : null,
    unassigned: plan ? plan.unassigned.length : null,
    lateStops: plan ? stops.filter(stop => stop.status === 'late').length : null,
  }
}

export async function loadDashboardData(orgId: string): Promise<DashboardData> {
  const [vehicles, deliveries, locations, plans] = await Promise.all([
    getVehicles(orgId),
    getDeliveries(orgId),
    getLocations(orgId),
    listDeliveryPlans(orgId),
  ])
  const latestPlan = plans[0] ? await getDeliveryPlan(plans[0].id, orgId) : null
  return { vehicles, deliveries, locations, latestPlan, metrics: dashboardMetrics(vehicles, deliveries, latestPlan) }
}

export async function loadPlanComparisonData(orgId: string): Promise<PlanComparisonData | null> {
  const [deliveries, vehicles, locations, plans] = await Promise.all([
    getDeliveries(orgId),
    getVehicles(orgId),
    getLocations(orgId),
    listDeliveryPlans(orgId),
  ])
  if (plans.length < 2) return null
  // listDeliveryPlans is newest first: compare the immediately preceding saved
  // plan against the latest, using their persisted plan_stops and metrics.
  const [originalPlan, revisedPlan] = await Promise.all([
    getDeliveryPlan(plans[1].id, orgId),
    getDeliveryPlan(plans[0].id, orgId),
  ])
  return { deliveries, vehicles, locations, originalPlan, revisedPlan }
}
