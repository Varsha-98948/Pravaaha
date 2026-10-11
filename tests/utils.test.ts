import { describe, it, expect } from 'vitest'
import { fmtTime, isValidWindow } from '../src/utils/time'
import { originalPlan, vehicles, deliveries, matrix, revisedPlan } from '../src/data/demo'
import { comparePlans } from '../src/engine/compare'
import { replan } from '../src/engine/replan'
import { computeStops, validatePlan, validateRoute } from '../src/engine/schedule'
import type { Delivery, DeliveryPlan, RouteStop, TravelMatrix, Vehicle } from '../src/types'

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

  it('pending stop arriving after its window: validateRoute detects time window violation', () => {
    const d = mkDelivery('d1', 'c1', 5, 0, 30)                 // window closes at t=30
    const stop: RouteStop = {
      deliveryId: 'd1',
      locationId: 'c1',
      arrival: 50,                                             // arrives after window end
      waitMin: 0,
      serviceStart: 50,
      departure: 60,
      status: 'pending',                                       // incorrectly marked pending
    }
    const violations = validateRoute(van, [stop], dMap(d))
    expect(violations.some(v => v.includes('misses time window'))).toBe(true)
  })

  it('pending stop with non-finite timing values: validateRoute detects unreachable violation', () => {
    const d = mkDelivery('d1', 'c1', 5, 0, 120)
    const stop: RouteStop = {
      deliveryId: 'd1',
      locationId: 'c1',
      arrival: Infinity,                                       // non-finite timing values
      waitMin: 0,
      serviceStart: Infinity,
      departure: Infinity,
      status: 'pending',                                       // incorrectly marked pending
    }
    const violations = validateRoute(van, [stop], dMap(d))
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatch(/unreachable/)
    expect(violations.some(v => v.includes('window'))).toBe(false)
  })

  it('stop timing: rejects negative waitMin', () => {
    const d = mkDelivery('d1', 'c1', 5, 0, 120)
    const stop: RouteStop = { deliveryId: 'd1', locationId: 'c1', arrival: 20, waitMin: -5, serviceStart: 15, departure: 25, status: 'pending' }
    const violations = validateRoute(van, [stop], dMap(d))
    expect(violations.some(v => v.includes('invalid stop timing'))).toBe(true)
  })

  it('stop timing: rejects serviceStart not equal to arrival + waitMin', () => {
    const d = mkDelivery('d1', 'c1', 5, 0, 120)
    const stop: RouteStop = { deliveryId: 'd1', locationId: 'c1', arrival: 20, waitMin: 10, serviceStart: 40, departure: 50, status: 'pending' }
    const violations = validateRoute(van, [stop], dMap(d))
    expect(violations.some(v => v.includes('invalid stop timing'))).toBe(true)
  })

  it('stop timing: rejects departure not equal to serviceStart + serviceMin', () => {
    const d = mkDelivery('d1', 'c1', 5, 0, 120, 10)
    const stop: RouteStop = { deliveryId: 'd1', locationId: 'c1', arrival: 20, waitMin: 0, serviceStart: 20, departure: 50, status: 'pending' }
    const violations = validateRoute(van, [stop], dMap(d))
    expect(violations.some(v => v.includes('invalid stop timing'))).toBe(true)
  })

  it('travel matrix: rejects arrival not matching depot + shiftStart + travel time on first leg', () => {
    const d = mkDelivery('d1', 'c1', 5, 0, 120)
    const mat = mkMatrix({ depot: { c1: 20 }, c1: { depot: 20 } })
    const stop: RouteStop = { deliveryId: 'd1', locationId: 'c1', arrival: 15, waitMin: 0, serviceStart: 15, departure: 25, status: 'pending' }
    const violations = validateRoute(van, [stop], dMap(d), mat)
    expect(violations.some(v => v.includes('invalid arrival time'))).toBe(true)
  })

  it('travel matrix: rejects arrival not matching preceding departure + travel time on second leg', () => {
    const d1 = mkDelivery('d1', 'c1', 5, 0, 120)
    const d2 = mkDelivery('d2', 'c2', 5, 0, 120)
    const mat = mkMatrix({ depot: { c1: 20 }, c1: { c2: 15 }, c2: {} })
    const stop1: RouteStop = { deliveryId: 'd1', locationId: 'c1', arrival: 20, waitMin: 0, serviceStart: 20, departure: 30, status: 'pending' }
    const stop2: RouteStop = { deliveryId: 'd2', locationId: 'c2', arrival: 55, waitMin: 0, serviceStart: 55, departure: 65, status: 'pending' }
    const violations = validateRoute(van, [stop1, stop2], dMap(d1, d2), mat)
    expect(violations.some(v => v.includes('invalid arrival time'))).toBe(true)
  })

  it('stop timing: rejects negative arrival time', () => {
    const d = mkDelivery('d1', 'c1', 5, 0, 120)
    const stop: RouteStop = { deliveryId: 'd1', locationId: 'c1', arrival: -10, waitMin: 0, serviceStart: -10, departure: 0, status: 'pending' }
    const violations = validateRoute(van, [stop], dMap(d))
    expect(violations.some(v => v.includes('invalid stop timing'))).toBe(true)
  })

  it('inconsistent stop status: rejects stop marked late when on-time within window', () => {
    const d = mkDelivery('d1', 'c1', 5, 0, 120)
    const stop: RouteStop = { deliveryId: 'd1', locationId: 'c1', arrival: 20, waitMin: 0, serviceStart: 20, departure: 30, status: 'late' }
    const violations = validateRoute(van, [stop], dMap(d))
    expect(violations.some(v => v.includes('inconsistent stop status'))).toBe(true)
  })

  it('time window: rejects stop with serviceStart before window start', () => {
    const d = mkDelivery('d1', 'c1', 5, 60, 120)
    const stop: RouteStop = { deliveryId: 'd1', locationId: 'c1', arrival: 20, waitMin: 0, serviceStart: 20, departure: 30, status: 'pending' }
    const violations = validateRoute(van, [stop], dMap(d))
    expect(violations.some(v => v.includes('misses time window'))).toBe(true)
  })

  it('matrix validation: unreachable leg cascades without duplicate or misleading arrival errors', () => {
    const d1 = mkDelivery('d1', 'c1', 5, 0, 120)
    const d2 = mkDelivery('d2', 'c2', 5, 0, 120)
    const d3 = mkDelivery('d3', 'c3', 5, 0, 120)
    const mat = mkMatrix({ depot: { c1: 20 }, c1: {}, c2: { c3: 10 } })
    const stops = computeStops('depot', 0, ['d1', 'd2', 'd3'], dMap(d1, d2, d3), mat)
    const violations = validateRoute(van, stops, dMap(d1, d2, d3), mat)
    expect(violations).toHaveLength(2)
    expect(violations.every(v => v.includes('unreachable'))).toBe(true)
    expect(violations.some(v => v.includes('arrival'))).toBe(false)
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

import { allocate } from '../src/engine/allocate'

describe('allocate', () => {
  // ─── Shared inline fixtures ──────────────────────────────────────────────
  const mkV = (id: string, capacity: number, shiftEnd = 480, status: Vehicle['status'] = 'active'): Vehicle =>
    ({ id, name: `Van ${id}`, capacity, depotId: 'depot', shiftStart: 0, shiftEnd, status })

  const mkD = (id: string, loc: string, size: number, winStart: number, winEnd: number, priority: Delivery['priority'] = 'normal', serviceMin = 10): Delivery =>
    ({ id, locationId: loc, size, serviceMin, window: { start: winStart, end: winEnd }, priority })

  // Symmetric matrix: depot↔c1, depot↔c2, depot↔c3, all legs = 20 min
  const mat20: TravelMatrix = {
    depot: { depot: 0, c1: 20, c2: 20, c3: 20 },
    c1:    { depot: 20, c1: 0, c2: 20, c3: 20 },
    c2:    { depot: 20, c1: 20, c2: 0, c3: 20 },
    c3:    { depot: 20, c1: 20, c2: 20, c3: 0 },
  }

  const allIds = (plan: ReturnType<typeof allocate>) =>
    [...plan.routes.flatMap(r => r.stops.map(s => s.deliveryId)), ...plan.unassigned.map(u => u.deliveryId)]

  // ─── Tests ───────────────────────────────────────────────────────────────

  it('every input delivery appears exactly once in the result', () => {
    const plan = allocate([mkV('v1', 50)], [mkD('d1', 'c1', 10, 0, 120), mkD('d2', 'c2', 10, 0, 120), mkD('d3', 'c3', 10, 0, 120)], mat20)
    expect(allIds(plan).sort()).toEqual(['d1', 'd2', 'd3'])
  })

  it('urgent deliveries are allocated before normal deliveries', () => {
    // v1 capacity 10: can take only one; urgent wins even though normal has earlier window.end
    const vs = [mkV('v1', 10)]
    const plan = allocate(vs, [mkD('dn', 'c1', 10, 0, 200, 'normal'), mkD('du', 'c2', 10, 0, 300, 'urgent')], mat20)
    expect(plan.routes.flatMap(r => r.stops.map(s => s.deliveryId))).toContain('du')
    expect(plan.unassigned.map(u => u.deliveryId)).toContain('dn')
  })

  it('capacity limit: delivery exceeding remaining capacity goes unassigned with reason capacity', () => {
    const vs = [mkV('v1', 15)]
    const plan = allocate(vs, [mkD('d1', 'c1', 10, 0, 200), mkD('d2', 'c2', 10, 0, 300)], mat20)
    expect(plan.routes[0].load).toBe(10)
    expect(plan.unassigned.find(u => u.deliveryId === 'd2')?.reason).toBe('capacity')
  })

  it('time window: delivery with closed window goes unassigned with reason time_window', () => {
    // travel=20, window closes at t=10 — impossible to arrive in time
    const plan = allocate([mkV('v1', 50)], [mkD('d1', 'c1', 5, 0, 10)], mat20)
    expect(plan.routes[0].stops).toHaveLength(0)
    expect(plan.unassigned[0].reason).toBe('time_window')
  })

  it('shift overrun: delivery that causes shift overrun goes unassigned', () => {
    // shiftEnd=25: travel 20 + service 10 → departs at 30 > 25
    const plan = allocate([mkV('v1', 50, 25)], [mkD('d1', 'c1', 5, 0, 200)], mat20)
    expect(plan.unassigned).toHaveLength(1)
    expect(plan.unassigned[0].reason).toBe('time_window')      // shift overrun maps to time_window
  })

  it('unreachable route: goes unassigned with reason unreachable', () => {
    const noRoute: TravelMatrix = { depot: { depot: 0 }, c1: {} }
    const plan = allocate([mkV('v1', 50)], [mkD('d1', 'c1', 5, 0, 480)], noRoute)
    expect(plan.unassigned[0].reason).toBe('unreachable')
  })

  it('failed vehicle is ignored; deliveries go unassigned with reason no_vehicle', () => {
    const plan = allocate([mkV('v1', 50, 480, 'failed')], [mkD('d1', 'c1', 5, 0, 480)], mat20)
    expect(plan.routes).toHaveLength(0)
    expect(plan.unassigned[0].reason).toBe('no_vehicle')
  })

  it('no vehicles at all: all deliveries unassigned with reason no_vehicle', () => {
    const plan = allocate([], [mkD('d1', 'c1', 5, 0, 480), mkD('d2', 'c2', 5, 0, 480)], mat20)
    expect(plan.routes).toHaveLength(0)
    expect(plan.unassigned.every(u => u.reason === 'no_vehicle')).toBe(true)
  })

  it('vehicle capacity respected: route load never exceeds capacity', () => {
    const vs = [mkV('v1', 30), mkV('v2', 30)]
    const ds = [mkD('d1', 'c1', 15, 0, 480), mkD('d2', 'c2', 15, 0, 480), mkD('d3', 'c3', 15, 0, 480), mkD('d4', 'c1', 15, 0, 480)]
    const plan = allocate(vs, ds, mat20)
    plan.routes.forEach(r => expect(r.load).toBeLessThanOrEqual(vs.find(v => v.id === r.vehicleId)!.capacity))
  })

  it('deterministic: same inputs always produce identical results', () => {
    const vs = [mkV('v1', 50), mkV('v2', 50)]
    const ds = [mkD('d1', 'c1', 10, 0, 480), mkD('d2', 'c2', 10, 0, 480), mkD('d3', 'c3', 10, 0, 480)]
    const p1 = allocate(vs, ds, mat20, 'run1')
    const p2 = allocate(vs, ds, mat20, 'run2')
    expect(p1.routes.map(r => ({ v: r.vehicleId, stops: r.stops.map(s => s.deliveryId) })))
      .toEqual(p2.routes.map(r => ({ v: r.vehicleId, stops: r.stops.map(s => s.deliveryId) })))
  })

  it('input immutability: vehicles, deliveries, and matrix are not mutated', () => {
    const vs = [mkV('v1', 50)]
    const ds = [mkD('d1', 'c1', 10, 0, 480)]
    const matCopy: TravelMatrix = { depot: { depot: 0, c1: 20 }, c1: { depot: 20, c1: 0 } }
    const [vsBefore, dsBefore, matBefore] = [JSON.stringify(vs), JSON.stringify(ds), JSON.stringify(matCopy)]
    allocate(vs, ds, matCopy)
    expect(JSON.stringify(vs)).toBe(vsBefore)
    expect(JSON.stringify(ds)).toBe(dsBefore)
    expect(JSON.stringify(matCopy)).toBe(matBefore)
  })

  it('vehicle tie-break: vehicle with lexicographically smaller ID wins when completions are equal', () => {
    // v2 is listed first in input but v1 should win the tie
    const plan = allocate([mkV('v2', 50), mkV('v1', 50)], [mkD('d1', 'c1', 10, 0, 480)], mat20)
    expect(plan.routes.find(r => r.stops.length > 0)?.vehicleId).toBe('v1')
  })

  it('empty deliveries: produces routes with no stops and no unassigned', () => {
    const plan = allocate([mkV('v1', 50)], [], mat20)
    expect(plan.routes).toHaveLength(1)
    expect(plan.routes[0].stops).toHaveLength(0)
    expect(plan.unassigned).toHaveLength(0)
  })

  it('mixed constraints: capacity on v1 and shift/window failure on v2 classifies as time_window', () => {
    const v1 = mkV('v1', 5)       // capacity 5 < size 10 (capacity violation)
    const v2 = mkV('v2', 50, 25)   // departs at t=30 > shiftEnd 25 (shift overrun)
    const plan = allocate([v1, v2], [mkD('d1', 'c1', 10, 0, 200)], mat20)
    expect(plan.unassigned).toHaveLength(1)
    expect(plan.unassigned[0].reason).toBe('time_window')
  })

  it('mixed constraints: capacity on v1 and unreachable on v2 classifies as time_window', () => {
    const v1 = mkV('v1', 5)                                      // depot has route to c1, but capacity 5 < 10
    const v2: Vehicle = { ...mkV('v2', 50), depotId: 'depotB' }  // depotB has no route to c1
    const splitMat: TravelMatrix = {
      depot: { depot: 0, c1: 20 },
      c1: { depot: 20, c1: 0 },
      depotB: { depotB: 0 },
    }
    const plan = allocate([v1, v2], [mkD('d1', 'c1', 10, 0, 200)], splitMat)
    expect(plan.unassigned).toHaveLength(1)
    expect(plan.unassigned[0].reason).toBe('time_window')
  })

  it('mixed constraints: unreachable on v1 and time window on v2 classifies as time_window', () => {
    const v1: Vehicle = { ...mkV('v1', 50), depotId: 'depotB' }  // no route to c1
    const v2 = mkV('v2', 50, 25)                                 // departs at t=30 > shiftEnd 25
    const splitMat: TravelMatrix = {
      depot: { depot: 0, c1: 20 },
      c1: { depot: 20, c1: 0 },
      depotB: { depotB: 0 },
    }
    const plan = allocate([v1, v2], [mkD('d1', 'c1', 10, 0, 200)], splitMat)
    expect(plan.unassigned).toHaveLength(1)
    expect(plan.unassigned[0].reason).toBe('time_window')
  })

  it('all vehicles blocked by unreachable routes classifies as unreachable', () => {
    const v1 = mkV('v1', 50)
    const v2 = mkV('v2', 50)
    const noRouteMat: TravelMatrix = { depot: { depot: 0 }, c1: {} }
    const plan = allocate([v1, v2], [mkD('d1', 'c1', 10, 0, 200)], noRouteMat)
    expect(plan.unassigned).toHaveLength(1)
    expect(plan.unassigned[0].reason).toBe('unreachable')
  })

  it('capacity is the only blocking constraint across all vehicles classifies as capacity', () => {
    const v1 = mkV('v1', 5)
    const v2 = mkV('v2', 8)
    const plan = allocate([v1, v2], [mkD('d1', 'c1', 10, 0, 200)], mat20)
    expect(plan.unassigned).toHaveLength(1)
    expect(plan.unassigned[0].reason).toBe('capacity')
  })
})

describe('validatePlan', () => {
  const mkV = (id: string, capacity: number, shiftEnd = 480, status: Vehicle['status'] = 'active'): Vehicle =>
    ({ id, name: `Van ${id}`, capacity, depotId: 'depot', shiftStart: 0, shiftEnd, status })

  const mkD = (id: string, loc: string, size: number, winStart: number, winEnd: number, priority: Delivery['priority'] = 'normal', serviceMin = 10): Delivery =>
    ({ id, locationId: loc, size, serviceMin, window: { start: winStart, end: winEnd }, priority })

  const mat20: TravelMatrix = {
    depot: { depot: 0, c1: 20, c2: 20 },
    c1:    { depot: 20, c1: 0, c2: 20 },
    c2:    { depot: 20, c1: 20, c2: 0 },
  }

  it('valid plan passes validation with zero violations', () => {
    const v = mkV('v1', 50)
    const d = mkD('d1', 'c1', 10, 0, 120)
    const plan = allocate([v], [d], mat20)
    expect(validatePlan(plan, [v], [d])).toHaveLength(0)
    expect(validatePlan([v], [d], plan)).toHaveLength(0)
  })

  it('detects missing delivery accounting when input delivery is omitted from plan', () => {
    const v = mkV('v1', 50)
    const d1 = mkD('d1', 'c1', 10, 0, 120)
    const d2 = mkD('d2', 'c2', 10, 0, 120)
    const plan: DeliveryPlan = {
      id: 'p-missing',
      label: 'Missing delivery',
      createdAt: 0,
      routes: [{
        vehicleId: 'v1',
        stops: [{ deliveryId: 'd1', locationId: 'c1', arrival: 20, waitMin: 0, serviceStart: 20, departure: 30, status: 'pending' }],
        load: 10,
      }],
      unassigned: [],
    }
    const violations = validatePlan(plan, [v], [d1, d2])
    expect(violations.some(v => v.includes('missing delivery accounting'))).toBe(true)
    expect(violations.some(v => v.includes('d2'))).toBe(true)
  })

  it('detects duplicate delivery accounting across routes', () => {
    const v1 = mkV('v1', 50)
    const v2 = mkV('v2', 50)
    const d1 = mkD('d1', 'c1', 10, 0, 120)
    const plan: DeliveryPlan = {
      id: 'p-dup-routes',
      label: 'Duplicate routes',
      createdAt: 0,
      routes: [
        {
          vehicleId: 'v1',
          stops: [{ deliveryId: 'd1', locationId: 'c1', arrival: 20, waitMin: 0, serviceStart: 20, departure: 30, status: 'pending' }],
          load: 10,
        },
        {
          vehicleId: 'v2',
          stops: [{ deliveryId: 'd1', locationId: 'c1', arrival: 20, waitMin: 0, serviceStart: 20, departure: 30, status: 'pending' }],
          load: 10,
        },
      ],
      unassigned: [],
    }
    const violations = validatePlan(plan, [v1, v2], [d1])
    expect(violations.some(v => v.includes('duplicate delivery accounting'))).toBe(true)
  })

  it('detects duplicate delivery accounting between routes and unassigned', () => {
    const v = mkV('v1', 50)
    const d1 = mkD('d1', 'c1', 10, 0, 120)
    const plan: DeliveryPlan = {
      id: 'p-dup-unassigned',
      label: 'Duplicate in unassigned',
      createdAt: 0,
      routes: [{
        vehicleId: 'v1',
        stops: [{ deliveryId: 'd1', locationId: 'c1', arrival: 20, waitMin: 0, serviceStart: 20, departure: 30, status: 'pending' }],
        load: 10,
      }],
      unassigned: [{ deliveryId: 'd1', reason: 'capacity', detail: 'test' }],
    }
    const violations = validatePlan(plan, [v], [d1])
    expect(violations.some(v => v.includes('duplicate delivery accounting'))).toBe(true)
  })

  it('detects assignment to failed vehicles', () => {
    const failedV = mkV('v1', 50, 480, 'failed')
    const d1 = mkD('d1', 'c1', 10, 0, 120)
    const plan: DeliveryPlan = {
      id: 'p-failed-v',
      label: 'Assigned to failed vehicle',
      createdAt: 0,
      routes: [{
        vehicleId: 'v1',
        stops: [{ deliveryId: 'd1', locationId: 'c1', arrival: 20, waitMin: 0, serviceStart: 20, departure: 30, status: 'pending' }],
        load: 10,
      }],
      unassigned: [],
    }
    const violations = validatePlan(plan, [failedV], [d1])
    expect(violations.some(v => v.includes('assigned to failed vehicle'))).toBe(true)
  })

  it('detects unknown vehicle and delivery IDs', () => {
    const v = mkV('v1', 50)
    const d1 = mkD('d1', 'c1', 10, 0, 120)
    const plan: DeliveryPlan = {
      id: 'p-unknown',
      label: 'Unknown IDs',
      createdAt: 0,
      routes: [{
        vehicleId: 'unknown_v',
        stops: [{ deliveryId: 'ghost_d', locationId: 'c1', arrival: 20, waitMin: 0, serviceStart: 20, departure: 30, status: 'pending' }],
        load: 10,
      }],
      unassigned: [{ deliveryId: 'ghost_u', reason: 'capacity', detail: 'test' }],
    }
    const violations = validatePlan(plan, [v], [d1])
    expect(violations.some(v => v.includes('unknown vehicle'))).toBe(true)
    expect(violations.some(v => v.includes('unknown delivery'))).toBe(true)
  })

  it('allocate rejects invalid generated plans explicitly', () => {
    const v = mkV('v1', 50)
    const d1 = mkD('d1', 'c1', 10, 0, 120)
    const d1Dup = mkD('d1', 'c1', 10, 0, 120)
    expect(() => allocate([v], [d1, d1Dup], mat20)).toThrow(/Generated plan is invalid/i)
  })

  it('detects duplicate vehicle IDs in input', () => {
    const v1 = mkV('v1', 50)
    const v1Dup = mkV('v1', 40)
    const d = mkD('d1', 'c1', 10, 0, 120)
    const plan = allocate([v1], [d], mat20)
    const violations = validatePlan(plan, [v1, v1Dup], [d])
    expect(violations.some(v => v.includes('duplicate vehicle ID in input'))).toBe(true)
  })

  it('detects duplicate delivery IDs in input', () => {
    const v = mkV('v1', 50)
    const d1 = mkD('d1', 'c1', 10, 0, 120)
    const d1Dup = mkD('d1', 'c2', 15, 0, 120)
    const plan = allocate([v], [d1], mat20)
    const violations = validatePlan(plan, [v], [d1, d1Dup])
    expect(violations.some(v => v.includes('duplicate delivery ID in input'))).toBe(true)
  })

  it('detects mismatched route load against sum of delivery sizes', () => {
    const v = mkV('v1', 50)
    const d1 = mkD('d1', 'c1', 10, 0, 120)
    const plan: DeliveryPlan = {
      id: 'p-load-mismatch',
      label: 'Mismatched load',
      createdAt: 0,
      routes: [{
        vehicleId: 'v1',
        stops: [{ deliveryId: 'd1', locationId: 'c1', arrival: 20, waitMin: 0, serviceStart: 20, departure: 30, status: 'pending' }],
        load: 25,
      }],
      unassigned: [],
    }
    const violations = validatePlan(plan, [v], [d1])
    expect(violations.some(v => v.includes('mismatched route load'))).toBe(true)
  })
})
