import { describe, it, expect } from 'vitest'
import type { Delivery, DeliveryPlan, TravelMatrix, Vehicle } from '../src/types'
import type { World } from '../src/engine/disruptions'
import { replan } from '../src/engine/replan'
import { comparePlans } from '../src/engine/compare'

describe('ReRoute Engine — replan and compare', () => {
  const matrix: TravelMatrix = {
    depot: { depot: 0, c1: 10, c2: 20, c3: 30, c4: 40 },
    c1: { depot: 10, c1: 0, c2: 10, c3: 20, c4: 30 },
    c2: { depot: 20, c1: 10, c2: 0, c3: 10, c4: 20 },
    c3: { depot: 30, c1: 20, c2: 10, c3: 0, c4: 10 },
    c4: { depot: 40, c1: 30, c2: 20, c3: 10, c4: 0 },
  }

  const vehicles: Vehicle[] = [
    { id: 'v1', name: 'Van 1', capacity: 40, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'active' },
    { id: 'v2', name: 'Van 2', capacity: 40, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'active' },
  ]

  const deliveries: Delivery[] = [
    { id: 'd1', locationId: 'c1', size: 10, serviceMin: 10, window: { start: 0, end: 120 }, priority: 'normal' },
    { id: 'd2', locationId: 'c2', size: 10, serviceMin: 10, window: { start: 20, end: 180 }, priority: 'normal' },
    { id: 'd3', locationId: 'c3', size: 10, serviceMin: 10, window: { start: 40, end: 240 }, priority: 'normal' },
  ]

  const initialPlan: DeliveryPlan = {
    id: 'plan-init',
    label: 'Initial plan',
    createdAt: 0,
    routes: [
      {
        vehicleId: 'v1',
        load: 20,
        stops: [
          { deliveryId: 'd1', locationId: 'c1', arrival: 10, serviceStart: 10, departure: 20, waitMin: 0, status: 'pending' },
          { deliveryId: 'd2', locationId: 'c2', arrival: 30, serviceStart: 30, departure: 40, waitMin: 0, status: 'pending' },
        ],
      },
      {
        vehicleId: 'v2',
        load: 10,
        stops: [
          { deliveryId: 'd3', locationId: 'c3', arrival: 30, serviceStart: 40, departure: 50, waitMin: 10, status: 'pending' },
        ],
      },
    ],
    unassigned: [],
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Completed-stop preservation
  // ───────────────────────────────────────────────────────────────────────────
  describe('Completed-stop preservation', () => {
    it('preserves stops whose departure is <= now as fixed completed stops', () => {
      const world: World = { vehicles, deliveries, matrix }

      // At now = 25:
      // v1's d1 has departure 20 <= 25 -> COMPLETED
      // v1's d2 has arrival 30 > 25 -> FUTURE
      const revised = replan(world, initialPlan, 25)

      const v1Route = revised.routes.find((r) => r.vehicleId === 'v1')!
      expect(v1Route.stops.length).toBeGreaterThanOrEqual(1)

      const stop1 = v1Route.stops[0]
      expect(stop1.deliveryId).toBe('d1')
      expect(stop1.status).toBe('completed')
      expect(stop1.arrival).toBe(10)
      expect(stop1.departure).toBe(20)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Vehicle failure & stop reassignment
  // ───────────────────────────────────────────────────────────────────────────
  describe('Vehicle failure handling', () => {
    it('prevents failed vehicle from receiving future stops and reassigns remaining deliveries', () => {
      const failedVehicles: Vehicle[] = [
        { ...vehicles[0], status: 'active' },
        { ...vehicles[1], status: 'failed' }, // v2 failed!
      ]

      const world: World = { vehicles: failedVehicles, deliveries, matrix }

      // Initial plan had d3 on v2 (departure 50). At now = 20, v2 fails before d3 starts.
      const revised = replan(world, initialPlan, 20)

      // v2 must have NO future stops
      const v2Route = revised.routes.find((r) => r.vehicleId === 'v2')!
      expect(v2Route.stops).toEqual([])
      expect(v2Route.load).toBe(0)

      // d3 must be reassigned to active vehicle v1
      const v1Route = revised.routes.find((r) => r.vehicleId === 'v1')!
      const v1DeliveryIds = v1Route.stops.map((s) => s.deliveryId)
      expect(v1DeliveryIds).toContain('d3')
      expect(revised.unassigned).toEqual([])
    })

    it('keeps completed stops on failed vehicle while reassigning incomplete ones', () => {
      const failedVehicles: Vehicle[] = [
        { ...vehicles[0], status: 'active' },
        { ...vehicles[1], status: 'failed' },
      ]

      // v2 completed d3 at departure 50. Then failed at now = 60.
      const world: World = { vehicles: failedVehicles, deliveries, matrix }
      const planWithCompletedD3: DeliveryPlan = {
        ...initialPlan,
        routes: [
          initialPlan.routes[0],
          {
            vehicleId: 'v2',
            load: 20,
            stops: [
              { deliveryId: 'd3', locationId: 'c3', arrival: 30, serviceStart: 40, departure: 50, waitMin: 10, status: 'completed' },
              { deliveryId: 'd2', locationId: 'c2', arrival: 60, serviceStart: 60, departure: 70, waitMin: 0, status: 'pending' },
            ],
          },
        ],
      }

      const revised = replan(world, planWithCompletedD3, 55)

      // v2 retains completed stop d3
      const v2Route = revised.routes.find((r) => r.vehicleId === 'v2')!
      expect(v2Route.stops.length).toBe(1)
      expect(v2Route.stops[0].deliveryId).toBe('d3')
      expect(v2Route.stops[0].status).toBe('completed')

      // d2 was incomplete on v2, so it must not remain on v2
      expect(v2Route.stops.some((s) => s.deliveryId === 'd2')).toBe(false)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Road closures
  // ───────────────────────────────────────────────────────────────────────────
  describe('Road closures handling', () => {
    it('avoids closed roads and flags unreachable deliveries when customer is cut off', () => {
      // Disconnect customer c4 completely
      const closedWorld: World = {
        vehicles,
        deliveries: [
          ...deliveries,
          { id: 'd-isolated', locationId: 'c4', size: 5, serviceMin: 10, window: { start: 0, end: 100 }, priority: 'normal' },
        ],
        matrix,
        activeClosures: [
          { eventId: 'rc-1', from: 'depot', to: 'c4', at: 0, originalForward: 40, originalBackward: 40 },
          { eventId: 'rc-2', from: 'c1', to: 'c4', at: 0, originalForward: 30, originalBackward: 30 },
          { eventId: 'rc-3', from: 'c2', to: 'c4', at: 0, originalForward: 20, originalBackward: 20 },
          { eventId: 'rc-4', from: 'c3', to: 'c4', at: 0, originalForward: 10, originalBackward: 10 },
        ],
      }

      const revised = replan(closedWorld, initialPlan, 10)

      // d-isolated cannot be reached by any vehicle
      const unassigned = revised.unassigned.find((u) => u.deliveryId === 'd-isolated')
      expect(unassigned).toBeDefined()
      expect(unassigned?.reason).toBe('unreachable')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Urgent deliveries
  // ───────────────────────────────────────────────────────────────────────────
  describe('Urgent deliveries handling', () => {
    it('prioritizes and schedules urgent delivery on active vehicle', () => {
      const urgentDelivery: Delivery = {
        id: 'd-urgent',
        locationId: 'c1',
        size: 5,
        serviceMin: 5,
        window: { start: 20, end: 80 },
        priority: 'urgent',
      }

      const worldWithUrgent: World = {
        vehicles,
        deliveries: [...deliveries, urgentDelivery],
        matrix,
      }

      const revised = replan(worldWithUrgent, initialPlan, 15)

      // d-urgent should be assigned to an active route
      const allStops = revised.routes.flatMap((r) => r.stops)
      const urgentStop = allStops.find((s) => s.deliveryId === 'd-urgent')
      expect(urgentStop).toBeDefined()
      expect(revised.unassigned.some((u) => u.deliveryId === 'd-urgent')).toBe(false)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Unassignable deliveries with reasons
  // ───────────────────────────────────────────────────────────────────────────
  describe('Unassignable delivery reporting', () => {
    it('reports capacity reason when delivery size exceeds vehicle capacity', () => {
      const hugeDelivery: Delivery = {
        id: 'd-huge',
        locationId: 'c1',
        size: 999, // exceeds 40
        serviceMin: 10,
        window: { start: 0, end: 300 },
        priority: 'normal',
      }

      const world: World = { vehicles, deliveries: [hugeDelivery], matrix }
      const emptyPlan: DeliveryPlan = { id: 'empty', label: 'empty', createdAt: 0, routes: [], unassigned: [] }

      const revised = replan(world, emptyPlan, 0)
      const u = revised.unassigned.find((x) => x.deliveryId === 'd-huge')
      expect(u?.reason).toBe('capacity')
    })

    it('reports time_window reason when delivery window has already passed', () => {
      const expiredDelivery: Delivery = {
        id: 'd-expired',
        locationId: 'c1',
        size: 5,
        serviceMin: 10,
        window: { start: 0, end: 30 },
        priority: 'normal',
      }

      const world: World = { vehicles, deliveries: [expiredDelivery], matrix }
      const emptyPlan: DeliveryPlan = { id: 'empty', label: 'empty', createdAt: 0, routes: [], unassigned: [] }

      // replan at now = 100: window ended at 30
      const revised = replan(world, emptyPlan, 100)
      const u = revised.unassigned.find((x) => x.deliveryId === 'd-expired')
      expect(u?.reason).toBe('time_window')
    })

    it('reports no_vehicle reason when all vehicles are failed', () => {
      const allFailed: Vehicle[] = [
        { ...vehicles[0], status: 'failed' },
        { ...vehicles[1], status: 'failed' },
      ]

      const world: World = { vehicles: allFailed, deliveries, matrix }
      const emptyPlan: DeliveryPlan = { id: 'empty', label: 'empty', createdAt: 0, routes: [], unassigned: [] }

      const revised = replan(world, emptyPlan, 0)
      expect(revised.unassigned.length).toBe(deliveries.length)
      expect(revised.unassigned.every((u) => u.reason === 'no_vehicle')).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Plan comparison (comparePlans)
  // ───────────────────────────────────────────────────────────────────────────
  describe('Plan comparison (comparePlans)', () => {
    it('accurately categorizes kept, moved, and broken decisions with truthful reasons', () => {
      const planA: DeliveryPlan = {
        id: 'plan-a',
        label: 'Plan A',
        createdAt: 0,
        routes: [
          {
            vehicleId: 'v1',
            load: 20,
            stops: [
              { deliveryId: 'd-kept', locationId: 'c1', arrival: 10, serviceStart: 10, departure: 20, waitMin: 0, status: 'completed' },
              { deliveryId: 'd-rescheduled', locationId: 'c2', arrival: 30, serviceStart: 30, departure: 40, waitMin: 0, status: 'pending' },
              { deliveryId: 'd-reassigned', locationId: 'c3', arrival: 50, serviceStart: 50, departure: 60, waitMin: 0, status: 'pending' },
              { deliveryId: 'd-broken', locationId: 'c4', arrival: 70, serviceStart: 70, departure: 80, waitMin: 0, status: 'pending' },
            ],
          },
        ],
        unassigned: [
          { deliveryId: 'd-was-unassigned', reason: 'capacity', detail: 'Too large' },
        ],
      }

      const planB: DeliveryPlan = {
        id: 'plan-b',
        label: 'Plan B',
        createdAt: 20,
        routes: [
          {
            vehicleId: 'v1',
            load: 20,
            stops: [
              // d-kept: same vehicle, same time
              { deliveryId: 'd-kept', locationId: 'c1', arrival: 10, serviceStart: 10, departure: 20, waitMin: 0, status: 'completed' },
              // d-rescheduled: same vehicle, different time (45 instead of 30)
              { deliveryId: 'd-rescheduled', locationId: 'c2', arrival: 45, serviceStart: 45, departure: 55, waitMin: 0, status: 'pending' },
              // d-was-unassigned: now assigned to v1
              { deliveryId: 'd-was-unassigned', locationId: 'c1', arrival: 65, serviceStart: 65, departure: 75, waitMin: 0, status: 'pending' },
            ],
          },
          {
            vehicleId: 'v2',
            load: 20,
            stops: [
              // d-reassigned: moved from v1 to v2
              { deliveryId: 'd-reassigned', locationId: 'c3', arrival: 30, serviceStart: 30, departure: 40, waitMin: 0, status: 'pending' },
              // d-new-urgent: newly introduced in plan B
              { deliveryId: 'd-new-urgent', locationId: 'c2', arrival: 50, serviceStart: 50, departure: 60, waitMin: 0, status: 'pending' },
            ],
          },
        ],
        unassigned: [
          // d-broken: was assigned in A, now unassigned in B
          { deliveryId: 'd-broken', reason: 'time_window', detail: 'Could not make window' },
        ],
      }

      const cmp = comparePlans(planA, planB)

      // Test decisions
      expect(cmp.decisions['d-kept']).toBe('kept')
      expect(cmp.decisions['d-rescheduled']).toBe('moved')
      expect(cmp.decisions['d-reassigned']).toBe('moved')
      expect(cmp.decisions['d-was-unassigned']).toBe('moved')
      expect(cmp.decisions['d-new-urgent']).toBe('moved')
      expect(cmp.decisions['d-broken']).toBe('broken')

      // Test counts
      expect(cmp.counts.kept).toBe(1)
      expect(cmp.counts.moved).toBe(4)
      expect(cmp.counts.broken).toBe(1)

      // Test truthful reasons exist
      expect(cmp.reasons['d-kept']).toContain('Retained on v1')
      expect(cmp.reasons['d-rescheduled']).toContain('Rescheduled on v1')
      expect(cmp.reasons['d-reassigned']).toContain('Reassigned from v1')
      expect(cmp.reasons['d-broken']).toContain('Unassigned in revised plan')
      expect(cmp.reasons['d-new-urgent']).toContain('New delivery assigned to v2')
    })

    it('produces deterministic output independent of route ordering', () => {
      const planA = initialPlan
      const planB = { ...initialPlan, routes: [...initialPlan.routes].reverse() }

      const cmp1 = comparePlans(planA, planB)
      const cmp2 = comparePlans(planA, planB)

      expect(cmp1).toEqual(cmp2)
      expect(Object.keys(cmp1.decisions)).toEqual(Object.keys(cmp1.decisions).sort())
    })
  })
})
