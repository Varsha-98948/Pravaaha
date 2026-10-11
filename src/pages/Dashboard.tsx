import { useCallback, useEffect, useState } from 'react'
import { Card, PageHead, State } from '../components/ui'
import { dashboardMetrics, loadDashboardData, type DashboardData } from '../services/overviewService'
import { isDemoMode } from '../services/supabase'
import type { UserProfile } from '../types'

type OverviewData = Omit<DashboardData, 'metrics'>

export default function Dashboard({ profile = null }: { profile?: UserProfile | null }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      let overview: OverviewData
      if (isDemoMode) {
        const samples = await import('../data/demo')
        overview = { vehicles: samples.vehicles, deliveries: samples.deliveries, latestPlan: samples.originalPlan }
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
  const kpis: Array<[string, number | string]> = [
    ['Active vehicles', metrics?.activeVehicles ?? '—'],
    ['Deliveries', metrics?.deliveries ?? '—'],
    ['Scheduled', metrics?.scheduledStops ?? 'Unavailable'],
    ['Unassigned', metrics?.unassigned ?? 'Unavailable'],
    ['Late stops', metrics?.lateStops ?? 'Unavailable'],
  ]

  return <>
    <PageHead title="Dispatch overview" sub={isDemoMode ? "Today's sample plan (demo mode)" : "Today's organization data at a glance"} />
    <div className="mb-4 flex justify-end">
      <button type="button" onClick={() => void load()} disabled={loading} className="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">Refresh</button>
    </div>
    {loading ? <State kind="loading" text="Loading organization metrics…" />
      : error ? <State kind="error" text={error} />
        : data ? <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{kpis.map(([label, value]) => <Card key={label}><div className="text-2xl font-semibold">{value}</div><div className="text-sm text-slate-500">{label}</div></Card>)}</div>
          <div className="mt-4"><Card title="Status">
            {data.vehicles.length === 0 && data.deliveries.length === 0 && !data.latestPlan
              ? <State kind="empty" text="No organization vehicles, deliveries, or saved plans are available yet." />
              : <State kind={data.latestPlan ? 'success' : 'empty'} text={data.latestPlan
                ? `Metrics are based on the latest saved plan${isDemoMode ? ' (demo mode)' : ' and successfully loaded organization records'}.`
                : 'Vehicles and deliveries loaded. Plan metrics are unavailable until a plan has been saved.'} />}
          </Card></div>
        </> : <State kind="empty" text="No overview data is available." />}
  </>
}
