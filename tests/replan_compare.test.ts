import { describe, it, expect } from 'vitest'
import type { Delivery, DeliveryPlan, TravelMatrix, Vehicle, VehicleFailureEvent } from '../src/types'
import type { World } from '../src/engine/disruptions'
import { applyDisruption } from '../src/engine/disruptions'
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

  // ───────────────────────────────────────────────────────────────────────────
  // 7. Milestone A Regression Tests
  // ───────────────────────────────────────────────────────────────────────────
  describe('7. Milestone A Regression Tests', () => {
    it('does not mark a stop completed if failure occurred before the stop even if replanning happens after its scheduled departure', () => {
      // v1 was scheduled for d1 (dep 20) and d2 (arr 30, dep 40)
      // v1 suffered a breakdown at t=25 (after d1 departed, but before d2 started)
      // Replanning happens at now = 50 (after d2's scheduled departure 40)
      const failedVehicles: Vehicle[] = [
        { ...vehicles[0], status: 'failed' },
        { ...vehicles[1], status: 'active' },
      ]

      const world: World = {
        vehicles: failedVehicles,
        deliveries,
        matrix,
        vehicleFailures: [
          { eventId: 'vf-1', vehicleId: 'v1', at: 25 },
        ],
      }

      const revised = replan(world, initialPlan, 50)

      // v1 must only keep d1 (which finished at 20 <= 25)
      const v1Route = revised.routes.find((r) => r.vehicleId === 'v1')!
      expect(v1Route.stops.map((s) => s.deliveryId)).toEqual(['d1'])
      expect(v1Route.stops[0].status).toBe('completed')

      // d2 MUST NOT be completed on v1 and must be reassigned to active vehicle v2
      expect(v1Route.stops.some((s) => s.deliveryId === 'd2')).toBe(false)
      const v2Route = revised.routes.find((r) => r.vehicleId === 'v2')!
      expect(v2Route.stops.map((s) => s.deliveryId)).toContain('d2')
    })

    it('allows an active vehicle with a committed late stop to receive valid future deliveries', () => {
      // v1 has a committed in-progress stop d-late whose arrival missed the delivery window (status: 'late')
      // Delivery d-future has window 50-150, which v1 can easily make on time
      const deliveryLate: Delivery = {
        id: 'd-late',
        locationId: 'c1',
        size: 5,
        serviceMin: 10,
        window: { start: 0, end: 15 }, // misses window because arrival is 20
        priority: 'normal',
      }
      const deliveryFuture: Delivery = {
        id: 'd-future',
        locationId: 'c2',
        size: 5,
        serviceMin: 10,
        window: { start: 50, end: 150 },
        priority: 'normal',
      }

      const planWithLateStop: DeliveryPlan = {
        id: 'plan-late',
        label: 'Plan with late stop',
        createdAt: 0,
        routes: [
          {
            vehicleId: 'v1',
            load: 5,
            stops: [
              { deliveryId: 'd-late', locationId: 'c1', arrival: 20, serviceStart: 20, departure: 30, waitMin: 0, status: 'late' },
            ],
          },
          {
            vehicleId: 'v2',
            load: 0,
            stops: [],
          },
        ],
        unassigned: [],
      }

      // Replan at now = 25 (stop is in progress at c1)
      const world: World = {
        vehicles: [vehicles[0], { ...vehicles[1], status: 'failed' }], // only v1 active
        deliveries: [deliveryLate, deliveryFuture],
        matrix,
      }

      const revised = replan(world, planWithLateStop, 25)

      // v1 must not be disqualified: d-future should be scheduled on v1
      const v1Route = revised.routes.find((r) => r.vehicleId === 'v1')!
      expect(v1Route.stops.map((s) => s.deliveryId)).toEqual(['d-late', 'd-future'])
      expect(revised.unassigned.some((u) => u.deliveryId === 'd-future')).toBe(false)
    })

    it('blocks a leg scheduled to enter a road during a future closure', () => {
      // now = 10, but candidate stop d-c4 at c4 would enter road from c1 at t=20.
      // Closure on c1 -> c4 starts at t=15 (future relative to now=10, before road entry 20).
      const deliveryC4: Delivery = {
        id: 'd-c4',
        locationId: 'c4',
        size: 5,
        serviceMin: 10,
        window: { start: 20, end: 150 },
        priority: 'normal',
      }

      const planV1AtC1: DeliveryPlan = {
        id: 'plan-v1-at-c1',
        label: 'Plan v1 at c1',
        createdAt: 0,
        routes: [
          {
            vehicleId: 'v1',
            load: 10,
            stops: [{ deliveryId: 'd1', locationId: 'c1', arrival: 10, serviceStart: 10, departure: 20, waitMin: 0, status: 'pending' }],
          },
        ],
        unassigned: [],
      }

      const worldWithFutureClosure: World = {
        vehicles: [vehicles[0]], // only v1 active
        deliveries: [deliveries[0], deliveryC4],
        matrix,
        activeClosures: [
          // Road from c1 to c4 closed starting at t=15
          { eventId: 'rc-fut', from: 'c1', to: 'c4', at: 15, originalForward: 30, originalBackward: 30 },
          // Also close direct depot -> c4 so vehicle cannot jump depot -> c4
          { eventId: 'rc-depot', from: 'depot', to: 'c4', at: 0, originalForward: 40, originalBackward: 40 },
        ],
      }

      // At now = 10: v1 is en route to c1 (departure from c1 will be at t=20).
      // Leg to c4 would enter road c1 -> c4 at t=20 >= 15, so future closure must block it.
      const revised = replan(worldWithFutureClosure, planV1AtC1, 10)

      const unassigned = revised.unassigned.find((u) => u.deliveryId === 'd-c4')
      expect(unassigned).toBeDefined()
      expect(unassigned?.reason).toBe('unreachable')
    })

    it('reports defensible reason when different vehicles fail for different reasons', () => {
      // v1 at c1 cannot reach c3 because c1 -> c3 is closed.
      // v2 at depot can reach c3 (depot -> c3 is open), but v2 capacity (20) < heavy delivery size (35).
      // Reported reason must be 'capacity', NOT 'unreachable'.
      const heavyDelivery: Delivery = {
        id: 'd-heavy',
        locationId: 'c3',
        size: 35,
        serviceMin: 10,
        window: { start: 0, end: 300 },
        priority: 'normal',
      }

      const testVehicles: Vehicle[] = [
        { id: 'v1', name: 'Van 1', capacity: 50, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'active' },
        { id: 'v2', name: 'Van 2', capacity: 20, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'active' },
      ]

      const planWithV1AtC1: DeliveryPlan = {
        id: 'plan-v1',
        label: 'Plan v1 at c1',
        createdAt: 0,
        routes: [
          {
            vehicleId: 'v1',
            load: 10,
            stops: [{ deliveryId: 'd1', locationId: 'c1', arrival: 10, serviceStart: 10, departure: 20, waitMin: 0, status: 'completed' }],
          },
          {
            vehicleId: 'v2',
            load: 0,
            stops: [],
          },
        ],
        unassigned: [],
      }

      const worldDifferentFailures: World = {
        vehicles: testVehicles,
        deliveries: [deliveries[0], heavyDelivery],
        matrix,
        activeClosures: [
          // c1 -> c3 is closed (blocks v1 who is at c1)
          { eventId: 'rc-c1-c3', from: 'c1', to: 'c3', at: 0, originalForward: 20, originalBackward: 20 },
          // depot -> c3 is OPEN (v2 at depot CAN reach c3, but fails on capacity)
        ],
      }

      const revised = replan(worldDifferentFailures, planWithV1AtC1, 20)

      const u = revised.unassigned.find((x) => x.deliveryId === 'd-heavy')
      expect(u).toBeDefined()
      expect(u?.reason).toBe('time_window')
    })

    // ── Task 1: Breakdown during in-progress delivery (travel, service, future) ──
    it('handles vehicle breakdown during travel (en route) to a delivery', () => {
      // v1 route: d1 (dep 20), d2 (arr 35, dep 45), d3 (arr 65, dep 75)
      // v1 breaks down at t=28 (while travelling between c1 and c2; 20 <= 28 < 35)
      // Replanning occurs at now = 50
      const plan3Stops: DeliveryPlan = {
        id: 'plan-3stops',
        label: 'Plan with 3 stops',
        createdAt: 0,
        routes: [
          {
            vehicleId: 'v1',
            load: 30,
            stops: [
              { deliveryId: 'd1', locationId: 'c1', arrival: 10, serviceStart: 10, departure: 20, waitMin: 0, status: 'pending' },
              { deliveryId: 'd2', locationId: 'c2', arrival: 35, serviceStart: 35, departure: 45, waitMin: 0, status: 'pending' },
              { deliveryId: 'd3', locationId: 'c3', arrival: 65, serviceStart: 65, departure: 75, waitMin: 0, status: 'pending' },
            ],
          },
          {
            vehicleId: 'v2',
            load: 0,
            stops: [],
          },
        ],
        unassigned: [],
      }

      const world: World = {
        vehicles: [
          { ...vehicles[0], status: 'failed' },
          { ...vehicles[1], status: 'active' },
        ],
        deliveries,
        matrix,
        vehicleFailures: [{ eventId: 'vf-travel', vehicleId: 'v1', at: 28 }],
      }

      const revised = replan(world, plan3Stops, 50)

      // 1. Completed stop before breakdown (d1) is preserved on v1
      const v1Route = revised.routes.find((r) => r.vehicleId === 'v1')!
      expect(v1Route.stops.map((s) => s.deliveryId)).toEqual(['d1'])
      expect(v1Route.stops[0].status).toBe('completed')
      expect(v1Route.load).toBe(10)

      // 2. Interrupted stop (d2, breakdown during travel) must NOT be completed on v1
      expect(v1Route.stops.some((s) => s.deliveryId === 'd2')).toBe(false)

      // 3. Future stop (d3) must NOT remain assigned to failed vehicle v1
      expect(v1Route.stops.some((s) => s.deliveryId === 'd3')).toBe(false)

      // 4. d2 and d3 must be reassigned to active vehicle v2
      const v2Route = revised.routes.find((r) => r.vehicleId === 'v2')!
      expect(v2Route.stops.map((s) => s.deliveryId)).toEqual(['d2', 'd3'])
      expect(revised.unassigned).toEqual([])
    })

    it('handles vehicle breakdown during service at customer location', () => {
      // v1 route: d1 (dep 20), d2 (arr 30, serviceStart 30, dep 40)
      // v1 breaks down at t=35 (arrived at 30, but service finishes at 40; 30 <= 35 < 40)
      // Replanning occurs at now = 50
      const planService: DeliveryPlan = {
        id: 'plan-service',
        label: 'Plan during service',
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

      const world: World = {
        vehicles: [
          { ...vehicles[0], status: 'failed' },
          { ...vehicles[1], status: 'active' },
        ],
        deliveries,
        matrix,
        vehicleFailures: [{ eventId: 'vf-service', vehicleId: 'v1', at: 35 }],
      }

      const revised = replan(world, planService, 50)

      // d1 finished at 20 <= 35 -> completed on v1
      const v1Route = revised.routes.find((r) => r.vehicleId === 'v1')!
      expect(v1Route.stops.map((s) => s.deliveryId)).toEqual(['d1'])
      expect(v1Route.stops[0].status).toBe('completed')

      // d2 broke down during service -> NOT completed on v1, reassigned to v2
      expect(v1Route.stops.some((s) => s.deliveryId === 'd2')).toBe(false)
      const v2Route = revised.routes.find((r) => r.vehicleId === 'v2')!
      expect(v2Route.stops.map((s) => s.deliveryId)).toContain('d2')
    })

    it('ensures interrupted delivery is not silently lost when no active vehicle can accept it', () => {
      // v1 breaks down at t=35 during service of d2.
      // v2 cannot accept d2 because v2 is already at max capacity (capacity 10, has d3 size 10).
      const fullV2: Vehicle[] = [
        { ...vehicles[0], status: 'failed' },
        { ...vehicles[1], capacity: 10, status: 'active' }, // capacity 10
      ]

      const plan: DeliveryPlan = {
        id: 'plan-stranded',
        label: 'Plan stranded',
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

      const world: World = {
        vehicles: fullV2,
        deliveries,
        matrix,
        vehicleFailures: [{ eventId: 'vf-stranded', vehicleId: 'v1', at: 35 }],
      }

      const revised = replan(world, plan, 50)

      // d1 is completed on v1
      const v1Route = revised.routes.find((r) => r.vehicleId === 'v1')!
      expect(v1Route.stops.map((s) => s.deliveryId)).toEqual(['d1'])

      // d2 is NOT completed on v1 and NOT silently lost: reported in unassigned with reason 'capacity'
      expect(v1Route.stops.some((s) => s.deliveryId === 'd2')).toBe(false)
      const unassignedD2 = revised.unassigned.find((u) => u.deliveryId === 'd2')
      expect(unassignedD2).toBeDefined()
      expect(unassignedD2?.reason).toBe('capacity')

      // comparePlans marks d2 as broken with truthful reason
      const cmp = comparePlans(plan, revised)
      expect(cmp.decisions['d2']).toBe('broken')
      expect(cmp.reasons['d2']).toContain('Unassigned in revised plan')
    })

    // ── Task 2: Real event-to-replanning regression via applyDisruption ──
    it('exercises end-to-end vehicle_failure via applyDisruption into replan', () => {
      const baseWorld: World = {
        vehicles: [
          { id: 'v1', name: 'Van 1', capacity: 40, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'active' },
          { id: 'v2', name: 'Van 2', capacity: 40, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'active' },
        ],
        deliveries,
        matrix,
      }

      // v1 breaks down at t=25 via real applyDisruption
      const failureEvent: VehicleFailureEvent = {
        type: 'vehicle_failure',
        id: 'evt-fail-v1',
        at: 25,
        vehicleId: 'v1',
      }
      const worldAfterFailure = applyDisruption(baseWorld, failureEvent)

      // Verify failure timestamp is recorded in world
      expect(worldAfterFailure.vehicleFailures).toBeDefined()
      expect(worldAfterFailure.vehicleFailures?.length).toBe(1)
      expect(worldAfterFailure.vehicleFailures?.[0].at).toBe(25)
      expect(worldAfterFailure.vehicles.find((v) => v.id === 'v1')?.status).toBe('failed')

      // Pass resulting world into replan at now=60 (well past d2's departure time 40)
      const revisedPlan = replan(worldAfterFailure, initialPlan, 60)

      // d1 (dep 20 <= 25) is completed on v1
      const v1Route = revisedPlan.routes.find((r) => r.vehicleId === 'v1')!
      expect(v1Route.stops.map((s) => s.deliveryId)).toEqual(['d1'])
      expect(v1Route.stops[0].status).toBe('completed')

      // d2 (scheduled dep 40 > 25) must NOT be completed on v1 and must be reassigned to v2
      expect(v1Route.stops.some((s) => s.deliveryId === 'd2')).toBe(false)
      const v2Route = revisedPlan.routes.find((r) => r.vehicleId === 'v2')!
      expect(v2Route.stops.map((s) => s.deliveryId)).toContain('d2')
      expect(revisedPlan.unassigned).toEqual([])
    })

    // ── Task 3: Truthful unassigned reason when no active vehicles remain ──
    it('truthfully reports no_vehicle rather than time_window when all vehicles are failed', () => {
      const allFailedWorld: World = {
        vehicles: [
          { id: 'v1', name: 'Van 1', capacity: 40, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'failed' },
          { id: 'v2', name: 'Van 2', capacity: 40, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'failed' },
        ],
        deliveries,
        matrix,
      }

      const emptyPlan: DeliveryPlan = { id: 'empty', label: 'empty', createdAt: 0, routes: [], unassigned: [] }
      const revised = replan(allFailedWorld, emptyPlan, 10)

      expect(revised.unassigned.length).toBe(deliveries.length)
      expect(revised.unassigned.every((u) => u.reason === 'no_vehicle')).toBe(true)
      expect(revised.unassigned[0].detail).toBe('No active vehicles available to assign delivery')
    })

    // ── Task 4: Route validation and travel matrix checks in replanning ──
    it('replanning rejects unreachable destinations missing from matrix as unassigned unreachable', () => {
      const unreachableWorld: World = {
        vehicles: [
          { id: 'v1', name: 'Van 1', capacity: 40, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'active' },
        ],
        deliveries: [
          { id: 'd-isolated', locationId: 'c-isolated', size: 10, serviceMin: 10, window: { start: 0, end: 480 }, priority: 'normal' },
        ],
        matrix: {
          depot: { depot: 0 },
          'c-isolated': {},
        },
      }
      const emptyPlan: DeliveryPlan = { id: 'empty', label: 'empty', createdAt: 0, routes: [], unassigned: [] }
      const revised = replan(unreachableWorld, emptyPlan, 10)

      expect(revised.routes[0].stops).toHaveLength(0)
      expect(revised.unassigned).toHaveLength(1)
      expect(revised.unassigned[0].deliveryId).toBe('d-isolated')
      expect(revised.unassigned[0].reason).toBe('unreachable')
    })

    // ── Task 5: Blocker classification consistency between replan and allocate ──
    it('mixed constraints in replanning: capacity on v1 and shift overrun on v2 classifies as time_window', () => {
      const mixedWorld: World = {
        vehicles: [
          { id: 'v1', name: 'Van 1', capacity: 5, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'active' },
          { id: 'v2', name: 'Van 2', capacity: 40, depotId: 'depot', shiftStart: 0, shiftEnd: 25, status: 'active' },
        ],
        deliveries: [
          { id: 'd-mixed', locationId: 'c1', size: 10, serviceMin: 20, window: { start: 0, end: 480 }, priority: 'normal' },
        ],
        matrix,
      }
      const emptyPlan: DeliveryPlan = { id: 'empty', label: 'empty', createdAt: 0, routes: [], unassigned: [] }
      const revised = replan(mixedWorld, emptyPlan, 0)

      expect(revised.unassigned).toHaveLength(1)
      expect(revised.unassigned[0].deliveryId).toBe('d-mixed')
      expect(revised.unassigned[0].reason).toBe('time_window')
    })

    it('capacity-only across all active vehicles in replanning classifies as capacity', () => {
      const capWorld: World = {
        vehicles: [
          { id: 'v1', name: 'Van 1', capacity: 5, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'active' },
          { id: 'v2', name: 'Van 2', capacity: 8, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'active' },
        ],
        deliveries: [
          { id: 'd-too-big', locationId: 'c1', size: 15, serviceMin: 10, window: { start: 0, end: 480 }, priority: 'normal' },
        ],
        matrix,
      }
      const emptyPlan: DeliveryPlan = { id: 'empty', label: 'empty', createdAt: 0, routes: [], unassigned: [] }
      const revised = replan(capWorld, emptyPlan, 0)

      expect(revised.unassigned).toHaveLength(1)
      expect(revised.unassigned[0].deliveryId).toBe('d-too-big')
      expect(revised.unassigned[0].reason).toBe('capacity')
    })
  })
})
