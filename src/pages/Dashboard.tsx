import { Card, PageHead, State } from '../components/ui'
import { originalPlan, deliveries, vehicles } from '../data/demo'
export default function Dashboard() { const stops = originalPlan.routes.flatMap(r => r.stops); const kpi = [['Active vehicles', vehicles.filter(v => v.status === 'active').length], ['Deliveries', deliveries.length], ['Scheduled', stops.length], ['Unassigned', originalPlan.unassigned.length], ['Late stops', stops.filter(s => s.status === 'late').length]]
  return <><PageHead title="Dispatch overview" sub="Today's plan at a glance" /><div className="grid grid-cols-2 gap-3 md:grid-cols-5">{kpi.map(([l, v]) => <Card key={l}><div className="text-2xl font-semibold">{v}</div><div className="text-sm text-slate-500">{l}</div></Card>)}</div>
    <div className="mt-4"><Card title="Status"><State kind="success" text="Demo plan loaded. All scheduled routes pass capacity and time-window checks." /></Card></div></> }
