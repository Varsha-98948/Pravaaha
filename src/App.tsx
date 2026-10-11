import { useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Truck,
  Package,
  Route as RouteIcon,
  AlertTriangle,
  GitCompare,
  Users as UsersIcon,
  Menu,
  LogOut,
  Radio,
  Clock,
  Layers,
  ShieldAlert,
} from 'lucide-react'
import type { Role, UserProfile } from './types'
import { isDemoMode, supabase } from './services/supabase'
import { getCurrentUserProfile } from './services/authService'
import { Badge, State } from './components/ui'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Fleet from './pages/Fleet'
import Deliveries from './pages/Deliveries'
import Routes from './pages/Routes'
import Disruptions from './pages/Disruptions'
import Compare from './pages/Compare'
import Users from './pages/Users'
import { originalPlan } from './data/demo'

const NAV = [
  { id: 'dash', label: 'Overview', I: LayoutDashboard, C: Dashboard, roles: ['admin', 'dispatcher', 'viewer'] },
  { id: 'route', label: 'Route Engine', I: RouteIcon, C: Routes, roles: ['admin', 'dispatcher', 'viewer'] },
  { id: 'dis', label: 'Disruptions', I: AlertTriangle, C: Disruptions, roles: ['admin', 'dispatcher'] },
  { id: 'cmp', label: 'Plan Compare', I: GitCompare, C: Compare, roles: ['admin', 'dispatcher', 'viewer'] },
  { id: 'fleet', label: 'Fleet Grid', I: Truck, C: Fleet, roles: ['admin', 'dispatcher', 'viewer'] },
  { id: 'del', label: 'Deliveries', I: Package, C: Deliveries, roles: ['admin', 'dispatcher', 'viewer'] },
  { id: 'usr', label: 'Team', I: UsersIcon, C: Users, roles: ['admin'] },
]

export default function App() {
  const [authed, setAuthed] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [demoRole, setDemoRole] = useState<Role>('dispatcher')
  const [page, setPage] = useState('dash')
  const [open, setOpen] = useState(false)

  // Derived effective role for client navigation
  const activeRole: Role = isDemoMode ? demoRole : (profile?.role ?? 'viewer')

  const handleSignOut = async () => {
    if (!isDemoMode && supabase) {
      await supabase.auth.signOut().catch(() => {})
    }
    setAuthed(false)
    setProfile(null)
    setProfileError('')
    setPage('dash')
  }

  useEffect(() => {
    let mounted = true

    const loadProfile = async () => {
      if (isDemoMode) return
      setLoadingProfile(true)
      setProfileError('')
      try {
        const p = await getCurrentUserProfile()
        if (mounted) {
          setProfile(p)
          setLoadingProfile(false)
        }
      } catch (e) {
        if (mounted) {
          setProfile(null)
          setProfileError((e as Error).message || 'Failed to load user profile.')
          setLoadingProfile(false)
        }
      }
    }

    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        if (!mounted) return
        const hasSession = !!data.session
        setAuthed(hasSession)
        if (hasSession) {
          loadProfile()
        }
      })

      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!mounted) return
        const hasSession = !!session
        setAuthed(hasSession)
        if (hasSession) {
          loadProfile()
        } else {
          setProfile(null)
          setProfileError('')
          setLoadingProfile(false)
        }
      })

      return () => {
        mounted = false
        sub.subscription.unsubscribe()
      }
    }
  }, [])

  if (!authed) {
    return (
      <Login
        onDemo={() => {
          setAuthed(true)
          setProfile(null)
          setProfileError('')
        }}
      />
    )
  }

  if (!isDemoMode && loadingProfile) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f2f3ec] p-4">
        <State kind="loading" text="Verifying session and loading profile..." />
      </div>
    )
  }

  if (!isDemoMode && profileError) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#f2f3ec] p-4">
        <div className="w-full max-w-sm rounded-xl border border-[#30280D]/15 bg-white p-6 shadow-spatial-lg">
          <h1 className="mb-2 text-lg font-bold text-[#30280D]">Profile Unavailable</h1>
          <State kind="error" text={profileError} />
          <p className="mt-2 text-xs text-[#30280D]/70 leading-relaxed">
            Your auth session is active, but your profile could not be loaded from the organization database.
          </p>
          <button
            onClick={handleSignOut}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#30280D] py-2 text-sm font-medium text-white hover:bg-[#201a08] transition-colors"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>
    )
  }

  const items = NAV.filter((n) => n.roles.includes(activeRole))
  const Cur = (items.find((n) => n.id === page) ?? items[0]).C

  return (
    <div className="flex min-h-screen bg-[#f2f3ec] text-[#30280D]">
      {/* Mobile Drawer Overlay */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-[#30280D]/60 backdrop-blur-sm md:hidden"
        />
      )}

      {/* Spatial Sidebar Navigation Rail */}
      <aside
        className={`${
          open ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0 fixed md:static z-40 h-full min-h-screen w-64 shrink-0 bg-gradient-to-b from-[#30280D] via-[#241e0a] to-[#181405] text-[#BBBEA7] p-5 flex flex-col justify-between border-r border-[#BBBEA7]/15 shadow-spatial-lg transition-transform duration-300 ease-in-out`}
      >
        <div>
          {/* Spatial Brand Identity Header */}
          <div className="mb-7 flex items-center justify-between border-b border-[#BBBEA7]/15 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#243607] text-[#f2f3ec] shadow-spatial-glow border border-[#BBBEA7]/30">
                <Radio size={18} className="animate-pulse" />
              </div>
              <div>
                <div className="text-base font-extrabold tracking-tight text-[#f2f3ec] flex items-center gap-1.5">
                  ReRoute
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#243607] text-white">
                    PRO
                  </span>
                </div>
                <div className="text-[10px] uppercase tracking-wider text-[#BBBEA7]/80 font-medium">
                  Spatial Fleet Ops
                </div>
              </div>
            </div>

            {profile ? (
              <Badge t={profile.role === 'admin' ? 'warn' : 'ok'}>{profile.role}</Badge>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#BBBEA7]/20 text-[#BBBEA7] font-mono uppercase">
                {demoRole}
              </span>
            )}
          </div>

          {/* Navigation Links */}
          <div className="mb-2 px-1 text-[10px] font-semibold tracking-wider uppercase text-[#BBBEA7]/60">
            Operations Matrix
          </div>
          <nav className="space-y-1.5">
            {items.map((n) => {
              const active = page === n.id
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    setPage(n.id)
                    setOpen(false)
                  }}
                  className={`group relative flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200 ${
                    active
                      ? 'bg-[#243607] text-white shadow-spatial-md border border-[#BBBEA7]/30'
                      : 'text-[#BBBEA7]/85 hover:bg-white/[0.07] hover:text-[#f2f3ec]'
                  }`}
                >
                  <n.I
                    size={17}
                    className={`transition-colors ${
                      active ? 'text-white' : 'text-[#BBBEA7]/70 group-hover:text-white'
                    }`}
                  />
                  <span>{n.label}</span>
                  {active && (
                    <span className="ml-auto h-2 w-2 rounded-full bg-[#BBBEA7] shadow-sm" />
                  )}
                </button>
              )
            })}
          </nav>
        </div>

        {/* Lower Tactical Sidebar Controls */}
        <div className="mt-8 border-t border-[#BBBEA7]/15 pt-4 space-y-3">
          {isDemoMode ? (
            <div className="rounded-xl border border-[#BBBEA7]/15 bg-white/[0.05] p-3 text-xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-semibold text-[#f2f3ec]">Role Switcher</span>
                <span className="text-[10px] text-[#BBBEA7]/60 font-mono">Simulated</span>
              </div>
              <select
                value={demoRole}
                onChange={(e) => setDemoRole(e.target.value as Role)}
                className="w-full rounded-lg bg-[#30280D] border border-[#BBBEA7]/30 px-2 py-1.5 text-xs text-[#f2f3ec] focus:outline-none focus:border-[#243607]"
              >
                <option value="admin">Admin (Full Control)</option>
                <option value="dispatcher">Dispatcher (Operations)</option>
                <option value="viewer">Viewer (Read Only)</option>
              </select>
            </div>
          ) : (
            profile && (
              <div className="rounded-xl border border-[#BBBEA7]/15 bg-white/[0.05] p-3 text-xs">
                <div className="font-semibold text-[#f2f3ec] truncate">{profile.name}</div>
                <div className="truncate text-[#BBBEA7]/70 text-[11px]">{profile.email}</div>
              </div>
            )
          )}

          <button
            onClick={handleSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#BBBEA7]/20 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-[#BBBEA7] hover:bg-[#91696E]/20 hover:text-white hover:border-[#91696E]/40 transition-all"
          >
            <LogOut size={14} />
            <span>Sign Out Session</span>
          </button>
        </div>
      </aside>

      {/* Main Workspace Canvas */}
      <div className="min-w-0 flex-1 flex flex-col">
        {/* Top Tactical Status Bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#30280D]/10 bg-[#f2f3ec]/90 px-4 py-3 backdrop-blur-md md:px-8">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg border border-[#30280D]/15 p-1.5 text-[#30280D] md:hidden hover:bg-white"
              aria-label="Open Navigation Menu"
              onClick={() => setOpen(!open)}
            >
              <Menu size={18} />
            </button>
            <div className="flex items-center gap-2 text-xs text-[#30280D]/75">
              <span className="font-bold text-[#30280D] uppercase tracking-wider text-[11px]">
                Active Schedule:
              </span>
              <span className="font-semibold text-[#243607] bg-[#243607]/10 px-2 py-0.5 rounded-md border border-[#243607]/20">
                {originalPlan.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <div className="hidden sm:flex items-center gap-1.5 text-[#30280D]/70 bg-white/70 px-2.5 py-1 rounded-lg border border-[#30280D]/10">
              <Clock size={13} className="text-[#243607]" />
              <span className="font-mono font-medium">Clock: 08:00 (t=0m)</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#243607]/10 border border-[#243607]/20 text-[#243607] font-medium text-[11px]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#243607] animate-pulse" />
              <span>Realtime Replanning Ready</span>
            </div>
          </div>
        </header>

        {/* Page Content View */}
        <main className="min-w-0 flex-1 p-4 md:p-8 space-y-6">
          <Cur />
        </main>
      </div>
    </div>
  )
}
