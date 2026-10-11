import { useState } from 'react'
import { Card, PageHead, Badge, Table, MetricCard } from '../components/ui'
import { deliveries, locName, originalPlan, vehicles } from '../data/demo'
import { fmtTime, fmtWindow } from '../utils/time'
import { Package, Clock, ShieldAlert, CheckCircle2, Filter, AlertCircle } from 'lucide-react'

export default function Deliveries() {
  const [filter, setFilter] = useState<'all' | 'urgent' | 'normal' | 'unassigned'>('all')

  const unassignedMap = new Map(originalPlan.unassigned.map((u) => [u.deliveryId, u]))
  const urgentCount = deliveries.filter((d) => d.priority === 'urgent').length
  const totalUnits = deliveries.reduce((sum, d) => sum + d.size, 0)

  const filteredDeliveries = deliveries.filter((d) => {
    if (filter === 'urgent') return d.priority === 'urgent'
    if (filter === 'normal') return d.priority === 'normal'
    if (filter === 'unassigned') return unassignedMap.has(d.id)
    return true
  })

  return (
    <div className="space-y-6">
      <PageHead
        title="Delivery Orders & Manifests"
        sub="Customer delivery commitments, cargo volume sizes, service time windows, and vehicle assignments."
        badge={
          <Badge t="ok" dot>
            {deliveries.length} Total Orders Loaded
          </Badge>
        }
      />

      {/* Orders High-Level KPI Strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          label="Total Orders"
          value={deliveries.length}
          sub="Customer stops scheduled"
          icon={<Package size={17} />}
          trend="Active"
          trendType="positive"
        />
        <MetricCard
          label="Cumulative Cargo Volume"
          value={`${totalUnits} units`}
          sub="Total package weight/size"
          icon={<Package size={17} />}
          trend="Dispatched"
          trendType="neutral"
        />
        <MetricCard
          label="Urgent Orders"
          value={urgentCount}
          sub="Strict high-priority time bounds"
          icon={<ShieldAlert size={17} />}
          trend="Monitored"
          trendType="positive"
        />
        <MetricCard
          label="Unassigned Orders"
          value={originalPlan.unassigned.length}
          sub="Optimal vehicle allocation"
          icon={<AlertCircle size={17} />}
          trend="0 Pending"
          trendType="positive"
        />
      </div>

      {/* Manifest Table */}
      <Card
        title="Customer Delivery Schedule Register"
        sub="Individual stop records with assigned carrier vehicle and service timing"
        action={
          <div className="flex items-center gap-1.5 bg-[#f2f3ec] p-1 rounded-lg border border-[#30280D]/10">
            <Filter size={13} className="text-[#30280D]/60 ml-1.5" />
            {(['all', 'urgent', 'normal', 'unassigned'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setFilter(opt)}
                className={`px-2.5 py-0.5 text-xs font-semibold rounded capitalize transition-all ${
                  filter === opt
                    ? 'bg-[#243607] text-white shadow-sm'
                    : 'text-[#30280D]/70 hover:bg-white'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        }
      >
        <Table
          head={[
            'Order ID & Customer',
            'Cargo Size',
            'Service Duration',
            'Time Window Window',
            'Priority Tier',
            'Carrier Assignment',
          ]}
          rows={filteredDeliveries.map((d) => {
            const assignedRoute = originalPlan.routes.find((r) =>
              r.stops.some((s) => s.deliveryId === d.id)
            )
            const assignedStop = assignedRoute?.stops.find((s) => s.deliveryId === d.id)
            const assignedVehicle = vehicles.find((v) => v.id === assignedRoute?.vehicleId)
            const isUnassigned = unassignedMap.has(d.id)

            return [
              <div key="cust">
                <span className="font-mono font-bold text-xs text-[#243607] block">{d.id}</span>
                <span className="font-bold text-xs text-[#30280D]">{locName(d.locationId)}</span>
              </div>,
              <span key="size" className="font-mono font-bold text-xs text-[#30280D]">
                {d.size} units
              </span>,
              <span key="serv" className="font-mono text-xs text-[#30280D]/80">
                {d.serviceMin} mins
              </span>,
              <div key="win" className="flex items-center gap-1.5 font-mono text-xs text-[#30280D]">
                <Clock size={12} className="text-[#30280D]/50" />
                <span>{fmtWindow(d.window)}</span>
              </div>,
              <Badge key="pri" t={d.priority === 'urgent' ? 'warn' : 'mute'}>
                {d.priority.toUpperCase()}
              </Badge>,
              isUnassigned ? (
                <Badge key="assign" t="bad">
                  Unassigned: {unassignedMap.get(d.id)!.detail}
                </Badge>
              ) : assignedVehicle && assignedStop ? (
                <div key="assign">
                  <span className="font-semibold text-xs text-[#243607] block">
                    {assignedVehicle.name}
                  </span>
                  <span className="text-[11px] text-[#30280D]/60">
                    Serv: {fmtTime(assignedStop.serviceStart)}
                  </span>
                </div>
              ) : (
                <Badge key="assign" t="mute">Unscheduled</Badge>
              ),
            ]
          })}
        />
      </Card>
    </div>
  )
}
