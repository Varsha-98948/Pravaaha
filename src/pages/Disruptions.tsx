import { useState } from 'react'
import { Card, PageHead, State, Badge } from '../components/ui'
import { placeholderInterpreter } from '../services/disruptionInterpreter'
import { replan } from '../engine/replan'
import { applyDisruption, type World } from '../engine/disruptions'
import { originalPlan, vehicles, deliveries, matrix, locations, locName } from '../data/demo'
import { fmtTime } from '../utils/time'
import type { DeliveryPlan, DisruptionEvent, InterpretedDisruption } from '../types'

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

  // Retained state across disruptions
  const [worldState, setWorldState] = useState<World>({
    vehicles,
    deliveries,
    matrix,
    locations,
  })
  const [currentPlan, setCurrentPlan] = useState<DeliveryPlan>(originalPlan)
  const [appliedEvents, setAppliedEvents] = useState<DisruptionEvent[]>([])

  const run = async () => {
    setErr('')
    setSuccess('')
    const result = await placeholderInterpreter.interpret(text, locations.map((l) => l.id))
    setRes(result)
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
        `Disruption confirmed and applied at ${fmtTime(event.at)} (${event.at}m). Plan updated with ${replanned.routes.length} vehicle routes.`,
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
        <Card title="Incident Intake & Preview">
          <div className="mb-3">
            <span className="text-xs font-medium text-slate-500">Quick Incident Scenarios:</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {QUICK_DISRUPTIONS.map((q) => (
                <button
                  key={q.label}
                  onClick={() => {
                    setText(q.interpretation.rawText)
                    setRes(q.interpretation)
                    setErr('')
                    setSuccess('')
                  }}
                  className="rounded border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="e.g. Van 2 broke down near Harbor Grocers"
            className="w-full rounded border border-slate-300 p-2 text-sm"
          />

          <div className="mt-2 flex gap-2">
            <button
              onClick={run}
              disabled={!text.trim()}
              className="rounded bg-teal px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Interpret incident
            </button>
          </div>

          {res && (
            <div className="mt-4 rounded border border-slate-200 bg-slate-50/50 p-4 text-sm">
              <div className="flex items-center gap-2">
                <Badge t="warn">{res.source}</Badge>
                <span className="font-medium text-slate-800">{res.preview}</span>
              </div>

              {res.event && (
                <div className="mt-2 text-xs text-slate-600">
                  <span className="font-semibold">Event Type:</span> {res.event.type} ·{' '}
                  <span className="font-semibold">Effective Time:</span> {fmtTime(res.event.at)} ({res.event.at}m)
                </div>
              )}

              {res.missing.length > 0 && (
                <div className="mt-1 text-xs text-amber-700">Missing: {res.missing.join(', ')}</div>
              )}

              <div className="mt-3 flex gap-2">
                <button onClick={confirm} className="rounded bg-navy px-3 py-1.5 text-sm font-medium text-white">
                  Confirm and replan
                </button>
                <button
                  onClick={() => {
                    setRes(null)
                    setErr('')
                  }}
                  className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Reject
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
                          <Badge t={s.status === 'completed' ? 'ok' : s.status === 'late' ? 'warn' : s.status === 'skipped' ? 'bad' : 'mute'}>
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
