import { Card, PageHead, Badge, Table } from '../components/ui'
import { vehicles, locName } from '../data/demo'
export default function Fleet() { return <><PageHead title="Fleet" sub="Vehicles, capacity and shifts" /><Card><Table head={['Vehicle', 'Capacity', 'Depot', 'Shift', 'Status']} rows={vehicles.map(v => [v.name, v.capacity, locName(v.depotId), `${v.shiftStart}–${v.shiftEnd} min`, <Badge t={v.status === 'active' ? 'ok' : 'bad'}>{v.status}</Badge>])} /></Card></> }
