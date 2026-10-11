/**
 * disruptions.ts — Disruption Event Engine for Pravaaha
 *
 * All times are simulation Minutes (0 = day start, 480 = end of an 8-hour shift).
 * No wall-clock time, no external APIs, no GPS.
 *
 * Public API consumed by the replanning engine
 * ─────────────────────────────────────────────
 *  World                  — simulation snapshot (vehicles, deliveries, matrix, closures)
 *  TimedClosure           — registered road closure with preserved original travel times
 *  CLOSED_MIN             — sentinel stored in effective matrices for impassable roads
 *  DisruptionValidationError — structured error thrown by all validation functions
 *
 *  buildMatrixAt(world, now)        — effective TravelMatrix respecting closure timing
 *  validateDisruptionEvent(e, world) — pure validation gate; never mutates
 *  applyDisruption(world, e)        — pure world transform; returns new World
 *  applyDisruptionBatch(world, events) — chronological batch apply with dedup
 *
 *  analyseDisruption(e, world, plan) — validate + produce structured DisruptionEffect
 *  analyseRoadClosure(e, world, plan)
 *  analyseBreakdown(e, world, plan)
 *  validateUrgentDelivery(e, world)
 */

import type {
  Delivery,
  DeliveryPlan,
  DisruptionEvent,
  Location,
  Minutes,
  RoadClosureEvent,
  RouteStop,
  TravelMatrix,
  UrgentDeliveryEvent,
  Vehicle,
  VehicleFailureEvent,
  VehicleRoute,
} from '../types'
import { isValidWindow } from '../utils/time'

// ─────────────────────────────────────────────────────────────────────────────
// TimedClosure — preserves original travel times alongside closure metadata
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A registered road closure.  Stored separately from the travel-time matrix so
 * that original travel times are never lost and closure timing can be respected:
 * a closure is only active when simulationNow >= closure.at.
 *
 * Use buildMatrixAt(world, now) to obtain a TravelMatrix with active closures
 * applied.  world.matrix always holds the original, unmodified travel times.
 */
export interface TimedClosure {
  /** Matches the originating RoadClosureEvent.id; used for deduplication. */
  eventId: string
  from: string
  to: string
  /** Half-open interval start: closure is active for now >= at. */
  at: Minutes
  /** Original world.matrix[from][to] before the closure. */
  originalForward: Minutes
  /** Original world.matrix[to][from] before the closure. */
  originalBackward: Minutes
}

// ─────────────────────────────────────────────────────────────────────────────
// World
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Live simulation snapshot.  Treat as immutable — every engine function that
 * changes state returns a new World object.
 */
export interface World {
  vehicles: Vehicle[]
  deliveries: Delivery[]
  /**
   * Baseline travel-time matrix.  Never modified by road-closure events.
   * Use buildMatrixAt(world, now) when scheduling or replanning so that
   * only currently-active closures are reflected.
   */
  matrix: TravelMatrix
  /**
   * All registered closures.  Absent when no closures have been applied (e.g.
   * World objects constructed by demo.ts or tests).  Default: [].
   *
   * Integration note: allocate.ts and schedule.ts consume world.matrix directly.
   * Until they are updated to call buildMatrixAt, the caller must pass the result
   * of buildMatrixAt as the matrix argument to those functions.
   */
  activeClosures?: TimedClosure[]
  /**
   * Canonical location list.  When provided, used as the authoritative source
   * for location-ID validation.  When absent (minimal World without locations),
   * validation falls back to matrix-row presence only — see each validator for
   * the exact fallback behaviour.
   */
  locations?: Location[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sentinel substituted into effective matrices for closed roads.
 * Large enough that any route using it fails capacity/window checks in the
 * existing schedule.ts and allocate.ts.  Not Infinity so JSON round-trips safely.
 */
export const CLOSED_MIN = 9_999

// ─────────────────────────────────────────────────────────────────────────────
// Structured error
// ─────────────────────────────────────────────────────────────────────────────

export class DisruptionValidationError extends Error {
  constructor(
    public readonly eventId: string,
    public readonly eventType: string,
    public readonly reason: string,
  ) {
    super(`[${eventType}/${eventId}] ${reason}`)
    this.name = 'DisruptionValidationError'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Effect types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single route stop whose inbound leg uses a closing road.
 *
 * Modelling note: RouteStop records arrival/departure *at the stop location*,
 * not leg-entry/leg-exit timestamps.  Road-entry time is approximated as the
 * departure of the immediately preceding stop (or vehicle.shiftStart for the
 * first stop).  This is exact for point-to-point travel and accurate for any
 * sequential chain because travel is modelled as continuous motion starting at
 * departure from the prior location.
 */
export interface BlockedStop {
  stop: RouteStop
  /** Departure time of the prior stop — earliest moment the vehicle could enter the road. */
  estimatedRoadEntryTime: Minutes
  /**
   * True when the vehicle entered the road before the closure took effect
   * (roadEntry < closureStart AND stop.arrival > closureStart).
   * Such vehicles complete their current traversal; they are NOT blocked.
   * Flagged here so dispatchers have the full picture.
   */
  alreadyOnRoad: boolean
}

export interface RoadClosureEffect {
  type: 'road_closure'
  event: RoadClosureEvent
  /** Closure is active for now >= closureStart (half-open interval). */
  closureStart: Minutes
  /**
   * Always Infinity: RoadClosureEvent carries no end field.
   * Integration blocker: if bounded closures are needed, an `end?: Minutes`
   * field must be added to RoadClosureEvent in src/types/index.ts.
   */
  closureEnd: Minutes
  affectedRoutes: Array<{
    vehicleId: string
    blockedStops: BlockedStop[]
  }>
}

export interface BreakdownEffect {
  type: 'vehicle_failure'
  event: VehicleFailureEvent
  failedAt: Minutes
  /**
   * Best-approximated location of the vehicle at failedAt:
   *   - Service in progress → the stop being serviced (vehicle is physically there)
   *   - En route            → the departure point of the current leg (last known position)
   *   - Not yet departed    → vehicle.depotId
   */
  lastKnownLocationId: string
  /**
   * The stop whose delivery is incomplete at failedAt.  May be a stop the
   * vehicle is en route to, or one where service started but did not finish.
   * Null when the vehicle failed before starting its first leg or after
   * completing all scheduled stops.
   */
  inProgressStop: RouteStop | null
  /**
   * Distinguishes whether the vehicle was en route ('travel') or at the stop ('service')
   * when the breakdown occurred. Null when there is no in-progress stop.
   */
  inProgressPhase?: 'travel' | 'service' | null
  /** Stops where service was completed and the vehicle departed before failedAt. */
  completedStops: RouteStop[]
  /** Stops not yet begun at failedAt; their deliveries must be reassigned. */
  remainingStops: RouteStop[]
  /** Union of inProgressStop and remainingStops delivery IDs for the planner. */
  affectedDeliveryIds: string[]
}

export interface UrgentDeliveryEffect {
  type: 'urgent_delivery'
  event: UrgentDeliveryEvent
  /** Validated Delivery ready to be added to the world and passed to the planner. */
  delivery: Delivery
}

export type DisruptionEffect = RoadClosureEffect | BreakdownEffect | UrgentDeliveryEffect

// ─────────────────────────────────────────────────────────────────────────────
// buildMatrixAt — timed-closure-aware effective matrix
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the effective TravelMatrix at simulation minute `now`.
 *
 * Only closures where now >= closure.at are applied.  world.matrix is never
 * modified.  Returns world.matrix by reference when no closures are active.
 *
 * Multiple closures on the same road are applied cumulatively: all active
 * closures set CLOSED_MIN for their leg, so a road covered by more than one
 * active closure remains closed until every covering closure is removed.
 *
 * Limitation — in-transit vehicles:
 *   buildMatrixAt produces a routing matrix snapshot valid at `now`; it does
 *   NOT detect or correct for vehicles that entered a road before the closure
 *   began.  Whether a vehicle already on the road should complete its traversal
 *   or be stopped is a replanning policy decision that requires inspecting the
 *   current plan's RouteStop timestamps alongside the closure time.  Use
 *   analyseRoadClosure() to identify those vehicles; do not rely on this
 *   function alone to handle in-transit semantics.
 *
 * Integration requirement:
 *   allocate.ts and schedule.ts consume world.matrix directly.  Pass the
 *   result of buildMatrixAt(world, now) as the matrix argument to those
 *   functions when replanning after a closure event.
 */
export function buildMatrixAt(world: World, now: Minutes): TravelMatrix {
  const closures = world.activeClosures ?? []
  const active = closures.filter((c) => now >= c.at)
  if (active.length === 0) return world.matrix

  // Clone only the affected rows. Processing all active closures in sequence
  // is safe: spreading an already-cloned row simply re-clones it, which
  // preserves CLOSED_MIN set by an earlier closure on the same leg.
  const m: TravelMatrix = { ...world.matrix }
  for (const c of active) {
    if (m[c.from] !== undefined) m[c.from] = { ...m[c.from], [c.to]: CLOSED_MIN }
    if (m[c.to] !== undefined) m[c.to] = { ...m[c.to], [c.from]: CLOSED_MIN }
  }
  return m
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function findLocation(world: World, id: string): Location | undefined {
  return world.locations?.find((l) => l.id === id)
}

function getVehicleRoute(plan: DeliveryPlan, vehicleId: string): VehicleRoute {
  return (
    plan.routes.find((r) => r.vehicleId === vehicleId) ?? { vehicleId, stops: [], load: 0 }
  )
}

function areDeliveriesIdentical(a: Delivery, b: Delivery): boolean {
  return (
    a.id === b.id &&
    a.locationId === b.locationId &&
    a.size === b.size &&
    a.serviceMin === b.serviceMin &&
    a.window.start === b.window.start &&
    a.window.end === b.window.end &&
    (a.priority ?? 'urgent') === (b.priority ?? 'urgent')
  )
}

function areEventsIdentical(a: DisruptionEvent, b: DisruptionEvent): boolean {
  if (a.id !== b.id || a.type !== b.type || a.at !== b.at) return false
  if (a.type === 'road_closure' && b.type === 'road_closure') {
    return a.from === b.from && a.to === b.to
  }
  if (a.type === 'vehicle_failure' && b.type === 'vehicle_failure') {
    return a.vehicleId === b.vehicleId
  }
  if (a.type === 'urgent_delivery' && b.type === 'urgent_delivery') {
    return areDeliveriesIdentical(a.delivery, b.delivery)
  }
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation — pure; no side effects; throws DisruptionValidationError
// ─────────────────────────────────────────────────────────────────────────────

function requireId(id: string | undefined, type: string): void {
  if (!id?.trim()) {
    throw new DisruptionValidationError(id ?? '(missing)', type, 'Event id is required')
  }
}

function validateRoadClosure(e: RoadClosureEvent, world: World): void {
  requireId(e.id, e.type)
  if (!Number.isFinite(e.at) || e.at < 0)
    throw new DisruptionValidationError(e.id, e.type, `Invalid closure time: ${e.at}`)
  if (!e.from?.trim() || !e.to?.trim())
    throw new DisruptionValidationError(e.id, e.type, 'Both from and to location IDs are required')
  if (e.from === e.to)
    throw new DisruptionValidationError(e.id, e.type, `from and to must differ; got '${e.from}'`)

  // Location validation: authoritative source is world.locations when present;
  // matrix-row presence is the fallback when locations are not loaded.
  if (world.locations) {
    if (!findLocation(world, e.from))
      throw new DisruptionValidationError(e.id, e.type, `Unknown location '${e.from}'`)
    if (!findLocation(world, e.to))
      throw new DisruptionValidationError(e.id, e.type, `Unknown location '${e.to}'`)
  } else {
    // Fallback: matrix-row presence.  This is weaker than location-list membership.
    // Callers that require authoritative validation must include world.locations.
    if (world.matrix[e.from] === undefined)
      throw new DisruptionValidationError(e.id, e.type, `No matrix row for '${e.from}' (locations not loaded)`)
    if (world.matrix[e.to] === undefined)
      throw new DisruptionValidationError(e.id, e.type, `No matrix row for '${e.to}' (locations not loaded)`)
  }

  if (world.matrix[e.from]?.[e.to] === undefined)
    throw new DisruptionValidationError(e.id, e.type, `No matrix entry for '${e.from}' to '${e.to}'`)
}

function validateVehicleFailure(e: VehicleFailureEvent, world: World): void {
  requireId(e.id, e.type)
  if (!Number.isFinite(e.at) || e.at < 0)
    throw new DisruptionValidationError(e.id, e.type, `Invalid failure time: ${e.at}`)
  if (!e.vehicleId?.trim())
    throw new DisruptionValidationError(e.id, e.type, 'vehicleId is required')
  if (!world.vehicles.find((v) => v.id === e.vehicleId))
    throw new DisruptionValidationError(e.id, e.type, `Unknown vehicle '${e.vehicleId}'`)
  // A vehicle that is already failed is still valid (idempotent re-application allowed).
}

function validateUrgentDeliveryEvent(e: UrgentDeliveryEvent, world: World): void {
  requireId(e.id, e.type)
  if (!Number.isFinite(e.at) || e.at < 0)
    throw new DisruptionValidationError(e.id, e.type, `Invalid event time: ${e.at}`)

  const d = e.delivery
  if (!d)
    throw new DisruptionValidationError(e.id, e.type, 'delivery payload is missing')
  if (!d.id?.trim())
    throw new DisruptionValidationError(e.id, e.type, 'delivery.id is required')

  // Reject conflicting delivery IDs; allow exact replays for idempotency.
  const existingDelivery = world.deliveries.find((x) => x.id === d.id)
  if (existingDelivery !== undefined) {
    if (!areDeliveriesIdentical(existingDelivery, { ...d, priority: 'urgent' })) {
      throw new DisruptionValidationError(
        e.id,
        e.type,
        `Delivery id '${d.id}' already exists with conflicting data — cannot overwrite`,
      )
    }
  }

  if (!d.locationId?.trim())
    throw new DisruptionValidationError(e.id, e.type, 'delivery.locationId is required')

  if (world.locations) {
    if (!findLocation(world, d.locationId))
      throw new DisruptionValidationError(e.id, e.type, `Unknown location '${d.locationId}'`)
  } else {
    if (world.matrix[d.locationId] === undefined)
      throw new DisruptionValidationError(e.id, e.type, `Destination '${d.locationId}' unreachable (no matrix row; locations not loaded)`)
  }

  if (!Number.isFinite(d.size) || d.size <= 0)
    throw new DisruptionValidationError(e.id, e.type, `delivery.size must be > 0, got ${d.size}`)
  if (!Number.isFinite(d.serviceMin) || d.serviceMin < 0)
    throw new DisruptionValidationError(e.id, e.type, `delivery.serviceMin must be >= 0, got ${d.serviceMin}`)
  if (!d.window || !isValidWindow(d.window))
    throw new DisruptionValidationError(e.id, e.type, `delivery.window invalid: ${JSON.stringify(d.window)}`)
  if (d.priority !== 'urgent')
    throw new DisruptionValidationError(e.id, e.type, `delivery.priority must be 'urgent', got '${d.priority}'`)
}

/**
 * Pure validation gate for any DisruptionEvent.  Throws DisruptionValidationError
 * on the first problem.  The world is never modified.
 *
 * Call this before applyDisruption to keep validation and mutation separated.
 * Unsupported event types produce an explicit error (no silent fallthrough).
 */
export function validateDisruptionEvent(e: DisruptionEvent, world: World): void {
  switch (e.type) {
    case 'road_closure':      return validateRoadClosure(e, world)
    case 'vehicle_failure':   return validateVehicleFailure(e, world)
    case 'urgent_delivery':   return validateUrgentDeliveryEvent(e, world)
    default: {
      const _: never = e
      throw new DisruptionValidationError(
        (e as { id?: string }).id ?? '(unknown)',
        (e as { type?: string }).type ?? 'unknown',
        'Unsupported event type',
      )
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysis functions — pure; validate then describe the effect
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Identify which stops in the current plan are affected by a road closure.
 *
 * A stop is affected when the inbound leg uses the closing road.  The vehicle's
 * road-entry time is approximated as the departure of the immediately preceding
 * stop (or vehicle.shiftStart for the first stop in the route).
 *
 * Affected stops are separated into two groups:
 *   alreadyOnRoad = true  — vehicle entered before closureStart; will complete traversal
 *   alreadyOnRoad = false — vehicle has not entered yet; it is blocked by the closure
 *
 * Does NOT mutate the world.  Call applyDisruption to register the closure.
 */
export function analyseRoadClosure(
  e: RoadClosureEvent,
  world: World,
  plan: DeliveryPlan,
): RoadClosureEffect {
  const closureStart = e.at
  const closureEnd = Infinity // RoadClosureEvent has no end field

  const affectedRoutes: RoadClosureEffect['affectedRoutes'] = []

  for (const route of plan.routes) {
    const vehicle = world.vehicles.find((v) => v.id === route.vehicleId)
    if (!vehicle) continue

    const blockedStops: BlockedStop[] = []

    for (let i = 0; i < route.stops.length; i++) {
      const stop = route.stops[i]
      const fromLoc = i === 0 ? vehicle.depotId : route.stops[i - 1].locationId
      const toLoc = stop.locationId

      // Check both directions; the matrix is symmetric in the demo world.
      const usesClosedRoad =
        (fromLoc === e.from && toLoc === e.to) ||
        (fromLoc === e.to && toLoc === e.from)
      if (!usesClosedRoad) continue

      const estimatedRoadEntryTime: Minutes =
        i === 0 ? vehicle.shiftStart : route.stops[i - 1].departure

      // Vehicle entered the road before the closure began and has not yet arrived.
      const alreadyOnRoad =
        estimatedRoadEntryTime < closureStart && stop.arrival > closureStart

      blockedStops.push({ stop, estimatedRoadEntryTime, alreadyOnRoad })
    }

    if (blockedStops.length > 0) {
      affectedRoutes.push({ vehicleId: route.vehicleId, blockedStops })
    }
  }

  return { type: 'road_closure', event: e, closureStart, closureEnd, affectedRoutes }
}

/**
 * Partition the vehicle's planned route into completed, in-progress, and
 * remaining stops at the moment of breakdown (e.at).
 *
 * Stop classification uses an explicit boolean cutoff so that as soon as the
 * first non-completed stop is found, every subsequent stop is unconditionally
 * classified as remaining.  Road-entry times are never re-evaluated after the
 * cutoff is reached.
 *
 *   COMPLETED     stop.departure <= failedAt
 *                 Service finished and vehicle has departed.  Delivery is
 *                 fulfilled.  Note: stop.departure is serviceStart + serviceMin;
 *                 a stop is NOT complete if service started but failedAt falls
 *                 before departure (that is the service-in-progress case below).
 *
 *   IN-PROGRESS   roadEntry <= failedAt AND stop.departure > failedAt
 *                 Vehicle has committed to this stop (departed the prior
 *                 location) but has not finished service.  Two sub-cases:
 *                   (a) failedAt < stop.arrival  — breakdown en route
 *                   (b) stop.arrival <= failedAt — breakdown during service
 *                 Either way the delivery is NOT fulfilled and must be
 *                 reassigned or marked unserviceable.
 *
 *   REMAINING     roadEntry > failedAt
 *                 Vehicle had not yet started this leg.  Delivery unaffected
 *                 so far; must be reassigned.
 *
 * roadEntry for stop i = stops[i-1].departure, or vehicle.shiftStart for i=0.
 */
export function analyseBreakdown(
  e: VehicleFailureEvent,
  world: World,
  plan: DeliveryPlan,
): BreakdownEffect {
  const vehicle = world.vehicles.find((v) => v.id === e.vehicleId)
  if (!vehicle)
    throw new DisruptionValidationError(e.id, e.type, `Vehicle '${e.vehicleId}' not found`)

  const route = getVehicleRoute(plan, e.vehicleId)
  const failedAt = e.at

  const completedStops: RouteStop[] = []
  let inProgressStop: RouteStop | null = null
  const remainingStops: RouteStop[] = []

  // cutoffReached is set to true the moment the first non-completed stop is
  // found.  Every stop after that point is pushed to remainingStops directly
  // without re-evaluating roadEntry, because the route is sequential and a
  // vehicle cannot skip ahead.
  let cutoffReached = false

  for (let i = 0; i < route.stops.length; i++) {
    if (cutoffReached) {
      remainingStops.push(route.stops[i])
      continue
    }

    const stop = route.stops[i]
    // roadEntry is the moment the vehicle committed to travelling toward this
    // stop: either its shift start (for the first stop) or the departure time
    // of the immediately preceding stop.
    const roadEntry: Minutes = i === 0 ? vehicle.shiftStart : route.stops[i - 1].departure

    if (stop.departure <= failedAt) {
      // Service complete and vehicle departed before the breakdown.
      // stop.departure = serviceStart + serviceMin, so this confirms the
      // delivery was fully executed.
      completedStops.push(stop)
    } else if (roadEntry <= failedAt) {
      // Vehicle started this leg before the breakdown but has not finished
      // service.  Sub-case (a): en route (failedAt < arrival).
      // Sub-case (b): service in progress (arrival <= failedAt < departure).
      // In both cases the delivery is unserved.
      inProgressStop = stop
      cutoffReached = true
    } else {
      // roadEntry > failedAt: vehicle had not yet departed toward this stop.
      remainingStops.push(stop)
      cutoffReached = true
    }
  }

  // Determine the best-known location at failedAt.
  let lastKnownLocationId: string
  if (inProgressStop !== null) {
    const idx = route.stops.indexOf(inProgressStop)
    if (failedAt >= inProgressStop.arrival) {
      // Vehicle arrived and is being serviced — it is physically at the stop.
      lastKnownLocationId = inProgressStop.locationId
    } else {
      // Vehicle is in transit — last known is the point it departed.
      lastKnownLocationId = idx === 0 ? vehicle.depotId : route.stops[idx - 1].locationId
    }
  } else if (completedStops.length > 0) {
    lastKnownLocationId = completedStops[completedStops.length - 1].locationId
  } else {
    lastKnownLocationId = vehicle.depotId
  }

  const affectedDeliveryIds: string[] = [
    ...(inProgressStop ? [inProgressStop.deliveryId] : []),
    ...remainingStops.map((s) => s.deliveryId),
  ]

  const inProgressPhase: 'travel' | 'service' | null = inProgressStop
    ? (failedAt < inProgressStop.arrival ? 'travel' : 'service')
    : null

  return {
    type: 'vehicle_failure',
    event: e,
    failedAt,
    lastKnownLocationId,
    inProgressStop,
    inProgressPhase,
    completedStops,
    remainingStops,
    affectedDeliveryIds,
  }
}

/**
 * Validate and extract the urgent delivery.
 * Returns the Delivery in the exact shape expected by allocate/schedule/replan.
 * Does not assign a vehicle; the planner handles scheduling.
 */
export function validateUrgentDelivery(
  e: UrgentDeliveryEvent,
  world: World,
): UrgentDeliveryEffect {
  validateUrgentDeliveryEvent(e, world)
  return { type: 'urgent_delivery', event: e, delivery: { ...e.delivery, priority: 'urgent' } }
}

// ─────────────────────────────────────────────────────────────────────────────
// applyDisruption — pure world transformation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure: apply a single disruption event to the world.  Returns a new World.
 * The input is never mutated.
 *
 * Validation is the caller's responsibility (call validateDisruptionEvent
 * first).  applyDisruption includes idempotency guards for safe re-application
 * of the same event, and explicit conflict detection for events that share an
 * ID or key but carry different data.
 *
 * Event-activation timing:
 *   applyDisruption does not know the current simulation time.  The caller is
 *   responsible for ensuring e.at <= now before calling this function.  In
 *   applyDisruptionBatch the `now` parameter enforces this boundary.  Callers
 *   that invoke applyDisruption directly must perform the check themselves.
 *
 * road_closure
 *   Registers a TimedClosure in world.activeClosures.  world.matrix is NOT
 *   modified.  Use buildMatrixAt(world, now) for the effective matrix.
 *   Idempotent replay (same eventId, same data): returns world unchanged.
 *   Conflict (same eventId, different road): throws DisruptionValidationError.
 *
 * vehicle_failure
 *   Sets vehicle.status = 'failed'.  Structurally idempotent.
 *
 * urgent_delivery
 *   Appends the delivery to world.deliveries with priority = 'urgent'.
 *   Idempotent replay (same delivery.id from the same event): returns world
 *   unchanged.
 *   Conflict (same delivery.id from a different event): throws
 *   DisruptionValidationError — the planner cannot handle two distinct
 *   deliveries that share an ID.
 */
export function applyDisruption(w: World, e: DisruptionEvent): World {
  switch (e.type) {
    case 'vehicle_failure': {
      const v = w.vehicles.find((x) => x.id === e.vehicleId)
      if (v?.status === 'failed') return w
      return {
        ...w,
        vehicles: w.vehicles.map((v) =>
          v.id === e.vehicleId ? { ...v, status: 'failed' } : v,
        ),
      }
    }

    case 'urgent_delivery': {
      const existing = w.deliveries.find((d) => d.id === e.delivery.id)
      if (existing !== undefined) {
        // Same delivery.id found in the world. Determine whether this is a
        // harmless replay of the same event or a genuine data conflict.
        const isReplay = areDeliveriesIdentical(existing, { ...e.delivery, priority: 'urgent' })
        if (isReplay) return w // idempotent: same event applied again
        throw new DisruptionValidationError(
          e.id,
          e.type,
          `Delivery id '${e.delivery.id}' already exists with conflicting data — cannot overwrite`,
        )
      }
      return {
        ...w,
        deliveries: [...w.deliveries, { ...e.delivery, priority: 'urgent' }],
      }
    }

    case 'road_closure': {
      const closures = w.activeClosures ?? []
      const existing = closures.find((c) => c.eventId === e.id)
      if (existing !== undefined) {
        // Same eventId already registered. Verify it covers the same road and timing to
        // detect conflicting events sharing an ID.
        if (existing.from !== e.from || existing.to !== e.to || existing.at !== e.at) {
          throw new DisruptionValidationError(
            e.id,
            e.type,
            `Event id '${e.id}' already registered with conflicting data ` +
              `(registered: '${existing.from}' to '${existing.to}' at ${existing.at}; ` +
              `incoming: '${e.from}' to '${e.to}' at ${e.at})`,
          )
        }
        return w // idempotent: same closure applied again
      }

      // Preserve baseline travel times. If an earlier closure on this road was
      // already registered, reuse its baseline travel times so multiple closures
      // affecting the same road never capture CLOSED_MIN as their baseline.
      const prior = closures.find(
        (c) => (c.from === e.from && c.to === e.to) || (c.from === e.to && c.to === e.from),
      )
      const originalForward: Minutes =
        prior !== undefined && prior.originalForward !== CLOSED_MIN
          ? prior.originalForward
          : (w.matrix[e.from]?.[e.to] ?? CLOSED_MIN)
      const originalBackward: Minutes =
        prior !== undefined && prior.originalBackward !== CLOSED_MIN
          ? prior.originalBackward
          : (w.matrix[e.to]?.[e.from] ?? CLOSED_MIN)

      const newClosure: TimedClosure = {
        eventId: e.id,
        from: e.from,
        to: e.to,
        at: e.at,
        originalForward,
        originalBackward,
      }
      return { ...w, activeClosures: [...closures, newClosure] }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// applyDisruptionBatch — chronological deterministic batch application
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure: apply a batch of disruption events to the world in chronological,
 * deterministic order, enforcing event-activation time boundaries.
 *
 * Parameters:
 *   world  — current simulation world
 *   events — batch to apply
 *   now    — optional current simulation time (Minutes). Only events where e.at <= now
 *            are eligible for application. Events scheduled in the future
 *            (e.at > now) are recorded in `future` and not applied; they must
 *            be re-submitted in a later call once simulation time advances.
 *            When omitted (undefined), all events are processed immediately
 *            to preserve backward compatibility.
 *
 * Sort key within eligible events (primary → secondary → tertiary):
 *   1. e.at ascending        — earlier sim-time events take effect first
 *   2. type rank ascending   — road_closure(0), vehicle_failure(1), urgent_delivery(2)
 *                              within a tick: road state stable before fleet/delivery
 *   3. e.id lexicographic    — stable tie-breaking for simultaneous same-type events
 *
 * Duplicate and conflict handling within a batch:
 *   Replaying the exact same event id with identical data preserves idempotency:
 *   the duplicate is recorded in `skipped`. Reusing an event id or urgent delivery id
 *   with conflicting data is explicitly detected and recorded in `rejected`.
 *
 * Validation:
 *   Each eligible event is validated before application. A failure records the
 *   event in `rejected` without mutating the accumulated world. Subsequent
 *   events in the batch are unaffected.
 *
 * Integration requirement — activation timing:
 *   Omitting `now` activates all events immediately without checking simulation
 *   time. Callers synchronizing with simulation progress (e.g. simulation loops
 *   or interactive UI) MUST supply `now` so that future disruptions are deferred
 *   to `future` rather than prematurely applied.
 *
 * Returns { world, applied, future, rejected, skipped }.
 */
export function applyDisruptionBatch(
  world: World,
  events: DisruptionEvent[],
  now?: Minutes,
): {
  world: World
  applied: DisruptionEvent[]
  future: DisruptionEvent[]
  rejected: Array<{ event: DisruptionEvent; reason: string }>
  skipped: string[]
} {
  const typeRank: Record<DisruptionEvent['type'], number> = {
    road_closure: 0,
    vehicle_failure: 1,
    urgent_delivery: 2,
  }

  // Partition into eligible (e.at <= now) and future (e.at > now) when now is supplied.
  // When now is omitted (undefined), backward compatibility requires processing all events.
  const future: DisruptionEvent[] = []
  const eligible: DisruptionEvent[] = []
  for (const e of events) {
    if (now !== undefined && e.at > now) future.push(e)
    else eligible.push(e)
  }

  const sorted = eligible.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at
    const td = typeRank[a.type] - typeRank[b.type]
    if (td !== 0) return td
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  let currentWorld = world
  const applied: DisruptionEvent[] = []
  const rejected: Array<{ event: DisruptionEvent; reason: string }> = []
  const skipped: string[] = []
  const seenEventsById = new Map<string, DisruptionEvent>()
  const seenDeliveriesById = new Map<string, Delivery>()

  for (const e of sorted) {
    const prevEvent = seenEventsById.get(e.id)
    if (prevEvent !== undefined) {
      if (areEventsIdentical(prevEvent, e)) {
        skipped.push(e.id)
        continue
      }
      rejected.push({
        event: e,
        reason: `Conflicting event id '${e.id}' carries different data`,
      })
      continue
    }

    if (e.type === 'urgent_delivery') {
      const prevDelivery = seenDeliveriesById.get(e.delivery.id)
      if (prevDelivery !== undefined) {
        if (!areDeliveriesIdentical(prevDelivery, e.delivery)) {
          rejected.push({
            event: e,
            reason: `Urgent delivery id '${e.delivery.id}' already present in batch with conflicting data`,
          })
          continue
        }
      } else {
        seenDeliveriesById.set(e.delivery.id, e.delivery)
      }
    }

    seenEventsById.set(e.id, e)

    try {
      validateDisruptionEvent(e, currentWorld)
      const nextWorld = applyDisruption(currentWorld, e)
      if (nextWorld === currentWorld) {
        // Event had already been applied in currentWorld (cross-batch replay)
        skipped.push(e.id)
      } else {
        currentWorld = nextWorld
        applied.push(e)
      }
    } catch (err) {
      rejected.push({
        event: e,
        reason: err instanceof Error ? err.message : String(err),
      })
      // currentWorld unchanged on failure; next events are unaffected.
    }
  }

  return { world: currentWorld, applied, future, rejected, skipped }
}

// ─────────────────────────────────────────────────────────────────────────────
// analyseDisruption — validate then describe a single event's effect
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pure: validate then produce a structured DisruptionEffect for one event.
 * Does NOT mutate the world.  Throws DisruptionValidationError on invalid input.
 *
 * This is the primary interface through which the replanning engine reasons
 * about what needs to change: which deliveries to reassign, which roads are
 * blocked, and which new deliveries to schedule.
 */
export function analyseDisruption(
  e: DisruptionEvent,
  world: World,
  plan: DeliveryPlan,
): DisruptionEffect {
  validateDisruptionEvent(e, world)
  switch (e.type) {
    case 'road_closure':    return analyseRoadClosure(e, world, plan)
    case 'vehicle_failure': return analyseBreakdown(e, world, plan)
    case 'urgent_delivery': return validateUrgentDelivery(e, world)
  }
}
