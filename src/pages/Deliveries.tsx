import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Badge, Card, PageHead, State, Table, MetricCard } from '../components/ui'
import { getDeliveries, getLocations, saveDelivery } from '../services/persistenceService'
import { isDemoMode } from '../services/supabase'
import type { Delivery, Location, UserProfile } from '../types'
import { fmtWindow } from '../utils/time'

export default function Deliveries({ profile = null }: { profile?: UserProfile | null }) {
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [demoUnassigned, setDemoUnassigned] = useState<Map<string, { detail: string }>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [locationId, setLocationId] = useState('')
  const [size, setSize] = useState('1')
  const [serviceMin, setServiceMin] = useState('10')
  const [windowStart, setWindowStart] = useState('0')
  const [windowEnd, setWindowEnd] = useState('60')
  const [priority, setPriority] = useState<Delivery['priority']>('normal')
  const canWrite = !isDemoMode && (profile?.role === 'admin' || profile?.role === 'dispatcher')

  const load = useCallback(async (): Promise<boolean> => {
    setError('')
    setLoading(true)
    if (isDemoMode) {
      try {
        const samples = await import('../data/demo')
        setDeliveries(samples.deliveries)
        setLocations(samples.locations)
        setDemoUnassigned(new Map(samples.originalPlan.unassigned.map(item => [item.deliveryId, { detail: item.detail }])))
        return true
      } catch (cause) {
        setDeliveries(null)
        setLocations([])
        setError((cause as Error).message || 'Unable to load demo deliveries.')
        return false
      } finally {
        setLoading(false)
      }
    }

    if (!profile?.orgId) {
      setDeliveries(null)
      setLocations([])
      setLoading(false)
      setError('Your organization profile is unavailable. Sign out and sign in again, or contact your administrator.')
      return false
    }

    try {
      const [organizationDeliveries, organizationLocations] = await Promise.all([
        getDeliveries(profile.orgId),
        getLocations(profile.orgId),
      ])
      setDeliveries(organizationDeliveries)
      setLocations(organizationLocations)
      return true
    } catch (cause) {
      setDeliveries(null)
      setLocations([])
      setError((cause as Error).message || 'Unable to load organization deliveries.')
      return false
    } finally {
      setLoading(false)
    }
  }, [profile?.orgId])

  useEffect(() => { void load() }, [load])

  const createDelivery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError('')
    setSuccess('')
    if (!canWrite || !profile) {
      setFormError('Only administrators and dispatchers can create organization deliveries.')
      return
    }
    const parsedSize = Number(size)
    const parsedServiceMin = Number(serviceMin)
    const parsedWindowStart = Number(windowStart)
    const parsedWindowEnd = Number(windowEnd)
    const selectedLocation = locations.find(location => location.id === locationId && location.kind === 'customer')
    if (!selectedLocation || !Number.isInteger(parsedSize) || parsedSize <= 0
      || !Number.isInteger(parsedServiceMin) || parsedServiceMin < 0
      || !Number.isInteger(parsedWindowStart) || !Number.isInteger(parsedWindowEnd)
      || parsedWindowStart < 0 || parsedWindowEnd <= parsedWindowStart) {
      setFormError('Choose an organization customer location, enter a positive integer size, nonnegative service minutes, and a valid time window.')
      return
    }

    setSaving(true)
    try {
      await saveDelivery({
        id: crypto.randomUUID(), locationId, size: parsedSize, serviceMin: parsedServiceMin,
        window: { start: parsedWindowStart, end: parsedWindowEnd }, priority,
      }, profile.orgId, profile)
      const refreshed = await load()
      setLocationId('')
      if (refreshed) setSuccess('Delivery saved and organization deliveries refreshed.')
      else setFormError('The delivery was saved, but deliveries could not be refreshed. Use Refresh to reload the list.')
    } catch (cause) {
      setFormError((cause as Error).message || 'Unable to save this delivery. Verify the customer location and your organization permissions.')
    } finally {
      setSaving(false)
    }
  }

  const locationNames = new Map(locations.map(location => [location.id, location.name]))
  const customerName = (id: string) => locationNames.get(id) ?? id
  const customers = locations.filter(location => location.kind === 'customer')

  return <>
    <PageHead title="Deliveries" sub={isDemoMode ? 'Sample orders, sizes and time windows (demo mode)' : 'Orders loaded from your organization'} />
    <div className="mb-4 flex justify-end">
      <button type="button" onClick={() => void load()} disabled={loading || saving} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Refresh</button>
    </div>

    {formError && <State kind="error" text={formError} />}
    {success && <State kind="success" text={success} />}
    {!loading && !error && deliveries && <div className="mb-4 grid gap-3 sm:grid-cols-3">
      <MetricCard label="Deliveries" value={deliveries.length} sub="Loaded from this organization" />
      <MetricCard label="Urgent" value={deliveries.filter(delivery => delivery.priority === 'urgent').length} sub="Persisted priority" />
      <MetricCard label="Customer locations" value={locations.filter(location => location.kind === 'customer').length} sub="Organization locations" />
    </div>}
    {isDemoMode
      ? <Card title="Demo mode"><State kind="empty" text="Sample deliveries are read only. Connect an authenticated Supabase organization to create deliveries." /></Card>
      : canWrite && <Card title="Create delivery" action={<span className="text-xs text-slate-500">Organization: {profile?.name}</span>}>
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={event => void createDelivery(event)}>
          <label className="text-xs text-slate-600">Customer location
            <select required value={locationId} onChange={event => setLocationId(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm">
              <option value="">Select customer</option>{customers.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-600">Size
            <input type="number" required min="1" step="1" value={size} onChange={event => setSize(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">Service minutes
            <input type="number" required min="0" step="1" value={serviceMin} onChange={event => setServiceMin(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">Window starts (minutes)
            <input type="number" required min="0" step="1" value={windowStart} onChange={event => setWindowStart(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">Window ends (minutes)
            <input type="number" required min="1" step="1" value={windowEnd} onChange={event => setWindowEnd(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 text-sm" />
          </label>
          <label className="text-xs text-slate-600">Priority
            <select value={priority} onChange={event => setPriority(event.target.value as Delivery['priority'])} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm"><option value="normal">Normal</option><option value="urgent">Urgent</option></select>
          </label>
          <button type="submit" disabled={saving || loading || customers.length === 0} className="rounded bg-navy px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Saving…' : 'Create delivery'}</button>
          {customers.length === 0 && <p className="text-xs text-amber-800 sm:col-span-2 lg:col-span-3">No customer locations exist in this organization. Create a customer location in Fleet first.</p>}
        </form>
      </Card>}

    <div className="mt-4">
      <Card
        title={isDemoMode ? 'Sample deliveries' : 'Organization deliveries'}
        action={<button type="button" onClick={() => void load()} disabled={loading || saving} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Refresh</button>}
      >
        {loading ? <State kind="loading" text="Loading deliveries from your organization…" />
          : error ? <State kind="error" text={error} />
            : deliveries === null ? <State kind="error" text="Delivery data is unavailable." />
              : deliveries.length === 0 ? <State kind="empty" text="No deliveries are registered for this organization yet." />
                : <Table
                  head={isDemoMode ? ['ID', 'Customer', 'Size', 'Window', 'Priority', 'Assignment'] : ['ID', 'Customer', 'Size', 'Window', 'Priority']}
                  rows={deliveries.map(delivery => {
                    const missing = demoUnassigned.get(delivery.id)
                    const cells: ReactNode[] = [
                      delivery.id, customerName(delivery.locationId), delivery.size, fmtWindow(delivery.window),
                      <Badge key={`${delivery.id}-priority`} t={delivery.priority === 'urgent' ? 'warn' : 'mute'}>{delivery.priority}</Badge>,
                    ]
                    if (isDemoMode) cells.push(missing
                      ? <Badge key={`${delivery.id}-assignment`} t="bad">Unassigned: {missing.detail}</Badge>
                      : <Badge key={`${delivery.id}-assignment`} t="ok">Assigned</Badge>)
                    return cells
                  })}
                />}
      </Card>
    </div>
  </>
}
