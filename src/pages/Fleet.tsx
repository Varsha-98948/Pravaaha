import { Card, PageHead, Badge, Table, MetricCard } from '../components/ui'
import { vehicles, locName, originalPlan } from '../data/demo'
import { fmtTime } from '../utils/time'
import { Truck, BatteryCharging, ShieldCheck, MapPin, Gauge } from 'lucide-react'

export default function Fleet() {
  const totalCapacity = vehicles.reduce((sum, v) => sum + v.capacity, 0)
  const activeCount = vehicles.filter((v) => v.status === 'active').length

  return (
    <div className="space-y-6">
      <PageHead
        title="Fleet Management Grid"
        sub="Vehicle capacities, operational shift boundaries, depot home stations, and mechanical status."
        badge={
          <Badge t="ok" dot>
            {activeCount}/{vehicles.length} Units Operational
          </Badge>
        }
      />

      {/* Fleet Overview Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Total Fleet Units"
          value={vehicles.length}
          sub="3 dispatch vehicles available"
          icon={<Truck size={18} />}
          trend="100% Ready"
          trendType="positive"
        />
        <MetricCard
          label="Cumulative Payload Capacity"
          value={`${totalCapacity} units`}
          sub="Van & medium truck cargo volume"
          icon={<Gauge size={18} />}
          trend="Nominal"
          trendType="neutral"
        />
        <MetricCard
          label="Home Depot Terminal"
          value={locName('depot')}
          sub="All routes originate & return here"
          icon={<MapPin size={18} />}
          trend="Hub Central"
          trendType="positive"
        />
      </div>

      {/* Spatial Vehicle Detail Cards */}
      <div className="grid gap-5 md:grid-cols-3">
        {vehicles.map((v) => {
          const route = originalPlan.routes.find((r) => r.vehicleId === v.id)
          const load = route?.load ?? 0
          const stopsCount = route?.stops.length ?? 0
          const pct = Math.round((load / v.capacity) * 100)

          return (
            <Card
              key={v.id}
              title={
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#243607]/10 text-[#243607]">
                    <Truck size={16} />
                  </div>
                  <div>
                    <span className="font-bold text-sm text-[#30280D]">{v.name}</span>
                    <span className="text-[10px] text-[#30280D]/50 font-mono block">ID: {v.id}</span>
                  </div>
                </div>
              }
              action={
                <Badge t={v.status === 'active' ? 'ok' : 'bad'}>
                  {v.status.toUpperCase()}
                </Badge>
              }
            >
              {/* Capacity Usage Gauge */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#30280D]/70 font-medium">Payload Volume:</span>
                  <span className="font-mono font-bold text-[#30280D]">
                    {load} / {v.capacity} units ({pct}%)
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-[#30280D]/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#243607] to-[#354e0c] transition-all duration-300"
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </div>

              {/* Shift Information */}
              <div className="space-y-2 rounded-xl bg-[#f2f3ec] p-3 text-xs text-[#30280D]/80">
                <div className="flex justify-between">
                  <span className="text-[#30280D]/60">Operational Shift:</span>
                  <span className="font-semibold text-[#30280D]">
                    {fmtTime(v.shiftStart)} – {fmtTime(v.shiftEnd)} ({v.shiftEnd - v.shiftStart}m)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#30280D]/60">Home Base Depot:</span>
                  <span className="font-semibold text-[#30280D]">{locName(v.depotId)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#30280D]/60">Active Deliveries:</span>
                  <span className="font-bold text-[#243607]">{stopsCount} stops scheduled</span>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* Complete Registry Table */}
      <Card title="Vehicle Specifications & Dispatch Register">
        <Table
          head={['Vehicle Name & ID', 'Capacity Limit', 'Home Depot', 'Operating Shift', 'Operational Status']}
          rows={vehicles.map((v) => [
            <div key="name">
              <span className="font-bold text-xs text-[#30280D] block">{v.name}</span>
              <span className="font-mono text-[11px] text-[#30280D]/50">ID: {v.id}</span>
            </div>,
            <span key="cap" className="font-mono font-bold text-xs text-[#30280D]">
              {v.capacity} units
            </span>,
            locName(v.depotId),
            <span key="shift" className="font-mono text-xs">
              {fmtTime(v.shiftStart)} – {fmtTime(v.shiftEnd)} ({v.shiftEnd - v.shiftStart} mins)
            </span>,
            <Badge key="status" t={v.status === 'active' ? 'ok' : 'bad'}>
              {v.status}
            </Badge>,
          ])}
        />
      </Card>
    </div>
  )
}
