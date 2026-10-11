/**
 * Runtime validation for disruption interpreter outputs and disruption events.
 * Enforces contracts, non-empty identifiers, finite simulation times, distinct road endpoints,
 * and organization-scoped reference existence (locations and vehicles).
 */

import type {
  ConfirmationState,
  Delivery,
  DisruptionEvent,
  InterpretedDisruption,
  RoadClosureEvent,
  UrgentDeliveryEvent,
  VehicleFailureEvent,
} from '../types'
import { ValidationError } from './errors'

export interface DisruptionValidationResult {
  isValid: boolean
  errors: string[]
  unknownLocations: string[]
  unknownVehicles: string[]
  event: DisruptionEvent | null
}

/**
 * Validates a disruption event structure and checks all foreign references
 * against the caller's organization-scoped known locations and vehicles.
 */
export function validateDisruptionEvent(
  rawEvent: unknown,
  knownLocationIds: string[],
  knownVehicleIds: string[]
): DisruptionValidationResult {
  const errors: string[] = []
  const unknownLocations: string[] = []
  const unknownVehicles: string[] = []

  if (!rawEvent || typeof rawEvent !== 'object') {
    return {
      isValid: false,
      errors: ['Event must be a non-null object.'],
      unknownLocations: [],
      unknownVehicles: [],
      event: null,
    }
  }

  const ev = rawEvent as Record<string, unknown>

  // 1. Validate ID
  if (!ev.id || typeof ev.id !== 'string' || ev.id.trim() === '') {
    errors.push('Event is missing a valid non-empty string id.')
  }

  // 2. Validate simulation time `at`
  if (typeof ev.at !== 'number' || !Number.isFinite(ev.at) || ev.at < 0) {
    errors.push('Event simulation time `at` must be a non-negative finite number.')
  }

  // 3. Validate event type
  if (ev.type !== 'road_closure' && ev.type !== 'vehicle_failure' && ev.type !== 'urgent_delivery') {
    errors.push(`Invalid event type '${String(ev.type)}'. Allowed: road_closure, vehicle_failure, urgent_delivery.`)
    return {
      isValid: false,
      errors,
      unknownLocations,
      unknownVehicles,
      event: null,
    }
  }

  const locationSet = new Set(knownLocationIds)
  const vehicleSet = new Set(knownVehicleIds)

  // 4. Type-specific validations
  if (ev.type === 'road_closure') {
    const from = ev.from
    const to = ev.to

    if (typeof from !== 'string' || from.trim() === '') {
      errors.push('Road closure requires a non-empty `from` location id.')
    } else if (!locationSet.has(from)) {
      errors.push(`Road closure 'from' location '${from}' does not exist in the organization.`)
      unknownLocations.push(from)
    }

    if (typeof to !== 'string' || to.trim() === '') {
      errors.push('Road closure requires a non-empty `to` location id.')
    } else if (!locationSet.has(to)) {
      errors.push(`Road closure 'to' location '${to}' does not exist in the organization.`)
      unknownLocations.push(to)
    }

    if (typeof from === 'string' && typeof to === 'string' && from === to) {
      errors.push(`Road closure endpoints must be distinct; cannot close road from '${from}' to itself.`)
    }

    if (errors.length > 0) {
      return { isValid: false, errors, unknownLocations, unknownVehicles, event: null }
    }

    const validRoadClosure: RoadClosureEvent = {
      type: 'road_closure',
      id: ev.id as string,
      at: ev.at as number,
      from: ev.from as string,
      to: ev.to as string,
    }
    return { isValid: true, errors: [], unknownLocations, unknownVehicles, event: validRoadClosure }
  }

  if (ev.type === 'vehicle_failure') {
    const vehicleId = ev.vehicleId

    if (typeof vehicleId !== 'string' || vehicleId.trim() === '') {
      errors.push('Vehicle failure requires a non-empty `vehicleId`.')
    } else if (!vehicleSet.has(vehicleId)) {
      errors.push(`Vehicle failure references unknown vehicle '${vehicleId}' not in the organization.`)
      unknownVehicles.push(vehicleId)
    }

    if (errors.length > 0) {
      return { isValid: false, errors, unknownLocations, unknownVehicles, event: null }
    }

    const validVehicleFailure: VehicleFailureEvent = {
      type: 'vehicle_failure',
      id: ev.id as string,
      at: ev.at as number,
      vehicleId: ev.vehicleId as string,
    }
    return { isValid: true, errors: [], unknownLocations, unknownVehicles, event: validVehicleFailure }
  }

  if (ev.type === 'urgent_delivery') {
    const delivery = ev.delivery as Record<string, unknown> | undefined

    if (!delivery || typeof delivery !== 'object') {
      errors.push('Urgent delivery event requires a valid `delivery` object.')
      return { isValid: false, errors, unknownLocations, unknownVehicles, event: null }
    }

    if (!delivery.id || typeof delivery.id !== 'string' || delivery.id.trim() === '') {
      errors.push('Urgent delivery is missing a valid `id`.')
    }

    if (!delivery.locationId || typeof delivery.locationId !== 'string' || delivery.locationId.trim() === '') {
      errors.push('Urgent delivery is missing a valid `locationId`.')
    } else if (!locationSet.has(delivery.locationId)) {
      errors.push(`Urgent delivery location '${delivery.locationId}' does not exist in the organization.`)
      unknownLocations.push(delivery.locationId)
    }

    if (typeof delivery.size !== 'number' || !Number.isFinite(delivery.size) || delivery.size <= 0) {
      errors.push('Urgent delivery `size` must be a positive finite number.')
    }

    if (typeof delivery.serviceMin !== 'number' || !Number.isFinite(delivery.serviceMin) || delivery.serviceMin < 0) {
      errors.push('Urgent delivery `serviceMin` must be a non-negative finite number.')
    }

    const window = delivery.window as Record<string, unknown> | undefined
    if (!window || typeof window !== 'object') {
      errors.push('Urgent delivery requires a `window` object with start and end times.')
    } else {
      if (typeof window.start !== 'number' || !Number.isFinite(window.start) || window.start < 0) {
        errors.push('Urgent delivery window `start` must be a non-negative finite number.')
      }
      if (typeof window.end !== 'number' || !Number.isFinite(window.end)) {
        errors.push('Urgent delivery window `end` must be a finite number.')
      } else if (typeof window.start === 'number' && window.end <= window.start) {
        errors.push(`Urgent delivery window end (${window.end}) must be strictly after start (${window.start}).`)
      }
    }

    if (delivery.priority !== 'urgent' && delivery.priority !== 'normal') {
      errors.push(`Urgent delivery priority must be 'urgent' or 'normal', got '${String(delivery.priority)}'.`)
    }

    if (errors.length > 0) {
      return { isValid: false, errors, unknownLocations, unknownVehicles, event: null }
    }

    const validDelivery: Delivery = {
      id: delivery.id as string,
      locationId: delivery.locationId as string,
      size: delivery.size as number,
      serviceMin: delivery.serviceMin as number,
      window: {
        start: (delivery.window as { start: number; end: number }).start,
        end: (delivery.window as { start: number; end: number }).end,
      },
      priority: (delivery.priority as 'normal' | 'urgent') || 'urgent',
    }

    const validUrgentDelivery: UrgentDeliveryEvent = {
      type: 'urgent_delivery',
      id: ev.id as string,
      at: ev.at as number,
      delivery: validDelivery,
    }
    return { isValid: true, errors: [], unknownLocations, unknownVehicles, event: validUrgentDelivery }
  }

  return { isValid: false, errors: ['Unknown error during validation.'], unknownLocations, unknownVehicles, event: null }
}

/**
 * Validates the full InterpretedDisruption structure produced by an interpreter.
 * Ensures fields adhere to the contract and reconciles any event errors into missing / unknownLocations.
 */
export function validateInterpretedDisruption(
  output: unknown,
  knownLocationIds: string[],
  knownVehicleIds: string[]
): InterpretedDisruption {
  if (!output || typeof output !== 'object') {
    throw new ValidationError('Interpreter output must be a non-null object.')
  }

  const raw = output as Record<string, unknown>

  if (typeof raw.rawText !== 'string') {
    throw new ValidationError('Interpreter output requires a string `rawText` property.')
  }

  if (typeof raw.preview !== 'string') {
    throw new ValidationError('Interpreter output requires a string `preview` property.')
  }

  const validConfirmations: ConfirmationState[] = ['pending', 'confirmed', 'rejected']
  if (!validConfirmations.includes(raw.confirmation as ConfirmationState)) {
    throw new ValidationError(`Invalid confirmation state '${String(raw.confirmation)}'.`)
  }

  if (raw.source !== 'placeholder' && raw.source !== 'ai') {
    throw new ValidationError(`Invalid interpreter source '${String(raw.source)}'.`)
  }

  const missing: string[] = Array.isArray(raw.missing) ? raw.missing.map(String) : []
  const unknownLocations: string[] = Array.isArray(raw.unknownLocations) ? raw.unknownLocations.map(String) : []
  const unknownVehicles: string[] = Array.isArray(raw.unknownVehicles) ? raw.unknownVehicles.map(String) : []

  let validatedEvent: DisruptionEvent | null = null

  if (raw.event !== null && raw.event !== undefined) {
    const result = validateDisruptionEvent(raw.event, knownLocationIds, knownVehicleIds)
    if (!result.isValid) {
      // Collect errors into missing and unknownLocations lists
      for (const err of result.errors) {
        if (!missing.includes(err)) missing.push(err)
      }
      for (const loc of result.unknownLocations) {
        if (!unknownLocations.includes(loc)) unknownLocations.push(loc)
      }
      for (const veh of result.unknownVehicles) {
        if (!unknownVehicles.includes(veh)) unknownVehicles.push(veh)
      }
      validatedEvent = null
    } else {
      validatedEvent = result.event
    }
  }

  return {
    rawText: raw.rawText,
    event: validatedEvent,
    missing,
    unknownLocations,
    preview: raw.preview,
    confirmation: raw.confirmation as ConfirmationState,
    source: raw.source as 'placeholder' | 'ai',
    unknownVehicles,
    needsClarification: Boolean(raw.needsClarification),
    clarificationQuestion: typeof raw.clarificationQuestion === 'string' ? raw.clarificationQuestion : undefined,
    inferredFields: Array.isArray(raw.inferredFields) ? raw.inferredFields.map(String) : undefined,
    explicitFields: Array.isArray(raw.explicitFields) ? raw.explicitFields.map(String) : undefined,
    error: typeof raw.error === 'string' ? raw.error : undefined,
  }
}
