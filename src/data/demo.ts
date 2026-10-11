import type { Delivery, Location, TravelMatrix, UserProfile, Vehicle } from '../types'
import { allocate } from '../engine/allocate'
import { applyDisruption } from '../engine/disruptions'
const xy: Record<string, [number, number]> = { depot: [0, 0], c1: [2, 5], c2: [6, 3], c3: [8, 8], c4: [-4, 6], c5: [-6, 1], c6: [3, -5], c7: [-3, -6], c8: [9, -2] }
const names = ['Central Depot', 'Greenfield Pharmacy', 'Harbor Grocers', 'Northgate Clinic', 'Riverside Cafe', 'Old Town Hardware', 'Southpoint Market', 'Elm St Bakery', 'Eastside Florist']
export const locations: Location[] = Object.keys(xy).map((id, i) => ({ id, name: names[i], kind: id === 'depot' ? 'depot' : 'customer' }))
export const matrix: TravelMatrix = Object.fromEntries(Object.keys(xy).map(a => [a, Object.fromEntries(Object.keys(xy).map(b => [b, a === b ? 0 : Math.ceil((Math.abs(xy[a][0] - xy[b][0]) + Math.abs(xy[a][1] - xy[b][1])) * 2.5)]))]))
export const vehicles: Vehicle[] = [{ id: 'v1', name: 'Van 1', capacity: 40, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'active' }, { id: 'v2', name: 'Van 2', capacity: 30, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'active' }, { id: 'v3', name: 'Truck 3', capacity: 60, depotId: 'depot', shiftStart: 30, shiftEnd: 480, status: 'active' }]
const dl = (n: number, loc: string, size: number, s: number, e: number, p: Delivery['priority'] = 'normal'): Delivery => ({ id: `d${n}`, locationId: loc, size, serviceMin: 10, window: { start: s, end: e }, priority: p })
export const deliveries: Delivery[] = [dl(1, 'c1', 12, 0, 120), dl(2, 'c2', 18, 30, 150), dl(3, 'c3', 25, 60, 240), dl(4, 'c4', 10, 0, 180), dl(5, 'c5', 22, 90, 300), dl(6, 'c6', 15, 120, 300), dl(7, 'c7', 30, 150, 360), dl(8, 'c8', 14, 180, 400, 'urgent'), dl(9, 'c1', 8, 200, 420)]
export const originalPlan = allocate(vehicles, deliveries, matrix, 'Original plan')
// Seeded sample (NOT live replanning): same baseline allocator re-run after Van 2 fails.
export const revisedPlan = allocate(applyDisruption({ vehicles, deliveries, matrix }, { type: 'vehicle_failure', id: 'e1', at: 90, vehicleId: 'v2' }).vehicles, deliveries, matrix, 'Revised plan (sample: Van 2 failed)')
export const users: UserProfile[] = [{ id: 'u1', orgId: 'o1', name: 'Priya Nair', email: 'priya@harborlogistics.example', role: 'admin' }, { id: 'u2', orgId: 'o1', name: 'Marcus Lee', email: 'marcus@harborlogistics.example', role: 'dispatcher' }, { id: 'u3', orgId: 'o1', name: 'Ana Costa', email: 'ana@harborlogistics.example', role: 'viewer' }]
export const locName = (id: string) => locations.find(l => l.id === id)?.name ?? id
