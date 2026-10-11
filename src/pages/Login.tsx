import { useState, type FormEvent } from 'react'
import { State } from '../components/ui'
import { getSupabaseClient, isDemoMode } from '../services/supabase'

export default function Login({ onDemo, authError = '' }: { onDemo: () => void; authError?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const client = getSupabaseClient()
      const { error: signInError } = await client.auth.signInWithPassword({ email, password })
      if (signInError) setError(signInError.message)
    } catch (cause) {
      setError((cause as Error).message || 'Unable to sign in.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6">
        <h1 className="mb-1 text-xl font-semibold">ReRoute</h1>
        <p className="mb-4 text-sm text-slate-500">Dispatcher sign-in</p>
        {isDemoMode ? (
          <>
            <State kind="empty" text="Supabase is not configured. Demo mode uses sample data only." />
            <button onClick={onDemo} className="w-full rounded bg-teal py-2 font-medium text-white">
              Enter demo
            </button>
          </>
        ) : (
          <form onSubmit={signIn} className="space-y-2">
            {authError && <State kind="error" text={authError} />}
            <label className="block text-sm text-slate-600">
              Email
              <input
                className="mt-1 w-full rounded border p-2 text-sm"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={event => setEmail(event.target.value)}
              />
            </label>
            <label className="block text-sm text-slate-600">
              Password
              <input
                className="mt-1 w-full rounded border p-2 text-sm"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={event => setPassword(event.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded bg-teal py-2 font-medium text-white disabled:opacity-50"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
            {error && <State kind="error" text={error} />}
          </form>
        )}
      </div>
    </div>
  )
}
