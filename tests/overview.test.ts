import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDeliveries, getDeliveryPlan, getLocations, getVehicles, listDeliveryPlans } = vi.hoisted(() => ({
  getDeliveries: vi.fn(),
  getDeliveryPlan: vi.fn(),
  getLocations: vi.fn(),
  getVehicles: vi.fn(),
  listDeliveryPlans: vi.fn(),
}))

vi.mock('../src/services/persistenceService', () => ({
  getDeliveries,
  getDeliveryPlan,
  getLocations,
  getVehicles,
  listDeliveryPlans,
}))

import { dashboardMetrics, loadDashboardData, loadPlanComparisonData } from '../src/services/overviewService'
import type { Delivery, DeliveryPlan, Vehicle } from '../src/types'

const vehicles: Vehicle[] = [{ id: 'v1', name: 'Van 1', capacity: 20, depotId: 'l1', shiftStart: 0, shiftEnd: 500, status: 'active' }]
const deliveries: Delivery[] = [{ id: 'd1', locationId: 'l2', size: 2, serviceMin: 10, window: { start: 10, end: 100 }, priority: 'normal' }]
const plan = (id: string, status: 'pending' | 'late' = 'pending'): DeliveryPlan => ({
  id,
  label: id,
  createdAt: 20,
  routes: [{ vehicleId: 'v1', load: 2, stops: [{ deliveryId: 'd1', locationId: 'l2', arrival: 10, waitMin: 0, serviceStart: 10, departure: 20, status }] }],
  unassigned: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  getVehicles.mockResolvedValue(vehicles)
  getDeliveries.mockResolvedValue(deliveries)
  getLocations.mockResolvedValue([{ id: 'l2', name: 'Customer', kind: 'customer' }])
  listDeliveryPlans.mockResolvedValue([{ id: 'new', label: 'Latest', createdAt: 20, parentPlanId: 'old' }])
  getDeliveryPlan.mockResolvedValue(plan('new', 'late'))
})

describe('overview data loading and metrics', () => {
  it('loads live organization records through the scoped persistence service and derives metrics from the saved plan', async () => {
    const data = await loadDashboardData('org-7')
    expect(getVehicles).toHaveBeenCalledWith('org-7')
    expect(getDeliveries).toHaveBeenCalledWith('org-7')
    expect(getLocations).toHaveBeenCalledWith('org-7')
    expect(listDeliveryPlans).toHaveBeenCalledWith('org-7')
    expect(getDeliveryPlan).toHaveBeenCalledWith('new', 'org-7')
    expect(data.metrics).toEqual({ activeVehicles: 1, deliveries: 1, scheduledStops: 1, unassigned: 0, lateStops: 1 })
  })

  it('marks plan-derived metrics unavailable when there is no persisted plan', () => {
    expect(dashboardMetrics(vehicles, deliveries, null)).toEqual({
      activeVehicles: 1, deliveries: 1, scheduledStops: null, unassigned: null, lateStops: null,
    })
  })

  it('keeps empty live results empty and reports zero counts without inventing a plan', async () => {
    getVehicles.mockResolvedValue([])
    getDeliveries.mockResolvedValue([])
    getLocations.mockResolvedValue([])
    listDeliveryPlans.mockResolvedValue([])
    const data = await loadDashboardData('org-empty')
    expect(data).toEqual({
      vehicles: [], deliveries: [], locations: [], latestPlan: null,
      metrics: { activeVehicles: 0, deliveries: 0, scheduledStops: null, unassigned: null, lateStops: null },
    })
    expect(getDeliveryPlan).not.toHaveBeenCalled()
  })

  it('propagates live query failures instead of returning demo or fabricated values', async () => {
    getDeliveries.mockRejectedValue(new Error('permission denied'))
    await expect(loadDashboardData('org-7')).rejects.toThrow('permission denied')
  })
})

describe('saved plan comparison loading', () => {
  it('loads the two most recent saved plans and their mapped persisted stops for the organization', async () => {
    listDeliveryPlans.mockResolvedValue([
      { id: 'new', label: 'Revised', createdAt: 30, parentPlanId: 'old' },
      { id: 'old', label: 'Original', createdAt: 20, parentPlanId: null },
    ])
    getDeliveryPlan.mockImplementation(async (id: string) => plan(id, id === 'new' ? 'late' : 'pending'))
    const data = await loadPlanComparisonData('org-9')
    expect(listDeliveryPlans).toHaveBeenCalledWith('org-9')
    expect(getDeliveryPlan).toHaveBeenNthCalledWith(1, 'old', 'org-9')
    expect(getDeliveryPlan).toHaveBeenNthCalledWith(2, 'new', 'org-9')
    expect(data?.originalPlan.routes[0].stops[0].deliveryId).toBe('d1')
    expect(data?.revisedPlan.routes[0].stops[0].status).toBe('late')
  })

  it('returns an incomplete state when fewer than two persisted plans exist', async () => {
    expect(await loadPlanComparisonData('org-9')).toBeNull()
    expect(getDeliveryPlan).not.toHaveBeenCalled()
  })

  it('propagates comparison query failures', async () => {
    getLocations.mockRejectedValue(new Error('RLS denied'))
    await expect(loadPlanComparisonData('org-9')).rejects.toThrow('RLS denied')
  })
})
