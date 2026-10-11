import { useCallback, useEffect, useState } from 'react'
import { Card, PageHead, Badge, State, Table, MetricCard } from '../components/ui'
import { comparePlans } from '../engine/compare'
import { loadPlanComparisonData, type PlanComparisonData } from '../services/overviewService'
import { isDemoMode } from '../services/supabase'
import type { DeliveryPlan, UserProfile } from '../types'
import { fmtTime } from '../utils/time'

export default function Compare({ profile = null }: { profile?: UserProfile | null }) {
  const [data, setData] = useState<PlanComparisonData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      if (isDemoMode) {
        const samples = await import('../data/demo')
        setData({
          deliveries: samples.deliveries,
          vehicles: samples.vehicles,
          locations: samples.locations,
          originalPlan: samples.originalPlan,
          revisedPlan: samples.revisedPlan,
        })
      } else {
        if (!profile?.orgId) throw new Error('Your organization profile is unavailable. Sign out and sign in again, or contact your administrator.')
        setData(await loadPlanComparisonData(profile.orgId))
      }
    } catch (cause) {
      setData(null)
      setError((cause as Error).message || 'Unable to load saved organization plans.')
    } finally {
      setLoading(false)
    }
  }, [profile?.orgId])

  useEffect(() => { void load() }, [load])

  const comparison = data ? comparePlans(data.originalPlan, data.revisedPlan) : null
  const vehiclesById = new Map((data?.vehicles ?? []).map(vehicle => [vehicle.id, vehicle.name]))
  const locationNames = new Map((data?.locations ?? []).map(location => [location.id, location.name]))
  const stopsByPlan = (plan: DeliveryPlan) => new Map(plan.routes.flatMap(route => route.stops.map(stop => [stop.deliveryId, {
    vehicle: vehiclesById.get(route.vehicleId) ?? route.vehicleId,
    time: Number.isFinite(stop.serviceStart) ? fmtTime(stop.serviceStart) : 'Time unavailable',
  }] as const)))
  const originalStops = data ? stopsByPlan(data.originalPlan) : new Map()
  const revisedStops = data ? stopsByPlan(data.revisedPlan) : new Map()
  const originalUnassigned = new Map((data?.originalPlan.unassigned ?? []).map(item => [item.deliveryId, item]))
  const revisedUnassigned = new Map((data?.revisedPlan.unassigned ?? []).map(item => [item.deliveryId, item]))
  const comparedIds = data ? [...new Set([
    ...originalStops.keys(), ...revisedStops.keys(),
    ...data.originalPlan.unassigned.map(item => item.deliveryId),
    ...data.revisedPlan.unassigned.map(item => item.deliveryId),
    ...data.deliveries.map(delivery => delivery.id),
  ])].sort() : []
  const deliveriesById = new Map((data?.deliveries ?? []).map(delivery => [delivery.id, delivery]))

  return <>
    <PageHead title="Original vs revised" sub={isDemoMode ? 'Compare the sample plans (demo mode)' : 'Compare the two most recently saved plans in your organization'} />
    <div className="mb-4 flex justify-end">
      <button type="button" onClick={() => void load()} disabled={loading} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Refresh</button>
    </div>
    {loading ? <State kind="loading" text="Loading saved organization plans…" />
      : error ? <State kind="error" text={error} />
        : !data ? <State kind="empty" text={isDemoMode ? 'Plan comparison is unavailable.' : 'At least two saved plans are required.'} sub={isDemoMode ? 'The demo data provides both plans; this should always be visible.' : 'Generate a baseline plan in Route plan, then confirm a disruption in Disruptions to produce a second replanned route. The two most recently saved plans will be compared here.'} />
          : comparison ? <>
            <div className="mb-4 flex flex-wrap gap-3">
              {(['kept', 'moved', 'broken'] as const).map(key => <MetricCard key={key} label={key} value={comparison.counts[key]} sub="Saved plan comparison" />)}
            </div>
            <Card>
              <div className="mb-3 text-sm text-slate-600">{data.originalPlan.label} → {data.revisedPlan.label}</div>
              {comparedIds.length === 0
                ? <State kind="empty" text="These saved plans contain no scheduled or unassigned deliveries to compare." />
                : <Table head={['Delivery', 'Original', 'Revised', 'Decision']} rows={comparedIds.map(id => {
                  const delivery = deliveriesById.get(id)
                  const name = delivery ? locationNames.get(delivery.locationId) ?? delivery.locationId : 'Delivery record unavailable'
                  const original = originalStops.get(id)
                  const revised = revisedStops.get(id)
                  const originalMiss = originalUnassigned.get(id)
                  const revisedMiss = revisedUnassigned.get(id)
                  const decision = comparison.decisions[id]
                  const describeUnassigned = (item: typeof originalMiss) => item
                    ? `Unassigned: ${item.detail || item.reason}`
                    : 'Not in either plan'
                  return [
                    `${id} ${name}`,
                    original ? `${original.vehicle} ${original.time}` : describeUnassigned(originalMiss),
                    revised ? `${revised.vehicle} ${revised.time}` : describeUnassigned(revisedMiss),
                    decision ? <Badge key={`${id}-decision`} t={decision === 'kept' ? 'ok' : decision === 'moved' ? 'warn' : 'bad'}>{decision}</Badge> : 'Not compared',
                  ]
                })} />}
            </Card>
          </> : <State kind="empty" text="Plan comparison is unavailable." />}
  </>
}
