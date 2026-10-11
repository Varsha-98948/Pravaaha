import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSupabaseClientMock } = vi.hoisted(() => ({ getSupabaseClientMock: vi.fn() }))

vi.mock('../src/services/supabase', () => ({
  getSupabaseClient: getSupabaseClientMock,
  isDemoMode: false,
}))

import { AuthorizationError, DatabaseError, OrganizationMismatchError, ValidationError } from '../src/services/errors'
import { saveDelivery, saveLocation, saveVehicle } from '../src/services/persistenceService'
import type { Delivery, Location, UserProfile, Vehicle } from '../src/types'

const admin: UserProfile = { id: 'admin-1', orgId: 'org-1', name: 'Admin', email: '', role: 'admin' }
const dispatcher: UserProfile = { id: 'dispatcher-1', orgId: 'org-1', name: 'Dispatcher', email: '', role: 'dispatcher' }
const viewer: UserProfile = { id: 'viewer-1', orgId: 'org-1', name: 'Viewer', email: '', role: 'viewer' }

const location: Location = { id: 'loc-1', name: 'Depot', kind: 'depot' }
const vehicle: Vehicle = { id: 'veh-1', name: 'Van 1', capacity: 20, depotId: location.id, shiftStart: 0, shiftEnd: 480, status: 'active' }
const delivery: Delivery = { id: 'del-1', locationId: 'customer-1', size: 2, serviceMin: 10, window: { start: 0, end: 60 }, priority: 'normal' }

function mockUpsert(result: { data: unknown; error: { message: string } | null }) {
  const single = vi.fn().mockResolvedValue(result)
  const select = vi.fn().mockReturnValue({ single })
  const upsert = vi.fn().mockReturnValue({ select })
  const from = vi.fn().mockReturnValue({ upsert })
  getSupabaseClientMock.mockReturnValue({ from })
  return { from, upsert, select, single }
}

beforeEach(() => getSupabaseClientMock.mockReset())

describe('organization operational create writes', () => {
  it('saves a location with its organization and maps the confirmed database result', async () => {
    const query = mockUpsert({ data: { id: location.id, org_id: 'org-1', name: location.name, kind: location.kind }, error: null })
    await expect(saveLocation(location, 'org-1', admin)).resolves.toEqual(location)
    expect(query.from).toHaveBeenCalledWith('locations')
    expect(query.upsert).toHaveBeenCalledWith({ id: location.id, org_id: 'org-1', name: location.name, kind: 'depot' })
  })

  it('saves a vehicle with its selected depot relationship and organization', async () => {
    const query = mockUpsert({ data: {
      id: vehicle.id, org_id: 'org-1', name: vehicle.name, capacity: 20, depot_id: location.id,
      shift_start: 0, shift_end: 480, status: 'active',
    }, error: null })
    await expect(saveVehicle(vehicle, 'org-1', dispatcher)).resolves.toEqual(vehicle)
    expect(query.from).toHaveBeenCalledWith('vehicles')
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ org_id: 'org-1', depot_id: location.id }))
  })

  it('saves a delivery using the selected customer location and organization', async () => {
    const query = mockUpsert({ data: {
      id: delivery.id, org_id: 'org-1', location_id: delivery.locationId, size: 2,
      service_min: 10, window_start: 0, window_end: 60, priority: 'normal',
    }, error: null })
    await expect(saveDelivery(delivery, 'org-1', admin)).resolves.toEqual(delivery)
    expect(query.from).toHaveBeenCalledWith('deliveries')
    expect(query.upsert).toHaveBeenCalledWith(expect.objectContaining({ org_id: 'org-1', location_id: delivery.locationId }))
  })

  it('rejects malformed records before issuing a database write', async () => {
    await expect(saveLocation({ ...location, name: ' ' }, 'org-1', admin)).rejects.toThrow(ValidationError)
    await expect(saveVehicle({ ...vehicle, capacity: 0 }, 'org-1', admin)).rejects.toThrow(ValidationError)
    await expect(saveDelivery({ ...delivery, window: { start: 60, end: 60 } }, 'org-1', admin)).rejects.toThrow(ValidationError)
    expect(getSupabaseClientMock).not.toHaveBeenCalled()
  })

  it('rejects viewers and cross-organization actors before issuing writes', async () => {
    await expect(saveLocation(location, 'org-1', viewer)).rejects.toThrow(AuthorizationError)
    await expect(saveVehicle(vehicle, 'org-1', viewer)).rejects.toThrow(AuthorizationError)
    await expect(saveDelivery(delivery, 'org-1', viewer)).rejects.toThrow(AuthorizationError)
    await expect(saveDelivery(delivery, 'org-2', admin)).rejects.toThrow(OrganizationMismatchError)
    expect(getSupabaseClientMock).not.toHaveBeenCalled()
  })

  it('propagates RLS or database mutation failures', async () => {
    mockUpsert({ data: null, error: { message: 'new row violates row-level security policy' } })
    await expect(saveLocation(location, 'org-1', admin)).rejects.toThrow(DatabaseError)
    await expect(saveLocation(location, 'org-1', admin)).rejects.toThrow('Failed to save location: new row violates row-level security policy')
  })
})
