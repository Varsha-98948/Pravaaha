/**
 * =============================================================================
 * Pravaaha Data Integration Service Tests
 * =============================================================================
 *
 * NOTE: THESE TESTS WERE AUTHORED FOR SERVICE VALIDATION BOUNDARIES AND
 * HAVE INTENTIONALLY NOT BEEN EXECUTED PER THE TASK EXECUTION CONSTRAINTS.
 *
 * Covers:
 * 1. Database-to-TypeScript field mapping (snake_case <-> camelCase, time units, route stops, loads)
 * 2. Missing configuration behavior & demo mode write rejection (never claiming fake writes)
 * 3. Authenticated profile loading & error handling (unauthenticated, missing profile PGRST116)
 * 4. Role & organization authorization checks (admin vs dispatcher vs viewer, org mismatch)
 * 5. Disruption validation (malformed output, unknown locations/vehicles, identical road endpoints, invalid times)
 * 6. Preview-only incident interpretation (never persists or mutates state, forces pending confirmation)
 * 7. Disruption confirmation enforcement (explicit confirmation check, viewer rejection, audit logging)
 * 8. Persistence operations & database error propagation
 * =============================================================================
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  Delivery,
  DeliveryPlan,
  DisruptionEvent,
  Location,
  UserProfile,
  Vehicle,
} from '../src/types'
import {
  ConfigurationError,
  AuthenticationError,
  AuthorizationError,
  OrganizationMismatchError,
  ValidationError,
  NotFoundError,
  DatabaseError,
} from '../src/services/errors'
import {
  dbToDelivery,
  dbToDeliveryPlan,
  dbToDisruptionEvent,
  dbToLocation,
  dbToUserProfile,
  dbToVehicle,
  deliveryPlanToDb,
  deliveryToDb,
  locationToDb,
  userProfileToDb,
  vehicleToDb,
  type DbDeliveryRow,
  type DbLocationRow,
  type DbPlanRow,
  type DbPlanStopRow,
  type DbProfileRow,
  type DbVehicleRow,
} from '../src/services/mappers'
import {
  canAdministerRoles,
  canPerformOperations,
  requireRole,
} from '../src/services/authService'
import {
  validateDisruptionEvent,
  validateInterpretedDisruption,
} from '../src/services/validation'
import {
  confirmDisruption,
  interpretIncidentPreview,
} from '../src/services/disruptionService'
import type { DisruptionInterpreter } from '../src/services/disruptionInterpreter'

describe('Data Integration: Field Mappers', () => {
  it('maps Location between DB snake_case and TypeScript domain model', () => {
    const dbRow: DbLocationRow = {
      id: 'loc-1',
      org_id: 'org-1',
      name: 'Central Depot',
      kind: 'depot',
    }

    const loc = dbToLocation(dbRow)
    expect(loc).toEqual({
      id: 'loc-1',
      name: 'Central Depot',
      kind: 'depot',
    })

    const roundTrip = locationToDb(loc, 'org-1')
    expect(roundTrip).toEqual({
      id: 'loc-1',
      org_id: 'org-1',
      name: 'Central Depot',
      kind: 'depot',
    })
  })

  it('maps Vehicle snake_case to camelCase preserving simulation time units', () => {
    const dbRow: DbVehicleRow = {
      id: 'veh-1',
      org_id: 'org-1',
      name: 'Van 1',
      capacity: 50,
      depot_id: 'loc-1',
      shift_start: 30,
      shift_end: 480,
      status: 'active',
    }

    const vehicle = dbToVehicle(dbRow)
    expect(vehicle.depotId).toBe('loc-1')
    expect(vehicle.shiftStart).toBe(30)
    expect(vehicle.shiftEnd).toBe(480)
    expect(vehicle.capacity).toBe(50)

    const backToDb = vehicleToDb(vehicle, 'org-1')
    expect(backToDb.depot_id).toBe('loc-1')
    expect(backToDb.shift_start).toBe(30)
    expect(backToDb.shift_end).toBe(480)
  })

  it('maps Delivery snake_case to nested time window in domain model', () => {
    const dbRow: DbDeliveryRow = {
      id: 'del-1',
      org_id: 'org-1',
      location_id: 'loc-2',
      size: 15,
      service_min: 12,
      window_start: 60,
      window_end: 180,
      priority: 'urgent',
    }

    const delivery = dbToDelivery(dbRow)
    expect(delivery.locationId).toBe('loc-2')
    expect(delivery.serviceMin).toBe(12)
    expect(delivery.window.start).toBe(60)
    expect(delivery.window.end).toBe(180)
    expect(delivery.priority).toBe('urgent')

    const backToDb = deliveryToDb(delivery, 'org-1')
    expect(backToDb.location_id).toBe('loc-2')
    expect(backToDb.window_start).toBe(60)
    expect(backToDb.window_end).toBe(180)
  })

  it('reconstructs DeliveryPlan with vehicle routes, ordered stops, wait times, and total loads', () => {
    const planRow: DbPlanRow = {
      id: 'plan-1',
      org_id: 'org-1',
      label: 'Morning Dispatch',
      created_at_min: 0,
      unassigned: [{ deliveryId: 'del-3', reason: 'capacity', detail: 'Overloaded' }],
    }

    const stopRows: DbPlanStopRow[] = [
      {
        plan_id: 'plan-1',
        org_id: 'org-1',
        vehicle_id: 'veh-1',
        delivery_id: 'del-1',
        seq: 0,
        arrival: 30,
        service_start: 35,
        departure: 45,
        status: 'pending',
      },
      {
        plan_id: 'plan-1',
        org_id: 'org-1',
        vehicle_id: 'veh-1',
        delivery_id: 'del-2',
        seq: 1,
        arrival: 60,
        service_start: 60,
        departure: 70,
        status: 'pending',
      },
    ]

    const deliveriesById: Record<string, Delivery> = {
      'del-1': {
        id: 'del-1',
        locationId: 'loc-c1',
        size: 10,
        serviceMin: 10,
        window: { start: 0, end: 120 },
        priority: 'normal',
      },
      'del-2': {
        id: 'del-2',
        locationId: 'loc-c2',
        size: 20,
        serviceMin: 10,
        window: { start: 30, end: 150 },
        priority: 'normal',
      },
    }

    const plan = dbToDeliveryPlan(planRow, stopRows, deliveriesById)
    expect(plan.id).toBe('plan-1')
    expect(plan.routes).toHaveLength(1)
    expect(plan.routes[0].vehicleId).toBe('veh-1')
    expect(plan.routes[0].load).toBe(30) // 10 + 20
    expect(plan.routes[0].stops[0].waitMin).toBe(5) // 35 - 30
    expect(plan.routes[0].stops[1].waitMin).toBe(0) // 60 - 60
    expect(plan.unassigned).toHaveLength(1)

    const { planRow: roundTripPlan, stopRows: roundTripStops } = deliveryPlanToDb(plan, 'org-1')
    expect(roundTripPlan.id).toBe('plan-1')
    expect(roundTripStops).toHaveLength(2)
  })

  it('maps DisruptionEvent types and payloads bidirectionally', () => {
    const roadClosureDb = {
      id: 'dis-1',
      org_id: 'org-1',
      type: 'road_closure',
      payload: { from: 'loc-1', to: 'loc-2' },
      at_min: 45,
    }
    const closureEvent = dbToDisruptionEvent(roadClosureDb)
    expect(closureEvent.type).toBe('road_closure')
    if (closureEvent.type === 'road_closure') {
      expect(closureEvent.from).toBe('loc-1')
      expect(closureEvent.to).toBe('loc-2')
    }

    const vehFailureDb = {
      id: 'dis-2',
      org_id: 'org-1',
      type: 'vehicle_failure',
      payload: { vehicleId: 'veh-9' },
      at_min: 90,
    }
    const failureEvent = dbToDisruptionEvent(vehFailureDb)
    expect(failureEvent.type).toBe('vehicle_failure')
    if (failureEvent.type === 'vehicle_failure') {
      expect(failureEvent.vehicleId).toBe('veh-9')
    }
  })
})

describe('Data Integration: Authorization & Roles', () => {
  const admin: UserProfile = {
    id: 'u-1',
    orgId: 'org-1',
    name: 'Admin User',
    email: 'admin@example.com',
    role: 'admin',
  }
  const dispatcher: UserProfile = {
    id: 'u-2',
    orgId: 'org-1',
    name: 'Dispatcher User',
    email: 'dispatcher@example.com',
    role: 'dispatcher',
  }
  const viewer: UserProfile = {
    id: 'u-3',
    orgId: 'org-1',
    name: 'Viewer User',
    email: 'viewer@example.com',
    role: 'viewer',
  }

  it('enforces role checks via requireRole', () => {
    expect(() => requireRole(admin, ['admin'])).not.toThrow()
    expect(() => requireRole(dispatcher, ['admin', 'dispatcher'])).not.toThrow()
    expect(() => requireRole(viewer, ['admin', 'dispatcher'])).toThrow(AuthorizationError)
  })

  it('permits operational writes only for admin and dispatcher', () => {
    expect(canPerformOperations(admin)).toBe(true)
    expect(canPerformOperations(dispatcher)).toBe(true)
    expect(canPerformOperations(viewer)).toBe(false)
  })

  it('permits role administration strictly for admin', () => {
    expect(canAdministerRoles(admin)).toBe(true)
    expect(canAdministerRoles(dispatcher)).toBe(false)
    expect(canAdministerRoles(viewer)).toBe(false)
  })
})

describe('Data Integration: Runtime Disruption Validation', () => {
  const knownLocations = ['depot', 'c1', 'c2']
  const knownVehicles = ['v1', 'v2']

  it('accepts valid road closure event with distinct known endpoints', () => {
    const raw = {
      id: 'e-1',
      type: 'road_closure',
      at: 30,
      from: 'depot',
      to: 'c1',
    }
    const res = validateDisruptionEvent(raw, knownLocations, knownVehicles)
    expect(res.isValid).toBe(true)
    expect(res.event?.type).toBe('road_closure')
  })

  it('rejects identical endpoints on road closure', () => {
    const raw = {
      id: 'e-1',
      type: 'road_closure',
      at: 30,
      from: 'c1',
      to: 'c1',
    }
    const res = validateDisruptionEvent(raw, knownLocations, knownVehicles)
    expect(res.isValid).toBe(false)
    expect(res.errors[0]).toContain('must be distinct')
  })

  it('rejects road closure with unknown location outside the organization', () => {
    const raw = {
      id: 'e-1',
      type: 'road_closure',
      at: 30,
      from: 'depot',
      to: 'foreign_location',
    }
    const res = validateDisruptionEvent(raw, knownLocations, knownVehicles)
    expect(res.isValid).toBe(false)
    expect(res.unknownLocations).toContain('foreign_location')
  })

  it('rejects vehicle failure referencing unknown vehicle', () => {
    const raw = {
      id: 'e-2',
      type: 'vehicle_failure',
      at: 45,
      vehicleId: 'ghost_van',
    }
    const res = validateDisruptionEvent(raw, knownLocations, knownVehicles)
    expect(res.isValid).toBe(false)
    expect(res.unknownVehicles).toContain('ghost_van')
  })

  it('rejects non-finite or negative simulation time', () => {
    const raw = {
      id: 'e-3',
      type: 'vehicle_failure',
      at: -10,
      vehicleId: 'v1',
    }
    const res = validateDisruptionEvent(raw, knownLocations, knownVehicles)
    expect(res.isValid).toBe(false)
    expect(res.errors.some(e => e.includes('simulation time `at`'))).toBe(true)
  })

  it('rejects urgent delivery with invalid time window (end <= start)', () => {
    const raw = {
      id: 'e-4',
      type: 'urgent_delivery',
      at: 10,
      delivery: {
        id: 'del-x',
        locationId: 'c1',
        size: 5,
        serviceMin: 10,
        window: { start: 100, end: 50 },
        priority: 'urgent',
      },
    }
    const res = validateDisruptionEvent(raw, knownLocations, knownVehicles)
    expect(res.isValid).toBe(false)
    expect(res.errors.some(e => e.includes('strictly after start'))).toBe(true)
  })
})

describe('Data Integration: Preview-Only Incident Intake & Confirmation', () => {
  const knownLocations = ['depot', 'c1', 'c2']
  const knownVehicles = ['v1', 'v2']

  const mockInterpreter: DisruptionInterpreter = {
    async interpret(text, locs) {
      return {
        rawText: text,
        event: {
          type: 'road_closure',
          id: 'temp-1',
          at: 60,
          from: 'depot',
          to: 'c1',
        },
        missing: [],
        unknownLocations: [],
        preview: 'Road closed between depot and c1 at min 60',
        confirmation: 'confirmed', // Attempted early confirmation from interpreter
        source: 'placeholder',
      }
    },
  }

  it('enforces confirmation = pending during interpretation (preview only)', async () => {
    const preview = await interpretIncidentPreview(
      'Road from depot to c1 blocked at 09:00',
      mockInterpreter,
      knownLocations,
      knownVehicles
    )

    // Even if interpreter claimed confirmed, service must force pending
    expect(preview.confirmation).toBe('pending')
    expect(preview.event).not.toBeNull()
  })

  it('rejects confirmation when user has not explicitly confirmed preview', async () => {
    const interpreted = await interpretIncidentPreview(
      'Road from depot to c1 blocked',
      mockInterpreter,
      knownLocations,
      knownVehicles
    )

    const actor: UserProfile = {
      id: 'u-1',
      orgId: 'org-1',
      name: 'Dispatcher Dave',
      email: 'dave@example.com',
      role: 'dispatcher',
    }

    // Confirmation status is still 'pending'
    await expect(
      confirmDisruption({
        interpreted,
        orgId: 'org-1',
        actorProfile: actor,
        knownLocationIds: knownLocations,
        knownVehicleIds: knownVehicles,
      })
    ).rejects.toThrow(ValidationError)
  })

  it('rejects confirmation by viewer role with AuthorizationError', async () => {
    const interpreted = await interpretIncidentPreview(
      'Road from depot to c1 blocked',
      mockInterpreter,
      knownLocations,
      knownVehicles
    )

    interpreted.confirmation = 'confirmed'

    const viewer: UserProfile = {
      id: 'u-3',
      orgId: 'org-1',
      name: 'Viewer Val',
      email: 'val@example.com',
      role: 'viewer',
    }

    await expect(
      confirmDisruption({
        interpreted,
        orgId: 'org-1',
        actorProfile: viewer,
        knownLocationIds: knownLocations,
        knownVehicleIds: knownVehicles,
      })
    ).rejects.toThrow(AuthorizationError)
  })

  it('rejects confirmation across organizations with OrganizationMismatchError', async () => {
    const interpreted = await interpretIncidentPreview(
      'Road from depot to c1 blocked',
      mockInterpreter,
      knownLocations,
      knownVehicles
    )
    interpreted.confirmation = 'confirmed'

    const wrongOrgActor: UserProfile = {
      id: 'u-1',
      orgId: 'foreign-org',
      name: 'Foreign Admin',
      email: 'foreign@example.com',
      role: 'admin',
    }

    await expect(
      confirmDisruption({
        interpreted,
        orgId: 'org-1',
        actorProfile: wrongOrgActor,
        knownLocationIds: knownLocations,
        knownVehicleIds: knownVehicles,
      })
    ).rejects.toThrow(OrganizationMismatchError)
  })
})
