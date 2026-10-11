import { useState } from 'react'
import { supabase, isDemoMode } from '../services/supabase'
import { State, SpatialButton } from '../components/ui'
import { Radio, Lock, Mail, ArrowRight, Shield, Sparkles } from 'lucide-react'

export default function Login({ onDemo }: { onDemo: () => void }) {
  const [email, setE] = useState('')
  const [pw, setP] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const go = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      const { error } = await supabase!.auth.signInWithPassword({ email, password: pw })
      if (error) setErr(error.message)
    } catch (e: unknown) {
      setErr((e as Error).message || 'Failed to authenticate.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center p-4 bg-gradient-to-br from-[#30280D] via-[#201a08] to-[#120f04] text-[#f2f3ec] overflow-hidden">
      {/* Background Spatial Ambience */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-[#243607]/25 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-[#91696E]/20 blur-3xl" />
        <div
          className="absolute inset-0 opacity-15"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(187,190,167,0.3) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
      </div>

      {/* Floating Spatial Portal Card */}
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[#BBBEA7]/20 bg-gradient-to-b from-[#30280D]/90 to-[#221c09]/95 p-8 shadow-spatial-float backdrop-blur-xl animate-in fade-in zoom-in-95 duration-300">
        {/* Brand Icon Header */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="relative mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#243607] text-white shadow-spatial-glow border border-[#BBBEA7]/30">
            <Radio size={28} className="animate-pulse text-[#BBBEA7]" />
            <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#91696E] text-[9px] font-bold">
              ✓
            </span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-[#f2f3ec]">ReRoute</h1>
          <p className="mt-1 text-xs text-[#BBBEA7]/80 uppercase tracking-widest font-medium">
            Spatial Fleet Intelligence & Replanning Platform
          </p>
        </div>

        {isDemoMode ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-[#BBBEA7]/20 bg-white/[0.05] p-4 text-xs text-[#BBBEA7] leading-relaxed space-y-2">
              <div className="flex items-center gap-2 text-[#f2f3ec] font-bold">
                <Sparkles size={16} className="text-[#BBBEA7]" />
                <span>Demo Environment Active</span>
              </div>
              <p>
                Supabase credentials are not detected in environment variables. You can enter the live interactive simulation in demo mode with full replanning, spatial route exploration, and role emulation.
              </p>
            </div>

            <SpatialButton
              variant="primary"
              size="lg"
              className="w-full justify-center shadow-spatial-md"
              onClick={onDemo}
              icon={<ArrowRight size={17} />}
            >
              Enter Fleet Simulation Demo
            </SpatialButton>

            <div className="text-center text-[11px] text-[#BBBEA7]/60">
              Role switching (Admin / Dispatcher / Viewer) available inside.
            </div>
          </div>
        ) : (
          <form onSubmit={go} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#BBBEA7]">
                Dispatcher Email
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-3 text-[#BBBEA7]/60" />
                <input
                  type="email"
                  required
                  placeholder="operator@harborlogistics.example"
                  value={email}
                  onChange={(e) => setE(e.target.value)}
                  className="w-full rounded-xl border border-[#BBBEA7]/25 bg-black/30 py-2.5 pl-9 pr-3 text-sm text-[#f2f3ec] placeholder-[#BBBEA7]/40 focus:border-[#243607] focus:outline-none focus:ring-1 focus:ring-[#243607]"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-[#BBBEA7]">
                Password
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-3 text-[#BBBEA7]/60" />
                <input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={pw}
                  onChange={(e) => setP(e.target.value)}
                  className="w-full rounded-xl border border-[#BBBEA7]/25 bg-black/30 py-2.5 pl-9 pr-3 text-sm text-[#f2f3ec] placeholder-[#BBBEA7]/40 focus:border-[#243607] focus:outline-none focus:ring-1 focus:ring-[#243607]"
                />
              </div>
            </div>

            <SpatialButton
              variant="primary"
              size="lg"
              type="submit"
              disabled={loading}
              className="w-full justify-center shadow-spatial-md mt-2"
              icon={<ArrowRight size={17} />}
            >
              {loading ? 'Authenticating...' : 'Sign In to Operations'}
            </SpatialButton>

            {err && (
              <div className="mt-2">
                <State kind="error" text={err} />
              </div>
            )}
          </form>
        )}

        {/* Security Footer Note */}
        <div className="mt-6 border-t border-[#BBBEA7]/15 pt-4 flex items-center justify-center gap-1.5 text-[11px] text-[#BBBEA7]/50 font-medium">
          <Shield size={12} />
          <span>PostgreSQL RLS & Cryptographic Role Guards</span>
        </div>
      </div>
    </div>
  )
}
