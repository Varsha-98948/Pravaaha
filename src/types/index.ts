/** Shared contracts. All times are Minutes from simulation start (0 = start). No React imports here. */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type Minutes = number
export type Role = 'admin' | 'dispatcher' | 'viewer'

// ---------------------------------------------------------------------------
// Org / users
// ---------------------------------------------------------------------------

export interface Organization { id: string; name: string }
export interface UserProfile { id: string; orgId: string; name: string; email: string; role: Role }

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

export interface Location { id: string; name: string; kind: 'depot' | 'customer' }

// ---------------------------------------------------------------------------
// Vehicles / capacity
// ---------------------------------------------------------------------------

export interface Vehicle {
  id: string
  name: string
  /** Maximum load units the vehicle can carry. */
  capacity: number
  depotId: string
  shiftStart: Minutes
  shiftEnd: Minutes
  status: 'active' | 'failed'
}

// ---------------------------------------------------------------------------
// Deliveries / time windows
// ---------------------------------------------------------------------------

export interface TimeWindow { start: Minutes; end: Minutes }

export interface Delivery {
  id: string
  locationId: string
  /** Load units consumed from the assigned vehicle's capacity. */
  size: number
  /** Time required to complete the stop, in minutes. */
  serviceMin: Minutes
  window: TimeWindow
  priority: 'normal' | 'urgent'
}

// ---------------------------------------------------------------------------
// Travel time matrix
// ---------------------------------------------------------------------------

/** matrix[fromLocationId][toLocationId] = travel minutes. A missing entry means the route is unreachable. */
export type TravelMatrix = Record<string, Record<string, Minutes>>

// ---------------------------------------------------------------------------
// Route stops
// ---------------------------------------------------------------------------

export type StopStatus = 'pending' | 'completed' | 'late' | 'skipped'

export interface RouteStop {
  deliveryId: string
  locationId: string
  /** Time the vehicle arrives at the location. */
  arrival: Minutes
  /** Minutes spent waiting for the time window to open (0 when no wait). */
  waitMin: Minutes
  /** Time service begins (= max(arrival, window.start)). */
  serviceStart: Minutes
  /** Time the vehicle departs (= serviceStart + serviceMin). */
  departure: Minutes
  status: StopStatus
}

export interface VehicleRoute {
  vehicleId: string
  stops: RouteStop[]
  /** Total load units loaded onto this vehicle for this route. */
  load: number
}

// ---------------------------------------------------------------------------
// Unassigned deliveries
// ---------------------------------------------------------------------------

export type UnassignedReason =
  | 'capacity'
  | 'time_window'
  | 'no_vehicle'
  | 'unreachable'

export interface UnassignedDelivery {
  deliveryId: string
  reason: UnassignedReason
  detail: string
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export interface DeliveryPlan {
  id: string
  label: string
  /** Simulation time at which this plan was produced. */
  createdAt: Minutes
  routes: VehicleRoute[]
  unassigned: UnassignedDelivery[]
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** A snapshot of a plan saved to durable storage. */
export interface SavedPlan {
  id: string
  orgId: string
  plan: DeliveryPlan
  /** Wall-clock ISO timestamp of when the snapshot was persisted. */
  savedAt: string
  savedBy: string
  note?: string
}

// ---------------------------------------------------------------------------
// Disruption events
// ---------------------------------------------------------------------------

export interface RoadClosureEvent {
  type: 'road_closure'
  id: string
  /** Simulation time the closure takes effect. */
  at: Minutes
  /** Known location ID where the closure starts. */
  from: string
  /** Known location ID where the closure ends. */
  to: string
}

export interface VehicleFailureEvent {
  type: 'vehicle_failure'
  id: string
  /** Simulation time the failure occurs. */
  at: Minutes
  vehicleId: string
  /** Location ID where the vehicle is when it fails, if known. */
  locationId?: string
}

export interface UrgentDeliveryEvent {
  type: 'urgent_delivery'
  id: string
  /** Simulation time the delivery is inserted. */
  at: Minutes
  delivery: Delivery
}

export type DisruptionEvent =
  | RoadClosureEvent
  | VehicleFailureEvent
  | UrgentDeliveryEvent

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------

export interface SimulationState {
  /** Current simulation clock. */
  now: Minutes
  /** Active plan being executed. */
  plan: DeliveryPlan
  /** Disruptions applied so far, in chronological order. */
  events: DisruptionEvent[]
}

// ---------------------------------------------------------------------------
// Plan comparison
// ---------------------------------------------------------------------------

export type DeliveryDecision = 'kept' | 'moved' | 'broken'

/** Named return type for comparePlans. Evaluates deliveries across both original and revised plans. */
export interface PlanComparison {
  /** Per-delivery status keyed by deliveryId for all deliveries evaluated across plans. */
  decisions: Record<string, DeliveryDecision>
  /** Human-readable explanation per deliveryId describing the decision. */
  reasons: Record<string, string>
  counts: { kept: number; moved: number; broken: number }
}

// ---------------------------------------------------------------------------
// Disruption interpreter (AI gateway)
// ---------------------------------------------------------------------------

export type ConfirmationState = 'pending' | 'confirmed' | 'rejected'

export interface InterpretedDisruption {
  rawText: string
  event: DisruptionEvent | null
  /** Fields the interpreter could not resolve. */
  missing: string[]
  /** Location names from text that do not match any known location ID. */
  unknownLocations: string[]
  /** Human-readable summary of what the event would do, shown before confirmation. */
  preview: string
  confirmation: ConfirmationState
  source: 'placeholder' | 'ai'
}
