import { useCallback, useEffect, useState } from 'react'
import { Card, PageHead, Badge, State, Table, MetricCard } from '../components/ui'
import { comparePlans } from '../engine/compare'
import { getDeliveryPlan, listDeliveryPlans, getDeliveries, getVehicles, getLocations } from '../services/persistenceService'
import { isDemoMode } from '../services/supabase'
import type { Delivery, DeliveryPlan, Location, UserProfile, Vehicle } from '../types'
import { fmtTime } from '../utils/time'

type DecisionFilter = 'all' | 'kept' | 'moved' | 'broken'

export default function Compare({ profile = null }: { profile?: UserProfile | null }) {
  const [plansList, setPlansList] = useState<Array<{ id: string; label: string; createdAt: number }>>([])
  const [planAId, setPlanAId] = useState('')
  const [planBId, setPlanBId] = useState('')
  const [originalPlan, setOriginalPlan] = useState<DeliveryPlan | null>(null)
  const [revisedPlan, setRevisedPlan] = useState<DeliveryPlan | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [filterDecision, setFilterDecision] = useState<DecisionFilter>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingPlans, setLoadingPlans] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      if (isDemoMode) {
        const samples = await import('../data/demo')
        setDeliveries(samples.deliveries)
        setVehicles(samples.vehicles)
        setLocations(samples.locations)
        setOriginalPlan(samples.originalPlan)
        setRevisedPlan(samples.revisedPlan)
        setPlansList([
          { id: samples.originalPlan.id, label: samples.originalPlan.label, createdAt: samples.originalPlan.createdAt },
          { id: samples.revisedPlan.id, label: samples.revisedPlan.label, createdAt: samples.revisedPlan.createdAt },
        ])
        setPlanAId(samples.originalPlan.id)
        setPlanBId(samples.revisedPlan.id)
      } else {
        if (!profile?.orgId) throw new Error('Your organization profile is unavailable. Sign out and sign in again, or contact your administrator.')
        const [orgDeliveries, orgVehicles, orgLocations, plans] = await Promise.all([
          getDeliveries(profile.orgId),
          getVehicles(profile.orgId),
          getLocations(profile.orgId),
          listDeliveryPlans(profile.orgId),
        ])
        setDeliveries(orgDeliveries)
        setVehicles(orgVehicles)
        setLocations(orgLocations)
        setPlansList(plans)

        if (plans.length >= 2) {
          const idA = plans[1].id
          const idB = plans[0].id
          setPlanAId(idA)
          setPlanBId(idB)
          const [pA, pB] = await Promise.all([
            getDeliveryPlan(idA, profile.orgId),
            getDeliveryPlan(idB, profile.orgId),
          ])
          setOriginalPlan(pA)
          setRevisedPlan(pB)
        } else if (plans.length === 1) {
          setPlanAId(plans[0].id)
          setPlanBId('')
          const pA = await getDeliveryPlan(plans[0].id, profile.orgId)
          setOriginalPlan(pA)
          setRevisedPlan(null)
        } else {
          setOriginalPlan(null)
          setRevisedPlan(null)
        }
      }
    } catch (cause) {
      setOriginalPlan(null)
      setRevisedPlan(null)
      setError((cause as Error).message || 'Unable to load saved organization plans.')
    } finally {
      setLoading(false)
    }
  }, [profile?.orgId])

  useEffect(() => { void load() }, [load])

  const handleSelectPlans = async (newAId: string, newBId: string) => {
    if (!profile?.orgId || isDemoMode) return
    setPlanAId(newAId)
    setPlanBId(newBId)
    if (!newAId || !newBId) return
    setLoadingPlans(true)
    setError('')
    try {
      const [pA, pB] = await Promise.all([
        getDeliveryPlan(newAId, profile.orgId),
        getDeliveryPlan(newBId, profile.orgId),
      ])
      setOriginalPlan(pA)
      setRevisedPlan(pB)
    } catch (cause) {
      setError((cause as Error).message || 'Unable to load selected plans.')
    } finally {
      setLoadingPlans(false)
    }
  }

  const comparison = originalPlan && revisedPlan ? comparePlans(originalPlan, revisedPlan) : null
  const vehiclesById = new Map(vehicles.map(vehicle => [vehicle.id, vehicle.name]))
  const locationNames = new Map(locations.map(location => [location.id, location.name]))

  const stopsByPlan = (p: DeliveryPlan) => new Map(p.routes.flatMap(route => route.stops.map(stop => [stop.deliveryId, {
    vehicle: vehiclesById.get(route.vehicleId) ?? route.vehicleId,
    time: Number.isFinite(stop.serviceStart) ? fmtTime(stop.serviceStart) : 'Time unavailable',
  }] as const)))

  const originalStops = originalPlan ? stopsByPlan(originalPlan) : new Map()
  const revisedStops = revisedPlan ? stopsByPlan(revisedPlan) : new Map()
  const originalUnassigned = new Map((originalPlan?.unassigned ?? []).map(item => [item.deliveryId, item]))
  const revisedUnassigned = new Map((revisedPlan?.unassigned ?? []).map(item => [item.deliveryId, item]))

  const allComparedIds = originalPlan && revisedPlan ? [...new Set([
    ...originalStops.keys(), ...revisedStops.keys(),
    ...originalPlan.unassigned.map(item => item.deliveryId),
    ...revisedPlan.unassigned.map(item => item.deliveryId),
    ...deliveries.map(delivery => delivery.id),
  ])].sort() : []

  const deliveriesById = new Map(deliveries.map(delivery => [delivery.id, delivery]))

  const filteredIds = allComparedIds.filter(id => {
    const decision = comparison?.decisions[id]
    if (filterDecision !== 'all' && decision !== filterDecision) return false
    if (!search) return true
    const delivery = deliveriesById.get(id)
    const name = delivery ? locationNames.get(delivery.locationId) ?? delivery.locationId : ''
    return id.toLowerCase().includes(search.toLowerCase()) || name.toLowerCase().includes(search.toLowerCase())
  })

  return <>
    <PageHead
      title="Original vs revised"
      sub={isDemoMode ? 'Compare the sample plans (demo mode)' : 'Compare any two persisted delivery plans in your organization'}
      actions={
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || loadingPlans}
          className="rounded-lg border border-[#30280D]/15 bg-white px-3 py-1.5 text-xs font-medium text-[#30280D] shadow-sm hover:bg-[#f2f3ec] disabled:opacity-50 transition-colors"
        >
          {loading || loadingPlans ? 'Loading…' : 'Refresh'}
        </button>
      }
    />

    {/* Plan Selector Dropdowns */}
    {plansList.length >= 2 && !isDemoMode && (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-[#30280D]/10 bg-white/70 p-3 shadow-sm">
        <label className="flex items-center gap-2 text-xs font-medium text-[#30280D]">
          Plan A (Baseline):
          <select
            value={planAId}
            onChange={e => void handleSelectPlans(e.target.value, planBId)}
            disabled={loadingPlans}
            className="rounded-lg border border-[#30280D]/15 bg-white px-2.5 py-1 text-xs text-[#30280D] focus:border-[#243607] focus:outline-none"
          >
            {plansList.map(p => (
              <option key={p.id} value={p.id}>
                {p.label} ({fmtTime(p.createdAt)})
              </option>
            ))}
          </select>
        </label>
        <span className="text-[#30280D]/40 text-xs">→</span>
        <label className="flex items-center gap-2 text-xs font-medium text-[#30280D]">
          Plan B (Revised):
          <select
            value={planBId}
            onChange={e => void handleSelectPlans(planAId, e.target.value)}
            disabled={loadingPlans}
            className="rounded-lg border border-[#30280D]/15 bg-white px-2.5 py-1 text-xs text-[#30280D] focus:border-[#243607] focus:outline-none"
          >
            {plansList.map(p => (
              <option key={p.id} value={p.id}>
                {p.label} ({fmtTime(p.createdAt)})
              </option>
            ))}
          </select>
        </label>
      </div>
    )}

    {loading ? <State kind="loading" text="Loading saved organization plans…" />
      : error ? <State kind="error" text={error} />
        : !originalPlan || !revisedPlan ? <State kind="empty" text={isDemoMode ? 'Plan comparison is unavailable.' : 'At least two saved plans are required before they can be compared. Save a baseline plan and run replanning to compare.'} />
          : comparison ? <>
            <div className="mb-4 grid grid-cols-3 gap-3">
              {(['kept', 'moved', 'broken'] as const).map(key => (
                <MetricCard
                  key={key}
                  label={key}
                  value={comparison.counts[key]}
                  sub={key === 'kept' ? 'Stops unchanged' : key === 'moved' ? 'Reassigned / rescheduled' : 'Dropped to unassigned'}
                  active={filterDecision === key}
                  onClick={() => setFilterDecision(filterDecision === key ? 'all' : key)}
                />
              ))}
            </div>

            {/* Filter toolbar */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#30280D]/10 bg-white/70 p-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  placeholder="Search deliveries…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="rounded-lg border border-[#30280D]/15 bg-white px-3 py-1 text-xs text-[#30280D] placeholder-[#30280D]/40 focus:border-[#243607] focus:outline-none"
                />
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-[#30280D]/60 font-medium">Decision:</span>
                  {(['all', 'kept', 'moved', 'broken'] as const).map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setFilterDecision(d)}
                      className={`rounded px-2 py-0.5 text-xs font-medium transition-all ${
                        filterDecision === d
                          ? 'bg-[#243607] text-white shadow-sm'
                          : 'bg-[#BBBEA7]/20 text-[#30280D]/75 hover:bg-[#BBBEA7]/35'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              {(search || filterDecision !== 'all') && (
                <button
                  type="button"
                  onClick={() => { setSearch(''); setFilterDecision('all'); }}
                  className="text-xs font-medium text-[#91696E] hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>

            <Card
              title={
                <div className="flex items-center gap-2 text-sm font-semibold text-[#30280D]">
                  <span>{originalPlan.label}</span>
                  <span className="text-[#30280D]/40">→</span>
                  <span>{revisedPlan.label}</span>
                </div>
              }
              sub={`${filteredIds.length} of ${allComparedIds.length} deliveries matching current filters`}
            >
              {filteredIds.length === 0
                ? <State kind="empty" text="No deliveries match your active filter." />
                : <Table head={['Delivery', 'Original Plan', 'Revised Plan', 'Decision']} rows={filteredIds.map(id => {
                  const delivery = deliveriesById.get(id)
                  const name = delivery ? locationNames.get(delivery.locationId) ?? delivery.locationId : 'Delivery record unavailable'
                  const original = originalStops.get(id)
                  const revised = revisedStops.get(id)
                  const originalMiss = originalUnassigned.get(id)
                  const revisedMiss = revisedUnassigned.get(id)
                  const decision = comparison.decisions[id]
                  const describeUnassigned = (item: typeof originalMiss) => item
                    ? `Unassigned: ${item.detail || item.reason}`
                    : 'Not in plan'
                  return [
                    <span key={`${id}-label`} className="font-medium text-xs text-[#30280D]">
                      <span className="font-mono text-[11px] text-[#30280D]/60 mr-1.5">{id}</span>
                      {name}
                    </span>,
                    original ? `${original.vehicle} @ ${original.time}` : describeUnassigned(originalMiss),
                    revised ? `${revised.vehicle} @ ${revised.time}` : describeUnassigned(revisedMiss),
                    decision ? <Badge key={`${id}-decision`} t={decision === 'kept' ? 'ok' : decision === 'moved' ? 'warn' : 'bad'}>{decision}</Badge> : 'Not compared',
                  ]
                })} />}
            </Card>
          </> : <State kind="empty" text="Plan comparison is unavailable." />}
  </>
}
