import { describe, it, expect } from 'vitest'
import type {
  Delivery,
  DeliveryPlan,
  RoadClosureEvent,
  RouteStop,
  TravelMatrix,
  UrgentDeliveryEvent,
  Vehicle,
  VehicleFailureEvent,
} from '../src/types'
import {
  World,
  CLOSED_MIN,
  DisruptionValidationError,
  buildMatrixAt,
  validateDisruptionEvent,
  applyDisruption,
  applyDisruptionBatch,
  analyseBreakdown,
  analyseRoadClosure,
  validateUrgentDelivery,
} from '../src/engine/disruptions'
import { vehicles as demoVehicles, deliveries as demoDeliveries, matrix as demoMatrix, locations as demoLocations } from '../src/data/demo'

describe('Disruptions Engine', () => {
  const baseWorld: World = {
    vehicles: [
      { id: 'v1', name: 'Van 1', capacity: 50, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'active' },
      { id: 'v2', name: 'Van 2', capacity: 50, depotId: 'depot', shiftStart: 10, shiftEnd: 480, status: 'active' },
    ],
    deliveries: [
      { id: 'd1', locationId: 'c1', size: 10, serviceMin: 10, window: { start: 0, end: 120 }, priority: 'normal' },
      { id: 'd2', locationId: 'c2', size: 15, serviceMin: 10, window: { start: 30, end: 180 }, priority: 'normal' },
      { id: 'd3', locationId: 'c3', size: 20, serviceMin: 10, window: { start: 60, end: 240 }, priority: 'normal' },
    ],
    matrix: {
      depot: { depot: 0, c1: 15, c2: 25, c3: 35 },
      c1: { depot: 15, c1: 0, c2: 12, c3: 20 },
      c2: { depot: 25, c1: 12, c2: 0, c3: 18 },
      c3: { depot: 35, c1: 20, c2: 18, c3: 0 },
    },
    locations: [
      { id: 'depot', name: 'Depot', kind: 'depot' },
      { id: 'c1', name: 'Customer 1', kind: 'customer' },
      { id: 'c2', name: 'Customer 2', kind: 'customer' },
      { id: 'c3', name: 'Customer 3', kind: 'customer' },
    ],
  }

  const samplePlan: DeliveryPlan = {
    id: 'plan-1',
    label: 'Test Plan',
    createdAt: 0,
    routes: [
      {
        vehicleId: 'v1',
        load: 45,
        stops: [
          { deliveryId: 'd1', locationId: 'c1', arrival: 15, serviceStart: 15, departure: 25, waitMin: 0, status: 'completed' },
          { deliveryId: 'd2', locationId: 'c2', arrival: 37, serviceStart: 37, departure: 47, waitMin: 0, status: 'pending' },
          { deliveryId: 'd3', locationId: 'c3', arrival: 65, serviceStart: 65, departure: 75, waitMin: 0, status: 'pending' },
        ],
      },
    ],
    unassigned: [],
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Vehicle breakdowns during travel and service
  // ───────────────────────────────────────────────────────────────────────────
  describe('1. Vehicle breakdowns', () => {
    it('correctly handles breakdown during travel (en route)', () => {
      // v1 departed c1 at 25, arrives c2 at 37. Failure occurs at t=30 (en route to c2)
      const event: VehicleFailureEvent = { type: 'vehicle_failure', id: 'fail-1', at: 30, vehicleId: 'v1' }
      const effect = analyseBreakdown(event, baseWorld, samplePlan)

      expect(effect.inProgressPhase).toBe('travel')
      expect(effect.inProgressStop?.deliveryId).toBe('d2')
      expect(effect.completedStops.map(s => s.deliveryId)).toEqual(['d1'])
      expect(effect.remainingStops.map(s => s.deliveryId)).toEqual(['d3'])
      expect(effect.affectedDeliveryIds).toEqual(['d2', 'd3'])
      // Last known location is departure point of current leg (c1)
      expect(effect.lastKnownLocationId).toBe('c1')
    })

    it('correctly handles breakdown during service at destination', () => {
      // v1 arrived c2 at 37, departs at 47. Failure occurs at t=42 (during service at c2)
      const event: VehicleFailureEvent = { type: 'vehicle_failure', id: 'fail-2', at: 42, vehicleId: 'v1' }
      const effect = analyseBreakdown(event, baseWorld, samplePlan)

      expect(effect.inProgressPhase).toBe('service')
      expect(effect.inProgressStop?.deliveryId).toBe('d2')
      // Delivery d2 is NOT completed because service has not finished
      expect(effect.completedStops.map(s => s.deliveryId)).toEqual(['d1'])
      expect(effect.remainingStops.map(s => s.deliveryId)).toEqual(['d3'])
      expect(effect.affectedDeliveryIds).toEqual(['d2', 'd3'])
      // Last known location is the stop itself
      expect(effect.lastKnownLocationId).toBe('c2')
    })

    it('marks stop completed only after full service has finished', () => {
      // Failure at t=47 exactly when d2 finishes departure
      const event: VehicleFailureEvent = { type: 'vehicle_failure', id: 'fail-3', at: 47, vehicleId: 'v1' }
      const effect = analyseBreakdown(event, baseWorld, samplePlan)

      expect(effect.completedStops.map(s => s.deliveryId)).toEqual(['d1', 'd2'])
      // d3 has not started yet (roadEntry is 47, arrival 65)
      expect(effect.inProgressStop?.deliveryId).toBe('d3')
      expect(effect.inProgressPhase).toBe('travel')
      expect(effect.remainingStops).toEqual([])
      expect(effect.affectedDeliveryIds).toEqual(['d3'])
    })

    it('enforces cutoff so all stops after non-completed stop remain pending', () => {
      // Failure before stop 1 arrives (at t=10, shiftStart=0, arrival=15)
      const event: VehicleFailureEvent = { type: 'vehicle_failure', id: 'fail-4', at: 10, vehicleId: 'v1' }
      const effect = analyseBreakdown(event, baseWorld, samplePlan)

      expect(effect.completedStops).toEqual([])
      expect(effect.inProgressStop?.deliveryId).toBe('d1')
      expect(effect.inProgressPhase).toBe('travel')
      expect(effect.remainingStops.map(s => s.deliveryId)).toEqual(['d2', 'd3'])
      expect(effect.affectedDeliveryIds).toEqual(['d1', 'd2', 'd3'])
      expect(effect.lastKnownLocationId).toBe('depot')
    })

    it('handles vehicle failing before starting its shift', () => {
      // v2 shiftStart is 10. Failure at t=5
      const planV2: DeliveryPlan = {
        id: 'plan-v2',
        label: 'V2 Plan',
        createdAt: 0,
        routes: [
          {
            vehicleId: 'v2',
            load: 10,
            stops: [{ deliveryId: 'd1', locationId: 'c1', arrival: 25, serviceStart: 25, departure: 35, waitMin: 0, status: 'pending' }],
          },
        ],
        unassigned: [],
      }
      const event: VehicleFailureEvent = { type: 'vehicle_failure', id: 'fail-5', at: 5, vehicleId: 'v2' }
      const effect = analyseBreakdown(event, baseWorld, planV2)

      expect(effect.completedStops).toEqual([])
      expect(effect.inProgressStop).toBeNull()
      expect(effect.inProgressPhase).toBeNull()
      expect(effect.remainingStops.map(s => s.deliveryId)).toEqual(['d1'])
      expect(effect.affectedDeliveryIds).toEqual(['d1'])
      expect(effect.lastKnownLocationId).toBe('depot')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Future events activation timing
  // ───────────────────────────────────────────────────────────────────────────
  describe('2. Future events activation', () => {
    it('defers events scheduled after now into future and does not mutate world', () => {
      const e1: VehicleFailureEvent = { type: 'vehicle_failure', id: 'ef1', at: 20, vehicleId: 'v1' }
      const e2: RoadClosureEvent = { type: 'road_closure', id: 'ef2', at: 60, from: 'c1', to: 'c2' }
      const e3: UrgentDeliveryEvent = {
        type: 'urgent_delivery',
        id: 'ef3',
        at: 80,
        delivery: { id: 'du1', locationId: 'c3', size: 5, serviceMin: 5, window: { start: 80, end: 150 }, priority: 'urgent' },
      }

      // now = 30: only e1 is eligible (at=20); e2 and e3 are in the future
      const res = applyDisruptionBatch(baseWorld, [e1, e2, e3], 30)

      expect(res.applied.map(e => e.id)).toEqual(['ef1'])
      expect(res.future.map(e => e.id)).toEqual(['ef2', 'ef3'])
      expect(res.rejected).toEqual([])
      expect(res.skipped).toEqual([])

      // Check world mutations: v1 failed, but no closure registered and du1 not added
      expect(res.world.vehicles.find(v => v.id === 'v1')?.status).toBe('failed')
      expect(res.world.activeClosures ?? []).toEqual([])
      expect(res.world.deliveries.find(d => d.id === 'du1')).toBeUndefined()

      // Later simulation step: now advances to 70. Re-submitting future events
      const res2 = applyDisruptionBatch(res.world, res.future, 70)
      expect(res2.applied.map(e => e.id)).toEqual(['ef2'])
      expect(res2.future.map(e => e.id)).toEqual(['ef3'])
      expect(res2.world.activeClosures?.length).toBe(1)
      expect(res2.world.activeClosures?.[0].eventId).toBe('ef2')
    })

    it('processes all events immediately when now is omitted (backward compatibility)', () => {
      const e1: VehicleFailureEvent = { type: 'vehicle_failure', id: 'ef1', at: 20, vehicleId: 'v1' }
      const e2: RoadClosureEvent = { type: 'road_closure', id: 'ef2', at: 100, from: 'c1', to: 'c2' }

      const res = applyDisruptionBatch(baseWorld, [e1, e2]) // now omitted

      expect(res.applied.map(e => e.id)).toEqual(['ef1', 'ef2'])
      expect(res.future).toEqual([])
      expect(res.world.vehicles.find(v => v.id === 'v1')?.status).toBe('failed')
      expect(res.world.activeClosures?.length).toBe(1)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Overlapping road closures & baseline preservation
  // ───────────────────────────────────────────────────────────────────────────
  describe('3. Overlapping road closures', () => {
    it('preserves baseline travel times and keeps road closed under multiple closures', () => {
      const baselineForward = baseWorld.matrix.c1.c2 // 12
      const baselineBackward = baseWorld.matrix.c2.c1 // 12

      const closure1: RoadClosureEvent = { type: 'road_closure', id: 'rc-1', at: 20, from: 'c1', to: 'c2' }
      const closure2: RoadClosureEvent = { type: 'road_closure', id: 'rc-2', at: 40, from: 'c1', to: 'c2' }

      const w1 = applyDisruption(baseWorld, closure1)
      const w2 = applyDisruption(w1, closure2)

      expect(w2.activeClosures?.length).toBe(2)
      // Both closures must store the true baseline travel times, NOT CLOSED_MIN
      expect(w2.activeClosures?.[0].originalForward).toBe(baselineForward)
      expect(w2.activeClosures?.[0].originalBackward).toBe(baselineBackward)
      expect(w2.activeClosures?.[1].originalForward).toBe(baselineForward)
      expect(w2.activeClosures?.[1].originalBackward).toBe(baselineBackward)

      // Baseline matrix must never be mutated
      expect(w2.matrix.c1.c2).toBe(baselineForward)

      // Before closure 1 (now = 10): road open
      const mAt10 = buildMatrixAt(w2, 10)
      expect(mAt10.c1.c2).toBe(baselineForward)

      // During closure 1, before closure 2 (now = 30): road closed
      const mAt30 = buildMatrixAt(w2, 30)
      expect(mAt30.c1.c2).toBe(CLOSED_MIN)
      expect(mAt30.c2.c1).toBe(CLOSED_MIN)

      // During both closures (now = 50): road closed
      const mAt50 = buildMatrixAt(w2, 50)
      expect(mAt50.c1.c2).toBe(CLOSED_MIN)
    })

    it('identifies in-transit vs blocked vehicles with analyseRoadClosure', () => {
      const closure: RoadClosureEvent = { type: 'road_closure', id: 'rc-transit', at: 20, from: 'c1', to: 'c2' }
      // In samplePlan, stop 2 (c2) leg starts from c1 at departure 25.
      // Closure starts at 20. Road entry (25) is >= closureStart (20) -> vehicle is blocked (alreadyOnRoad = false)
      const analysis = analyseRoadClosure(closure, baseWorld, samplePlan)
      expect(analysis.affectedRoutes.length).toBe(1)
      expect(analysis.affectedRoutes[0].blockedStops[0].alreadyOnRoad).toBe(false)
      expect(analysis.affectedRoutes[0].blockedStops[0].stop.deliveryId).toBe('d2')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 4. Idempotency & conflict handling
  // ───────────────────────────────────────────────────────────────────────────
  describe('4. Idempotency and conflict handling', () => {
    it('allows identical event replay without side effects or errors', () => {
      const urgent: UrgentDeliveryEvent = {
        type: 'urgent_delivery',
        id: 'u-replay',
        at: 10,
        delivery: { id: 'du-rep', locationId: 'c1', size: 5, serviceMin: 5, window: { start: 10, end: 100 }, priority: 'urgent' },
      }

      const w1 = applyDisruption(baseWorld, urgent)
      expect(w1.deliveries.length).toBe(baseWorld.deliveries.length + 1)

      // Replay exact same event
      const w2 = applyDisruption(w1, urgent)
      expect(w2).toBe(w1) // exactly same instance returned

      // Batch with duplicate identical event
      const batchRes = applyDisruptionBatch(w1, [urgent])
      expect(batchRes.skipped).toContain('u-replay')
      expect(batchRes.rejected).toEqual([])
    })

    it('rejects conflicting urgent delivery carrying different data', () => {
      const urgent: UrgentDeliveryEvent = {
        type: 'urgent_delivery',
        id: 'u-conf-1',
        at: 10,
        delivery: { id: 'du-conf', locationId: 'c1', size: 5, serviceMin: 5, window: { start: 10, end: 100 }, priority: 'urgent' },
      }
      const w1 = applyDisruption(baseWorld, urgent)

      // Conflicting delivery with same delivery.id but different size
      const conflictingUrgent: UrgentDeliveryEvent = {
        type: 'urgent_delivery',
        id: 'u-conf-2',
        at: 15,
        delivery: { id: 'du-conf', locationId: 'c1', size: 10, serviceMin: 5, window: { start: 10, end: 100 }, priority: 'urgent' },
      }

      expect(() => applyDisruption(w1, conflictingUrgent)).toThrow(DisruptionValidationError)
      expect(() => validateDisruptionEvent(conflictingUrgent, w1)).toThrow(DisruptionValidationError)
    })

    it('rejects conflicting event ID carrying different data within a batch', () => {
      const e1: RoadClosureEvent = { type: 'road_closure', id: 'same-id', at: 10, from: 'c1', to: 'c2' }
      const e2: RoadClosureEvent = { type: 'road_closure', id: 'same-id', at: 10, from: 'c2', to: 'c3' }

      const res = applyDisruptionBatch(baseWorld, [e1, e2])
      expect(res.applied.map(e => e.id)).toEqual(['same-id'])
      expect(res.rejected.length).toBe(1)
      expect(res.rejected[0].reason).toContain("Conflicting event id 'same-id'")
    })

    it('rejects conflicting road closure with same event ID but different coordinates in applyDisruption', () => {
      const e1: RoadClosureEvent = { type: 'road_closure', id: 'rc-conf', at: 10, from: 'c1', to: 'c2' }
      const w1 = applyDisruption(baseWorld, e1)

      const e2: RoadClosureEvent = { type: 'road_closure', id: 'rc-conf', at: 10, from: 'c1', to: 'c3' }
      expect(() => applyDisruption(w1, e2)).toThrow(DisruptionValidationError)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 5. Event validation gates
  // ───────────────────────────────────────────────────────────────────────────
  describe('5. Event validation', () => {
    it('rejects invalid timestamps', () => {
      const negativeAt: VehicleFailureEvent = { type: 'vehicle_failure', id: 'e-neg', at: -1, vehicleId: 'v1' }
      expect(() => validateDisruptionEvent(negativeAt, baseWorld)).toThrow(DisruptionValidationError)

      const nanAt: VehicleFailureEvent = { type: 'vehicle_failure', id: 'e-nan', at: NaN, vehicleId: 'v1' }
      expect(() => validateDisruptionEvent(nanAt, baseWorld)).toThrow(DisruptionValidationError)
    })

    it('rejects unknown vehicle IDs', () => {
      const unknownV: VehicleFailureEvent = { type: 'vehicle_failure', id: 'e-uv', at: 10, vehicleId: 'unknown-v99' }
      expect(() => validateDisruptionEvent(unknownV, baseWorld)).toThrow(DisruptionValidationError)
    })

    it('rejects unknown location IDs when locations list is present', () => {
      const unknownLoc: RoadClosureEvent = { type: 'road_closure', id: 'e-ul', at: 10, from: 'c1', to: 'unknown-loc' }
      expect(() => validateDisruptionEvent(unknownLoc, baseWorld)).toThrow(DisruptionValidationError)
    })

    it('rejects closure between identical locations', () => {
      const loopClosure: RoadClosureEvent = { type: 'road_closure', id: 'e-loop', at: 10, from: 'c1', to: 'c1' }
      expect(() => validateDisruptionEvent(loopClosure, baseWorld)).toThrow(DisruptionValidationError)
    })

    it('rejects missing or empty event IDs', () => {
      const emptyId: VehicleFailureEvent = { type: 'vehicle_failure', id: '   ', at: 10, vehicleId: 'v1' }
      expect(() => validateDisruptionEvent(emptyId, baseWorld)).toThrow(DisruptionValidationError)
    })

    it('rejects invalid urgent delivery payload', () => {
      const badWindow: UrgentDeliveryEvent = {
        type: 'urgent_delivery',
        id: 'u-bad-win',
        at: 10,
        delivery: { id: 'd-bad', locationId: 'c1', size: 5, serviceMin: 5, window: { start: 100, end: 50 }, priority: 'urgent' },
      }
      expect(() => validateDisruptionEvent(badWindow, baseWorld)).toThrow(DisruptionValidationError)

      const badSize: UrgentDeliveryEvent = {
        type: 'urgent_delivery',
        id: 'u-bad-size',
        at: 10,
        delivery: { id: 'd-bad-s', locationId: 'c1', size: 0, serviceMin: 5, window: { start: 50, end: 100 }, priority: 'urgent' },
      }
      expect(() => validateDisruptionEvent(badSize, baseWorld)).toThrow(DisruptionValidationError)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────
  // 6. Integration and Demo compatibility
  // ───────────────────────────────────────────────────────────────────────────
  describe('6. Integration with demo data and caller contracts', () => {
    it('works seamlessly with demo world', () => {
      const demoWorld: World = {
        vehicles: demoVehicles,
        deliveries: demoDeliveries,
        matrix: demoMatrix,
        locations: demoLocations,
      }

      const urgent: UrgentDeliveryEvent = {
        type: 'urgent_delivery',
        id: 'evt-urgent-demo',
        at: 50,
        delivery: { id: 'demo-urgent-1', locationId: 'c2', size: 10, serviceMin: 10, window: { start: 60, end: 120 }, priority: 'urgent' },
      }

      const validated = validateUrgentDelivery(urgent, demoWorld)
      expect(validated.delivery.priority).toBe('urgent')

      const updatedWorld = applyDisruption(demoWorld, urgent)
      expect(updatedWorld.deliveries.length).toBe(demoDeliveries.length + 1)
      expect(updatedWorld.deliveries.find(d => d.id === 'demo-urgent-1')).toBeDefined()
    })
  })
})
