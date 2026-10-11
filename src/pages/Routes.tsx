import { useCallback, useEffect, useState } from 'react'
import { Play, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react'
import { Card, PageHead, Badge, State, MetricCard } from '../components/ui'
import {
  getDeliveryPlan,
  getDeliveries,
  getLocations,
  getVehicles,
  listDeliveryPlans,
  saveDeliveryPlan,
} from '../services/persistenceService'
import { isDemoMode } from '../services/supabase'
import type { DeliveryPlan, Delivery, Location, UserProfile, Vehicle } from '../types'
import { fmtTime } from '../utils/time'
import { SpatialRouteCanvas } from '../components/SpatialRouteCanvas'
import { allocate } from '../engine/allocate'
import { travelMatrixFromPersistedPlan } from '../services/replanningService'

export default function Routes({ profile = null }: { profile?: UserProfile | null }) {
  const [plansList, setPlansList] = useState<Array<{ id: string; label: string; createdAt: number }>>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string>('')
  const [plan, setPlan] = useState<DeliveryPlan | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [hasPlan, setHasPlan] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingPlan, setLoadingPlan] = useState(false)
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState('')
  const [genSuccess, setGenSuccess] = useState('')

  const canWrite = isDemoMode
    ? demoRole === 'admin' || demoRole === 'dispatcher'
    : profile?.role === 'admin' || profile?.role === 'dispatcher'

  const load = useCallback(async () => {
    setError('')
    setGenError('')
    setGenSuccess('')
    if (isDemoMode) {
      setLoading(true)
      try {
        const samples = await import('../data/demo')
        setPlan(samples.originalPlan)
        setVehicles(samples.vehicles)
        setDeliveries(samples.deliveries)
        setLocations(samples.locations)
        setPlansList([{ id: samples.originalPlan.id, label: samples.originalPlan.label, createdAt: samples.originalPlan.createdAt }])
        setSelectedPlanId(samples.originalPlan.id)
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
      setDeliveries([])
      setLocations([])
      setHasPlan(false)
      setLoading(false)
      setError(
        'Your organization profile is unavailable. Sign out and sign in again, or contact your administrator.',
      )
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
      setVehicles(organizationVehicles)
      setDeliveries(organizationDeliveries)
      setLocations(organizationLocations)
      setPlansList(plans)

      const targetPlanMeta = plans[0]
      if (targetPlanMeta) {
        setSelectedPlanId(targetPlanMeta.id)
        const organizationPlan = await getDeliveryPlan(targetPlanMeta.id, profile.orgId)
        setPlan(organizationPlan)
        setHasPlan(true)
      } else {
        setPlan(null)
        setHasPlan(false)
      }
    } catch (cause) {
      setError((cause as Error).message || 'Unable to load organization route plan.')
    } finally {
      setLoading(false)
    }
  }, [profile?.orgId])

  useEffect(() => { void load() }, [load])

  const handlePlanChange = async (planId: string) => {
    if (planId === selectedPlanId || !profile?.orgId || isDemoMode) return
    setSelectedPlanId(planId)
    setLoadingPlan(true)
    try {
      const loaded = await getDeliveryPlan(planId, profile.orgId)
      setPlan(loaded)
    } catch (cause) {
      setError((cause as Error).message || 'Unable to load selected plan.')
    } finally {
      setLoadingPlan(false)
    }
  }

  const locationNames = new Map(locations.map(location => [location.id, location.name]))
  const locationName = (id: string) => locationNames.get(id) ?? id
  const routeByVehicle = new Map((plan?.routes ?? []).map(route => [route.vehicleId, route]))

  const filteredVehicles = vehicles.filter(v =>
    v.name.toLowerCase().includes(vehicleSearch.toLowerCase()) ||
    v.id.toLowerCase().includes(vehicleSearch.toLowerCase())
  )

  return <>
    <PageHead
      title="Route plan"
      sub={plan?.label ?? 'Persisted dispatch routes in your organization'}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {plansList.length > 1 && !isDemoMode && (
            <label className="flex items-center gap-1.5 text-xs font-medium text-[#30280D]/80">
              Plan:
              <select
                value={selectedPlanId}
                onChange={e => void handlePlanChange(e.target.value)}
                disabled={loading || loadingPlan}
                className="rounded-lg border border-[#30280D]/15 bg-white px-2.5 py-1.5 text-xs text-[#30280D] shadow-sm focus:border-[#243607] focus:outline-none"
              >
                {plansList.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({fmtTime(p.createdAt)})
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || loadingPlan}
            className="rounded-lg border border-[#30280D]/15 bg-white px-3 py-1.5 text-xs font-medium text-[#30280D] shadow-sm hover:bg-[#f2f3ec] disabled:opacity-50 transition-colors"
          >
            {loading || loadingPlan ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      }
    />

    {loading ? <State kind="loading" text="Loading route plan from your organization…" />
      : error ? <State kind="error" text={error} />
        : !hasPlan ? <State kind="empty" text="No saved route plans are available for this organization yet. Run replanning or import an initial plan." />
          : !plan ? <State kind="error" text="The saved route plan could not be loaded." />
            : vehicles.length === 0 ? <State kind="empty" text="This organization has no registered vehicles." />
              : <div className="space-y-6">
                <div className="grid gap-3 sm:grid-cols-3">
                  <MetricCard label="Vehicles" value={vehicles.length} sub="Organization fleet" />
                  <MetricCard label="Scheduled stops" value={plan.routes.reduce((sum, route) => sum + route.stops.length, 0)} sub="Persisted plan stops" />
                  <MetricCard label="Unassigned" value={plan.unassigned.length} sub={plan.unassigned.length > 0 ? "Requires attention" : "All orders scheduled"} />
                </div>

                <SpatialRouteCanvas
                  plan={plan}
                  vehicles={vehicles}
                  locations={locations}
                  selectedVehicleId={selectedVehicleId}
                  onSelectVehicle={setSelectedVehicleId}
                />

                <div className="space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-base font-semibold text-[#30280D]">
                      Vehicle Itineraries {selectedVehicleId && <span className="text-xs font-normal text-[#30280D]/70">(filtered to {vehicles.find(v => v.id === selectedVehicleId)?.name})</span>}
                    </h2>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Search vehicles…"
                        value={vehicleSearch}
                        onChange={e => setVehicleSearch(e.target.value)}
                        className="rounded-lg border border-[#30280D]/15 bg-white px-3 py-1 text-xs text-[#30280D] placeholder-[#30280D]/40 focus:border-[#243607] focus:outline-none"
                      />
                      {selectedVehicleId && (
                        <button
                          type="button"
                          onClick={() => setSelectedVehicleId(null)}
                          className="rounded-lg border border-[#243607]/30 bg-[#243607]/10 px-2.5 py-1 text-xs font-medium text-[#243607] hover:bg-[#243607]/20 transition-colors"
                        >
                          Clear selection
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredVehicles.map(vehicle => {
                      const route = routeByVehicle.get(vehicle.id)
                      const isSelected = selectedVehicleId === vehicle.id
                      return (
                        <div
                          key={vehicle.id}
                          onClick={() => setSelectedVehicleId(isSelected ? null : vehicle.id)}
                          className={`cursor-pointer transition-all duration-200 rounded-xl ${
                            isSelected
                              ? 'ring-2 ring-[#243607] shadow-spatial-md -translate-y-0.5'
                              : 'hover:-translate-y-0.5'
                          }`}
                        >
                          <Card
                            title={
                              <div className="flex items-center gap-2">
                                <span className={`h-2.5 w-2.5 rounded-full ${isSelected ? 'bg-[#243607]' : 'bg-[#30280D]/30'}`} />
                                <span className="font-semibold text-sm">{vehicle.name}</span>
                              </div>
                            }
                            action={
                              <Badge t={route && route.load > vehicle.capacity ? 'bad' : 'mute'}>
                                {route?.load ?? 0}/{vehicle.capacity} load
                              </Badge>
                            }
                          >
                            <div className="mb-2 text-xs text-[#30280D]/65">
                              {route?.stops.length ?? 0} stops · Shift: {fmtTime(vehicle.shiftStart)}–{fmtTime(vehicle.shiftEnd)}
                            </div>
                            <ol className="space-y-2.5 border-l-2 border-[#243607]/30 pl-3.5 mt-3">
                              {(route?.stops ?? []).map(stop => (
                                <li key={stop.deliveryId} className="text-xs">
                                  <div className="font-medium text-[#30280D] leading-tight">
                                    {fmtTime(stop.serviceStart)} {locationName(stop.locationId)}
                                  </div>
                                  <div className="text-[11px] text-[#30280D]/60 mt-0.5">
                                    Arrive {fmtTime(stop.arrival)}
                                    {stop.waitMin > 0 && ` · wait ${stop.waitMin}m`} · leave {fmtTime(stop.departure)}
                                  </div>
                                </li>
                              ))}
                              {(!route || route.stops.length === 0) && (
                                <li className="text-xs text-[#30280D]/50 italic">No scheduled stops</li>
                              )}
                            </ol>
                          </Card>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>}
  </>
}
