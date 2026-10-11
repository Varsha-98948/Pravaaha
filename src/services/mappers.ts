/**
 * Field mappers between PostgreSQL snake_case rows and TypeScript camelCase domain models.
 * Preserves simulation time units, types, and strict contracts defined in src/types/index.ts.
 */

import type {
  Delivery,
  DeliveryPlan,
  DisruptionEvent,
  Location,
  Organization,
  RoadClosureEvent,
  RouteStop,
  StopStatus,
  UnassignedDelivery,
  UserProfile,
  Vehicle,
  VehicleFailureEvent,
  VehicleRoute,
  UrgentDeliveryEvent,
  Role,
} from '../types'
import { ValidationError } from './errors'

export interface DbOrganizationRow {
  id: string
  name: string
}

export interface DbProfileRow {
  id: string
  org_id: string
  name: string
  email?: string | null
  role: string
}

export interface DbLocationRow {
  id: string
  org_id?: string
  name: string
  kind: string
}

export interface DbVehicleRow {
  id: string
  org_id?: string
  name: string
  capacity: number
  depot_id: string
  shift_start: number
  shift_end: number
  status: string
}

export interface DbDeliveryRow {
  id: string
  org_id?: string
  location_id: string
  size: number
  service_min: number
  window_start: number
  window_end: number
  priority: string
}

export interface DbPlanRow {
  id: string
  org_id: string
  label: string
  parent_plan_id?: string | null
  created_at_min: number
  created_at?: string
  unassigned?: UnassignedDelivery[] | null
}

export interface DbPlanStopRow {
  id?: string
  org_id?: string
  plan_id: string
  vehicle_id: string
  delivery_id: string
  seq: number
  arrival: number
  service_start: number
  departure: number
  status: string
  decision?: string | null
}

export interface DbDisruptionRow {
  id: string
  org_id: string
  type: string
  payload: Record<string, unknown>
  raw_text?: string | null
  confirmed_by?: string | null
  at_min: number
  confirmed_at?: string | null
}

export interface AuditRecord {
  id: string
  orgId: string
  actorId: string
  action: string
  entityType: string
  entityId?: string | null
  planId?: string | null
  disruptionId?: string | null
  payload: Record<string, unknown>
  createdAt: string
}

export interface DbAuditLogRow {
  id: string
  org_id: string
  actor_id: string
  action: string
  entity_type: string
  entity_id?: string | null
  plan_id?: string | null
  disruption_id?: string | null
  payload: Record<string, unknown>
  created_at: string
}

export interface DbSimulationEventRow {
  id: string
  org_id: string
  plan_id?: string | null
  kind: string
  payload?: Record<string, unknown> | null
  at_min: number
}

// -----------------------------------------------------------------------------
// Organization Mappers
// -----------------------------------------------------------------------------

export function dbToOrganization(row: DbOrganizationRow): Organization {
  if (!row || !row.id || typeof row.name !== 'string') {
    throw new ValidationError('Malformed organization record from database')
  }
  return {
    id: row.id,
    name: row.name,
  }
}

export function organizationToDb(org: Organization): DbOrganizationRow {
  return {
    id: org.id,
    name: org.name,
  }
}

// -----------------------------------------------------------------------------
// User Profile Mappers
// -----------------------------------------------------------------------------

export function dbToUserProfile(row: DbProfileRow, fallbackEmail?: string): UserProfile {
  if (!row || !row.id || !row.org_id || !row.name) {
    throw new ValidationError('Malformed user profile record from database')
  }
  const role = row.role as Role
  if (role !== 'admin' && role !== 'dispatcher' && role !== 'viewer') {
    throw new ValidationError(`Unknown user role '${row.role}' in profile record`)
  }
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    email: row.email || fallbackEmail || '',
    role,
  }
}

export function userProfileToDb(profile: UserProfile): DbProfileRow {
  return {
    id: profile.id,
    org_id: profile.orgId,
    name: profile.name,
    email: profile.email,
    role: profile.role,
  }
}

// -----------------------------------------------------------------------------
// Location Mappers
// -----------------------------------------------------------------------------

export function dbToLocation(row: DbLocationRow): Location {
  if (!row || !row.id || !row.name || (row.kind !== 'depot' && row.kind !== 'customer')) {
    throw new ValidationError(`Malformed location record: ${JSON.stringify(row)}`)
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as 'depot' | 'customer',
  }
}

export function locationToDb(loc: Location, orgId: string): DbLocationRow {
  return {
    id: loc.id,
    org_id: orgId,
    name: loc.name,
    kind: loc.kind,
  }
}

// -----------------------------------------------------------------------------
// Vehicle Mappers
// -----------------------------------------------------------------------------

export function dbToVehicle(row: DbVehicleRow): Vehicle {
  if (!row || !row.id || !row.name || typeof row.capacity !== 'number' || !row.depot_id) {
    throw new ValidationError(`Malformed vehicle record: ${JSON.stringify(row)}`)
  }
  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    depotId: row.depot_id,
    shiftStart: row.shift_start,
    shiftEnd: row.shift_end,
    status: row.status === 'failed' ? 'failed' : 'active',
  }
}

export function vehicleToDb(veh: Vehicle, orgId: string): DbVehicleRow {
  return {
    id: veh.id,
    org_id: orgId,
    name: veh.name,
    capacity: veh.capacity,
    depot_id: veh.depotId,
    shift_start: veh.shiftStart,
    shift_end: veh.shiftEnd,
    status: veh.status,
  }
}

// -----------------------------------------------------------------------------
// Delivery Mappers
// -----------------------------------------------------------------------------

export function dbToDelivery(row: DbDeliveryRow): Delivery {
  if (!row || !row.id || !row.location_id || typeof row.size !== 'number') {
    throw new ValidationError(`Malformed delivery record: ${JSON.stringify(row)}`)
  }
  return {
    id: row.id,
    locationId: row.location_id,
    size: row.size,
    serviceMin: row.service_min,
    window: {
      start: row.window_start,
      end: row.window_end,
    },
    priority: row.priority === 'urgent' ? 'urgent' : 'normal',
  }
}

export function deliveryToDb(del: Delivery, orgId: string): DbDeliveryRow {
  return {
    id: del.id,
    org_id: orgId,
    location_id: del.locationId,
    size: del.size,
    service_min: del.serviceMin,
    window_start: del.window.start,
    window_end: del.window.end,
    priority: del.priority,
  }
}

// -----------------------------------------------------------------------------
// Delivery Plan & Stops Mappers
// -----------------------------------------------------------------------------

export function dbToDeliveryPlan(
  planRow: DbPlanRow,
  stopRows: DbPlanStopRow[],
  deliveriesById: Record<string, Delivery>
): DeliveryPlan {
  if (!planRow || !planRow.id || typeof planRow.label !== 'string') {
    throw new ValidationError('Malformed plan record from database')
  }

  // Group stops by vehicle and order by sequence
  const stopsByVehicle: Record<string, DbPlanStopRow[]> = {}
  for (const stop of stopRows) {
    if (!stopsByVehicle[stop.vehicle_id]) {
      stopsByVehicle[stop.vehicle_id] = []
    }
    stopsByVehicle[stop.vehicle_id].push(stop)
  }

  const routes: VehicleRoute[] = Object.entries(stopsByVehicle).map(([vehicleId, stops]) => {
    stops.sort((a, b) => a.seq - b.seq)
    let totalLoad = 0

    const routeStops: RouteStop[] = stops.map(stop => {
      const delivery = deliveriesById[stop.delivery_id]
      if (delivery) {
        totalLoad += delivery.size
      }
      const isSkipped = stop.status === 'skipped'
      const arrival = !Number.isFinite(stop.arrival) || stop.arrival < 0 || isSkipped ? Infinity : stop.arrival
      const serviceStart = !Number.isFinite(stop.service_start) || stop.service_start < 0 || isSkipped ? Infinity : stop.service_start
      const departure = !Number.isFinite(stop.departure) || stop.departure < 0 || isSkipped ? Infinity : stop.departure
      const waitMin = Number.isFinite(serviceStart) && Number.isFinite(arrival) ? Math.max(0, serviceStart - arrival) : 0
      return {
        deliveryId: stop.delivery_id,
        locationId: delivery ? delivery.locationId : '',
        arrival,
        serviceStart,
        departure,
        waitMin,
        status: (stop.status as StopStatus) || 'pending',
      }
    })

    return {
      vehicleId,
      stops: routeStops,
      load: totalLoad,
    }
  })

  return {
    id: planRow.id,
    label: planRow.label,
    createdAt: planRow.created_at_min,
    routes,
    unassigned: planRow.unassigned || [],
  }
}

export function deliveryPlanToDb(
  plan: DeliveryPlan,
  orgId: string,
  parentPlanId?: string | null
): { planRow: DbPlanRow; stopRows: DbPlanStopRow[] } {
  const planRow: DbPlanRow = {
    id: plan.id,
    org_id: orgId,
    label: plan.label,
    parent_plan_id: parentPlanId || null,
    created_at_min: plan.createdAt,
    unassigned: plan.unassigned,
  }

  const stopRows: DbPlanStopRow[] = []
  for (const route of plan.routes) {
    route.stops.forEach((stop, index) => {
      stopRows.push({
        plan_id: plan.id,
        org_id: orgId,
        vehicle_id: route.vehicleId,
        delivery_id: stop.deliveryId,
        seq: index,
        arrival: Number.isFinite(stop.arrival) && stop.arrival >= 0 ? stop.arrival : -1,
        service_start: Number.isFinite(stop.serviceStart) && stop.serviceStart >= 0 ? stop.serviceStart : -1,
        departure: Number.isFinite(stop.departure) && stop.departure >= 0 ? stop.departure : -1,
        status: stop.status,
      })
    })
  }

  return { planRow, stopRows }
}

// -----------------------------------------------------------------------------
// Disruption Mappers
// -----------------------------------------------------------------------------

export function dbToDisruptionEvent(row: DbDisruptionRow): DisruptionEvent {
  if (!row || !row.id || !row.type || typeof row.at_min !== 'number') {
    throw new ValidationError(`Malformed disruption record: ${JSON.stringify(row)}`)
  }

  const payload = row.payload || {}

  switch (row.type) {
    case 'road_closure': {
      if (typeof payload.from !== 'string' || typeof payload.to !== 'string') {
        throw new ValidationError('Malformed road closure payload: missing from/to endpoints')
      }
      const event: RoadClosureEvent = {
        type: 'road_closure',
        id: row.id,
        at: row.at_min,
        from: payload.from as string,
        to: payload.to as string,
      }
      return event
    }

    case 'vehicle_failure': {
      if (typeof payload.vehicleId !== 'string') {
        throw new ValidationError('Malformed vehicle failure payload: missing vehicleId')
      }
      const event: VehicleFailureEvent = {
        type: 'vehicle_failure',
        id: row.id,
        at: row.at_min,
        vehicleId: payload.vehicleId as string,
      }
      return event
    }

    case 'urgent_delivery': {
      if (!payload.delivery || typeof payload.delivery !== 'object') {
        throw new ValidationError('Malformed urgent delivery payload: missing delivery object')
      }
      const event: UrgentDeliveryEvent = {
        type: 'urgent_delivery',
        id: row.id,
        at: row.at_min,
        delivery: payload.delivery as Delivery,
      }
      return event
    }

    default:
      throw new ValidationError(`Unknown disruption type: ${row.type}`)
  }
}

export function disruptionEventToDb(
  event: DisruptionEvent,
  orgId: string,
  confirmedBy?: string | null,
  rawText?: string | null
): DbDisruptionRow {
  let payload: Record<string, unknown> = {}

  switch (event.type) {
    case 'road_closure':
      payload = { from: event.from, to: event.to }
      break
    case 'vehicle_failure':
      payload = { vehicleId: event.vehicleId }
      break
    case 'urgent_delivery':
      payload = { delivery: event.delivery }
      break
  }

  return {
    id: event.id,
    org_id: orgId,
    type: event.type,
    payload,
    raw_text: rawText || null,
    confirmed_by: confirmedBy || null,
    at_min: event.at,
  }
}

// -----------------------------------------------------------------------------
// Audit Log Mappers
// -----------------------------------------------------------------------------

export function dbToAuditRecord(row: DbAuditLogRow): AuditRecord {
  if (!row || !row.id || !row.org_id || !row.actor_id || !row.action) {
    throw new ValidationError('Malformed audit record from database')
  }
  return {
    id: row.id,
    orgId: row.org_id,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id || null,
    planId: row.plan_id || null,
    disruptionId: row.disruption_id || null,
    payload: row.payload || {},
    createdAt: row.created_at,
  }
}

export function auditRecordToDb(
  record: Omit<AuditRecord, 'id' | 'createdAt'>
): Omit<DbAuditLogRow, 'id' | 'created_at'> {
  return {
    org_id: record.orgId,
    actor_id: record.actorId,
    action: record.action,
    entity_type: record.entityType,
    entity_id: record.entityId || null,
    plan_id: record.planId || null,
    disruption_id: record.disruptionId || null,
    payload: record.payload || {},
  }
}
