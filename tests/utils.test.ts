import { describe, it, expect } from 'vitest'
import { fmtTime, isValidWindow } from '../src/utils/time'
import { originalPlan, vehicles, deliveries, matrix, revisedPlan } from '../src/data/demo'
import { comparePlans } from '../src/engine/compare'
import { replan } from '../src/engine/replan'
describe('time', () => { it('formats', () => { expect(fmtTime(0)).toBe('08:00'); expect(fmtTime(90)).toBe('09:30') }); it('validates', () => { expect(isValidWindow({ start: 10, end: 5 })).toBe(false) }) })
describe('engine', () => {
  it('never exceeds capacity', () => originalPlan.routes.forEach(r => expect(r.load).toBeLessThanOrEqual(vehicles.find(v => v.id === r.vehicleId)!.capacity)))
  it('accounts for every delivery', () => expect(originalPlan.routes.flatMap(r => r.stops).length + originalPlan.unassigned.length).toBe(deliveries.length))
  it('compares', () => { const c = comparePlans(originalPlan, revisedPlan); expect(c.counts.kept + c.counts.moved + c.counts.broken).toBeGreaterThan(0); expect(matrix.depot.depot).toBe(0) })
  it('replan throws until implemented', () => expect(() => replan({ vehicles, deliveries, matrix }, originalPlan, 0)).toThrow())
})
