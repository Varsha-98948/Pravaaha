/** Shared contracts. All times are Minutes from simulation start (0 = start). No React imports here. */
export type Minutes = number
export type Role = 'admin' | 'dispatcher' | 'viewer'
export interface Organization { id: string; name: string }
export interface UserProfile { id: string; orgId: string; name: string; email: string; role: Role }
export interface Location { id: string; name: string; kind: 'depot' | 'customer' }
export interface Vehicle { id: string; name: string; capacity: number; depotId: string; shiftStart: Minutes; shiftEnd: Minutes; status: 'active' | 'failed' }
export interface TimeWindow { start: Minutes; end: Minutes }
export interface Delivery { id: string; locationId: string; size: number; serviceMin: Minutes; window: TimeWindow; priority: 'normal' | 'urgent' }
/** matrix[from][to] = travel minutes */
export type TravelMatrix = Record<string, Record<string, Minutes>>
export type StopStatus = 'pending' | 'completed' | 'late' | 'skipped'
export interface RouteStop { deliveryId: string; locationId: string; arrival: Minutes; serviceStart: Minutes; departure: Minutes; waitMin: Minutes; status: StopStatus }
export interface VehicleRoute { vehicleId: string; stops: RouteStop[]; load: number }
export type DeliveryDecision = 'kept' | 'moved' | 'broken'
export type UnassignedReason = 'capacity' | 'time_window' | 'no_vehicle' | 'unreachable' | 'not_implemented'
export interface UnassignedDelivery { deliveryId: string; reason: UnassignedReason; detail: string }
export interface DeliveryPlan { id: string; label: string; createdAt: Minutes; routes: VehicleRoute[]; unassigned: UnassignedDelivery[] }
export interface RoadClosureEvent { type: 'road_closure'; id: string; at: Minutes; from: string; to: string }
export interface VehicleFailureEvent { type: 'vehicle_failure'; id: string; at: Minutes; vehicleId: string }
export interface UrgentDeliveryEvent { type: 'urgent_delivery'; id: string; at: Minutes; delivery: Delivery }
export type DisruptionEvent = RoadClosureEvent | VehicleFailureEvent | UrgentDeliveryEvent
export interface SimulationState { now: Minutes; plan: DeliveryPlan; events: DisruptionEvent[] }
export type ConfirmationState = 'pending' | 'confirmed' | 'rejected'
export interface InterpretedDisruption { rawText: string; event: DisruptionEvent | null; missing: string[]; unknownLocations: string[]; preview: string; confirmation: ConfirmationState; source: 'placeholder' | 'ai' }
