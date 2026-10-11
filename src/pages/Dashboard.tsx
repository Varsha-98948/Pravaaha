import { useState } from 'react'
import { Card, PageHead, MetricCard, Badge, SpatialButton } from '../components/ui'
import { originalPlan, deliveries, vehicles, locations, locName } from '../data/demo'
import { SpatialRouteCanvas } from '../components/SpatialRouteCanvas'
import { fmtTime, fmtWindow } from '../utils/time'
import {
  Truck,
  Package,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Clock,
  Sparkles,
  ArrowRight,
} from 'lucide-react'

export default function Dashboard() {
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)

  const activeVehicles = vehicles.filter((v) => v.status === 'active')
  const stops = originalPlan.routes.flatMap((r) => r.stops)
  const completedStops = stops.filter((s) => s.status === 'completed')
  const lateStops = stops.filter((s) => s.status === 'late')
  const totalLoad = originalPlan.routes.reduce((acc, r) => acc + r.load, 0)
  const totalCapacity = vehicles.reduce((acc, v) => acc + v.capacity, 0)
  const fleetUtilizationPct = Math.round((totalLoad / totalCapacity) * 100)

  return (
    <div className="space-y-6">
      <PageHead
        title="Fleet Operations Command"
        sub="Spatial network topology, real-time vehicle allocation, and dispatch schedule status."
        badge={
          <Badge t="ok" dot>
            Live Simulation t=0m
          </Badge>
        }
      />

      {/* Top Operational Metrics Grid */}
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-5">
        <MetricCard
          label="Active Fleet"
          value={`${activeVehicles.length}/${vehicles.length}`}
          sub="3 active delivery units"
          icon={<Truck size={17} />}
          trend="100% Online"
          trendType="positive"
        />
        <MetricCard
          label="Scheduled Stops"
          value={stops.length}
          sub={`Across ${originalPlan.routes.length} vehicle routes`}
          icon={<Package size={17} />}
          trend="Fully Routed"
          trendType="positive"
        />
        <MetricCard
          label="Fleet Capacity"
          value={`${fleetUtilizationPct}%`}
          sub={`${totalLoad}/${totalCapacity} load units`}
          icon={<CheckCircle2 size={17} />}
          trend={`${totalLoad} units`}
          trendType="neutral"
        />
        <MetricCard
          label="Unassigned"
          value={originalPlan.unassigned.length}
          sub="Zero unallocated orders"
          icon={<MapPin size={17} />}
          trend="Optimal"
          trendType="positive"
        />
        <MetricCard
          label="At-Risk Deliveries"
          value={lateStops.length}
          sub="All stops within window"
          icon={<AlertTriangle size={17} />}
          trend="Nominal"
          trendType="positive"
        />
      </div>

      {/* Spatial Route Network Canvas (Centerpiece) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-tight uppercase text-[#30280D]/80">
            Active Spatial Network Map & Route Trajectories
          </h2>
          <span className="text-xs text-[#30280D]/60 font-medium">
            Click any vehicle filter chip or node to inspect waypoints
          </span>
        </div>
        <SpatialRouteCanvas
          plan={originalPlan}
          vehicles={vehicles}
          selectedVehicleId={selectedVehicleId}
          onSelectVehicle={setSelectedVehicleId}
        />
      </div>

      {/* Two-Column Spatial Operational Details */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Fleet Vehicle Status & Capacity Utilization */}
        <Card
          title="Vehicle Load & Route Utilization"
          sub="Current cargo volume against vehicle capacity thresholds"
        >
          <div className="space-y-4">
            {originalPlan.routes.map((route) => {
              const vehicle = vehicles.find((v) => v.id === route.vehicleId)!
              const pct = Math.round((route.load / vehicle.capacity) * 100)
              const isSelected = selectedVehicleId === vehicle.id

              return (
                <div
                  key={vehicle.id}
                  onClick={() => setSelectedVehicleId(isSelected ? null : vehicle.id)}
                  className={`rounded-xl border p-4 transition-all cursor-pointer ${
                    isSelected
                      ? 'border-[#243607] bg-[#243607]/05 shadow-sm'
                      : 'border-[#30280D]/10 bg-white/60 hover:bg-white hover:border-[#243607]/30'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-[#30280D]">
                        {vehicle.name}
                      </span>
                      <Badge t="mute">Shift {fmtTime(vehicle.shiftStart)}–{fmtTime(vehicle.shiftEnd)}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-semibold text-[#30280D]">
                        {route.load} / {vehicle.capacity} ({pct}%)
                      </span>
                      <Badge t={vehicle.status === 'active' ? 'ok' : 'bad'}>
                        {vehicle.status}
                      </Badge>
                    </div>
                  </div>

                  {/* Spatial Bar Gauge */}
                  <div className="h-2 w-full rounded-full bg-[#30280D]/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#243607] to-[#354e0c] transition-all duration-500"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>

                  <div className="mt-2.5 flex items-center justify-between text-xs text-[#30280D]/70">
                    <span>
                      {route.stops.length} Scheduled Deliveries
                    </span>
                    <span className="font-medium">
                      First Dep: {fmtTime(route.stops[0]?.arrival ?? 0)} · Final Dep: {fmtTime(route.stops[route.stops.length - 1]?.departure ?? 0)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        {/* Priority Deliveries Radar */}
        <Card
          title="Delivery Time Window Schedule"
          sub="Customer orders, service durations, and assigned delivery sequence"
        >
          <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
            {deliveries.map((del) => {
              // Find which route visits this delivery
              const assignedRoute = originalPlan.routes.find((r) =>
                r.stops.some((s) => s.deliveryId === del.id)
              )
              const assignedStop = assignedRoute?.stops.find((s) => s.deliveryId === del.id)
              const vehicle = vehicles.find((v) => v.id === assignedRoute?.vehicleId)

              return (
                <div
                  key={del.id}
                  className="flex items-center justify-between rounded-xl border border-[#30280D]/10 bg-white/70 p-3 hover:bg-white transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#243607]/10 text-[#243607] font-mono text-xs font-bold">
                      {del.id}
                    </div>
                    <div>
                      <div className="font-semibold text-xs text-[#30280D]">
                        {locName(del.locationId)}
                      </div>
                      <div className="text-[11px] text-[#30280D]/60 flex items-center gap-1.5 mt-0.5">
                        <Clock size={11} />
                        <span>Window: {fmtWindow(del.window)}</span>
                        <span>· {del.size} units</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right flex flex-col items-end gap-1">
                    <Badge t={del.priority === 'urgent' ? 'warn' : 'mute'}>
                      {del.priority}
                    </Badge>
                    {assignedStop && vehicle ? (
                      <span className="text-[11px] font-medium text-[#243607]">
                        {vehicle.name} @ {fmtTime(assignedStop.serviceStart)}
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-[#91696E]">
                        Unassigned
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}
