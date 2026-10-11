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

export default function Routes({
  profile = null,
  demoRole = 'dispatcher',
}: {
  profile?: UserProfile | null
  demoRole?: UserProfile['role']
}) {
  const [plan, setPlan] = useState<DeliveryPlan | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [hasPlan, setHasPlan] = useState(false)
  const [loading, setLoading] = useState(true)
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
      const [organizationVehicles, organizationDeliveries, organizationLocations, plans] =
        await Promise.all([
          getVehicles(profile.orgId),
          getDeliveries(profile.orgId),
          getLocations(profile.orgId),
          listDeliveryPlans(profile.orgId),
        ])
      const latestPlan = plans[0]
      const organizationPlan = latestPlan
        ? await getDeliveryPlan(latestPlan.id, profile.orgId)
        : null
      setVehicles(organizationVehicles)
      setDeliveries(organizationDeliveries)
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

  const generatePlan = async () => {
    setGenError('')
    setGenSuccess('')

    if (isDemoMode) {
      // In demo mode, re-allocate from demo data (non-persisted, in-memory only)
      try {
        setGenerating(true)
        const samples = await import('../data/demo')
        const generated = allocate(samples.vehicles, samples.deliveries, samples.matrix, 'Generated plan (demo)')
        setPlan(generated)
        setHasPlan(true)
        setGenSuccess(
          `Route plan generated in demo mode. ${generated.routes.length} vehicle routes, ${generated.routes.reduce((s, r) => s + r.stops.length, 0)} stops scheduled, ${generated.unassigned.length} unassigned. Demo plans are not persisted.`,
        )
      } catch (cause) {
        setGenError(
          `Plan generation failed: ${(cause as Error).message}`,
        )
      } finally {
        setGenerating(false)
      }
      return
    }

    if (!profile?.orgId) {
      setGenError('Organization profile is unavailable. Sign in again before generating a plan.')
      return
    }
    if (profile.role !== 'admin' && profile.role !== 'dispatcher') {
      setGenError('Only administrators and dispatchers can generate and save route plans.')
      return
    }

    const activeVehicles = vehicles.filter(v => v.status === 'active')
    if (activeVehicles.length === 0) {
      setGenError(
        'No active vehicles are registered for this organization. Add active vehicles in Fleet before generating a plan.',
      )
      return
    }
    if (deliveries.length === 0) {
      setGenError(
        'No deliveries are registered for this organization. Add deliveries before generating a plan.',
      )
      return
    }

    // Build a direct-link travel matrix from observable stop timings across saved plans.
    // The allocator requires at least depot→customer entries to assign stops.
    // Without observable legs, the allocator honestly marks deliveries unreachable.
    let matrix: Record<string, Record<string, number>> = {}
    try {
      const historicalPlans = await listDeliveryPlans(profile.orgId)
      for (const p of historicalPlans.slice(0, 5)) {
        try {
          const fullPlan = await getDeliveryPlan(p.id, profile.orgId)
          const m = travelMatrixFromPersistedPlan(fullPlan, vehicles)
          for (const from of Object.keys(m)) {
            matrix[from] = { ...(matrix[from] ?? {}), ...m[from] }
          }
        } catch {
          // Non-fatal: individual plan parsing issues skipped
        }
      }
    } catch {
      if (plan) {
        try {
          matrix = travelMatrixFromPersistedPlan(plan, vehicles)
        } catch {
          // Non-fatal: matrix stays empty; allocator will report unreachable
        }
      }
    }

    setGenerating(true)
    try {
      const label = `Plan ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`
      const generated = allocate(activeVehicles, deliveries, matrix, label)
      const planToSave: DeliveryPlan = {
        ...generated,
        id: `plan-${Date.now()}-${crypto.randomUUID()}`,
      }
      await saveDeliveryPlan(planToSave, profile.orgId, profile)
      await load()
      const assigned = planToSave.routes.reduce((s, r) => s + r.stops.length, 0)
      const unassigned = planToSave.unassigned.length
      if (unassigned > 0 && assigned === 0) {
        setGenError(
          `Plan generated and saved but all ${unassigned} deliveries are unassigned. This is likely because no travel-time data exists between your locations. Persist a plan with known route timings first, or use the Disruptions workflow to establish route legs.`,
        )
      } else {
        setGenSuccess(
          `Plan "${planToSave.label}" generated and saved. ${planToSave.routes.length} vehicle routes, ${assigned} stops scheduled${unassigned > 0 ? `, ${unassigned} deliveries unassigned (see details below)` : ' with no unassigned deliveries'}.`,
        )
      }
    } catch (cause) {
      setGenError(`${(cause as Error).message}`)
    } finally {
      setGenerating(false)
    }
  }

  const locationNames = new Map(locations.map(location => [location.id, location.name]))
  const locationName = (id: string) => locationNames.get(id) ?? id
  const routeByVehicle = new Map((plan?.routes ?? []).map(route => [route.vehicleId, route]))

  const totalStops = plan?.routes.reduce((sum, route) => sum + route.stops.length, 0) ?? 0
  const activeVehicleCount = vehicles.filter(v => v.status === 'active').length
  const lateStops = plan?.routes.flatMap(r => r.stops).filter(s => s.status === 'late').length ?? 0

  return <>
    <PageHead
      title="Route plan"
      sub={plan?.label ?? (hasPlan ? 'Latest saved plan in your organization' : 'No saved plan yet')}
      actions={
        <div className="flex items-center gap-2">
          {canWrite && (
            <button
              type="button"
              onClick={() => void generatePlan()}
              disabled={generating || loading}
              className="inline-flex items-center gap-1.5 rounded bg-[#243607] px-3 py-2 text-sm font-medium text-white hover:bg-[#182404] disabled:opacity-50"
            >
              <Play size={14} />
              {generating ? 'Generating…' : hasPlan ? 'Regenerate plan' : 'Generate plan'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || generating}
            className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={12} />
            Refresh
          </button>
        </div>
      }
    />

    {genSuccess && (
      <div className="mb-4 flex items-start gap-2 rounded border border-[#243607]/25 bg-[#243607]/10 p-3 text-sm text-[#243607]">
        <CheckCircle size={16} className="mt-0.5 shrink-0" />
        <span>{genSuccess}</span>
      </div>
    )}
    {genError && (
      <div className="mb-4 flex items-start gap-2 rounded border border-[#91696E]/25 bg-[#91696E]/10 p-3 text-sm text-[#91696E]">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <span>{genError}</span>
      </div>
    )}

    {loading
      ? <State kind="loading" text="Loading the latest route plan from your organization…" />
      : error
        ? <State kind="error" text={error} />
        : !hasPlan
          ? <div className="space-y-4">
              <State
                kind="empty"
                text="No saved route plan yet."
                sub={isDemoMode
                  ? 'Click "Generate plan" above to run the route allocator on the demo data and preview a plan instantly.'
                  : canWrite
                    ? 'Click "Generate plan" to run the route allocator on your organization\'s vehicles and deliveries. A plan will be saved and made available to Compare and Disruptions workflows. Make sure you have active vehicles and deliveries registered first.'
                    : 'A route plan will appear here once an administrator or dispatcher generates one for your organization.'}
              />
              {!isDemoMode && canWrite && (deliveries.length === 0 || activeVehicleCount === 0) && (
                <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  {deliveries.length === 0 && activeVehicleCount === 0
                    ? 'You need active vehicles and deliveries before generating a plan. Visit Fleet and Deliveries to add them.'
                    : deliveries.length === 0
                      ? 'No deliveries registered. Visit Deliveries to add delivery orders before generating a plan.'
                      : 'No active vehicles registered. Visit Fleet to add active vehicles before generating a plan.'}
                </div>
              )}
            </div>
          : !plan
            ? <State kind="error" text="The saved route plan header exists but its stops could not be loaded. Refresh or contact your administrator." />
            : vehicles.length === 0
              ? <State kind="empty" text="This organization has no registered vehicles." />
              : <div className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <MetricCard label="Vehicles" value={vehicles.length} sub={`${activeVehicleCount} active`} />
                    <MetricCard label="Scheduled stops" value={totalStops} sub="This plan" />
                    <MetricCard label="Unassigned" value={plan.unassigned.length} sub={plan.unassigned.length > 0 ? 'Needs attention' : 'All assigned'} />
                    <MetricCard label="Late stops" value={lateStops} sub="Status late in plan" />
                  </div>
                  <SpatialRouteCanvas plan={plan} vehicles={vehicles} locations={locations} />
                  <div className="grid gap-4 lg:grid-cols-3">{vehicles.map(vehicle => {
                    const route = routeByVehicle.get(vehicle.id)
                    const loadPct = vehicle.capacity > 0 ? Math.round(((route?.load ?? 0) / vehicle.capacity) * 100) : 0
                    return <Card
                      key={vehicle.id}
                      title={vehicle.name}
                      action={
                        <div className="flex items-center gap-1.5">
                          <Badge t={vehicle.status === 'failed' ? 'bad' : 'mute'}>
                            {route?.load ?? 0}/{vehicle.capacity} load
                          </Badge>
                          {loadPct >= 90 && <Badge t="warn">Near capacity</Badge>}
                          {vehicle.status === 'failed' && <Badge t="bad">Failed</Badge>}
                        </div>
                      }
                    >
                      {(!route || route.stops.length === 0)
                        ? <p className="text-sm text-slate-500">No stops assigned to this vehicle.</p>
                        : <ol className="space-y-3 border-l-2 border-[#243607]/30 pl-4">
                            {route.stops.map((stop, idx) => (
                              <li key={stop.deliveryId}>
                                <div className="flex items-center gap-2">
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#243607]/10 text-[10px] font-bold text-[#243607]">{idx + 1}</span>
                                  <div>
                                    <div className="text-sm font-medium text-slate-800">
                                      {fmtTime(stop.serviceStart)} · {locationName(stop.locationId)}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      Arrive {fmtTime(stop.arrival)}{stop.waitMin > 0 && ` · waits ${stop.waitMin} min`} · leave {fmtTime(stop.departure)}
                                    </div>
                                  </div>
                                  <Badge
                                    t={stop.status === 'completed' ? 'ok' : stop.status === 'late' ? 'warn' : stop.status === 'skipped' ? 'bad' : 'mute'}
                                    className="ml-auto"
                                  >
                                    {stop.status}
                                  </Badge>
                                </div>
                              </li>
                            ))}
                          </ol>
                      }
                    </Card>
                  })}</div>
                  {plan.unassigned.length > 0 && (
                    <Card title="Unassigned deliveries" action={<Badge t="bad">{plan.unassigned.length} unassigned</Badge>}>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {plan.unassigned.map(item => (
                          <div key={item.deliveryId} className="rounded border border-[#91696E]/20 bg-[#91696E]/5 p-3 text-xs">
                            <div className="flex items-center gap-1.5">
                              <Badge t="bad">{item.reason}</Badge>
                              <span className="font-medium text-slate-700 truncate">{item.deliveryId}</span>
                            </div>
                            <p className="mt-1 text-slate-600">{item.detail}</p>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                </div>
    }
  </>
}
