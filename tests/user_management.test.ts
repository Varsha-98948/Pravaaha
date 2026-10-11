import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSupabaseClientMock } = vi.hoisted(() => ({ getSupabaseClientMock: vi.fn() }))

vi.mock('../src/services/supabase', () => ({
  getSupabaseClient: getSupabaseClientMock,
  isDemoMode: false,
}))

import { canAdministerRoles } from '../src/services/authService'
import { AuthorizationError, DatabaseError, OrganizationMismatchError } from '../src/services/errors'
import { getProfiles, updateUserProfile } from '../src/services/persistenceService'
import type { UserProfile } from '../src/types'

const admin: UserProfile = { id: 'admin-1', orgId: 'org-1', name: 'Admin', email: 'admin@example.test', role: 'admin' }
const dispatcher: UserProfile = { id: 'dispatcher-1', orgId: 'org-1', name: 'Dispatcher', email: 'dispatch@example.test', role: 'dispatcher' }
const viewer: UserProfile = { id: 'viewer-1', orgId: 'org-1', name: 'Viewer', email: 'viewer@example.test', role: 'viewer' }

beforeEach(() => getSupabaseClientMock.mockReset())

describe('organization profile administration', () => {
  it('loads and maps profiles with an explicit organization filter', async () => {
    const eq = vi.fn().mockResolvedValue({ data: [
      { id: 'member-1', org_id: 'org-1', name: 'Member', email: 'member@example.test', role: 'dispatcher' },
    ], error: null })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    getSupabaseClientMock.mockReturnValue({ from })

    await expect(getProfiles('org-1')).resolves.toEqual([{
      id: 'member-1', orgId: 'org-1', name: 'Member', email: 'member@example.test', role: 'dispatcher',
    }])
    expect(from).toHaveBeenCalledWith('profiles')
    expect(select).toHaveBeenCalledWith('id, org_id, name, email, role')
    expect(eq).toHaveBeenCalledWith('org_id', 'org-1')
  })

  it('surfaces profile query failures without returning demo profiles', async () => {
    const eq = vi.fn().mockResolvedValue({ data: null, error: { message: 'RLS denied' } })
    getSupabaseClientMock.mockReturnValue({ from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) }) })
    await expect(getProfiles('org-1')).rejects.toThrow(DatabaseError)
    await expect(getProfiles('org-1')).rejects.toThrow('Failed to fetch profiles: RLS denied')
  })

  it('allows an admin to change an in-organization profile role', async () => {
    const query = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: {
        id: 'member-1', org_id: 'org-1', name: 'Member', email: 'member@example.test', role: 'viewer',
      }, error: null }),
    }
    const update = vi.fn().mockReturnValue(query)
    const from = vi.fn().mockReturnValue({ update })
    getSupabaseClientMock.mockReturnValue({ from })

    await expect(updateUserProfile('member-1', 'org-1', { role: 'viewer' }, admin)).resolves.toMatchObject({
      id: 'member-1', orgId: 'org-1', role: 'viewer',
    })
    expect(from).toHaveBeenCalledWith('profiles')
    expect(update).toHaveBeenCalledWith({ role: 'viewer' })
    expect(query.eq).toHaveBeenNthCalledWith(1, 'id', 'member-1')
    expect(query.eq).toHaveBeenNthCalledWith(2, 'org_id', 'org-1')
  })

  it.each([dispatcher, viewer])('rejects role administration for %s before issuing a write', async actor => {
    expect(canAdministerRoles(actor)).toBe(false)
    await expect(updateUserProfile('member-1', 'org-1', { role: 'admin' }, actor)).rejects.toThrow(AuthorizationError)
    expect(getSupabaseClientMock).not.toHaveBeenCalled()
  })

  it('rejects cross-organization profile updates before issuing a write', async () => {
    await expect(updateUserProfile('member-1', 'org-2', { role: 'viewer' }, admin)).rejects.toThrow(OrganizationMismatchError)
    expect(getSupabaseClientMock).not.toHaveBeenCalled()
  })

  it('surfaces database authorization failures from profile updates', async () => {
    const query = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'new row violates row-level security policy' } }),
    }
    getSupabaseClientMock.mockReturnValue({ from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue(query) }) })
    await expect(updateUserProfile('member-1', 'org-1', { role: 'dispatcher' }, admin)).rejects.toThrow(DatabaseError)
    await expect(updateUserProfile('member-1', 'org-1', { role: 'dispatcher' }, admin)).rejects.toThrow('new row violates row-level security policy')
  })
})
