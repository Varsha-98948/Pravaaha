import { useState } from 'react'
import { Card, PageHead, Badge, Table, MetricCard, SpatialButton } from '../components/ui'
import { originalPlan, revisedPlan, vehicles, deliveries, locName } from '../data/demo'
import { comparePlans } from '../engine/compare'
import { fmtTime } from '../utils/time'
import { GitCompare, CheckCircle2, ArrowRightLeft, AlertOctagon, Filter } from 'lucide-react'

const findStop = (p: typeof originalPlan, id: string) =>
  p.routes
    .flatMap((r) =>
      r.stops.map((s) => ({
        ...s,
        vehicleName: vehicles.find((v) => v.id === r.vehicleId)?.name ?? r.vehicleId,
      }))
    )
    .find((s) => s.deliveryId === id)

export default function Compare() {
  const [filter, setFilter] = useState<'all' | 'kept' | 'moved' | 'broken'>('all')

  const comparison = comparePlans(originalPlan, revisedPlan)

  const filteredDeliveries = deliveries.filter((d) => {
    const decision = comparison.decisions[d.id]
    if (filter === 'all') return true
    return decision === filter
  })

  return (
    <div className="space-y-6">
      <PageHead
        title="Plan Comparison & Impact Matrix"
        sub="Compare baseline schedule against revised plan. Evaluates delivery continuity, reassignments, and broken stops."
        badge={
          <Badge t="warn" dot>
            Scenario: Van 2 Breakdown at 09:30
          </Badge>
        }
      />

      {/* Decision Summary KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Kept Deliveries"
          value={comparison.counts.kept}
          sub="Same vehicle, timing preserved"
          icon={<CheckCircle2 size={18} />}
          trend="Uninterrupted"
          trendType="positive"
          active={filter === 'kept'}
          onClick={() => setFilter(filter === 'kept' ? 'all' : 'kept')}
        />
        <MetricCard
          label="Moved Deliveries"
          value={comparison.counts.moved}
          sub="Reassigned to alternate fleet unit"
          icon={<ArrowRightLeft size={18} />}
          trend="Rerouted"
          trendType="neutral"
          active={filter === 'moved'}
          onClick={() => setFilter(filter === 'moved' ? 'all' : 'moved')}
        />
        <MetricCard
          label="Broken / Unassigned"
          value={comparison.counts.broken}
          sub="Capacity or window conflict"
          icon={<AlertOctagon size={18} />}
          trend={comparison.counts.broken > 0 ? 'Critical' : 'None'}
          trendType={comparison.counts.broken > 0 ? 'negative' : 'positive'}
          active={filter === 'broken'}
          onClick={() => setFilter(filter === 'broken' ? 'all' : 'broken')}
        />
      </div>

      {/* Side-by-Side High-Level Plan Stats */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card
          title="Baseline Plan (Original)"
          sub="3 active vehicles, pre-disruption state"
        >
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-[#f2f3ec] p-3">
              <span className="text-xs text-[#30280D]/60 block font-medium">Routes</span>
              <span className="text-xl font-bold text-[#30280D]">{originalPlan.routes.length}</span>
            </div>
            <div className="rounded-lg bg-[#f2f3ec] p-3">
              <span className="text-xs text-[#30280D]/60 block font-medium">Total Stops</span>
              <span className="text-xl font-bold text-[#243607]">
                {originalPlan.routes.reduce((acc, r) => acc + r.stops.length, 0)}
              </span>
            </div>
            <div className="rounded-lg bg-[#f2f3ec] p-3">
              <span className="text-xs text-[#30280D]/60 block font-medium">Unassigned</span>
              <span className="text-xl font-bold text-[#30280D]">
                {originalPlan.unassigned.length}
              </span>
            </div>
          </div>
        </Card>

        <Card
          title="Revised Plan (Post-Disruption)"
          sub="Van 2 failed at 09:30 · Dynamic replan applied"
        >
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-[#f2f3ec] p-3">
              <span className="text-xs text-[#30280D]/60 block font-medium">Routes</span>
              <span className="text-xl font-bold text-[#30280D]">{revisedPlan.routes.length}</span>
            </div>
            <div className="rounded-lg bg-[#f2f3ec] p-3">
              <span className="text-xs text-[#30280D]/60 block font-medium">Total Stops</span>
              <span className="text-xl font-bold text-[#91696E]">
                {revisedPlan.routes.reduce((acc, r) => acc + r.stops.length, 0)}
              </span>
            </div>
            <div className="rounded-lg bg-[#f2f3ec] p-3">
              <span className="text-xs text-[#30280D]/60 block font-medium">Unassigned</span>
              <span className="text-xl font-bold text-[#91696E]">
                {revisedPlan.unassigned.length}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Delivery-Level Comparison Matrix */}
      <Card
        title="Delivery-by-Delivery Decision Matrix"
        sub="Line-item status of every order across both plans"
        action={
          <div className="flex items-center gap-1.5 bg-[#f2f3ec] p-1 rounded-lg border border-[#30280D]/10">
            <Filter size={13} className="text-[#30280D]/60 ml-1.5" />
            {(['all', 'kept', 'moved', 'broken'] as const).map((opt) => (
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
          head={['Delivery ID & Location', 'Original Plan', 'Revised Plan', 'Decision', 'Operational Rationale']}
          rows={filteredDeliveries.map((d) => {
            const orig = findStop(originalPlan, d.id)
            const rev = findStop(revisedPlan, d.id)
            const decision = comparison.decisions[d.id]
            const reason = comparison.reasons[d.id] || 'Nominal status'

            return [
              <div key="del">
                <span className="font-mono font-bold text-xs text-[#243607] block">{d.id}</span>
                <span className="font-medium text-xs text-[#30280D]">{locName(d.locationId)}</span>
              </div>,
              orig ? (
                <span key="orig" className="text-xs">
                  <span className="font-semibold text-[#30280D]">{orig.vehicleName}</span>
                  <span className="text-[#30280D]/60 block">Serv: {fmtTime(orig.serviceStart)}</span>
                </span>
              ) : (
                <span key="orig" className="text-xs text-[#30280D]/40">—</span>
              ),
              rev ? (
                <span key="rev" className="text-xs">
                  <span className="font-semibold text-[#243607]">{rev.vehicleName}</span>
                  <span className="text-[#30280D]/60 block">Serv: {fmtTime(rev.serviceStart)}</span>
                </span>
              ) : (
                <Badge key="rev" t="bad">Unassigned</Badge>
              ),
              decision ? (
                <Badge
                  key="dec"
                  t={decision === 'kept' ? 'ok' : decision === 'moved' ? 'warn' : 'bad'}
                >
                  {decision.toUpperCase()}
                </Badge>
              ) : (
                '—'
              ),
              <span key="reason" className="text-xs text-[#30280D]/75">
                {reason}
              </span>,
            ]
          })}
        />
      </Card>
    </div>
  )
}
