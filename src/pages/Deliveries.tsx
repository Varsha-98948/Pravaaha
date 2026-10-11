import { Card, PageHead, Badge, Table } from '../components/ui'
import { deliveries, locName, originalPlan } from '../data/demo'
import { fmtWindow } from '../utils/time'
export default function Deliveries() { const un = new Map(originalPlan.unassigned.map(u => [u.deliveryId, u])); return <><PageHead title="Deliveries" sub="Orders, sizes and time windows" /><Card><Table head={['ID', 'Customer', 'Size', 'Window', 'Priority', 'Assignment']} rows={deliveries.map(d => [d.id, locName(d.locationId), d.size, fmtWindow(d.window), <Badge t={d.priority === 'urgent' ? 'warn' : 'mute'}>{d.priority}</Badge>, un.has(d.id) ? <Badge t="bad">Unassigned: {un.get(d.id)!.detail}</Badge> : <Badge t="ok">Assigned</Badge>])} /></Card></> }
