import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
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

const NAV = [
  { id: 'dash', label: 'Overview', I: LayoutDashboard, C: Dashboard, roles: ['admin', 'dispatcher', 'viewer'] },
  { id: 'fleet', label: 'Fleet', I: Truck, C: Fleet, roles: ['admin', 'dispatcher', 'viewer'] },
  { id: 'del', label: 'Deliveries', I: Package, C: Deliveries, roles: ['admin', 'dispatcher', 'viewer'] },
  { id: 'route', label: 'Route plan', I: RouteIcon, C: Routes, roles: ['admin', 'dispatcher', 'viewer'] },
  { id: 'dis', label: 'Disruptions', I: AlertTriangle, C: Disruptions, roles: ['admin', 'dispatcher'] },
  { id: 'cmp', label: 'Compare plans', I: GitCompare, C: Compare, roles: ['admin', 'dispatcher', 'viewer'] },
  { id: 'usr', label: 'Users', I: UsersIcon, C: Users, roles: ['admin'] },
]

export default function App() {
  const [authed, setAuthed] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [authReady, setAuthReady] = useState(isDemoMode)
  const [authError, setAuthError] = useState('')
  const [demoRole, setDemoRole] = useState<Role>('dispatcher')
  const [page, setPage] = useState('dash')
  const [open, setOpen] = useState(false)

  // Derived effective role for client navigation (backend operations enforce server/DB roles independently)
  const activeRole: Role = isDemoMode ? demoRole : (profile?.role ?? 'viewer')

  const handleSignOut = async () => {
    if (!isDemoMode && supabase) {
      const { error } = await supabase.auth.signOut()
      if (error) {
        setProfileError(`Unable to sign out: ${error.message}`)
        return
      }
    }
    setAuthed(false)
    setProfile(null)
    setProfileError('')
    setPage('dash')
  }

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true)
      return
    }

    let mounted = true
    let authEvents = 0
    let profileRequest = 0

    const loadProfile = async () => {
      const requestId = ++profileRequest
      setLoadingProfile(true)
      setProfileError('')
      try {
        const p = await getCurrentUserProfile()
        if (mounted && requestId === profileRequest) {
          setProfile(p)
          setLoadingProfile(false)
        }
      } catch (e) {
        if (mounted && requestId === profileRequest) {
          setProfile(null)
          setProfileError((e as Error).message || 'Failed to load user profile.')
          setLoadingProfile(false)
        }
      }
    }

    const applySession = (session: Session | null) => {
      const hasSession = !!session
      setAuthed(hasSession)
      setAuthReady(true)
      setAuthError('')
      if (hasSession) {
        void loadProfile()
      } else {
        profileRequest++
        setProfile(null)
        setProfileError('')
        setLoadingProfile(false)
      }
    }

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      authEvents++
      applySession(session)
    })

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted || authEvents > 0) return
      if (error) {
        setAuthError(error.message || 'Unable to restore the Supabase session.')
        setAuthReady(true)
        return
      }
      applySession(data.session)
    }).catch((error: unknown) => {
      if (!mounted || authEvents > 0) return
      setAuthError((error as Error).message || 'Unable to restore the Supabase session.')
      setAuthReady(true)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  if (!authed) {
    if (!authReady) {
      return <div className="grid min-h-screen place-items-center bg-slate-50 p-4"><State kind="loading" text="Checking Supabase session..." /></div>
    }
    return (
      <Login
        authError={authError}
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
      <div className="grid min-h-screen place-items-center bg-slate-50 p-4">
        <State kind="loading" text="Verifying session and loading profile..." />
      </div>
    )
  }

  if (!isDemoMode && profileError) {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 p-4">
        <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="mb-2 text-lg font-semibold text-slate-800">Profile Unavailable</h1>
          <State kind="error" text={profileError} />
          <p className="mt-2 text-xs text-slate-500">
            Your auth session is active, but your profile could not be loaded from the organization database.
          </p>
          <button
            onClick={handleSignOut}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-slate-700 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>
    )
  }

  const items = NAV.filter((n) => n.roles.includes(activeRole))
  const Cur = (items.find((n) => n.id === page) ?? items[0]).C

  useEffect(() => {
    if (!items.some((n) => n.id === page)) {
      setPage(items[0]?.id ?? 'dash')
    }
  }, [items, page])

  return (
    <div className="flex min-h-screen">
      <aside
        className={`${open ? 'block' : 'hidden'} md:block fixed md:static z-10 h-full w-56 shrink-0 bg-navy p-4 text-slate-200`}
      >
        <div className="mb-6 flex items-center justify-between">
          <div className="text-lg font-semibold text-white">ReRoute</div>
          {profile && <Badge t={profile.role === 'admin' ? 'warn' : 'ok'}>{profile.role}</Badge>}
        </div>

        <nav className="space-y-1">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                setPage(n.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 rounded px-3 py-2 text-sm ${page === n.id ? 'bg-teal text-white' : 'hover:bg-white/10'}`}
            >
              <n.I size={16} />
              {n.label}
            </button>
          ))}
        </nav>

        <div className="mt-8 border-t border-white/10 pt-4">
          {isDemoMode ? (
            <label className="block text-xs text-slate-400">
              Demo role
              <select
                value={demoRole}
                onChange={(e) => setDemoRole(e.target.value as Role)}
                className="mt-1 w-full rounded bg-white/10 p-1 text-slate-100"
              >
                <option>admin</option>
                <option>dispatcher</option>
                <option>viewer</option>
              </select>
            </label>
          ) : (
            profile && (
              <div className="mb-3 text-xs text-slate-300">
                <div className="font-medium text-white">{profile.name}</div>
                <div className="truncate text-slate-400">{profile.email}</div>
              </div>
            )
          )}

          <button
            onClick={handleSignOut}
            className="mt-3 flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-300 hover:bg-white/10"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#30280D]/10 bg-[#f2f3ec]/90 px-4 py-3 backdrop-blur-md md:px-8">
        <div className="flex items-center gap-3">
        <button className="mb-3 md:hidden" aria-label="Menu" onClick={() => setOpen(!open)}>
          <Menu />
        </button>
          <div className="flex items-center gap-2 text-xs text-[#30280D]/75">
            <Radio size={14} className="text-[#243607]" />
            <span className="font-bold uppercase tracking-wider">{items.find(item => item.id === page)?.label ?? 'Operations'}</span>
            <span className="hidden sm:inline rounded-md border border-[#243607]/20 bg-[#243607]/10 px-2 py-0.5 font-medium text-[#243607]">{isDemoMode ? 'Demo data' : profile?.orgId ?? 'Organization'}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-[#30280D]/10 bg-white/70 px-2.5 py-1 text-xs text-[#30280D]/70">
          <Clock size={13} className="text-[#243607]" />
          <span>{isDemoMode ? 'Demo mode' : 'Authenticated session'}</span>
        </div>
      </header>
      <main className="min-w-0 p-4 md:p-8">
        {page === 'dis' ? <Disruptions profile={profile} demoRole={activeRole} />
          : page === 'del' ? <Deliveries profile={profile} />
          : page === 'fleet' ? <Fleet profile={profile} />
              : page === 'route' ? <Routes profile={profile} demoRole={activeRole} />
                : page === 'dash' ? <Dashboard profile={profile} />
                  : page === 'cmp' ? <Compare profile={profile} />
                    : page === 'usr' ? <Users profile={profile} />
              : <Cur />}
      </main>
      </div>
    </div>
  )
}
