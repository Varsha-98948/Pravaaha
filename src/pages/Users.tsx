import { useCallback, useEffect, useState } from 'react'
import { Badge, Card, PageHead, State, Table, MetricCard } from '../components/ui'
import { canAdministerRoles } from '../services/authService'
import { getProfiles, updateUserProfile } from '../services/persistenceService'
import { isDemoMode } from '../services/supabase'
import type { Role, UserProfile } from '../types'

const roles: Role[] = ['admin', 'dispatcher', 'viewer']

export default function Users({ profile = null }: { profile?: UserProfile | null }) {
  const [profiles, setProfiles] = useState<UserProfile[] | null>(null)
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Role>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const canManage = isDemoMode ? false : Boolean(profile && canAdministerRoles(profile))

  const load = useCallback(async () => {
    setError('')
    setSuccess('')
    setLoading(true)
    try {
      let records: UserProfile[]
      if (isDemoMode) {
        const samples = await import('../data/demo')
        records = samples.users
      } else {
        if (!profile?.orgId) throw new Error('Your organization profile is unavailable. Sign out and sign in again, or contact your administrator.')
        if (!canAdministerRoles(profile)) throw new Error('Only organization administrators can open user administration.')
        records = await getProfiles(profile.orgId)
      }
      setProfiles(records)
      setRoleDrafts(Object.fromEntries(records.map(record => [record.id, record.role])))
    } catch (cause) {
      setProfiles(null)
      setError((cause as Error).message || 'Unable to load organization profiles. Check your access and try again.')
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => {
    if (!isDemoMode && !canManage) {
      setLoading(false)
      return
    }
    void load()
  }, [load, canManage])

  if (!isDemoMode && !canManage) {
    return <>
      <PageHead title="Users" sub="Organization profile administration" />
      <State kind="error" text="Only organization administrators can view or manage organization profiles." />
    </>
  }

  const saveRole = async (target: UserProfile) => {
    if (!profile || !canAdministerRoles(profile)) {
      setError('Only organization administrators can change profile roles.')
      return
    }
    const role = roleDrafts[target.id]
    if (!role || role === target.role) return

    setError('')
    setSuccess('')
    setSavingId(target.id)
    try {
      const updated = await updateUserProfile(target.id, profile.orgId, { role }, profile)
      setProfiles(current => current?.map(record => record.id === updated.id ? updated : record) ?? null)
      setRoleDrafts(current => ({ ...current, [updated.id]: updated.role }))
      setSuccess(`Updated ${updated.name}'s role to ${updated.role}.`)
    } catch (cause) {
      setError(`Could not update ${target.name}'s role. ${(cause as Error).message || 'Check your administrator permissions and try again.'}`)
    } finally {
      setSavingId('')
    }
  }

  const rows = (profiles ?? []).map(user => [
    user.name,
    user.email || 'Email unavailable',
    <Badge key={`${user.id}-role`} t={user.role === 'admin' ? 'warn' : user.role === 'dispatcher' ? 'ok' : 'mute'}>{user.role}</Badge>,
    canManage && !isDemoMode
      ? <div key={`${user.id}-actions`} className="flex items-center gap-2">
        <select
          aria-label={`Role for ${user.name}`}
          value={roleDrafts[user.id] ?? user.role}
          disabled={savingId === user.id}
          onChange={event => setRoleDrafts(current => ({ ...current, [user.id]: event.target.value as Role }))}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs disabled:opacity-50"
        >{roles.map(role => <option key={role} value={role}>{role}</option>)}</select>
        <button
          type="button"
          disabled={savingId === user.id || (roleDrafts[user.id] ?? user.role) === user.role}
          onClick={() => void saveRole(user)}
          className="rounded bg-navy px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
        >{savingId === user.id ? 'Saving…' : 'Save role'}</button>
      </div>
      : <span key={`${user.id}-readonly`} className="text-xs text-slate-500">Read only</span>,
  ])

  return <>
    <PageHead title="Users" sub={isDemoMode ? 'Sample team profiles (demo mode)' : 'Profiles in your organization'} />
    <Card
      title={isDemoMode ? 'Sample team' : 'Organization team'}
      action={<button type="button" onClick={() => void load()} disabled={loading || savingId !== ''} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Refresh</button>}
    >
      {loading ? <State kind="loading" text="Loading organization profiles…" />
        : error && profiles === null ? <State kind="error" text={error} />
          : profiles === null ? <State kind="error" text="Profile data is unavailable. Refresh to try again." />
            : profiles.length === 0 ? <State kind="empty" text="No user profiles are registered for this organization." />
              : <>
                <div className="mb-4 grid gap-3 sm:grid-cols-3">
                  {roles.map(role => <MetricCard key={role} label={role} value={profiles.filter(user => user.role === role).length} sub="Organization profiles" />)}
                </div>
                {error && <State kind="error" text={error} />}
                {success && <State kind="success" text={success} />}
                {!isDemoMode && <Table head={['Name', 'Email', 'Role', 'Administration']} rows={rows} />}
                {isDemoMode && <Table head={['Name', 'Email', 'Role']} rows={profiles.map(user => [user.name, user.email || 'Email unavailable', <Badge key={`${user.id}-role`} t={user.role === 'admin' ? 'warn' : user.role === 'dispatcher' ? 'ok' : 'mute'}>{user.role}</Badge>])} />}
                <p className="mt-3 text-xs text-slate-500">
                  {isDemoMode
                    ? 'Sample profiles are read only. No accounts or roles are changed in demo mode.'
                    : 'This page manages existing profiles only. New Supabase Auth accounts must be created through a trusted administrator invitation flow.'}
                </p>
              </>}
    </Card>
  </>
}
