import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Card, PageHead, State } from '../components/ui'
import { replan } from '../engine/replan'
import { applyDisruption, applyDisruptionBatch, type World } from '../engine/disruptions'
import { getDisruptions, getLocations, getDeliveries, getVehicles, getDeliveryPlan, listDeliveryPlans, saveDelivery, saveDeliveryPlan, updateVehicleStatus } from '../services/persistenceService'
import { confirmDisruption } from '../services/disruptionService'
import { isDemoMode } from '../services/supabase'
import { validateDisruptionEvent } from '../services/validation'
import { travelMatrixFromPersistedPlan } from '../services/replanningService'
import { ValidationError } from '../services/errors'
import { defaultDisruptionInterpreter } from '../services/disruptionInterpreter'
import { interpretIncidentPreview } from '../services/disruptionService'
import { fmtTime } from '../utils/time'
import type { DeliveryPlan, DisruptionEvent, InterpretedDisruption, Location, UserProfile, Vehicle } from '../types'

const QUICK_DISRUPTIONS: Array<{ label: string; interpretation: InterpretedDisruption }> = [
  {
    label: 'Van 2 breakdown at 09:30 (t=90)',
    interpretation: {
      rawText: 'Van 2 broke down near Harbor Grocers at 09:30',
      event: { type: 'vehicle_failure', id: 'dis-v2-fail', at: 90, vehicleId: 'v2', locationId: 'c2' },
      missing: [], unknownLocations: [],
      preview: 'Vehicle Van 2 failed at 09:30 (90m). Remaining stops must be reassigned.',
      confirmation: 'pending', source: 'placeholder',
    },
  },
  {
    label: 'Road closure: Central Depot → Harbor Grocers at 09:00 (t=60)',
    interpretation: {
      rawText: 'Road closure between Central Depot and Harbor Grocers starting at 09:00',
      event: { type: 'road_closure', id: 'dis-rc-depot-c2', at: 60, from: 'depot', to: 'c2' },
      missing: [], unknownLocations: [],
      preview: 'Road from Central Depot to Harbor Grocers closed at 09:00 (60m). Routes must detour.',
      confirmation: 'pending', source: 'placeholder',
    },
  },
  {
    label: 'Urgent delivery at Eastside Florist at 10:00 (t=120)',
    interpretation: {
      rawText: 'Urgent order for Eastside Florist at 10:00',
      event: {
        type: 'urgent_delivery', id: 'dis-urgent-c8', at: 120,
        delivery: { id: 'd-urgent-1', locationId: 'c8', size: 8, serviceMin: 10, window: { start: 120, end: 240 }, priority: 'urgent' },
      },
      missing: [], unknownLocations: [],
      preview: 'Urgent delivery (size 8) at Eastside Florist inserted at 10:00 (120m).',
      confirmation: 'pending', source: 'placeholder',
    },
  },
]

type EventKind = DisruptionEvent['type']

export default function Disruptions({
  profile = null,
  demoRole = 'dispatcher',
}: {
  profile?: UserProfile | null
  demoRole?: UserProfile['role']
}) {
  const [text, setText] = useState('')
  const [res, setRes] = useState<InterpretedDisruption | null>(null)
  const [err, setErr] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [interpreting, setInterpreting] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [kind, setKind] = useState<EventKind>('vehicle_failure')
  const [at, setAt] = useState('0')
  const [vehicleId, setVehicleId] = useState('')
  const [fromLocation, setFromLocation] = useState('')
  const [toLocation, setToLocation] = useState('')
  const [deliveryLocation, setDeliveryLocation] = useState('')
  const [deliverySize, setDeliverySize] = useState('1')
  const [serviceMin, setServiceMin] = useState('10')
  const [windowStart, setWindowStart] = useState('0')
  const [windowEnd, setWindowEnd] = useState('480')
  const [locations, setLocations] = useState<Location[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [disruptions, setDisruptions] = useState<DisruptionEvent[]>([])
  const [world, setWorld] = useState<World | null>(null)
  const [currentPlan, setCurrentPlan] = useState<DeliveryPlan | null>(null)

  const canWrite = isDemoMode
    ? demoRole === 'admin' || demoRole === 'dispatcher'
    : profile?.role === 'admin' || profile?.role === 'dispatcher'

  const load = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    setLoadError('')
    setErr('')
    try {
      if (isDemoMode) {
        const demo = await import('../data/demo')
        setLocations(demo.locations)
        setVehicles(demo.vehicles)
        setWorld({ vehicles: demo.vehicles, deliveries: demo.deliveries, matrix: demo.matrix, locations: demo.locations })
        setCurrentPlan(demo.originalPlan)
        setDisruptions([])
        return true
      }

      if (!profile?.orgId) throw new ValidationError('Your organization profile is unavailable. Sign out and sign in again, or contact your administrator.')

      const [organizationVehicles, organizationDeliveries, organizationLocations, organizationDisruptions, plans] = await Promise.all([
        getVehicles(profile.orgId),
        getDeliveries(profile.orgId),
        getLocations(profile.orgId),
        getDisruptions(profile.orgId),
        listDeliveryPlans(profile.orgId),
      ])
      const latest = plans[0]
      const plan = latest ? await getDeliveryPlan(latest.id, profile.orgId) : null

      setLocations(organizationLocations)
      setVehicles(organizationVehicles)
      setDisruptions(organizationDisruptions)
      setCurrentPlan(plan)
      if (plan) {
        const base: World = {
          vehicles: organizationVehicles,
          deliveries: organizationDeliveries,
          matrix: travelMatrixFromPersistedPlan(plan, organizationVehicles),
          locations: organizationLocations,
        }
        const restored = applyDisruptionBatch(base, organizationDisruptions, plan.createdAt)
        if (restored.rejected.length > 0) {
          throw new ValidationError(`Could not restore persisted disruption history: ${restored.rejected.map(item => item.reason).join('; ')}`)
        }
        setWorld(restored.world)
      } else {
        setWorld({ vehicles: organizationVehicles, deliveries: organizationDeliveries, matrix: {}, locations: organizationLocations })
      }
      return true
    } catch (cause) {
      setWorld(null)
      setCurrentPlan(null)
      setLoadError((cause as Error).message || 'Unable to load organization disruption data.')
      return false
    } finally {
      setLoading(false)
    }
  }, [profile?.orgId])

  useEffect(() => { void load() }, [load])

  const locationNames = useMemo(() => new Map(locations.map(location => [location.id, location.name])), [locations])
  const locName = (id: string) => locationNames.get(id) ?? id
  const travelLegCount = world ? Object.values(world.matrix).reduce((total, row) => total + Object.keys(row).length, 0) : 0

  const prepare = () => {
    setErr('')
    setSuccess('')
    if (!text.trim()) {
      setErr('Enter a short incident description before preparing the disruption.')
      return
    }

    if (isDemoMode) {
      setRes({
        rawText: text,
        event: null,
        missing: ['AI interpreter is not configured. Choose a quick incident scenario in demo mode.'],
        unknownLocations: [],
        preview: 'Free-text interpretation is not configured.',
        confirmation: 'pending',
        source: 'placeholder',
      })
      return
    }

    const effectiveAt = Number(at)
    if (!Number.isFinite(effectiveAt) || effectiveAt < 0) {
      setErr('Effective time must be a non-negative simulation minute.')
      return
    }

    let event: DisruptionEvent
    const eventId = `dis-${crypto.randomUUID()}`
    if (kind === 'vehicle_failure') {
      event = { type: kind, id: eventId, at: effectiveAt, vehicleId }
    } else if (kind === 'road_closure') {
      event = { type: kind, id: eventId, at: effectiveAt, from: fromLocation, to: toLocation }
    } else {
      const size = Number(deliverySize)
      const service = Number(serviceMin)
      const start = Number(windowStart)
      const end = Number(windowEnd)
      const deliveryId = `delivery-${crypto.randomUUID()}`
      event = {
        type: kind,
        id: eventId,
        at: effectiveAt,
        delivery: {
          id: deliveryId,
          locationId: deliveryLocation,
          size,
          serviceMin: service,
          window: { start, end },
          priority: 'urgent',
        },
      }
    }

    const checked = validateDisruptionEvent(event, locations.map(location => location.id), vehicles.map(vehicle => vehicle.id))
    if (!checked.isValid || !checked.event) {
      setErr(checked.errors.join(' '))
      setRes(null)
      return
    }
    const validatedEvent = checked.event

    const preview = validatedEvent.type === 'vehicle_failure'
      ? `${vehicles.find(vehicle => vehicle.id === validatedEvent.vehicleId)?.name ?? validatedEvent.vehicleId} fails at ${fmtTime(validatedEvent.at)}.`
      : validatedEvent.type === 'road_closure'
        ? `Road from ${locName(validatedEvent.from)} to ${locName(validatedEvent.to)} closes at ${fmtTime(validatedEvent.at)}.`
        : `Urgent delivery of ${validatedEvent.delivery.size} units at ${locName(validatedEvent.delivery.locationId)} at ${fmtTime(validatedEvent.at)}.`

    setRes({ rawText: text.trim(), event: validatedEvent, missing: [], unknownLocations: [], preview, confirmation: 'pending', source: 'placeholder' })
  }

  const prepareWithAi = async () => {
    setErr('')
    setSuccess('')
    if (!text.trim()) {
      setErr('Enter a short incident description before preparing the disruption.')
      return
    }
    if (isDemoMode) {
      setErr('AI interpretation is available only through the configured backend in live mode. Use a demo scenario instead.')
      return
    }
    if (!profile?.orgId) {
      setErr('Your organization profile is unavailable. Sign in again before interpreting an incident.')
      return
    }
    setInterpreting(true)
    try {
      const interpreted = await interpretIncidentPreview(
        text.trim(), defaultDisruptionInterpreter,
        locations.map(location => location.id), vehicles.map(vehicle => vehicle.id),
        { locations, knownVehicles: vehicles, currentTime: currentPlan?.createdAt ?? 0 },
      )
      setRes(interpreted)
      if (!interpreted.event) setErr(interpreted.error || interpreted.missing.join(' ') || 'The incident could not be interpreted. Correct the details and try again.')
    } catch (cause) {
      setRes(null)
      setErr((cause as Error).message || 'Unable to interpret this incident.')
    } finally {
      setInterpreting(false)
    }
  }

  const confirm = async () => {
    setErr('')
    setSuccess('')
    if (!res?.event) {
      setErr('Cannot confirm disruption: no disruption event was generated or validated.')
      return
    }
    if (!canWrite) {
      setErr('Your role is read-only and cannot confirm disruptions or save replanned routes.')
      return
    }
    if (!window.confirm('Confirm this disruption and save the resulting replanned route? This writes operational records and audit history.')) return

    if (isDemoMode) {
      try {
        if (!world || !currentPlan) throw new ValidationError('No active plan is available to replan.')
        const updatedWorld = applyDisruption(world, res.event)
        const replanned = replan(updatedWorld, currentPlan, res.event.at)
        setWorld(updatedWorld)
        setCurrentPlan(replanned)
        setDisruptions(previous => [...previous, res.event!])
        setSuccess(`Demo disruption applied at ${fmtTime(res.event.at)} (${res.event.at}m). Plan updated with ${replanned.routes.length} vehicle routes.`)
        setRes(null)
        setText('')
      } catch (cause) {
        setErr(`${(cause as Error).message} — the plan remains unchanged.`)
      }
      return
    }

    if (!profile?.orgId || !world || !currentPlan) {
      setErr('A saved organization route plan is required before disruptions can be confirmed and replanned.')
      return
    }
    if (res.event.at < currentPlan.createdAt) {
      setErr('The disruption time cannot be earlier than the latest saved plan simulation time.')
      return
    }
    if (travelLegCount === 0) {
      setErr('This database has no travel-time matrix, and the saved plan contains no usable route legs. Replanning is unavailable until route-leg timing data exists.')
      return
    }
    if (res.event.type === 'road_closure' && !world.matrix[res.event.from]?.[res.event.to] && !world.matrix[res.event.to]?.[res.event.from]) {
      setErr('This road has no travel time recorded in the saved plan. The closure cannot be replanned safely with the available data.')
      return
    }

    setSubmitting(true)
    let disruptionRecorded = false
    let urgentDeliverySaved = false
    try {
      const replayed = applyDisruptionBatch(world, disruptions, res.event.at)
      if (replayed.rejected.length > 0) {
        throw new ValidationError(`Persisted disruption history cannot be replayed: ${replayed.rejected.map(item => item.reason).join('; ')}`)
      }
      const updatedWorld = applyDisruption(replayed.world, res.event)
      const generated = replan(updatedWorld, currentPlan, res.event.at)
      const savedPlan: DeliveryPlan = {
        ...generated,
        id: `plan-replanned-${Date.now()}-${crypto.randomUUID()}`,
      }

      // Persist urgent deliveries first so generated plan stops satisfy the
      // deliveries foreign key. The confirmation RPC then records the event
      // and its audit row before the plan is saved.
      if (res.event.type === 'urgent_delivery') {
        await saveDelivery(res.event.delivery, profile.orgId, profile)
        urgentDeliverySaved = true
      }
      await confirmDisruption({
        interpreted: { ...res, confirmation: 'confirmed' },
        orgId: profile.orgId,
        actorProfile: profile,
        knownLocationIds: locations.map(location => location.id),
        knownVehicleIds: vehicles.map(vehicle => vehicle.id),
      })
      disruptionRecorded = true
      if (res.event.type === 'vehicle_failure') {
        await updateVehicleStatus(res.event.vehicleId, profile.orgId, 'failed', profile.role, profile.id)
      }

      try {
        await saveDeliveryPlan(savedPlan, profile.orgId, profile, currentPlan.id)
      } catch (cause) {
        setRes(null)
        await load()
        setErr(`The disruption was recorded, but the replanned routes could not be saved: ${(cause as Error).message}`)
        return
      }

      setRes(null)
      setText('')
      const refreshed = await load()
      if (refreshed) setSuccess(`Disruption recorded and audited. Replanned routes were saved at ${fmtTime(savedPlan.createdAt)} and refreshed from the organization database.`)
      else setErr('The disruption and replanned route were saved, but refresh failed. Retry refresh before relying on the displayed data.')
    } catch (cause) {
      setErr(disruptionRecorded
        ? `The disruption was recorded, but a related operational update failed: ${(cause as Error).message}`
        : urgentDeliverySaved
          ? `The urgent delivery was saved, but disruption confirmation failed: ${(cause as Error).message}`
          : `${(cause as Error).message} — no success was reported.`)
    } finally {
      setSubmitting(false)
    }
  }

  return <>
    <PageHead
      title="Disruptions & Dynamic Replanning"
      sub="Describe an incident or prepare a structured event. Nothing changes until you confirm the preview."
    />

    <div className="space-y-6">
      <Card
        title="Incident Intake & Preview"
        sub="Interpret a natural-language report or enter a structured event. Live changes are saved only after confirmation."
        action={<button onClick={() => void load()} disabled={loading || submitting} className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50">{loading ? 'Refreshing…' : 'Refresh'}</button>}
      >
        {loading ? <State kind="loading" text="Loading organization disruption data…" /> : loadError ? <>
          <State kind="error" text={loadError} />
          <button onClick={() => void load()} className="mt-3 rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700">Retry</button>
        </> : <>
          {isDemoMode && <div className="mb-4">
            <div className="mb-2 text-xs font-semibold text-slate-600">Quick incident scenarios (demo mode)</div>
            <div className="flex flex-wrap gap-2">
              {QUICK_DISRUPTIONS.map(item => <button
                key={item.label}
                onClick={() => { setText(item.interpretation.rawText); setRes(item.interpretation); setErr(''); setSuccess('') }}
                disabled={!canWrite || submitting}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >{item.label}</button>)}
            </div>
          </div>}

          {!isDemoMode && <div className="mb-3 grid gap-3 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
            <label className="text-xs text-slate-600">Disruption type
              <select value={kind} onChange={event => setKind(event.target.value as EventKind)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm">
                <option value="vehicle_failure">Vehicle failure</option><option value="road_closure">Road closure</option><option value="urgent_delivery">Urgent delivery</option>
              </select>
            </label>
            <label className="text-xs text-slate-600">Effective time (simulation minutes)
              <input type="number" min="0" value={at} onChange={event => setAt(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm" />
            </label>
            {kind === 'vehicle_failure' && <label className="text-xs text-slate-600 sm:col-span-2">Vehicle
              <select value={vehicleId} onChange={event => setVehicleId(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm"><option value="">Select a vehicle</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>)}</select>
            </label>}
            {kind === 'road_closure' && <>
              <label className="text-xs text-slate-600">From location<select value={fromLocation} onChange={event => setFromLocation(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm"><option value="">Select location</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
              <label className="text-xs text-slate-600">To location<select value={toLocation} onChange={event => setToLocation(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm"><option value="">Select location</option>{locations.filter(location => location.id !== fromLocation).map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            </>}
            {kind === 'urgent_delivery' && <>
              <label className="text-xs text-slate-600 sm:col-span-2">Delivery location<select value={deliveryLocation} onChange={event => setDeliveryLocation(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm"><option value="">Select location</option>{locations.filter(location => location.kind === 'customer').map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
              <label className="text-xs text-slate-600">Size<input type="number" min="1" value={deliverySize} onChange={event => setDeliverySize(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm" /></label>
              <label className="text-xs text-slate-600">Service minutes<input type="number" min="0" value={serviceMin} onChange={event => setServiceMin(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm" /></label>
              <label className="text-xs text-slate-600">Window start<input type="number" min="0" value={windowStart} onChange={event => setWindowStart(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm" /></label>
              <label className="text-xs text-slate-600">Window end<input type="number" min="1" value={windowEnd} onChange={event => setWindowEnd(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm" /></label>
            </>}
          </div>}

          <label className="block text-xs font-semibold text-slate-700">Incident report
            <textarea value={text} onChange={event => setText(event.target.value)} rows={3} placeholder="Describe a road closure, vehicle breakdown, or urgent delivery" className="mt-1 w-full rounded border border-slate-300 bg-white p-3 text-sm" />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {!isDemoMode && <button onClick={() => void prepareWithAi()} disabled={!text.trim() || loading || submitting || interpreting || !canWrite} className="rounded bg-[#243607] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">{interpreting ? 'Interpreting…' : 'Interpret with AI'}</button>}
            <button onClick={prepare} disabled={!text.trim() || loading || submitting || interpreting || !canWrite} className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-40">Prepare structured event</button>
          </div>
          {!canWrite && <div className="mt-2 text-xs text-slate-500">Your role is read-only. You can review disruption data but cannot prepare or confirm changes.</div>}

          {res && <div className="mt-4 rounded border border-slate-200 bg-slate-50/50 p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2"><Badge t={res.source === 'ai' ? 'ok' : 'warn'}>{res.source}</Badge><span className="font-medium text-slate-800">{res.preview}</span></div>
            {res.event && <div className="mt-2 text-xs text-slate-600"><span className="font-semibold">Event type:</span> {res.event.type} · <span className="font-semibold">Effective time:</span> {fmtTime(res.event.at)} ({res.event.at}m)</div>}
            {res.missing.length > 0 && <div className="mt-1 text-xs text-amber-700">Missing: {res.missing.join(', ')}</div>}
            {res.unknownLocations?.length ? <div className="mt-1 text-xs text-red-700">Unknown organization locations: {res.unknownLocations.join(', ')}. Select or correct known locations before confirming.</div> : null}
            {res.unknownVehicles?.length ? <div className="mt-1 text-xs text-red-700">Unknown organization vehicles: {res.unknownVehicles.join(', ')}. Select or correct known vehicles before confirming.</div> : null}
            {res.needsClarification && res.clarificationQuestion && <div className="mt-1 text-xs text-amber-700">Please clarify: {res.clarificationQuestion}</div>}
            {!isDemoMode && !currentPlan && <State kind="error" text="A saved organization plan is required before a disruption can be confirmed." />}
            {!isDemoMode && currentPlan && travelLegCount === 0 && <State kind="error" text="No route-leg travel times can be recovered from the saved plan. Live replanning is unavailable for this data." />}
            <div className="mt-3 flex gap-2">
              <button onClick={() => void confirm()} disabled={!res.event || !canWrite || submitting || (!isDemoMode && (!currentPlan || travelLegCount === 0))} className="rounded bg-navy px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">{submitting ? 'Saving disruption and plan…' : 'Confirm and replan'}</button>
              <button onClick={() => { setRes(null); setErr('') }} disabled={submitting} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50">Reject</button>
            </div>
          </div>}
        </>}

        {success && <State kind="success" text={success} />}
        {err && <State kind="error" text={err} />}
      </Card>

      {!loading && !loadError && <Card title="Persisted Disruptions">
        {disruptions.length === 0 ? <State kind="empty" text="No disruptions have been recorded for this organization." /> : <div className="space-y-1.5">
          {disruptions.map(event => <div key={event.id} className="flex items-center gap-2 text-xs text-slate-700"><Badge t="bad">{event.type}</Badge><span>at {fmtTime(event.at)} ({event.at}m) — ID: {event.id}</span></div>)}
        </div>}
      </Card>}

      {!loading && !loadError && <Card title={`Active Plan${currentPlan ? ` (${currentPlan.label})` : ''}`}>
        {!currentPlan ? <State kind="empty" text="No saved organization plan is available to display or replan." /> : <>
          <div className="mb-4 flex flex-wrap gap-4 text-xs text-slate-600">
            <div><span className="font-semibold text-slate-800">Routes:</span> {currentPlan.routes.length}</div>
            <div><span className="font-semibold text-slate-800">Scheduled stops:</span> {currentPlan.routes.reduce((count, route) => count + route.stops.length, 0)}</div>
            <div><span className="font-semibold text-slate-800">Unassigned deliveries:</span> {currentPlan.unassigned.length}</div>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {currentPlan.routes.map(route => {
              const vehicle = world?.vehicles.find(item => item.id === route.vehicleId)
              return <div key={route.vehicleId} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                <div className="mb-2 flex items-center justify-between"><span className="font-semibold text-slate-800">{vehicle?.name ?? route.vehicleId}</span><Badge t={vehicle?.status === 'failed' ? 'bad' : 'mute'}>{route.load}/{vehicle?.capacity ?? 0} load {vehicle?.status === 'failed' ? '(failed)' : ''}</Badge></div>
                <ol className="space-y-2 border-l-2 border-teal/40 pl-3">
                  {route.stops.map(stop => <li key={stop.deliveryId} className="text-xs"><div className="font-medium text-slate-800">{fmtTime(stop.serviceStart)} {locName(stop.locationId)} <Badge t={stop.status === 'completed' ? 'ok' : stop.status === 'late' ? 'warn' : stop.status === 'skipped' ? 'bad' : 'mute'}>{stop.status}</Badge></div><div className="text-slate-500">Arr {fmtTime(stop.arrival)}{stop.waitMin > 0 && ` · waits ${stop.waitMin}m`} · Dep {fmtTime(stop.departure)}</div></li>)}
                  {route.stops.length === 0 && <li className="text-xs text-slate-400">No stops assigned</li>}
                </ol>
              </div>
            })}
          </div>
          {currentPlan.unassigned.length > 0 && <div className="mt-4 border-t border-slate-200 pt-3"><div className="mb-2 text-xs font-semibold text-slate-700">Unassigned deliveries:</div><div className="flex flex-wrap gap-2">{currentPlan.unassigned.map(item => <div key={item.deliveryId} className="rounded border border-red-200 bg-red-50 p-2 text-xs"><span className="font-semibold text-red-800">{item.deliveryId}:</span> <Badge t="bad">{item.reason}</Badge><div className="mt-0.5 text-slate-600">{item.detail}</div></div>)}</div></div>}
        </>}
      </Card>}
    </div>
  </>
}
