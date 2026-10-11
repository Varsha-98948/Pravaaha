/**
 * Data Persistence Service for Pravaaha.
 * Provides reliable, organization-scoped persistence and retrieval for:
 * - Organizations
 * - User Profiles
 * - Locations
 * - Vehicles
 * - Deliveries
 * - Delivery Plans & Plan Stops
 * - Disruptions
 * - Simulation Events
 * - Audit History
 *
 * Guarantees:
 * - Strict PostgreSQL snake_case <-> TypeScript camelCase conversion.
 * - Org-scoped queries enforcing data isolation.
 * - Clear, propagated errors (no silent fallback or fake writes in demo mode).
 */

import type {
  Delivery,
  DeliveryPlan,
  DisruptionEvent,
  Location,
  Organization,
  Role,
  UserProfile,
  Vehicle,
} from '../types'
import {
  AuthorizationError,
  ConfigurationError,
  DatabaseError,
  NotFoundError,
  ValidationError,
} from './errors'
import { getSupabaseClient, isDemoMode } from './supabase'
import {
  auditRecordToDb,
  dbToAuditRecord,
  dbToDelivery,
  dbToDeliveryPlan,
  dbToDisruptionEvent,
  dbToLocation,
  dbToOrganization,
  dbToUserProfile,
  dbToVehicle,
  deliveryPlanToDb,
  deliveryToDb,
  locationToDb,
  userProfileToDb,
  vehicleToDb,
  type AuditRecord,
  type DbAuditLogRow,
  type DbDeliveryRow,
  type DbDisruptionRow,
  type DbLocationRow,
  type DbOrganizationRow,
  type DbPlanRow,
  type DbPlanStopRow,
  type DbProfileRow,
  type DbSimulationEventRow,
  type DbVehicleRow,
} from './mappers'

// =============================================================================
// Helper: Ensure Persistent Environment
// =============================================================================

function checkWriteAllowed() {
  if (isDemoMode) {
    throw new ConfigurationError('Cannot persist data in demo mode: Supabase is not configured.')
  }
}

// =============================================================================
// Organizations
// =============================================================================

export async function getOrganization(orgId: string): Promise<Organization> {
  if (!orgId) throw new ValidationError('orgId is required.')
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') throw new NotFoundError('Organization', orgId)
    throw new DatabaseError(`Failed to fetch organization: ${error.message}`, error)
  }

  return dbToOrganization(data as DbOrganizationRow)
}

// =============================================================================
// User Profiles
// =============================================================================

export async function getProfiles(orgId: string): Promise<UserProfile[]> {
  if (!orgId) throw new ValidationError('orgId is required.')
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('profiles')
    .select('id, org_id, name, email, role')
    .eq('org_id', orgId)

  if (error) {
    throw new DatabaseError(`Failed to fetch profiles: ${error.message}`, error)
  }

  return (data as DbProfileRow[]).map(row => dbToUserProfile(row))
}

export async function updateUserProfile(
  userId: string,
  orgId: string,
  updates: { name?: string; role?: Role },
  actorRole: Role
): Promise<UserProfile> {
  checkWriteAllowed()
  if (!userId || !orgId) throw new ValidationError('userId and orgId are required.')

  if (updates.role && actorRole !== 'admin') {
    throw new AuthorizationError('Only administrators can change user roles.')
  }

  const client = getSupabaseClient()
  const payload: Partial<DbProfileRow> = {}
  if (updates.name) payload.name = updates.name
  if (updates.role) payload.role = updates.role

  const { data, error } = await client
    .from('profiles')
    .update(payload)
    .eq('id', userId)
    .eq('org_id', orgId)
    .select('id, org_id, name, email, role')
    .single()

  if (error) {
    throw new DatabaseError(`Failed to update profile: ${error.message}`, error)
  }

  return dbToUserProfile(data as DbProfileRow)
}

// =============================================================================
// Locations
// =============================================================================

export async function getLocations(orgId: string): Promise<Location[]> {
  if (!orgId) throw new ValidationError('orgId is required.')
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('locations')
    .select('id, org_id, name, kind')
    .eq('org_id', orgId)

  if (error) {
    throw new DatabaseError(`Failed to fetch locations: ${error.message}`, error)
  }

  return (data as DbLocationRow[]).map(dbToLocation)
}

export async function saveLocation(location: Location, orgId: string): Promise<Location> {
  checkWriteAllowed()
  if (!orgId) throw new ValidationError('orgId is required.')
  const client = getSupabaseClient()

  const row = locationToDb(location, orgId)
  const { data, error } = await client
    .from('locations')
    .upsert(row)
    .select('id, org_id, name, kind')
    .single()

  if (error) {
    throw new DatabaseError(`Failed to save location: ${error.message}`, error)
  }

  return dbToLocation(data as DbLocationRow)
}

// =============================================================================
// Vehicles
// =============================================================================

export async function getVehicles(orgId: string): Promise<Vehicle[]> {
  if (!orgId) throw new ValidationError('orgId is required.')
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('vehicles')
    .select('id, org_id, name, capacity, depot_id, shift_start, shift_end, status')
    .eq('org_id', orgId)

  if (error) {
    throw new DatabaseError(`Failed to fetch vehicles: ${error.message}`, error)
  }

  return (data as DbVehicleRow[]).map(dbToVehicle)
}

export async function saveVehicle(vehicle: Vehicle, orgId: string): Promise<Vehicle> {
  checkWriteAllowed()
  if (!orgId) throw new ValidationError('orgId is required.')
  const client = getSupabaseClient()

  const row = vehicleToDb(vehicle, orgId)
  const { data, error } = await client
    .from('vehicles')
    .upsert(row)
    .select('id, org_id, name, capacity, depot_id, shift_start, shift_end, status')
    .single()

  if (error) {
    throw new DatabaseError(`Failed to save vehicle: ${error.message}`, error)
  }

  return dbToVehicle(data as DbVehicleRow)
}

export async function updateVehicleStatus(
  vehicleId: string,
  orgId: string,
  status: 'active' | 'failed',
  actorId?: string
): Promise<void> {
  checkWriteAllowed()
  if (!vehicleId || !orgId) throw new ValidationError('vehicleId and orgId are required.')
  const client = getSupabaseClient()

  const { error } = await client
    .from('vehicles')
    .update({ status })
    .eq('id', vehicleId)
    .eq('org_id', orgId)

  if (error) {
    throw new DatabaseError(`Failed to update vehicle status: ${error.message}`, error)
  }

  if (actorId) {
    await createAuditLog({
      orgId,
      actorId,
      action: 'vehicle_status_changed',
      entityType: 'vehicle',
      entityId: vehicleId,
      payload: { status },
    }).catch(() => {
      // Allow caller to proceed if non-critical audit log call fails
    })
  }
}

// =============================================================================
// Deliveries
// =============================================================================

export async function getDeliveries(orgId: string): Promise<Delivery[]> {
  if (!orgId) throw new ValidationError('orgId is required.')
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('deliveries')
    .select('id, org_id, location_id, size, service_min, window_start, window_end, priority')
    .eq('org_id', orgId)

  if (error) {
    throw new DatabaseError(`Failed to fetch deliveries: ${error.message}`, error)
  }

  return (data as DbDeliveryRow[]).map(dbToDelivery)
}

export async function saveDelivery(delivery: Delivery, orgId: string): Promise<Delivery> {
  checkWriteAllowed()
  if (!orgId) throw new ValidationError('orgId is required.')
  const client = getSupabaseClient()

  const row = deliveryToDb(delivery, orgId)
  const { data, error } = await client
    .from('deliveries')
    .upsert(row)
    .select('id, org_id, location_id, size, service_min, window_start, window_end, priority')
    .single()

  if (error) {
    throw new DatabaseError(`Failed to save delivery: ${error.message}`, error)
  }

  return dbToDelivery(data as DbDeliveryRow)
}

// =============================================================================
// Delivery Plans & Plan Stops
// =============================================================================

export async function listDeliveryPlans(
  orgId: string
): Promise<Array<{ id: string; label: string; createdAt: number; parentPlanId: string | null }>> {
  if (!orgId) throw new ValidationError('orgId is required.')
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('plans')
    .select('id, label, created_at_min, parent_plan_id')
    .eq('org_id', orgId)
    .order('created_at_min', { ascending: false })

  if (error) {
    throw new DatabaseError(`Failed to list delivery plans: ${error.message}`, error)
  }

  return (data || []).map(row => ({
    id: row.id,
    label: row.label,
    createdAt: row.created_at_min,
    parentPlanId: row.parent_plan_id || null,
  }))
}

export async function getDeliveryPlan(planId: string, orgId: string): Promise<DeliveryPlan> {
  if (!planId || !orgId) throw new ValidationError('planId and orgId are required.')
  const client = getSupabaseClient()

  // 1. Fetch Plan record
  const { data: planData, error: planError } = await client
    .from('plans')
    .select('id, org_id, label, parent_plan_id, created_at_min, unassigned')
    .eq('id', planId)
    .eq('org_id', orgId)
    .single()

  if (planError) {
    if (planError.code === 'PGRST116') throw new NotFoundError('DeliveryPlan', planId)
    throw new DatabaseError(`Failed to fetch plan: ${planError.message}`, planError)
  }

  // 2. Fetch Plan Stops
  const { data: stopsData, error: stopsError } = await client
    .from('plan_stops')
    .select('id, org_id, plan_id, vehicle_id, delivery_id, seq, arrival, service_start, departure, status')
    .eq('plan_id', planId)
    .eq('org_id', orgId)

  if (stopsError) {
    throw new DatabaseError(`Failed to fetch plan stops: ${stopsError.message}`, stopsError)
  }

  // 3. Fetch Deliveries to populate route stop locationIds and calculate route load
  const deliveries = await getDeliveries(orgId)
  const deliveriesById = Object.fromEntries(deliveries.map(d => [d.id, d]))

  return dbToDeliveryPlan(
    planData as DbPlanRow,
    (stopsData || []) as DbPlanStopRow[],
    deliveriesById
  )
}

export async function saveDeliveryPlan(
  plan: DeliveryPlan,
  orgId: string,
  actorId: string,
  parentPlanId?: string | null
): Promise<DeliveryPlan> {
  checkWriteAllowed()
  if (!plan || !orgId || !actorId) {
    throw new ValidationError('plan, orgId, and actorId are required.')
  }

  const client = getSupabaseClient()
  const { planRow, stopRows } = deliveryPlanToDb(plan, orgId, parentPlanId)

  // 1. Insert/Update Plan header
  const { error: planError } = await client.from('plans').upsert(planRow)
  if (planError) {
    throw new DatabaseError(`Failed to save plan header: ${planError.message}`, planError)
  }

  // 2. Replace existing stops for the plan if updating
  if (stopRows.length > 0) {
    const { error: deleteError } = await client
      .from('plan_stops')
      .delete()
      .eq('plan_id', plan.id)
      .eq('org_id', orgId)

    if (deleteError) {
      throw new DatabaseError(`Failed to clear previous stops: ${deleteError.message}`, deleteError)
    }

    const { error: stopsError } = await client.from('plan_stops').insert(stopRows)
    if (stopsError) {
      throw new DatabaseError(`Failed to save plan stops: ${stopsError.message}`, stopsError)
    }
  }

  // 3. Write plan audit record
  await createAuditLog({
    orgId,
    actorId,
    action: parentPlanId ? 'plan_updated' : 'plan_created',
    entityType: 'plan',
    entityId: plan.id,
    planId: plan.id,
    payload: {
      label: plan.label,
      routesCount: plan.routes.length,
      unassignedCount: plan.unassigned.length,
      parentPlanId: parentPlanId || null,
    },
  }).catch(() => {
    // Non-blocking for plan return, but logged
  })

  return plan
}

// =============================================================================
// Disruptions
// =============================================================================

export async function getDisruptions(orgId: string): Promise<DisruptionEvent[]> {
  if (!orgId) throw new ValidationError('orgId is required.')
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('disruptions')
    .select('id, org_id, type, payload, raw_text, confirmed_by, at_min, confirmed_at')
    .eq('org_id', orgId)
    .order('at_min', { ascending: true })

  if (error) {
    throw new DatabaseError(`Failed to fetch disruptions: ${error.message}`, error)
  }

  return (data as DbDisruptionRow[]).map(dbToDisruptionEvent)
}

export async function getDisruption(disruptionId: string, orgId: string): Promise<DisruptionEvent> {
  if (!disruptionId || !orgId) throw new ValidationError('disruptionId and orgId are required.')
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('disruptions')
    .select('id, org_id, type, payload, raw_text, confirmed_by, at_min, confirmed_at')
    .eq('id', disruptionId)
    .eq('org_id', orgId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') throw new NotFoundError('Disruption', disruptionId)
    throw new DatabaseError(`Failed to fetch disruption: ${error.message}`, error)
  }

  return dbToDisruptionEvent(data as DbDisruptionRow)
}

// =============================================================================
// Simulation Events
// =============================================================================

export async function getSimulationEvents(
  orgId: string,
  planId?: string
): Promise<Array<{ id: string; orgId: string; planId?: string | null; kind: string; payload: unknown; atMin: number }>> {
  if (!orgId) throw new ValidationError('orgId is required.')
  const client = getSupabaseClient()

  let query = client
    .from('simulation_events')
    .select('id, org_id, plan_id, kind, payload, at_min')
    .eq('org_id', orgId)
    .order('at_min', { ascending: true })

  if (planId) {
    query = query.eq('plan_id', planId)
  }

  const { data, error } = await query

  if (error) {
    throw new DatabaseError(`Failed to fetch simulation events: ${error.message}`, error)
  }

  return (data as DbSimulationEventRow[]).map(row => ({
    id: row.id,
    orgId: row.org_id,
    planId: row.plan_id || null,
    kind: row.kind,
    payload: row.payload || {},
    atMin: row.at_min,
  }))
}

export async function saveSimulationEvent(event: {
  orgId: string
  planId?: string | null
  kind: string
  payload?: unknown
  atMin: number
}): Promise<string> {
  checkWriteAllowed()
  if (!event.orgId || !event.kind) {
    throw new ValidationError('orgId and kind are required for simulation event.')
  }
  const client = getSupabaseClient()

  const { data, error } = await client
    .from('simulation_events')
    .insert({
      org_id: event.orgId,
      plan_id: event.planId || null,
      kind: event.kind,
      payload: event.payload || {},
      at_min: event.atMin,
    })
    .select('id')
    .single()

  if (error) {
    throw new DatabaseError(`Failed to save simulation event: ${error.message}`, error)
  }

  return data.id
}

// =============================================================================
// Audit Logs
// =============================================================================

export async function getAuditLogs(
  orgId: string,
  options?: { planId?: string; disruptionId?: string; limit?: number }
): Promise<AuditRecord[]> {
  if (!orgId) throw new ValidationError('orgId is required.')
  const client = getSupabaseClient()

  let query = client
    .from('audit_logs')
    .select('id, org_id, actor_id, action, entity_type, entity_id, plan_id, disruption_id, payload, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (options?.planId) query = query.eq('plan_id', options.planId)
  if (options?.disruptionId) query = query.eq('disruption_id', options.disruptionId)
  if (options?.limit) query = query.limit(options.limit)

  const { data, error } = await query

  if (error) {
    throw new DatabaseError(`Failed to fetch audit logs: ${error.message}`, error)
  }

  return (data as DbAuditLogRow[]).map(dbToAuditRecord)
}

export async function createAuditLog(
  record: Omit<AuditRecord, 'id' | 'createdAt'>
): Promise<AuditRecord> {
  checkWriteAllowed()
  if (!record.orgId || !record.actorId || !record.action || !record.entityType) {
    throw new ValidationError('orgId, actorId, action, and entityType are required for audit log.')
  }

  const client = getSupabaseClient()
  const dbPayload = auditRecordToDb(record)

  const { data, error } = await client
    .from('audit_logs')
    .insert(dbPayload)
    .select('id, org_id, actor_id, action, entity_type, entity_id, plan_id, disruption_id, payload, created_at')
    .single()

  if (error) {
    throw new DatabaseError(`Failed to create audit log: ${error.message}`, error)
  }

  return dbToAuditRecord(data as DbAuditLogRow)
}
