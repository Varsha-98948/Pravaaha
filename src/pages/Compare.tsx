import { Card, PageHead, Badge, Table } from '../components/ui'
import { originalPlan, revisedPlan, vehicles, deliveries, locName } from '../data/demo'
import { comparePlans } from '../engine/compare'
import { fmtTime } from '../utils/time'
const find = (p: typeof originalPlan, id: string) => p.routes.flatMap(r => r.stops.map(s => ({ ...s, v: vehicles.find(v => v.id === r.vehicleId)!.name }))).find(s => s.deliveryId === id)
export default function Compare() { const c = comparePlans(originalPlan, revisedPlan); return <><PageHead title="Original vs revised" sub="Revised plan is a seeded sample (Van 2 fails at 09:30); live replanning is not built yet." />
  <div className="mb-4 flex gap-3">{(['kept', 'moved', 'broken'] as const).map(k => <Card key={k}><div className="text-2xl font-semibold">{c.counts[k]}</div><div className="text-sm text-slate-500">{k}</div></Card>)}</div>
  <Card><Table head={['Delivery', 'Original', 'Revised', 'Decision']} rows={deliveries.map(d => { const a = find(originalPlan, d.id), b = find(revisedPlan, d.id), dec = c.decisions[d.id]; return [`${d.id} ${locName(d.locationId)}`, a ? `${a.v} ${fmtTime(a.serviceStart)}` : '—', b ? `${b.v} ${fmtTime(b.serviceStart)}` : 'Unassigned', dec ? <Badge t={dec === 'kept' ? 'ok' : dec === 'moved' ? 'warn' : 'bad'}>{dec}</Badge> : '—'] })} /></Card></> }
