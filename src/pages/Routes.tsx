import { useState } from 'react'
import { Card, PageHead, Badge, SpatialButton } from '../components/ui'
import { originalPlan, vehicles, locName } from '../data/demo'
import { SpatialRouteCanvas } from '../components/SpatialRouteCanvas'
import { fmtTime } from '../utils/time'
import { Truck, MapPin, Clock, ArrowRight, ShieldCheck } from 'lucide-react'

export default function Routes() {
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <PageHead
        title="Fleet Route Engine"
        sub="Spatial route timelines, vehicle trajectories, arrival/waiting profiles, and capacity checkpoints."
        badge={
          <Badge t="ok" dot>
            {originalPlan.label}
          </Badge>
        }
      />

      {/* Primary Spatial Canvas */}
      <SpatialRouteCanvas
        plan={originalPlan}
        vehicles={vehicles}
        selectedVehicleId={selectedVehicleId}
        onSelectVehicle={setSelectedVehicleId}
      />

      {/* Vehicle Route Profiles & Stop Sequencing */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-tight uppercase text-[#30280D]/80">
            Assigned Vehicle Routes & Stop Timelines
          </h2>
          <span className="text-xs text-[#30280D]/60 font-medium">
            3 Active Vehicle Route Schedules
          </span>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          {originalPlan.routes.map((r) => {
            const v = vehicles.find((x) => x.id === r.vehicleId)!
            const isSelected = selectedVehicleId === v.id
            const pct = Math.round((r.load / v.capacity) * 100)

            return (
              <Card
                key={r.vehicleId}
                variant="light"
                className={`transition-all duration-200 ${
                  isSelected ? 'ring-2 ring-[#243607] shadow-spatial-md' : ''
                }`}
                title={
                  <div className="flex items-center gap-2">
                    <Truck size={17} className="text-[#243607]" />
                    <span className="font-bold text-base text-[#30280D]">{v.name}</span>
                  </div>
                }
                action={
                  <Badge t={v.status === 'active' ? 'ok' : 'bad'}>
                    {r.load}/{v.capacity} load ({pct}%)
                  </Badge>
                }
              >
                {/* Vehicle Quick Stats Bar */}
                <div className="mb-4 rounded-lg bg-[#f2f3ec] p-2.5 text-xs text-[#30280D]/75 space-y-1.5">
                  <div className="flex justify-between">
                    <span>Shift Window:</span>
                    <span className="font-mono font-medium">
                      {fmtTime(v.shiftStart)} – {fmtTime(v.shiftEnd)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Deliveries:</span>
                    <span className="font-semibold">{r.stops.length} Stops</span>
                  </div>
                  {/* Capacity Bar */}
                  <div className="h-1.5 w-full rounded-full bg-[#30280D]/10 overflow-hidden mt-1">
                    <div
                      className="h-full rounded-full bg-[#243607]"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>

                {/* Vertical Stop Timeline */}
                <ol className="space-y-3.5 border-l-2 border-[#243607]/30 pl-4 my-2">
                  {r.stops.map((s, idx) => (
                    <li key={s.deliveryId} className="relative group">
                      {/* Timeline dot */}
                      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-white border-2 border-[#243607] group-hover:bg-[#243607] transition-colors" />

                      <div className="flex items-center justify-between gap-2">
                        <div className="font-bold text-xs text-[#30280D] flex items-center gap-1.5">
                          <span className="font-mono text-[#243607]">#{idx + 1}</span>
                          <span>{locName(s.locationId)}</span>
                        </div>
                        <Badge
                          t={
                            s.status === 'completed'
                              ? 'ok'
                              : s.status === 'late'
                              ? 'warn'
                              : s.status === 'skipped'
                              ? 'bad'
                              : 'mute'
                          }
                        >
                          {s.status}
                        </Badge>
                      </div>

                      <div className="mt-1 text-[11px] text-[#30280D]/65 flex flex-wrap gap-x-2 gap-y-0.5">
                        <span>Arr: {fmtTime(s.arrival)}</span>
                        <span>· Serv: {fmtTime(s.serviceStart)}</span>
                        <span>· Dep: {fmtTime(s.departure)}</span>
                        {s.waitMin > 0 && (
                          <span className="font-semibold text-[#91696E]">
                            (Waits {s.waitMin}m)
                          </span>
                        )}
                      </div>
                    </li>
                  ))}

                  {r.stops.length === 0 && (
                    <li className="text-xs text-[#30280D]/40 italic py-2">
                      No delivery stops assigned to this vehicle route.
                    </li>
                  )}
                </ol>

                <div className="mt-4 pt-3 border-t border-[#30280D]/08 flex items-center justify-between">
                  <SpatialButton
                    variant={isSelected ? 'dark' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedVehicleId(isSelected ? null : v.id)}
                  >
                    {isSelected ? 'Reset Focus' : 'Focus on Map'}
                  </SpatialButton>
                  <span className="text-[11px] text-[#30280D]/50 font-mono">
                    ID: {v.id}
                  </span>
                </div>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
