import { useEffect, useState } from 'react'
import { LayoutDashboard, Truck, Package, Route as RouteIcon, AlertTriangle, GitCompare, Users as UsersIcon, Menu } from 'lucide-react'
import type { Role } from './types'
import { isDemoMode, supabase } from './services/supabase'
import Login from './pages/Login'; import Dashboard from './pages/Dashboard'; import Fleet from './pages/Fleet'; import Deliveries from './pages/Deliveries'
import Routes from './pages/Routes'; import Disruptions from './pages/Disruptions'; import Compare from './pages/Compare'; import Users from './pages/Users'
const NAV = [{ id: 'dash', label: 'Overview', I: LayoutDashboard, C: Dashboard, roles: ['admin', 'dispatcher', 'viewer'] }, { id: 'fleet', label: 'Fleet', I: Truck, C: Fleet, roles: ['admin', 'dispatcher', 'viewer'] }, { id: 'del', label: 'Deliveries', I: Package, C: Deliveries, roles: ['admin', 'dispatcher', 'viewer'] }, { id: 'route', label: 'Route plan', I: RouteIcon, C: Routes, roles: ['admin', 'dispatcher', 'viewer'] }, { id: 'dis', label: 'Disruptions', I: AlertTriangle, C: Disruptions, roles: ['admin', 'dispatcher'] }, { id: 'cmp', label: 'Compare plans', I: GitCompare, C: Compare, roles: ['admin', 'dispatcher', 'viewer'] }, { id: 'usr', label: 'Users', I: UsersIcon, C: Users, roles: ['admin'] }]
export default function App() {
  const [authed, setAuthed] = useState(false), [role, setRole] = useState<Role>('dispatcher'), [page, setPage] = useState('dash'), [open, setOpen] = useState(false)
  useEffect(() => { supabase?.auth.getSession().then(({ data }) => setAuthed(!!data.session)); const s = supabase?.auth.onAuthStateChange((_e, ses) => setAuthed(!!ses)); return () => s?.data.subscription.unsubscribe() }, [])
  if (!authed) return <Login onDemo={() => setAuthed(true)} />
  const items = NAV.filter(n => n.roles.includes(role)); const Cur = (items.find(n => n.id === page) ?? items[0]).C
  return <div className="flex min-h-screen"><aside className={`${open ? 'block' : 'hidden'} md:block fixed md:static z-10 h-full w-56 shrink-0 bg-navy p-4 text-slate-200`}><div className="mb-6 text-lg font-semibold text-white">ReRoute</div>
    <nav className="space-y-1">{items.map(n => <button key={n.id} onClick={() => { setPage(n.id); setOpen(false) }} className={`flex w-full items-center gap-2 rounded px-3 py-2 text-sm ${page === n.id ? 'bg-teal text-white' : 'hover:bg-white/10'}`}><n.I size={16} />{n.label}</button>)}</nav>
    {isDemoMode && <label className="mt-8 block text-xs text-slate-400">Demo role<select value={role} onChange={e => setRole(e.target.value as Role)} className="mt-1 w-full rounded bg-white/10 p-1 text-slate-100"><option>admin</option><option>dispatcher</option><option>viewer</option></select></label>}</aside>
    <main className="min-w-0 flex-1 p-4 md:p-8"><button className="mb-3 md:hidden" aria-label="Menu" onClick={() => setOpen(!open)}><Menu /></button><Cur /></main></div>
}
