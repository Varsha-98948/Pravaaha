/**
 * Incident Intake, Preview Validation, and Explicit Disruption Confirmation Service.
 *
 * Enforces strict preview-only behavior: interpreting text never mutates state or writes to DB.
 * Persisting disruptions requires explicit confirmation by an authorized actor (admin or dispatcher).
 * Viewers are strictly prohibited from confirming or persisting disruptions.
 */

import type {
  DisruptionEvent,
  InterpretedDisruption,
  UserProfile,
} from '../types'
import {
  AuthorizationError,
  ConfigurationError,
  DatabaseError,
  OrganizationMismatchError,
  ValidationError,
} from './errors'
import { getSupabaseClient, isDemoMode } from './supabase'
import { requireRole } from './authService'
import { validateDisruptionEvent, validateInterpretedDisruption } from './validation'
import type { DisruptionInterpreter, InterpreterContext } from './disruptionInterpreter'
import type { AuditRecord } from './mappers'

export interface ConfirmDisruptionResult {
  disruption: DisruptionEvent
  auditRecord: AuditRecord
}

/**
 * 1. Interpretation Phase: PREVIEW ONLY.
 * Runs text through the configured interpreter and performs runtime validation.
 * Never persists to the database and never mutates simulation state.
 * Returns a validated preview with confirmation set to 'pending'.
 */
export async function interpretIncidentPreview(
  rawText: string,
  interpreter: DisruptionInterpreter,
  knownLocationIds: string[],
  knownVehicleIds: string[],
  context?: InterpreterContext
): Promise<InterpretedDisruption> {
  if (typeof rawText !== 'string' || rawText.trim() === '') {
    return {
      rawText: rawText || '',
      event: null,
      missing: ['Raw text cannot be empty.'],
      unknownLocations: [],
      preview: 'Empty incident input.',
      confirmation: 'pending',
      source: 'placeholder',
    }
  }

  const effectiveContext: InterpreterContext = {
    knownVehicles: knownVehicleIds,
    ...context,
  }

  // Run interpreter
  const rawInterpretation = await interpreter.interpret(rawText, knownLocationIds, effectiveContext)

  // Validate output against contracts and known references
  const validated = validateInterpretedDisruption(rawInterpretation, knownLocationIds, knownVehicleIds)

  // Enforce pending state for all new interpretations; preview cannot be pre-confirmed
  return {
    ...validated,
    confirmation: 'pending',
  }
}

/**
 * 2. Confirmation Phase: EXPLICIT AUTHORIZED CONFIRMATION.
 * Requires explicit confirmation status ('confirmed') from an authorized user ('admin' | 'dispatcher').
 * Revalidates event integrity and foreign keys before persisting to database with audit trail.
 *
 * NOTE: Disruption event application to the simulation/plan is deferred to caller/engine integration
 * (`applyDisruption` in `src/engine/disruptions.ts`). This service boundary guarantees database
 * persistence and audit logging first.
 */
export async function confirmDisruption(params: {
  interpreted: InterpretedDisruption
  orgId: string
  actorProfile: UserProfile
  knownLocationIds: string[]
  knownVehicleIds: string[]
}): Promise<ConfirmDisruptionResult> {
  const { interpreted, orgId, actorProfile, knownLocationIds, knownVehicleIds } = params

  // 1. Organization scoping check
  if (!actorProfile || actorProfile.orgId !== orgId) {
    throw new OrganizationMismatchError(
      `User organization '${actorProfile?.orgId}' does not match target organization '${orgId}'.`
    )
  }

  // 2. Authorization check: Viewers cannot confirm operational disruptions
  requireRole(actorProfile, ['admin', 'dispatcher'])

  // 3. Explicit confirmation check: Cannot confirm unless user explicitly confirmed preview
  if (interpreted.confirmation !== 'confirmed') {
    throw new ValidationError(
      `Disruption has confirmation status '${interpreted.confirmation}'. Explicit confirmation ('confirmed') is required.`
    )
  }

  // 4. Validate event presence
  if (!interpreted.event) {
    throw new ValidationError(
      'Cannot confirm disruption: no disruption event was generated or validated.',
      interpreted.missing
    )
  }

  // 5. Revalidate event against current organization locations and vehicles
  const validationResult = validateDisruptionEvent(interpreted.event, knownLocationIds, knownVehicleIds)
  if (!validationResult.isValid || !validationResult.event) {
    throw new ValidationError(
      'Disruption event failed validation upon confirmation.',
      validationResult.errors
    )
  }

  const validEvent = validationResult.event

  // 6. Persistence check: Demo mode cannot claim persistent writes
  if (isDemoMode) {
    throw new ConfigurationError('Cannot persist disruption in demo mode: Supabase is not configured.')
  }

  const client = getSupabaseClient()

  // 7. Persist via transactional database function or direct queries
  let payload: Record<string, unknown> = {}
  switch (validEvent.type) {
    case 'road_closure':
      payload = { from: validEvent.from, to: validEvent.to }
      break
    case 'vehicle_failure':
      payload = { vehicleId: validEvent.vehicleId }
      break
    case 'urgent_delivery':
      payload = { delivery: validEvent.delivery }
      break
  }

  const { data: rpcResult, error: rpcError } = await client.rpc('confirm_disruption_tx', {
    p_disruption_id: validEvent.id,
    p_raw_text: interpreted.rawText,
    p_type: validEvent.type,
    p_payload: payload,
    p_at_min: validEvent.at,
  })

  if (rpcError) {
    throw new DatabaseError(`Failed to persist confirmed disruption: ${rpcError.message}`, rpcError)
  }

  const resultData = rpcResult as {
    disruption_id: string
    audit_id: string
    confirmed_by: string
    confirmed_at: string
  }

  const auditRecord: AuditRecord = {
    id: resultData.audit_id || validEvent.id,
    orgId,
    actorId: actorProfile.id,
    action: 'disruption_confirmed',
    entityType: 'disruption',
    entityId: validEvent.id,
    disruptionId: validEvent.id,
    payload: {
      type: validEvent.type,
      at_min: validEvent.at,
      raw_text: interpreted.rawText,
      payload,
    },
    createdAt: resultData.confirmed_at || new Date().toISOString(),
  }

  return {
    disruption: validEvent,
    auditRecord,
  }
}
