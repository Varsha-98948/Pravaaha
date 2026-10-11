import { useState } from 'react'
import { supabase, isDemoMode } from '../services/supabase'
import { State } from '../components/ui'
export default function Login({ onDemo }: { onDemo: () => void }) {
  const [email, setE] = useState(''), [pw, setP] = useState(''), [err, setErr] = useState('')
  const go = async () => { const { error } = await supabase!.auth.signInWithPassword({ email, password: pw }); if (error) setErr(error.message) }
  return <div className="grid min-h-screen place-items-center p-4"><div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6"><h1 className="mb-1 text-xl font-semibold">ReRoute</h1><p className="mb-4 text-sm text-slate-500">Dispatcher sign-in</p>
    {isDemoMode ? <><State kind="empty" text="Supabase is not configured. Running in demo mode." /><button onClick={onDemo} className="w-full rounded bg-teal py-2 font-medium text-white">Enter demo</button></> :
      <div className="space-y-2"><input className="w-full rounded border p-2 text-sm" placeholder="Email" value={email} onChange={e => setE(e.target.value)} /><input className="w-full rounded border p-2 text-sm" type="password" placeholder="Password" value={pw} onChange={e => setP(e.target.value)} /><button onClick={go} className="w-full rounded bg-teal py-2 font-medium text-white">Sign in</button>{err && <State kind="error" text={err} />}</div>}</div></div>
}
