import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Badge, Card, PageHead, State, Table } from '../components/ui'
import { getLocations, getVehicles, saveLocation, saveVehicle } from '../services/persistenceService'
import { isDemoMode } from '../services/supabase'
import type { Location, UserProfile, Vehicle } from '../types'

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

  return <>
    <PageHead title="Fleet" sub={isDemoMode ? 'Sample vehicles, capacity and shifts (demo mode)' : 'Vehicles and locations in your organization'} />
    <div className="mb-4 flex justify-end">
      <button type="button" onClick={() => void load()} disabled={loading || saving !== ''} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Refresh</button>
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
            <button type="submit" disabled={saving !== '' || loading} className="rounded bg-navy px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saving === 'location' ? 'Saving…' : 'Create location'}</button>
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
            <button type="submit" disabled={saving !== '' || loading || depots.length === 0} className="self-end rounded bg-navy px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{saving === 'vehicle' ? 'Saving…' : 'Create vehicle'}</button>
            {depots.length === 0 && <p className="text-xs text-amber-800 sm:col-span-2">Create a depot location first; vehicles must reference a depot in this organization.</p>}
          </form>
        </Card>
      </div>}

    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={isDemoMode ? 'Sample locations' : 'Organization locations'}>
        {loading ? <State kind="loading" text="Loading organization locations…" />
          : error ? <State kind="error" text={error} />
            : locations.length === 0 ? <State kind="empty" text="No locations are registered. Create a depot before adding vehicles, and customer locations before adding deliveries." />
              : <Table head={['Name', 'Kind']} rows={locations.map(location => [location.name, <Badge key={`${location.id}-kind`} t={location.kind === 'depot' ? 'ok' : 'mute'}>{location.kind}</Badge>])} />}
      </Card>
      <Card title={isDemoMode ? 'Sample fleet' : 'Organization fleet'}>
        {loading ? <State kind="loading" text="Loading vehicles from your organization…" />
          : error ? <State kind="error" text={error} />
            : vehicles === null ? <State kind="error" text="Fleet data is unavailable. Refresh to try again." />
              : vehicles.length === 0 ? <State kind="empty" text="No vehicles are registered for this organization yet." />
                : <Table head={['Vehicle', 'Capacity', 'Depot', 'Shift', 'Status']} rows={vehicles.map(vehicle => [
                  vehicle.name, vehicle.capacity, depotName(vehicle.depotId), `${vehicle.shiftStart}–${vehicle.shiftEnd} min`,
                  <Badge key={`${vehicle.id}-status`} t={vehicle.status === 'active' ? 'ok' : 'bad'}>{vehicle.status}</Badge>,
                ])} />}
      </Card>
    </div>
  </>
}
