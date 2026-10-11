import { useCallback, useEffect, useState } from 'react'
import { Card, PageHead, State, MetricCard } from '../components/ui'
import { dashboardMetrics, loadDashboardData, type DashboardData } from '../services/overviewService'
import { isDemoMode } from '../services/supabase'
import type { UserProfile } from '../types'
import { SpatialRouteCanvas } from '../components/SpatialRouteCanvas'

type OverviewData = Omit<DashboardData, 'metrics'>

export default function Dashboard({ profile = null }: { profile?: UserProfile | null }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      let overview: OverviewData
      if (isDemoMode) {
        const samples = await import('../data/demo')
        overview = { vehicles: samples.vehicles, deliveries: samples.deliveries, locations: samples.locations, latestPlan: samples.originalPlan }
      } else {
        if (!profile?.orgId) throw new Error('Your organization profile is unavailable. Sign out and sign in again, or contact your administrator.')
        overview = await loadDashboardData(profile.orgId)
      }
      setData({ ...overview, metrics: dashboardMetrics(overview.vehicles, overview.deliveries, overview.latestPlan) })
    } catch (cause) {
      setData(null)
      setError((cause as Error).message || 'Unable to load organization overview.')
    } finally {
      setLoading(false)
    }
  }, [profile?.orgId])

  useEffect(() => { void load() }, [load])

  const metrics = data?.metrics
  const kpis: Array<{ label: string; value: number | string; sub?: string }> = [
    { label: 'Active vehicles', value: metrics?.activeVehicles ?? '—', sub: `${data?.vehicles.length ?? 0} total fleet` },
    { label: 'Deliveries', value: metrics?.deliveries ?? '—', sub: 'Orders in database' },
    { label: 'Scheduled', value: metrics?.scheduledStops ?? '—', sub: metrics?.scheduledStops !== null ? 'Planned stops' : 'No plan active' },
    { label: 'Unassigned', value: metrics?.unassigned ?? '—', sub: (metrics?.unassigned ?? 0) > 0 ? 'Requires attention' : 'All orders routed' },
    { label: 'Late stops', value: metrics?.lateStops ?? '0', sub: (metrics?.lateStops ?? 0) > 0 ? 'Time window breach' : 'On schedule' },
  ]

  const routesByVehicle = new Map((data?.latestPlan?.routes ?? []).map(r => [r.vehicleId, r]))

  return <>
    <PageHead
      title="Dispatch overview"
      sub={isDemoMode ? "Today's sample plan (demo mode)" : "Today's organization fleet and dispatch status at a glance"}
      actions={
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-[#30280D]/15 bg-white px-3 py-1.5 text-xs font-medium text-[#30280D] shadow-sm hover:bg-[#f2f3ec] disabled:opacity-50 transition-colors"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      }
    />

    {loading ? <State kind="loading" text="Loading organization metrics…" />
      : error ? <State kind="error" text={error} />
        : data ? <>
          {/* Top KPI Metrics Row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {kpis.map(kpi => (
              <MetricCard
                key={kpi.label}
                label={kpi.label}
                value={kpi.value}
                sub={kpi.sub}
              />
            ))}
          </div>

          {/* Spatial Route Map and Trajectories */}
          {data.latestPlan && data.vehicles.length > 0 ? (
            <div className="mt-6 space-y-6">
              <Card
                title={
                  <div className="flex items-center gap-2">
                    <span>Tactical Network & Trajectories</span>
                    {selectedVehicleId && (
                      <span className="text-xs font-normal text-[#30280D]/70">
                        (filtered to {data.vehicles.find(v => v.id === selectedVehicleId)?.name})
                      </span>
                    )}
                  </div>
                }
                sub={data.latestPlan.label}
                action={
                  selectedVehicleId && (
                    <button
                      type="button"
                      onClick={() => setSelectedVehicleId(null)}
                      className="rounded-lg border border-[#243607]/30 bg-[#243607]/10 px-2.5 py-1 text-xs font-medium text-[#243607] hover:bg-[#243607]/20 transition-colors"
                    >
                      Reset selection
                    </button>
                  )
                }
              >
                <SpatialRouteCanvas
                  plan={data.latestPlan}
                  vehicles={data.vehicles}
                  locations={data.locations}
                  selectedVehicleId={selectedVehicleId}
                  onSelectVehicle={setSelectedVehicleId}
                />
              </Card>

              {/* Fleet Capacity & Utilization Breakdown */}
              <div className="grid gap-4 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <Card
                    title="Fleet Capacity & Stop Utilization"
                    sub="Click any vehicle to focus its route on the spatial canvas"
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="border-b border-[#30280D]/10 text-[#30280D]/60 uppercase tracking-wider font-semibold">
                            <th className="py-2.5 pl-2">Vehicle</th>
                            <th className="py-2.5">Stops</th>
                            <th className="py-2.5">Load / Capacity</th>
                            <th className="py-2.5">Utilization</th>
                            <th className="py-2.5 pr-2">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#30280D]/06">
                          {data.vehicles.map(v => {
                            const route = routesByVehicle.get(v.id)
                            const load = route?.load ?? 0
                            const pct = Math.min(100, Math.round((load / v.capacity) * 100))
                            const isSelected = selectedVehicleId === v.id
                            return (
                              <tr
                                key={v.id}
                                onClick={() => setSelectedVehicleId(isSelected ? null : v.id)}
                                className={`cursor-pointer transition-colors ${
                                  isSelected
                                    ? 'bg-[#243607]/10 font-semibold'
                                    : 'hover:bg-[#243607]/[0.04]'
                                }`}
                              >
                                <td className="py-3 pl-2 font-medium text-[#30280D]">
                                  <div className="flex items-center gap-2">
                                    <span className={`h-2 w-2 rounded-full ${isSelected ? 'bg-[#243607]' : 'bg-[#30280D]/30'}`} />
                                    <span>{v.name}</span>
                                  </div>
                                </td>
                                <td className="py-3 text-[#30280D]">{route?.stops.length ?? 0} stops</td>
                                <td className="py-3 text-[#30280D]">{load} / {v.capacity} units</td>
                                <td className="py-3">
                                  <div className="flex items-center gap-2 max-w-[120px]">
                                    <div className="h-2 flex-1 rounded-full bg-[#BBBEA7]/30 overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${
                                          load > v.capacity
                                            ? 'bg-[#91696E]'
                                            : pct > 80
                                            ? 'bg-[#243607]'
                                            : 'bg-[#243607]/70'
                                        }`}
                                        style={{ width: `${pct}%` }}
                                      />
                                    </div>
                                    <span className="text-[11px] text-[#30280D]/70 font-mono">{pct}%</span>
                                  </div>
                                </td>
                                <td className="py-3 pr-2">
                                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                    v.status === 'active'
                                      ? 'bg-[#243607]/10 text-[#243607] border border-[#243607]/20'
                                      : 'bg-[#91696E]/15 text-[#91696E] border border-[#91696E]/30'
                                  }`}>
                                    {v.status}
                                  </span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </div>

                <div>
                  <Card title="System Integrity" sub="Operational data verification">
                    <div className="space-y-3 text-xs">
                      <div className="rounded-lg border border-[#243607]/15 bg-[#243607]/05 p-3">
                        <div className="font-semibold text-[#243607]">Plan Persistence</div>
                        <p className="mt-1 text-[#30280D]/75 leading-relaxed">
                          All KPIs reflect genuine records loaded from {isDemoMode ? 'the simulation fixture' : 'your authenticated organization database'}.
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#30280D]/10 bg-white/60 p-3">
                        <div className="font-semibold text-[#30280D]">Network Metrics</div>
                        <div className="mt-1 text-[#30280D]/70 space-y-1">
                          <div>Registered waypoints: <span className="font-semibold">{data.locations.length}</span></div>
                          <div>Total customer orders: <span className="font-semibold">{data.deliveries.length}</span></div>
                          <div>Active fleet size: <span className="font-semibold">{data.vehicles.length}</span></div>
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <Card title="Status">
                <State
                  kind="empty"
                  text={
                    data.vehicles.length === 0 && data.deliveries.length === 0
                      ? 'No organization vehicles, deliveries, or saved plans are available yet. Add vehicles in Fleet and orders in Deliveries.'
                      : 'Vehicles and deliveries are registered, but no dispatch plan has been created yet. Run replanning or import an initial plan in Route plan.'
                  }
                />
              </Card>
            </div>
          )}
        </> : <State kind="empty" text="No overview data is available." />}
  </>
}
