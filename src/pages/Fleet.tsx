import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Badge, Card, PageHead, State, Table, MetricCard } from '../components/ui'
import { getLocations, getVehicles, saveLocation, saveVehicle } from '../services/persistenceService'
import { isDemoMode } from '../services/supabase'
import type { Location, UserProfile, Vehicle } from '../types'
import { fmtTime } from '../utils/time'

export default function Fleet({ profile = null }: { profile?: UserProfile | null }) {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState<'location' | 'vehicle' | ''>('')
  const [locationName, setLocationName] = useState('')
  const [locationKind, setLocationKind] = useState<Location['kind']>('depot')
  const [vehicleName, setVehicleName] = useState('')
  const [capacity, setCapacity] = useState('20')
  const [depotId, setDepotId] = useState('')
  const [shiftStart, setShiftStart] = useState('0')
  const [shiftEnd, setShiftEnd] = useState('480')
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [vehicleStatusFilter, setVehicleStatusFilter] = useState<'all' | 'active' | 'failed'>('all')
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [locationKindFilter, setLocationKindFilter] = useState<'all' | 'depot' | 'customer'>('all')
  const canWrite = !isDemoMode && (profile?.role === 'admin' || profile?.role === 'dispatcher')

  const load = useCallback(async (): Promise<boolean> => {
    setError('')
    setLoading(true)
    if (isDemoMode) {
      try {
        const samples = await import('../data/demo')
        setVehicles(samples.vehicles)
        setLocations(samples.locations)
        return true
      } catch (cause) {
        setVehicles(null)
        setLocations([])
        setError((cause as Error).message || 'Unable to load demo fleet.')
        return false
      } finally {
        setLoading(false)
      }
    }
    if (!profile?.orgId) {
      setVehicles(null)
      setLocations([])
      setLoading(false)
      setError('Your organization profile is unavailable. Sign out and sign in again, or contact your administrator.')
      return false
    }

    try {
      const [organizationVehicles, organizationLocations] = await Promise.all([
        getVehicles(profile.orgId),
        getLocations(profile.orgId),
      ])
      setVehicles(organizationVehicles)
      setLocations(organizationLocations)
      return true
    } catch (cause) {
      setVehicles(null)
      setLocations([])
      setError((cause as Error).message || 'Unable to load organization fleet.')
      return false
    } finally {
      setLoading(false)
    }
  }, [profile?.orgId])

  useEffect(() => { void load() }, [load])

  const createLocation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError('')
    setSuccess('')
    if (!canWrite || !profile) {
      setFormError('Only administrators and dispatchers can create organization locations.')
      return
    }
    const name = locationName.trim()
    if (!name) {
      setFormError('Enter a location name.')
      return
    }
    setSaving('location')
    try {
      await saveLocation({ id: crypto.randomUUID(), name, kind: locationKind }, profile.orgId, profile)
      const refreshed = await load()
      setLocationName('')
      if (refreshed) setSuccess(`${name} was saved and the organization locations were refreshed.`)
      else setFormError(`${name} was saved, but the locations could not be refreshed. Use Refresh to reload the list.`)
    } catch (cause) {
      setFormError((cause as Error).message || 'Unable to save this location. Check the form and your organization permissions.')
    } finally {
      setSaving('')
    }
  }

  const createVehicle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError('')
    setSuccess('')
    if (!canWrite || !profile) {
      setFormError('Only administrators and dispatchers can create organization vehicles.')
      return
    }
    const name = vehicleName.trim()
    const parsedCapacity = Number(capacity)
    const parsedShiftStart = Number(shiftStart)
    const parsedShiftEnd = Number(shiftEnd)
    if (!name || !depotId || !Number.isInteger(parsedCapacity) || parsedCapacity <= 0
      || !Number.isInteger(parsedShiftStart) || !Number.isInteger(parsedShiftEnd) || parsedShiftEnd <= parsedShiftStart) {
      setFormError('Enter a vehicle name, choose a depot, provide positive integer capacity, and set an end time after the start time.')
      return
    }
    setSaving('vehicle')
    try {
      await saveVehicle({
        id: crypto.randomUUID(), name, capacity: parsedCapacity, depotId,
        shiftStart: parsedShiftStart, shiftEnd: parsedShiftEnd, status: 'active',
      }, profile.orgId, profile)
      const refreshed = await load()
      setVehicleName('')
      if (refreshed) setSuccess(`${name} was saved and the organization fleet was refreshed.`)
      else setFormError(`${name} was saved, but the fleet could not be refreshed. Use Refresh to reload the list.`)
    } catch (cause) {
      setFormError((cause as Error).message || 'Unable to save this vehicle. Verify its depot and your organization permissions.')
    } finally {
      setSaving('')
    }
  }

  const locationNames = new Map(locations.map(location => [location.id, location.name]))
  const depotName = (id: string) => locationNames.get(id) ?? id
  const depots = locations.filter(location => location.kind === 'depot')

  const filteredLocations = locations.filter(loc => {
    return locationKindFilter === 'all' || loc.kind === locationKindFilter
  })

  const filteredVehicles = (vehicles ?? []).filter(v => {
    const matchesSearch = !vehicleSearch ||
      v.name.toLowerCase().includes(vehicleSearch.toLowerCase()) ||
      v.id.toLowerCase().includes(vehicleSearch.toLowerCase())
    const matchesStatus = vehicleStatusFilter === 'all' || v.status === vehicleStatusFilter
    return matchesSearch && matchesStatus
  })

  const selectedVehicle = selectedVehicleId
    ? vehicles?.find(v => v.id === selectedVehicleId) ?? null
    : null

  return <>
    <PageHead title="Fleet" sub={isDemoMode ? 'Sample vehicles, capacity and shifts (demo mode)' : 'Vehicles and locations in your organization'} />
    <div className="mb-4 flex justify-end">
      <button type="button" onClick={() => void load()} disabled={loading || saving !== ''} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors">Refresh</button>
    </div>

    {formError && <State kind="error" text={formError} />}
    {success && <State kind="success" text={success} />}
    {isDemoMode
      ? <Card title="Demo mode"><State kind="empty" text="Sample fleet records are read only. Connect an authenticated Supabase organization to create locations or vehicles." /></Card>
      : canWrite && <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title="Create location">
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => void createLocation(event)}>
            <label className="text-xs text-slate-600">Name
              <input required maxLength={200} value={locationName} onChange={event => setLocationName(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 text-sm" />
            </label>
            <label className="text-xs text-slate-600">Kind
              <select value={locationKind} onChange={event => setLocationKind(event.target.value as Location['kind'])} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm">
                <option value="depot">Depot</option><option value="customer">Customer</option>
              </select>
            </label>
            <button type="submit" disabled={saving !== '' || loading} className="rounded-lg bg-[#243607] hover:bg-[#182404] px-4 py-2 text-sm font-medium text-white shadow-sm transition-all disabled:opacity-50">{saving === 'location' ? 'Saving…' : 'Create location'}</button>
          </form>
        </Card>

        <Card title="Create vehicle">
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => void createVehicle(event)}>
            <label className="text-xs text-slate-600">Vehicle name
              <input required maxLength={200} value={vehicleName} onChange={event => setVehicleName(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 text-sm" />
            </label>
            <label className="text-xs text-slate-600">Depot
              <select required value={depotId} onChange={event => setDepotId(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm">
                <option value="">Select depot</option>{depots.map(depot => <option key={depot.id} value={depot.id}>{depot.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600">Capacity
              <input type="number" required min="1" step="1" value={capacity} onChange={event => setCapacity(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 text-sm" />
            </label>
            <label className="text-xs text-slate-600">Shift starts (minutes)
              <input type="number" required step="1" value={shiftStart} onChange={event => setShiftStart(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 text-sm" />
            </label>
            <label className="text-xs text-slate-600">Shift ends (minutes)
              <input type="number" required step="1" value={shiftEnd} onChange={event => setShiftEnd(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 text-sm" />
            </label>
            <button type="submit" disabled={saving !== '' || loading || depots.length === 0} className="self-end rounded-lg bg-[#243607] hover:bg-[#182404] px-4 py-2 text-sm font-medium text-white shadow-sm transition-all disabled:opacity-50">{saving === 'vehicle' ? 'Saving…' : 'Create vehicle'}</button>
            {depots.length === 0 && <p className="text-xs text-amber-800 sm:col-span-2">Create a depot location first; vehicles must reference a depot in this organization.</p>}
          </form>
        </Card>
      </div>}

    {!loading && !error && vehicles && <div className="mb-4 grid gap-3 sm:grid-cols-3">
      <MetricCard label="Organization vehicles" value={vehicles.length} sub="Persisted fleet records" />
      <MetricCard label="Active vehicles" value={vehicles.filter(vehicle => vehicle.status === 'active').length} sub="Available fleet" />
      <MetricCard label="Locations" value={locations.length} sub="Depots and customers" />
    </div>}

    {/* Vehicle Inspector Card */}
    {selectedVehicle && (
      <div className="mb-4">
        <Card
          title={
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">Vehicle Inspection: {selectedVehicle.name}</span>
              <Badge t={selectedVehicle.status === 'active' ? 'ok' : 'bad'}>{selectedVehicle.status}</Badge>
            </div>
          }
          action={
            <button
              type="button"
              onClick={() => setSelectedVehicleId(null)}
              className="text-xs text-[#30280D]/60 hover:text-[#30280D]"
            >
              Close
            </button>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 text-xs">
            <div>
              <span className="text-[#30280D]/60 block font-medium">Identifier:</span>
              <span className="font-mono text-sm text-[#30280D]">{selectedVehicle.id}</span>
            </div>
            <div>
              <span className="text-[#30280D]/60 block font-medium">Capacity:</span>
              <span className="font-semibold text-sm text-[#30280D]">{selectedVehicle.capacity} units</span>
            </div>
            <div>
              <span className="text-[#30280D]/60 block font-medium">Home Depot:</span>
              <span className="font-semibold text-sm text-[#30280D]">{depotName(selectedVehicle.depotId)}</span>
            </div>
            <div>
              <span className="text-[#30280D]/60 block font-medium">Shift Window:</span>
              <span className="font-semibold text-sm text-[#30280D]">{selectedVehicle.shiftStart}m – {selectedVehicle.shiftEnd}m</span>
            </div>
          </div>
        </Card>
      </div>
    )}

    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title={isDemoMode ? 'Sample locations' : 'Organization locations'}
        sub={`${filteredLocations.length} locations`}
        action={
          <div className="flex items-center gap-1 text-xs">
            {(['all', 'depot', 'customer'] as const).map(k => (
              <button
                key={k}
                type="button"
                onClick={() => setLocationKindFilter(k)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-all ${
                  locationKindFilter === k
                    ? 'bg-[#243607] text-white shadow-sm'
                    : 'bg-[#BBBEA7]/20 text-[#30280D]/75 hover:bg-[#BBBEA7]/35'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        }
      >
        {loading ? <State kind="loading" text="Loading organization locations…" />
          : error ? <State kind="error" text={error} />
            : locations.length === 0 ? <State kind="empty" text="No locations are registered. Create a depot before adding vehicles, and customer locations before adding deliveries." />
              : <Table head={['Name', 'Kind']} rows={filteredLocations.map(location => [location.name, <Badge key={`${location.id}-kind`} t={location.kind === 'depot' ? 'ok' : 'mute'}>{location.kind}</Badge>])} />}
      </Card>

      <Card
        title={isDemoMode ? 'Sample fleet' : 'Organization fleet'}
        sub={`${filteredVehicles.length} vehicles`}
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="text"
              placeholder="Search vehicles…"
              value={vehicleSearch}
              onChange={e => setVehicleSearch(e.target.value)}
              className="rounded border border-[#30280D]/15 bg-white px-2 py-0.5 text-xs text-[#30280D] placeholder-[#30280D]/40 focus:border-[#243607] focus:outline-none"
            />
            {(['all', 'active', 'failed'] as const).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setVehicleStatusFilter(s)}
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-all ${
                  vehicleStatusFilter === s
                    ? 'bg-[#243607] text-white shadow-sm'
                    : 'bg-[#BBBEA7]/20 text-[#30280D]/75 hover:bg-[#BBBEA7]/35'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        }
      >
        {loading ? <State kind="loading" text="Loading vehicles from your organization…" />
          : error ? <State kind="error" text={error} />
            : vehicles === null ? <State kind="error" text="Fleet data is unavailable. Refresh to try again." />
              : filteredVehicles.length === 0 ? <State kind="empty" text={vehicles.length === 0 ? "No vehicles are registered for this organization yet." : "No vehicles match your active filter."} />
                : <Table head={['Vehicle', 'Capacity', 'Depot', 'Shift', 'Status', 'Action']} rows={filteredVehicles.map(vehicle => {
                  const isSelected = selectedVehicleId === vehicle.id
                  return [
                    vehicle.name,
                    vehicle.capacity,
                    depotName(vehicle.depotId),
                    `${vehicle.shiftStart}–${vehicle.shiftEnd} min`,
                    <Badge key={`${vehicle.id}-status`} t={vehicle.status === 'active' ? 'ok' : 'bad'}>{vehicle.status}</Badge>,
                    <button
                      key={`${vehicle.id}-action`}
                      type="button"
                      onClick={() => setSelectedVehicleId(isSelected ? null : vehicle.id)}
                      className={`rounded px-2 py-0.5 text-xs font-medium transition-all ${
                        isSelected
                          ? 'bg-[#243607] text-white'
                          : 'bg-[#BBBEA7]/25 text-[#30280D] hover:bg-[#BBBEA7]/40'
                      }`}
                    >
                      {isSelected ? 'Inspecting' : 'Inspect'}
                    </button>
                  ]
                })} />}
      </Card>
    </div>
  </>
}
