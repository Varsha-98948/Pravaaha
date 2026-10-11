import { useEffect, useState } from 'react'
import { Card, PageHead, State, Badge } from '../components/ui'
import {
  defaultDisruptionInterpreter,
  getAiInterpreterStatus,
  type AiStatusResult,
} from '../services/disruptionInterpreter'
import { interpretIncidentPreview } from '../services/disruptionService'
import { replan } from '../engine/replan'
import { applyDisruption, type World } from '../engine/disruptions'
import { originalPlan, vehicles, deliveries, matrix, locations, locName } from '../data/demo'
import { fmtTime } from '../utils/time'
import type { DeliveryPlan, DisruptionEvent, InterpretedDisruption } from '../types'
import { Bot, CheckCircle2, HelpCircle, AlertCircle, Sparkles } from 'lucide-react'

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
        `Disruption confirmed and applied at ${fmtTime(event.at)} (${event.at}m). Plan updated with ${replanned.routes.length} vehicle routes.`
      )
      setRes(null)
      setText('')
    } catch (e) {
      setSuccess('')
      setErr((e as Error).message + ' — the plan remains unchanged.')
    }
  }

  return (
    <>
      <PageHead
        title="Disruptions"
        sub="Describe or select what happened. Nothing is applied to routes until explicitly confirmed."
      />

      <div className="space-y-6">
        {/* AI Integration Status Bar */}
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3.5 text-xs ${
            aiStatus.configured
              ? 'border-teal-200 bg-teal-50/60 text-slate-700'
              : 'border-amber-200 bg-amber-50/60 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {aiStatus.configured ? (
              <>
                <Sparkles size={16} className="text-teal" />
                <span className="font-semibold text-slate-800">
                  AI Interpreter Active:
                </span>
                <span className="font-medium text-teal capitalize">
                  {aiStatus.provider} ({aiStatus.model})
                </span>
              </>
            ) : (
              <>
                <AlertCircle size={16} className="text-amber-700" />
                <div>
                  <span className="font-semibold text-amber-900">
                    AI Interpreter Not Configured:
                  </span>{' '}
                  <span className="text-amber-800">
                    Natural-language interpretation requires setting{' '}
                    <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">
                      AI_API_KEY
                    </code>{' '}
                    (or{' '}
                    <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">
                      GEMINI_API_KEY
                    </code>
                    ) in <code className="font-mono">.env</code>.
                  </span>
                </div>
              </>
            )}
          </div>
          <Badge t={aiStatus.configured ? 'ok' : 'warn'}>
            {aiStatus.configured ? 'Configured' : 'Setup Required'}
          </Badge>
        </div>

        <Card title="Incident Intake & Preview">
          <div className="mb-4">
            <span className="text-xs font-medium text-slate-500">
              Quick Incident Scenarios (Manual Preset Fallback):
            </span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {QUICK_DISRUPTIONS.map((q) => (
                <button
                  key={q.label}
                  onClick={() => {
                    setText(q.interpretation.rawText)
                    setRes(q.interpretation)
                    setErr('')
                    setSuccess('')
                  }}
                  className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block text-xs font-medium text-slate-600 mb-1">
            Natural-Language Incident Report:
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="e.g. Van 2 broke down near Harbor Grocers at 09:30, or Road closure between Central Depot and Harbor Grocers starting at 09:00"
            className="w-full rounded border border-slate-300 p-2.5 text-sm focus:border-teal focus:outline-none focus:ring-1 focus:ring-teal"
          />

          <div className="mt-2.5 flex items-center gap-3">
            <button
              onClick={run}
              disabled={!text.trim() || interpreting}
              className="inline-flex items-center gap-2 rounded bg-teal px-4 py-1.5 text-sm font-medium text-white hover:bg-teal/90 disabled:opacity-40 transition-colors"
            >
              <Bot size={15} />
              {interpreting ? 'Interpreting...' : 'Interpret incident'}
            </button>
            {interpreting && (
              <span className="text-xs text-slate-500 animate-pulse">
                Calling AI interpreter...
              </span>
            )}
          </div>

          {/* Interpretation Result Card */}
          {res && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 p-4 text-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge t={res.source === 'ai' ? 'ok' : 'warn'}>
                    {res.source === 'ai' ? 'AI Interpreted' : 'Preset / Fallback'}
                  </Badge>
                  <span className="font-semibold text-slate-800">{res.preview}</span>
                </div>
              </div>

              {/* State: Needs Clarification */}
              {res.needsClarification && (
                <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <HelpCircle size={16} className="shrink-0 text-amber-700 mt-0.5" />
                  <div>
                    <div className="font-semibold text-amber-900">
                      Clarification Needed
                    </div>
                    <p className="mt-0.5 text-amber-800">
                      {res.clarificationQuestion ||
                        'The incident report could not be mapped to an unambiguous disruption. Please provide more specifics.'}
                    </p>
                  </div>
                </div>
              )}

              {/* State: Unknown Entities or Unrecognized Inputs */}
              {(res.unknownLocations.length > 0 ||
                (res.unknownVehicles && res.unknownVehicles.length > 0)) && (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800 space-y-1">
                  <div className="font-semibold">Unrecognized Entities:</div>
                  {res.unknownLocations.length > 0 && (
                    <div>
                      • Unknown location(s):{' '}
                      <span className="font-mono font-medium">
                        {res.unknownLocations.join(', ')}
                      </span>{' '}
                      (Not in current organization network)
                    </div>
                  )}
                  {res.unknownVehicles && res.unknownVehicles.length > 0 && (
                    <div>
                      • Unknown vehicle(s):{' '}
                      <span className="font-mono font-medium">
                        {res.unknownVehicles.join(', ')}
                      </span>{' '}
                      (Not in current active fleet)
                    </div>
                  )}
                </div>
              )}

              {/* State: Provider Error */}
              {res.error && (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  <span className="font-semibold">Provider Communication Issue:</span>{' '}
                  {res.error}
                </div>
              )}

              {/* State: Missing Details */}
              {res.missing.length > 0 && !res.error && (
                <div className="text-xs text-amber-700">
                  <span className="font-semibold">Missing parameters:</span>{' '}
                  {res.missing.join(' · ')}
                </div>
              )}

              {/* State: Successfully Parsed Event */}
              {res.event && (
                <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-700 space-y-1.5 shadow-sm">
                  <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-teal" />
                    Structured Disruption Event Preview:
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
                    <div>
                      <span className="text-slate-500">Event Type:</span>{' '}
                      <span className="font-mono font-medium text-slate-800">
                        {res.event.type}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Effective Time:</span>{' '}
                      <span className="font-medium text-slate-800">
                        {fmtTime(res.event.at)} ({res.event.at}m)
                      </span>
                    </div>

                    {res.event.type === 'road_closure' && (
                      <div className="col-span-2">
                        <span className="text-slate-500">Closed Roadway:</span>{' '}
                        <span className="font-medium text-slate-800">
                          {locName(res.event.from)} ({res.event.from}) →{' '}
                          {locName(res.event.to)} ({res.event.to})
                        </span>
                      </div>
                    )}

                    {res.event.type === 'vehicle_failure' && (
                      <div className="col-span-2">
                        <span className="text-slate-500">Failed Vehicle:</span>{' '}
                        <span className="font-medium text-slate-800">
                          {res.event.vehicleId}
                          {res.event.locationId
                            ? ` at ${locName(res.event.locationId)}`
                            : ''}
                        </span>
                      </div>
                    )}

                    {res.event.type === 'urgent_delivery' && (
                      <div className="col-span-2 space-y-1">
                        <div>
                          <span className="text-slate-500">Destination:</span>{' '}
                          <span className="font-medium text-slate-800">
                            {locName(res.event.delivery.locationId)} (
                            {res.event.delivery.locationId})
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500">Delivery Window:</span>{' '}
                          <span className="font-medium text-slate-800">
                            {fmtTime(res.event.delivery.window.start)}–
                            {fmtTime(res.event.delivery.window.end)} · Size:{' '}
                            {res.event.delivery.size} units
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {res.inferredFields && res.inferredFields.length > 0 && (
                    <div className="pt-1.5 text-[11px] text-slate-500 italic">
                      Inferred with standard defaults: {res.inferredFields.join(', ')}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="mt-3 flex items-center gap-2 pt-1">
                {res.event ? (
                  <button
                    onClick={confirm}
                    className="rounded bg-navy px-3.5 py-1.5 text-sm font-medium text-white hover:bg-navy/90 transition-colors"
                  >
                    Confirm and replan
                  </button>
                ) : (
                  <div className="text-xs text-slate-500 italic">
                    Cannot confirm: an unambiguous disruption event must be resolved first.
                  </div>
                )}
                <button
                  onClick={() => {
                    setRes(null)
                    setErr('')
                  }}
                  className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {success && <State kind="success" text={success} />}
          {err && <State kind="error" text={err} />}
        </Card>

        {appliedEvents.length > 0 && (
          <Card title="Applied Disruptions">
            <div className="space-y-1.5">
              {appliedEvents.map((ev) => (
                <div key={ev.id} className="flex items-center gap-2 text-xs text-slate-700">
                  <Badge t="bad">{ev.type}</Badge>
                  <span>
                    at {fmtTime(ev.at)} ({ev.at}m) — ID: {ev.id}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card title={`Active Plan (${currentPlan.label})`}>
          <div className="mb-4 flex flex-wrap gap-4 text-xs text-slate-600">
            <div>
              <span className="font-semibold text-slate-800">Routes:</span> {currentPlan.routes.length}
            </div>
            <div>
              <span className="font-semibold text-slate-800">Scheduled stops:</span>{' '}
              {currentPlan.routes.reduce((acc, r) => acc + r.stops.length, 0)}
            </div>
            <div>
              <span className="font-semibold text-slate-800">Unassigned deliveries:</span>{' '}
              {currentPlan.unassigned.length}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {currentPlan.routes.map((r) => {
              const v = worldState.vehicles.find((x) => x.id === r.vehicleId)
              const cap = v?.capacity ?? 0
              return (
                <div key={r.vehicleId} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold text-slate-800">{v?.name ?? r.vehicleId}</span>
                    <Badge t={v?.status === 'failed' ? 'bad' : 'mute'}>
                      {r.load}/{cap} load {v?.status === 'failed' ? '(failed)' : ''}
                    </Badge>
                  </div>
                  <ol className="space-y-2 border-l-2 border-teal/40 pl-3">
                    {r.stops.map((s) => (
                      <li key={s.deliveryId} className="text-xs">
                        <div className="font-medium text-slate-800">
                          {fmtTime(s.serviceStart)} {locName(s.locationId)}{' '}
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
                        <div className="text-slate-500">
                          Arr {fmtTime(s.arrival)}
                          {s.waitMin > 0 && ` · waits ${s.waitMin}m`} · Dep {fmtTime(s.departure)}
                        </div>
                      </li>
                    ))}
                    {r.stops.length === 0 && <li className="text-xs text-slate-400">No stops assigned</li>}
                  </ol>
                </div>
              )
            })}
          </div>

          {currentPlan.unassigned.length > 0 && (
            <div className="mt-4 border-t border-slate-200 pt-3">
              <div className="mb-2 text-xs font-semibold text-slate-700">Unassigned Deliveries:</div>
              <div className="flex flex-wrap gap-2">
                {currentPlan.unassigned.map((u) => (
                  <div key={u.deliveryId} className="rounded border border-red-200 bg-red-50 p-2 text-xs">
                    <span className="font-semibold text-red-800">{u.deliveryId}:</span>{' '}
                    <Badge t="bad">{u.reason}</Badge>
                    <div className="mt-0.5 text-slate-600">{u.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
