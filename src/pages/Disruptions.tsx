import { useEffect, useState } from 'react'
import { Card, PageHead, State, Badge, SpatialButton } from '../components/ui'
import {
  defaultDisruptionInterpreter,
  getAiInterpreterStatus,
  type AiStatusResult,
} from '../services/disruptionInterpreter'
import { interpretIncidentPreview } from '../services/disruptionService'
import { replan } from '../engine/replan'
import { applyDisruption, type World } from '../engine/disruptions'
import { originalPlan, vehicles, deliveries, matrix, locations, locName } from '../data/demo'
import { SpatialRouteCanvas } from '../components/SpatialRouteCanvas'
import { fmtTime } from '../utils/time'
import type { DeliveryPlan, DisruptionEvent, InterpretedDisruption } from '../types'
import {
  Bot,
  CheckCircle2,
  HelpCircle,
  AlertCircle,
  Sparkles,
  Zap,
  ArrowRight,
  ShieldAlert,
  Clock,
  RotateCcw,
} from 'lucide-react'

const QUICK_DISRUPTIONS: Array<{ label: string; interpretation: InterpretedDisruption }> = [
  {
    label: 'Van 2 breakdown at 09:30 (t=90)',
    interpretation: {
      rawText: 'Van 2 broke down near Harbor Grocers at 09:30',
      event: { type: 'vehicle_failure', id: 'dis-v2-fail', at: 90, vehicleId: 'v2', locationId: 'c2' },
      missing: [],
      unknownLocations: [],
      preview: 'Vehicle Van 2 failed at 09:30 (90m). Remaining stops must be reassigned.',
      confirmation: 'pending',
      source: 'placeholder',
    },
  },
  {
    label: 'Road closure: Central Depot → Harbor Grocers at 09:00 (t=60)',
    interpretation: {
      rawText: 'Road closure between Central Depot and Harbor Grocers starting at 09:00',
      event: { type: 'road_closure', id: 'dis-rc-depot-c2', at: 60, from: 'depot', to: 'c2' },
      missing: [],
      unknownLocations: [],
      preview: 'Road from Central Depot to Harbor Grocers closed at 09:00 (60m). Routes must detour.',
      confirmation: 'pending',
      source: 'placeholder',
    },
  },
  {
    label: 'Urgent delivery at Eastside Florist at 10:00 (t=120)',
    interpretation: {
      rawText: 'Urgent order for Eastside Florist at 10:00',
      event: {
        type: 'urgent_delivery',
        id: 'dis-urgent-c8',
        at: 120,
        delivery: {
          id: 'd-urgent-1',
          locationId: 'c8',
          size: 8,
          serviceMin: 10,
          window: { start: 120, end: 240 },
          priority: 'urgent',
        },
      },
      missing: [],
      unknownLocations: [],
      preview: 'Urgent delivery (size 8) at Eastside Florist inserted at 10:00 (120m).',
      confirmation: 'pending',
      source: 'placeholder',
    },
  },
]

export default function Disruptions() {
  const [text, setText] = useState('')
  const [res, setRes] = useState<InterpretedDisruption | null>(null)
  const [err, setErr] = useState('')
  const [success, setSuccess] = useState('')
  const [interpreting, setInterpreting] = useState(false)
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [aiStatus, setAiStatus] = useState<AiStatusResult>({
    configured: false,
    provider: null,
    model: null,
    missingConfig: [],
  })

  // Retained state across disruptions
  const [worldState, setWorldState] = useState<World>({
    vehicles,
    deliveries,
    matrix,
    locations,
  })
  const [currentPlan, setCurrentPlan] = useState<DeliveryPlan>(originalPlan)
  const [appliedEvents, setAppliedEvents] = useState<DisruptionEvent[]>([])

  // Check AI integration configuration on mount
  useEffect(() => {
    let mounted = true
    getAiInterpreterStatus()
      .then((status) => {
        if (mounted) setAiStatus(status)
      })
      .catch(() => {
        if (mounted) {
          setAiStatus({
            configured: false,
            provider: null,
            model: null,
            missingConfig: ['AI API server unreachable'],
          })
        }
      })
    return () => {
      mounted = false
    }
  }, [])

  const run = async () => {
    if (!text.trim()) return
    setErr('')
    setSuccess('')
    setInterpreting(true)

    try {
      const activeLocations = worldState.locations || locations
      const knownLocationIds = activeLocations.map((l) => l.id)
      const knownVehicleIds = worldState.vehicles.map((v) => v.id)
      const currentTime = appliedEvents.length > 0 ? appliedEvents[appliedEvents.length - 1].at : 0

      const result = await interpretIncidentPreview(
        text,
        defaultDisruptionInterpreter,
        knownLocationIds,
        knownVehicleIds,
        {
          locations: activeLocations,
          knownVehicles: worldState.vehicles,
          currentTime,
        }
      )
      setRes(result)
    } catch (e: unknown) {
      setErr((e as Error).message || 'Failed to interpret incident.')
    } finally {
      setInterpreting(false)
    }
  }

  const confirm = () => {
    setErr('')
    setSuccess('')

    if (!res || !res.event) {
      setErr('Cannot confirm disruption: no disruption event was generated or validated.')
      return
    }

    try {
      const event = res.event
      // 1. Apply disruption to the current world snapshot
      const updatedWorld = applyDisruption(worldState, event)
      // 2. Replan routes at the event's actual simulation time
      const replanned = replan(updatedWorld, currentPlan, event.at)

      // 3. Retain the resulting plan and world state
      setWorldState(updatedWorld)
      setCurrentPlan(replanned)
      setAppliedEvents((prev) => [...prev, event])
      setSuccess(
        `Disruption confirmed and applied at ${fmtTime(event.at)} (${event.at}m). Route plan updated with ${replanned.routes.length} vehicle trajectories.`
      )
      setRes(null)
      setText('')
    } catch (e) {
      setSuccess('')
      setErr((e as Error).message + ' — the plan remains unchanged.')
    }
  }

  // Active closure helper for canvas highlight
  const activeClosure = appliedEvents.find((e) => e.type === 'road_closure') as
    | { from: string; to: string; at: number }
    | undefined

  return (
    <div className="space-y-6">
      <PageHead
        title="Disruptions & Dynamic Replanning"
        sub="Incident intake, natural-language AI interpretation, and deterministic route plan regeneration."
        badge={
          <Badge t="ok" dot>
            {appliedEvents.length} Applied Events
          </Badge>
        }
      />

      {/* AI Gateway Status Banner */}
      <div
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-xs transition-all shadow-sm ${
          aiStatus.configured
            ? 'border-[#243607]/25 bg-[#243607]/07 text-[#30280D]'
            : 'border-[#91696E]/25 bg-[#91696E]/08 text-[#30280D]'
        }`}
      >
        <div className="flex items-center gap-2.5">
          {aiStatus.configured ? (
            <>
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#243607] text-[#f2f3ec] shadow-sm">
                <Sparkles size={15} />
              </div>
              <div>
                <span className="font-bold text-[#30280D]">
                  AI Disruption Gateway Online:
                </span>{' '}
                <span className="font-medium text-[#243607] capitalize">
                  {aiStatus.provider} ({aiStatus.model})
                </span>
                <span className="ml-2 text-[#30280D]/60 hidden sm:inline">
                  {aiStatus.openrouter
                    ? `— ${aiStatus.openrouter.healthyCount}/${aiStatus.openrouter.totalConfigured} keys active (Free Tier :free)`
                    : '— Structured JSON natural-language parser active'}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#91696E] text-[#f2f3ec] shadow-sm">
                <AlertCircle size={15} />
              </div>
              <div>
                <span className="font-bold text-[#30280D]">
                  AI Gateway Offline:
                </span>{' '}
                <span className="text-[#30280D]/80">
                  Set <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-[11px]">OPENROUTER_API_KEY_1</code> (or <code className="font-mono">AI_API_KEY</code>) in <code className="font-mono">.env</code>. Quick Presets below remain 100% operational.
                </span>
              </div>
            </>
          )}
        </div>
        <Badge t={aiStatus.configured ? 'ok' : 'warn'}>
          {aiStatus.configured ? (aiStatus.openrouter ? `${aiStatus.openrouter.healthyCount} Keys Ready` : 'Active') : 'Setup Required'}
        </Badge>
      </div>

      {/* Incident Intake & Preview Console */}
      <Card
        title="Incident Intake & Interpretation Console"
        sub="Describe unexpected road closures, breakdowns, or urgent deliveries. Nothing modifies active routes until explicitly confirmed."
      >
        {/* Quick Presets */}
        <div className="mb-4">
          <span className="text-xs font-bold uppercase tracking-wider text-[#30280D]/65">
            Tactical Incident Presets:
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK_DISRUPTIONS.map((q) => (
              <button
                key={q.label}
                onClick={() => {
                  setText(q.interpretation.rawText)
                  setRes(q.interpretation)
                  setErr('')
                  setSuccess('')
                }}
                className="flex items-center gap-1.5 rounded-lg border border-[#30280D]/15 bg-white/80 px-3 py-1.5 text-xs font-medium text-[#30280D] hover:bg-[#243607]/08 hover:border-[#243607]/40 hover:-translate-y-0.5 transition-all shadow-sm"
              >
                <Zap size={13} className="text-[#91696E]" />
                {q.label}
              </button>
            ))}
          </div>
        </div>

        {/* Textarea Input */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-[#30280D]/80">
            Natural-Language Incident Report:
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="e.g. Van 2 broke down near Harbor Grocers at 09:30, or Road closure between Central Depot and Harbor Grocers starting at 09:00"
            className="w-full rounded-xl border border-[#30280D]/20 bg-white p-3 text-sm text-[#30280D] placeholder-[#30280D]/40 focus:border-[#243607] focus:outline-none focus:ring-2 focus:ring-[#243607]/15 transition-all shadow-spatial-inset"
          />
        </div>

        {/* Submit Button */}
        <div className="mt-3 flex items-center gap-3">
          <SpatialButton
            variant="primary"
            onClick={run}
            disabled={!text.trim() || interpreting}
            icon={<Bot size={15} />}
          >
            {interpreting ? 'Interpreting Report...' : 'Interpret Incident'}
          </SpatialButton>
          {interpreting && (
            <span className="text-xs text-[#243607] font-medium animate-pulse">
              Parsing with AI provider...
            </span>
          )}
        </div>

        {/* Interpretation Result Card */}
        {res && (
          <div className="mt-5 rounded-xl border border-[#30280D]/15 bg-[#f8f9f4] p-4 text-sm space-y-3.5 shadow-spatial-md animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-[#30280D]/10 pb-3">
              <div className="flex items-center gap-2">
                <Badge t={res.source === 'ai' ? 'ok' : 'warn'}>
                  {res.source === 'ai' ? 'AI Structured' : 'Manual Preset'}
                </Badge>
                <span className="font-bold text-sm text-[#30280D]">{res.preview}</span>
              </div>
            </div>

            {/* State: Needs Clarification */}
            {res.needsClarification && (
              <div className="flex items-start gap-2.5 rounded-lg border border-[#91696E]/30 bg-[#91696E]/10 p-3 text-xs text-[#30280D]">
                <HelpCircle size={16} className="shrink-0 text-[#91696E] mt-0.5" />
                <div>
                  <div className="font-bold text-[#91696E]">Clarification Required</div>
                  <p className="mt-0.5 leading-relaxed text-[#30280D]/85">
                    {res.clarificationQuestion ||
                      'The incident report is ambiguous. Please clarify locations or affected vehicles.'}
                  </p>
                </div>
              </div>
            )}

            {/* State: Unrecognized Entities */}
            {(res.unknownLocations.length > 0 || (res.unknownVehicles && res.unknownVehicles.length > 0)) && (
              <div className="rounded-lg border border-[#91696E]/30 bg-[#91696E]/10 p-3 text-xs space-y-1 text-[#30280D]">
                <div className="font-bold text-[#91696E]">Unrecognized Entity Scope:</div>
                {res.unknownLocations.length > 0 && (
                  <div>• Unknown location(s): <span className="font-mono font-semibold">{res.unknownLocations.join(', ')}</span></div>
                )}
                {res.unknownVehicles && res.unknownVehicles.length > 0 && (
                  <div>• Unknown vehicle(s): <span className="font-mono font-semibold">{res.unknownVehicles.join(', ')}</span></div>
                )}
              </div>
            )}

            {/* State: Successfully Parsed Event Object */}
            {res.event && (
              <div className="rounded-lg border border-[#30280D]/10 bg-white p-3.5 text-xs text-[#30280D] space-y-2 shadow-sm">
                <div className="font-bold text-xs flex items-center gap-1.5 text-[#243607]">
                  <CheckCircle2 size={15} />
                  Structured Disruption Event Schema:
                </div>
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#30280D]/06">
                  <div>
                    <span className="text-[#30280D]/60 block">Event Type</span>
                    <span className="font-mono font-bold text-sm text-[#30280D]">
                      {res.event.type}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#30280D]/60 block">Effective Time</span>
                    <span className="font-bold text-sm text-[#30280D]">
                      {fmtTime(res.event.at)} ({res.event.at}m)
                    </span>
                  </div>

                  {res.event.type === 'road_closure' && (
                    <div className="col-span-2 rounded bg-[#f2f3ec] p-2">
                      <span className="text-[#30280D]/60 block">Closed Road Segment</span>
                      <span className="font-semibold text-xs text-[#30280D]">
                        {locName(res.event.from)} ({res.event.from}) → {locName(res.event.to)} ({res.event.to})
                      </span>
                    </div>
                  )}

                  {res.event.type === 'vehicle_failure' && (
                    <div className="col-span-2 rounded bg-[#f2f3ec] p-2">
                      <span className="text-[#30280D]/60 block">Failed Vehicle</span>
                      <span className="font-semibold text-xs text-[#30280D]">
                        {res.event.vehicleId} {res.event.locationId ? `at ${locName(res.event.locationId)}` : ''}
                      </span>
                    </div>
                  )}

                  {res.event.type === 'urgent_delivery' && (
                    <div className="col-span-2 rounded bg-[#f2f3ec] p-2 space-y-1">
                      <div>
                        <span className="text-[#30280D]/60">Destination:</span>{' '}
                        <span className="font-semibold">{locName(res.event.delivery.locationId)}</span>
                      </div>
                      <div>
                        <span className="text-[#30280D]/60">Time Window:</span>{' '}
                        <span className="font-semibold">
                          {fmtTime(res.event.delivery.window.start)}–{fmtTime(res.event.delivery.window.end)} · Size: {res.event.delivery.size} units
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Decision Controls */}
            <div className="pt-2 flex flex-wrap items-center gap-2.5">
              {res.event ? (
                <SpatialButton variant="primary" onClick={confirm}>
                  Confirm and Replan Routes
                </SpatialButton>
              ) : (
                <span className="text-xs text-[#30280D]/60 italic">
                  Cannot replan: a valid disruption event must be resolved first.
                </span>
              )}
              <SpatialButton
                variant="outline"
                size="md"
                onClick={() => {
                  setRes(null)
                  setErr('')
                }}
              >
                Dismiss
              </SpatialButton>
            </div>
          </div>
        )}

        {success && <div className="mt-4"><State kind="success" text={success} /></div>}
        {err && <div className="mt-4"><State kind="error" text={err} /></div>}
      </Card>

      {/* Applied Disruptions Timeline */}
      {appliedEvents.length > 0 && (
        <Card
          title="Applied Disruptions Journal"
          sub="Chronological sequence of disruptions currently incorporated into the route engine"
        >
          <div className="space-y-2">
            {appliedEvents.map((ev, i) => (
              <div
                key={ev.id}
                className="flex items-center justify-between rounded-xl border border-[#30280D]/10 bg-white p-3 text-xs shadow-sm"
              >
                <div className="flex items-center gap-2.5">
                  <span className="font-mono font-bold text-[#30280D]/50">#{i + 1}</span>
                  <Badge t="bad">{ev.type}</Badge>
                  <span className="font-bold text-[#30280D]">
                    at {fmtTime(ev.at)} ({ev.at}m)
                  </span>
                  <span className="font-mono text-[#30280D]/60 text-[11px]">
                    ID: {ev.id}
                  </span>
                </div>
                <Badge t="ok">Active in Model</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Spatial Route Network with Dynamic Replanning View */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold tracking-tight uppercase text-[#30280D]/80">
            Current Plan Visualizer ({currentPlan.label})
          </h2>
          <span className="text-xs text-[#30280D]/60 font-medium">
            Updated immediately upon confirmed replan
          </span>
        </div>
        <SpatialRouteCanvas
          plan={currentPlan}
          vehicles={worldState.vehicles}
          selectedVehicleId={selectedVehicleId}
          onSelectVehicle={setSelectedVehicleId}
          highlightDisruption={activeClosure}
        />
      </div>
    </div>
  )
}
