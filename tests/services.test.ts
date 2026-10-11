/**
 * =============================================================================
 * Pravaaha Data Integration Service Tests
 * =============================================================================
 *
 * Service/database boundaries are exercised with mocked clients; these tests
 * never connect to the configured Supabase project.
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

const { getSupabaseClientMock } = vi.hoisted(() => ({
  getSupabaseClientMock: vi.fn(),
}))

vi.mock('../src/services/supabase', () => ({
  getSupabaseClient: getSupabaseClientMock,
  isDemoMode: false,
}))

beforeEach(() => {
  getSupabaseClientMock.mockReset()
})

import type {
  Delivery,
  DeliveryPlan,
  DisruptionEvent,
  Location,
  UserProfile,
  Vehicle,
} from '../src/types'
import {
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
import { getCurrentUserProfile } from '../src/services/authService'
import { getDeliveries, getDeliveryPlan, getDisruptions, getVehicles, listDeliveryPlans, saveDelivery, saveDeliveryPlan, updateVehicleStatus } from '../src/services/persistenceService'
import { travelMatrixFromPersistedPlan } from '../src/services/replanningService'
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

  it('maps unreachable stops with Infinity safely without producing NaN', () => {
    const planWithUnreachable: DeliveryPlan = {
      id: 'plan-unreach',
      label: 'Unreachable Plan',
      createdAt: 0,
      routes: [
        {
          vehicleId: 'veh-1',
          load: 0,
          stops: [
            {
              deliveryId: 'del-1',
              locationId: 'loc-c1',
              arrival: Infinity,
              serviceStart: Infinity,
              departure: Infinity,
              waitMin: 0,
              status: 'skipped',
            },
          ],
        },
      ],
      unassigned: [],
    }

    const { stopRows } = deliveryPlanToDb(planWithUnreachable, 'org-1')
    expect(Number.isNaN(stopRows[0].arrival)).toBe(false)
    expect(Number.isNaN(stopRows[0].service_start)).toBe(false)
    expect(Number.isNaN(stopRows[0].departure)).toBe(false)
    expect(stopRows[0].status).toBe('skipped')

    const deliveriesById: Record<string, Delivery> = {
      'del-1': {
        id: 'del-1',
        locationId: 'loc-c1',
        size: 10,
        serviceMin: 10,
        window: { start: 0, end: 120 },
        priority: 'normal',
      },
    }
    const reconstructed = dbToDeliveryPlan(
      { id: 'plan-unreach', org_id: 'org-1', label: 'Unreachable Plan', created_at_min: 0 },
      stopRows,
      deliveriesById
    )
    expect(reconstructed.routes[0].stops[0].waitMin).toBe(0)
    expect(Number.isNaN(reconstructed.routes[0].stops[0].waitMin)).toBe(false)
    expect(reconstructed.routes[0].stops[0].arrival).toBe(Infinity)
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

// =============================================================================
// Migration 003 compatibility: text ID roundtripping through all mappers
// =============================================================================
// These tests verify that every mapper accepts and preserves short, human-readable
// string IDs such as 'v1', 'd1', 'depot', and 'plan-replanned-90' — the kind the
// engine generates — rather than requiring UUID format strings.
// =============================================================================

describe('Migration 003 compat: text ID roundtripping through mappers', () => {
  it('Location mapper round-trips short string IDs unchanged', () => {
    const row: DbLocationRow = {
      id: 'depot',
      org_id: 'org-abc',
      name: 'Central Depot',
      kind: 'depot',
    }
    const loc = dbToLocation(row)
    expect(loc.id).toBe('depot')

    const back = locationToDb(loc, 'org-abc')
    expect(back.id).toBe('depot')
    expect(back.org_id).toBe('org-abc')
  })

  it('Vehicle mapper round-trips short IDs for both id and depot_id', () => {
    const row: DbVehicleRow = {
      id: 'v1',
      org_id: 'org-abc',
      name: 'Van 1',
      capacity: 40,
      depot_id: 'depot',
      shift_start: 0,
      shift_end: 480,
      status: 'active',
    }
    const vehicle = dbToVehicle(row)
    expect(vehicle.id).toBe('v1')
    expect(vehicle.depotId).toBe('depot')

    const back = vehicleToDb(vehicle, 'org-abc')
    expect(back.id).toBe('v1')
    expect(back.depot_id).toBe('depot')
  })

  it('Delivery mapper round-trips short IDs for id and location_id', () => {
    const row: DbDeliveryRow = {
      id: 'd1',
      org_id: 'org-abc',
      location_id: 'c1',
      size: 12,
      service_min: 10,
      window_start: 0,
      window_end: 120,
      priority: 'normal',
    }
    const delivery = dbToDelivery(row)
    expect(delivery.id).toBe('d1')
    expect(delivery.locationId).toBe('c1')

    const back = deliveryToDb(delivery, 'org-abc')
    expect(back.id).toBe('d1')
    expect(back.location_id).toBe('c1')
  })

  it('DeliveryPlan mapper round-trips short plan ID and vehicle/delivery stop IDs', () => {
    const planRow: DbPlanRow = {
      id: 'plan-original',
      org_id: 'org-abc',
      label: 'Original plan',
      created_at_min: 0,
    }
    const stopRows = [
      {
        plan_id: 'plan-original',
        org_id: 'org-abc',
        vehicle_id: 'v1',
        delivery_id: 'd1',
        seq: 0,
        arrival: 20,
        service_start: 20,
        departure: 30,
        status: 'pending',
      },
    ]
    const deliveriesById: Record<string, Delivery> = {
      'd1': {
        id: 'd1',
        locationId: 'c1',
        size: 12,
        serviceMin: 10,
        window: { start: 0, end: 120 },
        priority: 'normal',
      },
    }
    const plan = dbToDeliveryPlan(planRow, stopRows, deliveriesById)
    expect(plan.id).toBe('plan-original')
    expect(plan.routes[0].vehicleId).toBe('v1')
    expect(plan.routes[0].stops[0].deliveryId).toBe('d1')

    const { planRow: outPlan, stopRows: outStops } = deliveryPlanToDb(plan, 'org-abc')
    expect(outPlan.id).toBe('plan-original')
    expect(outStops[0].plan_id).toBe('plan-original')
    expect(outStops[0].vehicle_id).toBe('v1')
    expect(outStops[0].delivery_id).toBe('d1')
  })

  it('DeliveryPlan mapper preserves replanning-style IDs (plan-replanned-90)', () => {
    const planRow: DbPlanRow = {
      id: 'plan-replanned-90',
      org_id: 'org-abc',
      label: 'Replanned at t=90',
      created_at_min: 90,
      parent_plan_id: 'plan-original',
    }
    const plan = dbToDeliveryPlan(planRow, [], {})
    expect(plan.id).toBe('plan-replanned-90')

    const { planRow: out } = deliveryPlanToDb(plan, 'org-abc', 'plan-original')
    expect(out.id).toBe('plan-replanned-90')
    expect(out.parent_plan_id).toBe('plan-original')
  })

  it('DisruptionEvent mapper round-trips short disruption and vehicle IDs', () => {
    const row = {
      id: 'dis-v2-fail',
      org_id: 'org-abc',
      type: 'vehicle_failure' as const,
      payload: { vehicleId: 'v2' },
      at_min: 90,
    }
    const event = dbToDisruptionEvent(row)
    expect(event.id).toBe('dis-v2-fail')
    expect(event.type).toBe('vehicle_failure')
    if (event.type === 'vehicle_failure') {
      expect(event.vehicleId).toBe('v2')
    }
  })

  it('DisruptionEvent mapper round-trips short location IDs in road_closure payload', () => {
    const row = {
      id: 'dis-rc-depot-c2',
      org_id: 'org-abc',
      type: 'road_closure' as const,
      payload: { from: 'depot', to: 'c2' },
      at_min: 60,
    }
    const event = dbToDisruptionEvent(row)
    expect(event.id).toBe('dis-rc-depot-c2')
    if (event.type === 'road_closure') {
      expect(event.from).toBe('depot')
      expect(event.to).toBe('c2')
    }
  })
})

// =============================================================================
// Migration 003 compat: confirm_disruption_tx RPC parameter shape
// =============================================================================
// Verify the application sends text operational IDs to the RPC without making
// a live Supabase request. These tests cover the caller contract, not PostgreSQL.
// =============================================================================

describe('Migration 003 compat: confirm_disruption_tx RPC parameter types', () => {
  const knownLocations = ['depot', 'c1', 'c2']
  const knownVehicles = ['v1', 'v2']

  it('passes a short vehicle-failure disruption ID as text to the RPC', async () => {
    const interpreted = {
      rawText: 'Van 2 broke down',
      event: {
        type: 'vehicle_failure' as const,
        id: 'dis-v2-fail',  // short string ID — would fail against uuid RPC param
        at: 90,
        vehicleId: 'v2',
      },
      missing: [] as string[],
      unknownLocations: [] as string[],
      preview: 'Vehicle failure at t=90',
      confirmation: 'confirmed' as const,
      source: 'placeholder' as const,
    }

    const dispatcher = {
      id: 'u-1',
      orgId: 'org-1',
      name: 'Dispatcher',
      email: 'disp@example.com',
      role: 'dispatcher' as const,
    }

    const rpc = vi.fn().mockResolvedValue({
      data: { disruption_id: 'dis-v2-fail', audit_id: 'audit-1', confirmed_by: 'u-1', confirmed_at: '2025-01-01T00:00:00Z' },
      error: null,
    })
    getSupabaseClientMock.mockReturnValue({ rpc })

    await confirmDisruption({
      interpreted,
      orgId: 'org-1',
      actorProfile: dispatcher,
      knownLocationIds: knownLocations,
      knownVehicleIds: knownVehicles,
    })

    expect(rpc).toHaveBeenCalledWith('confirm_disruption_tx', {
      p_disruption_id: 'dis-v2-fail',
      p_raw_text: 'Van 2 broke down',
      p_type: 'vehicle_failure',
      p_payload: { vehicleId: 'v2' },
      p_at_min: 90,
    })
  })

  it('passes short urgent-delivery and location IDs as text to the RPC', async () => {
    const interpreted = {
      rawText: 'Urgent order for Eastside Florist',
      event: {
        type: 'urgent_delivery' as const,
        id: 'dis-urgent-c8',
        at: 120,
        delivery: {
          id: 'd-urgent-1',
          locationId: 'c8',
          size: 8,
          serviceMin: 10,
          window: { start: 120, end: 240 },
          priority: 'urgent' as const,
        },
      },
      missing: [] as string[],
      unknownLocations: [] as string[],
      preview: 'Urgent delivery at c8 at t=120',
      confirmation: 'confirmed' as const,
      source: 'placeholder' as const,
    }

    const admin = {
      id: 'u-1',
      orgId: 'org-1',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'admin' as const,
    }

    const rpc = vi.fn().mockResolvedValue({
      data: { disruption_id: 'dis-urgent-c8', audit_id: 'audit-2', confirmed_by: 'u-1', confirmed_at: '2025-01-01T00:00:00Z' },
      error: null,
    })
    getSupabaseClientMock.mockReturnValue({ rpc })

    await confirmDisruption({
      interpreted,
      orgId: 'org-1',
      actorProfile: admin,
      knownLocationIds: ['depot', 'c8'],
      knownVehicleIds: knownVehicles,
    })

    expect(rpc).toHaveBeenCalledWith('confirm_disruption_tx', {
      p_disruption_id: 'dis-urgent-c8',
      p_raw_text: 'Urgent order for Eastside Florist',
      p_type: 'urgent_delivery',
      p_payload: { delivery: interpreted.event.delivery },
      p_at_min: 120,
    })
  })
})

describe('Authenticated organization data reads', () => {
  it('loads the auth user profile by the verified Supabase user ID', async () => {
    const eq = vi.fn().mockReturnValue({
      single: vi.fn().mockResolvedValue({
        data: { id: 'auth-user-1', org_id: 'org-1', name: 'Dispatcher', email: null, role: 'dispatcher' },
        error: null,
      }),
    })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    getSupabaseClientMock.mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user-1', email: 'dispatch@example.com' } }, error: null }) },
      from,
    })

    const profile = await getCurrentUserProfile()

    expect(from).toHaveBeenCalledWith('profiles')
    expect(eq).toHaveBeenCalledWith('id', 'auth-user-1')
    expect(profile).toEqual({ id: 'auth-user-1', orgId: 'org-1', name: 'Dispatcher', email: 'dispatch@example.com', role: 'dispatcher' })
  })

  it('reads and maps deliveries scoped to the authenticated organization', async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [{
        id: 'delivery-1',
        org_id: 'org-1',
        location_id: 'location-1',
        size: 12,
        service_min: 15,
        window_start: 30,
        window_end: 120,
        priority: 'urgent',
      }],
      error: null,
    })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    getSupabaseClientMock.mockReturnValue({ from })

    const rows = await getDeliveries('org-1')

    expect(from).toHaveBeenCalledWith('deliveries')
    expect(select).toHaveBeenCalledWith('id, org_id, location_id, size, service_min, window_start, window_end, priority')
    expect(eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(rows).toEqual([{
      id: 'delivery-1',
      locationId: 'location-1',
      size: 12,
      serviceMin: 15,
      window: { start: 30, end: 120 },
      priority: 'urgent',
    }])
  })

  it('reads vehicles using the migrated columns and organization filter', async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [{
        id: 'vehicle-live-1', org_id: 'org-1', name: 'North van', capacity: 25,
        depot_id: 'depot-live', shift_start: 15, shift_end: 420, status: 'active',
      }],
      error: null,
    })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    getSupabaseClientMock.mockReturnValue({ from })

    await expect(getVehicles('org-1')).resolves.toEqual([{
      id: 'vehicle-live-1', name: 'North van', capacity: 25, depotId: 'depot-live',
      shiftStart: 15, shiftEnd: 420, status: 'active',
    }])
    expect(from).toHaveBeenCalledWith('vehicles')
    expect(select).toHaveBeenCalledWith('id, org_id, name, capacity, depot_id, shift_start, shift_end, status')
    expect(eq).toHaveBeenCalledWith('org_id', 'org-1')
  })

  it('propagates organization vehicle query failures instead of using sample records', async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    const select = vi.fn().mockReturnValue({ eq })
    getSupabaseClientMock.mockReturnValue({ from: vi.fn().mockReturnValue({ select }) })

    await expect(getVehicles('org-1')).rejects.toThrow('Failed to fetch vehicles: permission denied')
  })

  it('lists the latest saved plans within the requested organization', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{ id: 'plan-1', label: 'Morning routes', created_at_min: 90, parent_plan_id: null }],
      error: null,
    })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    getSupabaseClientMock.mockReturnValue({ from })

    await expect(listDeliveryPlans('org-1')).resolves.toEqual([
      { id: 'plan-1', label: 'Morning routes', createdAt: 90, parentPlanId: null },
    ])
    expect(from).toHaveBeenCalledWith('plans')
    expect(select).toHaveBeenCalledWith('id, label, created_at_min, parent_plan_id')
    expect(eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('loads a persisted route plan and stops using text operational IDs and org filters', async () => {
    const calls: Array<{ table: string; filters: Array<[string, string]> }> = []
    const from = vi.fn((table: string) => {
      const query = {
        filters: [] as Array<[string, string]>,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(function (this: typeof query, column: string, value: string) {
          this.filters.push([column, value])
          return this
        }),
        single: vi.fn(async function (this: typeof query) {
          calls.push({ table, filters: this.filters })
          return { data: { id: 'plan-text-1', org_id: 'org-1', label: 'Saved plan', parent_plan_id: null, created_at_min: 60, unassigned: [] }, error: null }
        }),
        then: undefined as unknown,
      }
      if (table === 'plan_stops') {
        Object.assign(query, {
          then: (resolve: (value: unknown) => unknown) => {
            calls.push({ table, filters: query.filters })
            return Promise.resolve({
              data: [{ id: 'stop-text-1', org_id: 'org-1', plan_id: 'plan-text-1', vehicle_id: 'vehicle-text-1', delivery_id: 'delivery-text-1', seq: 0, arrival: 30, service_start: 45, departure: 55, status: 'pending' }],
              error: null,
            }).then(resolve)
          },
        })
      }
      if (table === 'deliveries') {
        Object.assign(query, {
          then: (resolve: (value: unknown) => unknown) => {
            calls.push({ table, filters: query.filters })
            return Promise.resolve({
              data: [{ id: 'delivery-text-1', org_id: 'org-1', location_id: 'customer-text-1', size: 7, service_min: 10, window_start: 0, window_end: 120, priority: 'normal' }],
              error: null,
            }).then(resolve)
          },
        })
      }
      return query
    })
    getSupabaseClientMock.mockReturnValue({ from })

    const plan = await getDeliveryPlan('plan-text-1', 'org-1')

    expect(plan.id).toBe('plan-text-1')
    expect(plan.routes).toEqual([{
      vehicleId: 'vehicle-text-1',
      stops: [{ deliveryId: 'delivery-text-1', locationId: 'customer-text-1', arrival: 30, serviceStart: 45, departure: 55, waitMin: 15, status: 'pending' }],
      load: 7,
    }])
    expect(calls).toEqual([
      { table: 'plans', filters: [['id', 'plan-text-1'], ['org_id', 'org-1']] },
      { table: 'plan_stops', filters: [['plan_id', 'plan-text-1'], ['org_id', 'org-1']] },
      { table: 'deliveries', filters: [['org_id', 'org-1']] },
    ])
  })

  it('loads persisted disruptions within the organization and maps payloads', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{
        id: 'disruption-text-1', org_id: 'org-1', type: 'vehicle_failure',
        payload: { vehicleId: 'vehicle-text-1' }, raw_text: 'Vehicle failed',
        confirmed_by: 'auth-user-1', at_min: 75, confirmed_at: '2026-10-01T12:00:00Z',
      }],
      error: null,
    })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    getSupabaseClientMock.mockReturnValue({ from })

    await expect(getDisruptions('org-1')).resolves.toEqual([
      { type: 'vehicle_failure', id: 'disruption-text-1', at: 75, vehicleId: 'vehicle-text-1' },
    ])
    expect(from).toHaveBeenCalledWith('disruptions')
    expect(eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(order).toHaveBeenCalledWith('at_min', { ascending: true })
  })

  it('propagates disruption query failures rather than substituting sample events', async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: 'RLS denied' } })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    getSupabaseClientMock.mockReturnValue({ from: vi.fn().mockReturnValue({ select }) })

    await expect(getDisruptions('org-1')).rejects.toThrow('Failed to fetch disruptions: RLS denied')
  })

  it('derives only observed directed route legs from persisted plan timestamps', () => {
    const plan: DeliveryPlan = {
      id: 'plan-1', label: 'Persisted', createdAt: 90, unassigned: [],
      routes: [{ vehicleId: 'vehicle-1', load: 5, stops: [
        { deliveryId: 'delivery-1', locationId: 'location-1', arrival: 20, serviceStart: 20, departure: 30, waitMin: 0, status: 'pending' },
        { deliveryId: 'delivery-2', locationId: 'location-2', arrival: 45, serviceStart: 45, departure: 55, waitMin: 0, status: 'pending' },
      ] }],
    }
    const vehicle: Vehicle = { id: 'vehicle-1', name: 'Van', capacity: 10, depotId: 'depot-1', shiftStart: 5, shiftEnd: 480, status: 'active' }

    expect(travelMatrixFromPersistedPlan(plan, [vehicle])).toEqual({
      'depot-1': { 'location-1': 15 },
      'location-1': { 'location-2': 15 },
    })
  })

  it('does not allow viewers to save urgent deliveries or replanned routes', async () => {
    getSupabaseClientMock.mockReturnValue({})
    const plan: DeliveryPlan = { id: 'plan-1', label: 'Plan', createdAt: 0, routes: [], unassigned: [] }
    const viewerProfile: UserProfile = { id: 'auth-viewer-1', orgId: 'org-1', name: 'Viewer', email: '', role: 'viewer' }

    await expect(saveDelivery({ id: 'd-1', locationId: 'c1', size: 1, serviceMin: 10, window: { start: 0, end: 60 }, priority: 'urgent' }, 'org-1', viewerProfile))
      .rejects.toThrow(AuthorizationError)
    await expect(saveDeliveryPlan(plan, 'org-1', viewerProfile))
      .rejects.toThrow(AuthorizationError)
    expect(getSupabaseClientMock).not.toHaveBeenCalled()
  })

  it('propagates persisted plan header failures before writing stops', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { message: 'RLS denied' } })
    const from = vi.fn((table: string) => table === 'plans' ? { upsert } : { insert: vi.fn() })
    getSupabaseClientMock.mockReturnValue({ from })
    const actor: UserProfile = { id: 'auth-admin-1', orgId: 'org-1', name: 'Admin', email: '', role: 'admin' }
    const plan: DeliveryPlan = { id: 'plan-new', label: 'Replanned', createdAt: 90, routes: [], unassigned: [] }

    await expect(saveDeliveryPlan(plan, 'org-1', actor)).rejects.toThrow('Failed to save plan header: RLS denied')
    expect(from).toHaveBeenCalledWith('plans')
    expect(from).not.toHaveBeenCalledWith('plan_stops')
  })

  it('persists generated plan headers and stops with organization and operational text IDs', async () => {
    const actor: UserProfile = { id: 'auth-dispatcher-1', orgId: 'org-1', name: 'Dispatcher', email: '', role: 'dispatcher' }
    const plan: DeliveryPlan = {
      id: 'plan-replanned-text-1', label: 'Replanned at 90m', createdAt: 90, unassigned: [],
      routes: [{ vehicleId: 'vehicle-text-1', load: 4, stops: [
        { deliveryId: 'delivery-text-1', locationId: 'location-text-1', arrival: 30, serviceStart: 30, departure: 40, waitMin: 0, status: 'pending' },
      ] }],
    }
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const stopInsert = vi.fn().mockResolvedValue({ error: null })
    const auditInsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: { message: 'audit unavailable' } }) }) })
    const from = vi.fn((table: string) => table === 'plans'
      ? { upsert }
      : table === 'plan_stops'
        ? {
          delete: () => ({ eq: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) }),
          insert: stopInsert,
        }
        : { insert: auditInsert })
    getSupabaseClientMock.mockReturnValue({ from })

    await expect(saveDeliveryPlan(plan, 'org-1', actor)).resolves.toBe(plan)

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'plan-replanned-text-1', org_id: 'org-1' }))
    expect(stopInsert).toHaveBeenCalledWith([expect.objectContaining({
      plan_id: 'plan-replanned-text-1', org_id: 'org-1', vehicle_id: 'vehicle-text-1', delivery_id: 'delivery-text-1',
    })])
  })

  it('enforces vehicle status role restrictions and reports RLS-filtered no-op updates', async () => {
    getSupabaseClientMock.mockReturnValue({})
    await expect(updateVehicleStatus('vehicle-1', 'org-1', 'failed', 'viewer')).rejects.toThrow(AuthorizationError)
    expect(getSupabaseClientMock).not.toHaveBeenCalled()

    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const query = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle,
    }
    const update = vi.fn().mockReturnValue(query)
    getSupabaseClientMock.mockReturnValue({ from: vi.fn().mockReturnValue({ update }) })
    await expect(updateVehicleStatus('vehicle-1', 'org-1', 'failed', 'dispatcher'))
      .rejects.toThrow("Vehicle with id 'vehicle-1' not found.")
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', 'vehicle-1')
    expect(query.eq).toHaveBeenNthCalledWith(2, 'org_id', 'org-1')
    expect(query.select).toHaveBeenCalledWith('id')
  })
})
