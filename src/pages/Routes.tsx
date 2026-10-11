import { useCallback, useEffect, useState } from 'react'
import { Card, PageHead, Badge, State } from '../components/ui'
import { getDeliveryPlan, getLocations, getVehicles, listDeliveryPlans } from '../services/persistenceService'
import { isDemoMode } from '../services/supabase'
import type { DeliveryPlan, Location, UserProfile, Vehicle } from '../types'
import { fmtTime } from '../utils/time'
import { SpatialRouteCanvas } from '../components/SpatialRouteCanvas'
import { MetricCard } from '../components/ui'

export default function Routes({ profile = null }: { profile?: UserProfile | null }) {
  const [plan, setPlan] = useState<DeliveryPlan | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [hasPlan, setHasPlan] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    if (isDemoMode) {
      setLoading(true)
      try {
        const samples = await import('../data/demo')
        setPlan(samples.originalPlan)
        setVehicles(samples.vehicles)
        setLocations(samples.locations)
        setHasPlan(true)
      } catch (cause) {
        setPlan(null)
        setError((cause as Error).message || 'Unable to load the demo route plan.')
      } finally {
        setLoading(false)
      }
      return
    }
    if (!profile?.orgId) {
      setPlan(null)
      setVehicles([])
      setLocations([])
      setHasPlan(false)
      setLoading(false)
      setError('Your organization profile is unavailable. Sign out and sign in again, or contact your administrator.')
      return
    }

    setLoading(true)
    setPlan(null)
    setHasPlan(false)
    try {
      const [organizationVehicles, organizationLocations, plans] = await Promise.all([
        getVehicles(profile.orgId),
        getLocations(profile.orgId),
        listDeliveryPlans(profile.orgId),
      ])
      const latestPlan = plans[0]
      const organizationPlan = latestPlan
        ? await getDeliveryPlan(latestPlan.id, profile.orgId)
        : null
      setVehicles(organizationVehicles)
      setLocations(organizationLocations)
      setPlan(organizationPlan)
      setHasPlan(Boolean(latestPlan))
    } catch (cause) {
      setError((cause as Error).message || 'Unable to load organization route plan.')
    } finally {
      setLoading(false)
    }
  }, [profile?.orgId])

  useEffect(() => { void load() }, [load])

  const locationNames = new Map(locations.map(location => [location.id, location.name]))
  const locationName = (id: string) => locationNames.get(id) ?? id
  const routeByVehicle = new Map((plan?.routes ?? []).map(route => [route.vehicleId, route]))

  return <>
    <PageHead
      title="Route plan"
      sub={plan?.label ?? 'Latest saved plan in your organization'}
    />
    <div className="mb-4 flex justify-end">
      <button type="button" onClick={() => void load()} disabled={loading} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Refresh</button>
    </div>
    {loading ? <State kind="loading" text="Loading the latest route plan from your organization…" />
      : error ? <State kind="error" text={error} />
        : !hasPlan ? <State kind="empty" text="No saved route plans are available for this organization yet." />
          : !plan ? <State kind="error" text="The saved route plan could not be loaded." />
            : vehicles.length === 0 ? <State kind="empty" text="This organization has no registered vehicles." />
              : <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <MetricCard label="Vehicles" value={vehicles.length} sub="Organization fleet" />
                  <MetricCard label="Scheduled stops" value={plan.routes.reduce((sum, route) => sum + route.stops.length, 0)} sub="Persisted plan stops" />
                  <MetricCard label="Unassigned" value={plan.unassigned.length} sub="Persisted plan metrics" />
                </div>
                <SpatialRouteCanvas plan={plan} vehicles={vehicles} locations={locations} />
                <div className="grid gap-4 lg:grid-cols-3">{vehicles.map(vehicle => {
                const route = routeByVehicle.get(vehicle.id)
                return <Card key={vehicle.id} title={vehicle.name} action={<Badge t="mute">{route?.load ?? 0}/{vehicle.capacity} load</Badge>}>
                  <ol className="space-y-3 border-l-2 border-teal/40 pl-4">
                    {(route?.stops ?? []).map(stop => <li key={stop.deliveryId}>
                      <div className="font-medium">{fmtTime(stop.serviceStart)} {locationName(stop.locationId)}</div>
                      <div className="text-xs text-slate-500">Arrive {fmtTime(stop.arrival)}{stop.waitMin > 0 && ` · waits ${stop.waitMin} min`} · leave {fmtTime(stop.departure)}</div>
                    </li>)}
                    {(!route || route.stops.length === 0) && <li className="text-sm text-slate-500">No stops</li>}
                  </ol>
                </Card>
              })}</div></div>}
  </>
}
