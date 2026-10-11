import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Badge, Card, PageHead, State, Table, MetricCard } from '../components/ui'
import { getDeliveries, getDeliveryPlan, getLocations, getVehicles, listDeliveryPlans, saveDelivery } from '../services/persistenceService'
import { isDemoMode } from '../services/supabase'
import type { Delivery, Location, UserProfile } from '../types'
import { fmtWindow } from '../utils/time'

export default function Deliveries({ profile = null }: { profile?: UserProfile | null }) {
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [assignments, setAssignments] = useState<Map<string, string>>(new Map())
  const [hasSavedPlan, setHasSavedPlan] = useState(false)
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
  const [search, setSearch] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'normal' | 'urgent'>('all')
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null)
  const canWrite = !isDemoMode && (profile?.role === 'admin' || profile?.role === 'dispatcher')

  const load = useCallback(async (): Promise<boolean> => {
    setError('')
    setLoading(true)
    if (isDemoMode) {
      try {
        const samples = await import('../data/demo')
        setDeliveries(samples.deliveries)
        setLocations(samples.locations)
        setHasSavedPlan(true)
        setAssignments(new Map([
          ...samples.originalPlan.routes.flatMap(route => route.stops.map(stop => [stop.deliveryId, samples.vehicles.find(vehicle => vehicle.id === route.vehicleId)?.name ?? route.vehicleId] as const)),
          ...samples.originalPlan.unassigned.map(item => [item.deliveryId, `Unassigned: ${item.detail}`] as const),
        ]))
        return true
      } catch (cause) {
        setDeliveries(null)
        setLocations([])
        setHasSavedPlan(false)
        setAssignments(new Map())
        setError((cause as Error).message || 'Unable to load demo deliveries.')
        return false
      } finally {
        setLoading(false)
      }
    }

    if (!profile?.orgId) {
      setDeliveries(null)
      setLocations([])
      setHasSavedPlan(false)
      setAssignments(new Map())
      setLoading(false)
      setError('Your organization profile is unavailable. Sign out and sign in again, or contact your administrator.')
      return false
    }

    try {
      const [organizationDeliveries, organizationLocations, organizationVehicles, plans] = await Promise.all([
        getDeliveries(profile.orgId),
        getLocations(profile.orgId),
        getVehicles(profile.orgId),
        listDeliveryPlans(profile.orgId),
      ])
      const latest = plans[0] ? await getDeliveryPlan(plans[0].id, profile.orgId) : null
      setDeliveries(organizationDeliveries)
      setLocations(organizationLocations)
      setHasSavedPlan(latest !== null)
      const vehicleNames = new Map(organizationVehicles.map(vehicle => [vehicle.id, vehicle.name]))
      setAssignments(new Map([
        ...(latest?.routes.flatMap(route => route.stops.map(stop => [stop.deliveryId, vehicleNames.get(route.vehicleId) ?? route.vehicleId] as const)) ?? []),
        ...(latest?.unassigned.map(item => [item.deliveryId, `Unassigned: ${item.detail || item.reason}`] as const) ?? []),
      ]))
      return true
    } catch (cause) {
      setDeliveries(null)
      setLocations([])
      setHasSavedPlan(false)
      setAssignments(new Map())
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
      if (refreshed) setSuccess('Delivery saved and organization data refreshed.')
      else setFormError('The delivery was saved, but refreshed data could not be loaded. Refresh before relying on the displayed records.')
    } catch (cause) {
      setFormError((cause as Error).message || 'Unable to save this delivery. Verify the customer location and your organization permissions.')
    } finally {
      setSaving(false)
    }
  }

  const locationNames = new Map(locations.map(location => [location.id, location.name]))
  const customerName = (id: string) => locationNames.get(id) ?? id
  const customers = locations.filter(location => location.kind === 'customer')

  const filteredDeliveries = (deliveries ?? []).filter(delivery => {
    const matchesSearch = !search ||
      delivery.id.toLowerCase().includes(search.toLowerCase()) ||
      customerName(delivery.locationId).toLowerCase().includes(search.toLowerCase())
    const matchesPriority = priorityFilter === 'all' || delivery.priority === priorityFilter
    return matchesSearch && matchesPriority
  })

  const selectedDelivery = selectedDeliveryId
    ? deliveries?.find(d => d.id === selectedDeliveryId) ?? null
    : null

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
      : canWrite && <Card title="Create delivery" action={<span className="text-xs text-[#30280D]/70 font-medium">Organization: {profile?.name}</span>}>
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
          <button type="submit" disabled={saving || loading || customers.length === 0} className="rounded-lg bg-[#243607] hover:bg-[#182404] px-4 py-2 text-sm font-medium text-white shadow-sm transition-all disabled:opacity-50">{saving ? 'Saving…' : 'Create delivery'}</button>
          {customers.length === 0 && <p className="text-xs text-amber-800 sm:col-span-2 lg:col-span-3">No customer locations exist in this organization. Create a customer location in Fleet first.</p>}
        </form>
      </Card>}

    <div className="mt-4 space-y-4">
      {/* Search and Filter Toolbar */}
      {!loading && !error && deliveries && deliveries.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#30280D]/10 bg-white/70 p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Search by ID or customer…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="rounded-lg border border-[#30280D]/15 bg-white px-3 py-1.5 text-xs text-[#30280D] placeholder-[#30280D]/40 focus:border-[#243607] focus:outline-none"
            />
            <div className="flex items-center gap-1 text-xs">
              <span className="text-[#30280D]/60 font-medium">Priority:</span>
              {(['all', 'normal', 'urgent'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriorityFilter(p)}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-all ${
                    priorityFilter === p
                      ? 'bg-[#243607] text-white shadow-sm'
                      : 'bg-[#BBBEA7]/20 text-[#30280D]/75 hover:bg-[#BBBEA7]/35'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          {(search || priorityFilter !== 'all' || selectedDeliveryId) && (
            <button
              type="button"
              onClick={() => { setSearch(''); setPriorityFilter('all'); setSelectedDeliveryId(null); }}
              className="text-xs font-medium text-[#91696E] hover:underline"
            >
              Reset filters
            </button>
          )}
        </div>
      )}

      {/* Selected Delivery Details Inspector Card */}
      {selectedDelivery && (
        <Card
          title={
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">Delivery Inspection: {selectedDelivery.id}</span>
              <Badge t={selectedDelivery.priority === 'urgent' ? 'warn' : 'ok'}>{selectedDelivery.priority}</Badge>
            </div>
          }
          action={
            <button
              type="button"
              onClick={() => setSelectedDeliveryId(null)}
              className="text-xs text-[#30280D]/60 hover:text-[#30280D]"
            >
              Close
            </button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 text-xs">
            <div>
              <span className="text-[#30280D]/60 block font-medium">Customer Location:</span>
              <span className="font-semibold text-sm text-[#30280D]">{customerName(selectedDelivery.locationId)}</span>
            </div>
            <div>
              <span className="text-[#30280D]/60 block font-medium">Size / Units:</span>
              <span className="font-semibold text-sm text-[#30280D]">{selectedDelivery.size} units</span>
            </div>
            <div>
              <span className="text-[#30280D]/60 block font-medium">Service Time:</span>
              <span className="font-semibold text-sm text-[#30280D]">{selectedDelivery.serviceMin} minutes</span>
            </div>
            <div>
              <span className="text-[#30280D]/60 block font-medium">Delivery Window:</span>
              <span className="font-semibold text-sm text-[#30280D]">{fmtWindow(selectedDelivery.window)}</span>
            </div>
          </div>
        </Card>
      )}

      <Card
        title={isDemoMode ? 'Sample deliveries' : 'Organization deliveries'}
        sub={`${filteredDeliveries.length} records shown`}
        action={<button type="button" onClick={() => void load()} disabled={loading || saving} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Refresh</button>}
      >
        {loading ? <State kind="loading" text="Loading deliveries from your organization…" />
          : error ? <State kind="error" text={error} />
            : deliveries === null ? <State kind="error" text="Delivery data is unavailable." />
              : filteredDeliveries.length === 0 ? <State kind="empty" text={deliveries.length === 0 ? "No deliveries are registered for this organization yet." : "No deliveries match your active filter."} />
                : <Table
                  head={['ID', 'Customer', 'Size', 'Window', 'Priority', 'Assignment', 'Action']}
                  rows={filteredDeliveries.map(delivery => {
                    const assignment = assignments.get(delivery.id)
                    const isSelected = selectedDeliveryId === delivery.id
                    const cells: ReactNode[] = [
                      <span key={`${delivery.id}-id`} className="font-mono text-xs font-medium">{delivery.id}</span>,
                      customerName(delivery.locationId),
                      delivery.size,
                      fmtWindow(delivery.window),
                      <Badge key={`${delivery.id}-priority`} t={delivery.priority === 'urgent' ? 'warn' : 'mute'}>{delivery.priority}</Badge>,
                    ]
                    cells.push(assignment
                      ? assignment.startsWith('Unassigned:')
                        ? <Badge key={`${delivery.id}-assignment`} t="bad">{assignment}</Badge>
                        : <Badge key={`${delivery.id}-assignment`} t="ok">Assigned to {assignment}</Badge>
                      : hasSavedPlan ? 'Not included in latest saved plan' : 'No saved plan')
                    cells.push(
                      <button
                        key={`${delivery.id}-inspect`}
                        type="button"
                        onClick={() => setSelectedDeliveryId(isSelected ? null : delivery.id)}
                        className={`rounded px-2 py-0.5 text-xs font-medium transition-all ${
                          isSelected
                            ? 'bg-[#243607] text-white'
                            : 'bg-[#BBBEA7]/25 text-[#30280D] hover:bg-[#BBBEA7]/40'
                        }`}
                      >
                        {isSelected ? 'Inspecting' : 'Inspect'}
                      </button>
                    )
                    return cells
                  })}
                />}
      </Card>
    </div>
  </>
}
