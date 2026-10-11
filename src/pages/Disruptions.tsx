import { useState } from 'react'
import { Card, PageHead, State, Badge, Placeholder } from '../components/ui'
import { placeholderInterpreter } from '../services/disruptionInterpreter'
import { replan } from '../engine/replan'
import { originalPlan, vehicles, deliveries, matrix, locations } from '../data/demo'
import type { InterpretedDisruption } from '../types'
export default function Disruptions() {
  const [text, setText] = useState(''); const [res, setRes] = useState<InterpretedDisruption | null>(null); const [err, setErr] = useState('')
  const run = async () => setRes(await placeholderInterpreter.interpret(text, locations.map(l => l.id)))
  const confirm = () => { try { replan({ vehicles, deliveries, matrix }, originalPlan, 90) } catch (e) { setErr((e as Error).message + ' — the original plan is unchanged.') } }
  return <><PageHead title="Disruptions" sub="Describe what happened. Nothing is applied until you confirm." />
    <Card title="Describe a disruption" action={<Placeholder />}><textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="e.g. Van 2 broke down near Harbor Grocers" className="w-full rounded border border-slate-300 p-2 text-sm" />
      <button onClick={run} disabled={!text.trim()} className="mt-2 rounded bg-teal px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Interpret</button>
      {res && <div className="mt-4 rounded border border-slate-200 p-3 text-sm"><Badge t="warn">{res.source}</Badge> <span className="ml-2">{res.preview}</span>
        <div className="mt-3 flex gap-2"><button onClick={confirm} className="rounded border border-navy px-3 py-1 text-sm">Confirm and replan</button><button onClick={() => { setRes(null); setErr('') }} className="rounded px-3 py-1 text-sm text-slate-600">Reject</button></div></div>}
      {err && <State kind="error" text={err} />}</Card></>
}
