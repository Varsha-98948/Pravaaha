import { describe, it, expect } from 'vitest'
import { fmtTime, isValidWindow } from '../src/utils/time'
import { originalPlan, vehicles, deliveries, matrix, revisedPlan } from '../src/data/demo'
import { comparePlans } from '../src/engine/compare'
import { replan } from '../src/engine/replan'
import { computeStops, validateRoute } from '../src/engine/schedule'
import type { Delivery, TravelMatrix, Vehicle } from '../src/types'

describe('time', () => { it('formats', () => { expect(fmtTime(0)).toBe('08:00'); expect(fmtTime(90)).toBe('09:30') }); it('validates', () => { expect(isValidWindow({ start: 10, end: 5 })).toBe(false) }) })
describe('engine', () => {
  it('never exceeds capacity', () => originalPlan.routes.forEach(r => expect(r.load).toBeLessThanOrEqual(vehicles.find(v => v.id === r.vehicleId)!.capacity)))
  it('accounts for every delivery', () => expect(originalPlan.routes.flatMap(r => r.stops).length + originalPlan.unassigned.length).toBe(deliveries.length))
  it('compares', () => { const c = comparePlans(originalPlan, revisedPlan); expect(c.counts.kept + c.counts.moved + c.counts.broken).toBeGreaterThan(0); expect(matrix.depot.depot).toBe(0) })
  it('replan throws until implemented', () => expect(() => replan({ vehicles, deliveries, matrix }, originalPlan, 0)).toThrow())
})

describe('schedule', () => {
  // Shared fixtures
  const van: Vehicle = { id: 'v1', name: 'Van 1', capacity: 50, depotId: 'depot', shiftStart: 0, shiftEnd: 480, status: 'active' }

  const mkDelivery = (id: string, loc: string, size: number, winStart: number, winEnd: number, serviceMin = 10): Delivery =>
    ({ id, locationId: loc, size, serviceMin, window: { start: winStart, end: winEnd }, priority: 'normal' })

  const mkMatrix = (entries: Record<string, Record<string, number>>): TravelMatrix => entries

  const dMap = (...ds: Delivery[]) => new Map(ds.map(d => [d.id, d]))

  it('early arrival: vehicle waits for window to open', () => {
    const d = mkDelivery('d1', 'c1', 5, 60, 120)               // window opens at t=60
    const mat = mkMatrix({ depot: { c1: 10 }, c1: { depot: 0 } }) // arrives at t=10
    const [stop] = computeStops('depot', 0, ['d1'], dMap(d), mat)
    expect(stop.arrival).toBe(10)
    expect(stop.waitMin).toBe(50)                               // waits 50 min
    expect(stop.serviceStart).toBe(60)
    expect(stop.departure).toBe(70)
    expect(stop.status).toBe('pending')
  })

  it('on-time arrival: no waiting, feasible window', () => {
    const d = mkDelivery('d1', 'c1', 5, 0, 120)
    const mat = mkMatrix({ depot: { c1: 20 }, c1: { depot: 0 } })
    const [stop] = computeStops('depot', 0, ['d1'], dMap(d), mat)
    expect(stop.arrival).toBe(20)
    expect(stop.waitMin).toBe(0)
    expect(stop.serviceStart).toBe(20)
    expect(stop.status).toBe('pending')
  })

  it('late arrival: marks stop as late when arrival exceeds window end', () => {
    const d = mkDelivery('d1', 'c1', 5, 0, 30)                 // window closes at t=30
    const mat = mkMatrix({ depot: { c1: 50 }, c1: { depot: 0 } }) // arrives at t=50
    const [stop] = computeStops('depot', 0, ['d1'], dMap(d), mat)
    expect(stop.arrival).toBe(50)
    expect(stop.serviceStart).toBe(50)                          // no window to wait for
    expect(stop.status).toBe('late')
  })

  it('unreachable: missing matrix entry produces skipped stop', () => {
    const d = mkDelivery('d1', 'c1', 5, 0, 120)
    const mat = mkMatrix({ depot: {} })                         // no route to c1
    const [stop] = computeStops('depot', 0, ['d1'], dMap(d), mat)
    expect(stop.arrival).toBe(Infinity)
    expect(stop.status).toBe('skipped')
    expect(stop.waitMin).toBe(0)
  })

  it('unreachable stop: validateRoute reports only unreachable, not late', () => {
    const d = mkDelivery('d1', 'c1', 5, 0, 120)
    const mat = mkMatrix({ depot: {} })
    const stops = computeStops('depot', 0, ['d1'], dMap(d), mat)
    const violations = validateRoute(van, stops, dMap(d))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/unreachable/)
    expect(violations.some(v => v.includes('window'))).toBe(false)
  })

  it('capacity overflow: reports violation', () => {
    const tinyVan: Vehicle = { ...van, capacity: 5 }
    const d = mkDelivery('d1', 'c1', 10, 0, 120)               // size 10 > capacity 5
    const mat = mkMatrix({ depot: { c1: 5 }, c1: { depot: 0 } })
    const stops = computeStops('depot', 0, ['d1'], dMap(d), mat)
    const violations = validateRoute(tinyVan, stops, dMap(d))
    expect(violations.some(v => v.includes('capacity'))).toBe(true)
  })

  it('shift overrun: reports violation when departure exceeds shiftEnd', () => {
    const shortShiftVan: Vehicle = { ...van, shiftEnd: 30 }
    const d = mkDelivery('d1', 'c1', 5, 0, 120, 20)            // service takes 20 min
    const mat = mkMatrix({ depot: { c1: 20 }, c1: { depot: 0 } }) // arrives t=20, departs t=40
    const stops = computeStops('depot', 0, ['d1'], dMap(d), mat)
    expect(stops[0].departure).toBe(40)
    const violations = validateRoute(shortShiftVan, stops, dMap(d))
    expect(violations.some(v => v.includes('shift overrun'))).toBe(true)
  })

  it('computeStops throws for unknown delivery ID', () => {
    const mat = mkMatrix({ depot: { c1: 5 } })
    expect(() => computeStops('depot', 0, ['ghost'], new Map(), mat)).toThrow('Unknown delivery ghost')
  })

  it('validateRoute reports unknown delivery ID as violation', () => {
    // Construct a stop manually for a delivery not in the deliveries map
    const d = mkDelivery('d1', 'c1', 5, 0, 120)
    const mat = mkMatrix({ depot: { c1: 5 }, c1: { depot: 0 } })
    const stops = computeStops('depot', 0, ['d1'], dMap(d), mat)
    // Pass an empty map — delivery is unknown to validateRoute
    const violations = validateRoute(van, stops, new Map())
    expect(violations.some(v => v.includes('unknown delivery'))).toBe(true)
  })

  it('empty route: no violations', () => {
    expect(validateRoute(van, [], dMap())).toHaveLength(0)
    expect(computeStops('depot', 0, [], new Map(), {})).toHaveLength(0)
  })

  it('multi-stop: unreachable leg cascades — all subsequent stops skipped', () => {
    // d1 reachable (depot→c1=10), d2 unreachable (no c1→c2 route), d3 must be skipped too
    const d1 = mkDelivery('d1', 'c1', 5, 0, 120)
    const d2 = mkDelivery('d2', 'c2', 5, 0, 120)               // no route from c1
    const d3 = mkDelivery('d3', 'c3', 5, 0, 240)
    const mat = mkMatrix({ depot: { c1: 10 }, c1: { c3: 15 }, c2: {}, c3: {} })
    const stops = computeStops('depot', 0, ['d1', 'd2', 'd3'], dMap(d1, d2, d3), mat)
    expect(stops[0].status).toBe('pending')                     // d1 reachable
    expect(stops[1].status).toBe('skipped')                     // d2 breaks the route
    expect(stops[2].status).toBe('skipped')                     // d3 cascades — not computed from c1
    expect(stops[2].arrival).toBe(Infinity)
    expect(stops[2].serviceStart).toBe(Infinity)
    expect(stops[2].departure).toBe(Infinity)
  })
})
