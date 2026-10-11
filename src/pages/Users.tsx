import { Card, PageHead, Badge, Table, MetricCard } from '../components/ui'
import { users } from '../data/demo'
import { Users as UsersIcon, ShieldCheck, Key, Lock, UserCheck } from 'lucide-react'

export default function Users() {
  const adminCount = users.filter((u) => u.role === 'admin').length
  const dispatcherCount = users.filter((u) => u.role === 'dispatcher').length
  const viewerCount = users.filter((u) => u.role === 'viewer').length

  return (
    <div className="space-y-6">
      <PageHead
        title="Team Governance & Access Control"
        sub="Role-based authorization (RBAC) enforced cryptographically via database security triggers and row-level policies."
        badge={
          <Badge t="ok" dot>
            Admin Scope Active
          </Badge>
        }
      />

      {/* Role Counts */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Administrators"
          value={adminCount}
          sub="Full organization & team rights"
          icon={<Key size={18} />}
          trend="Superuser"
          trendType="neutral"
        />
        <MetricCard
          label="Active Dispatchers"
          value={dispatcherCount}
          sub="Route planning & disruption confirmation"
          icon={<ShieldCheck size={18} />}
          trend="Operational"
          trendType="positive"
        />
        <MetricCard
          label="Viewers / Analysts"
          value={viewerCount}
          sub="Read-only telemetry access"
          icon={<UserCheck size={18} />}
          trend="Auditing"
          trendType="positive"
        />
      </div>

      {/* Team Roster Card */}
      <Card
        title="Organization Members & Role Assignments"
        sub="Role modifications are restricted to verified administrators and logged to audit tables"
      >
        <Table
          head={['Team Member', 'Email Address', 'Access Tier', 'Operational Authority']}
          rows={users.map((u) => [
            <div key="name" className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#243607]/10 text-xs font-bold text-[#243607]">
                {u.name.charAt(0)}
              </div>
              <span className="font-bold text-xs text-[#30280D]">{u.name}</span>
            </div>,
            <span key="email" className="font-mono text-xs text-[#30280D]/70">{u.email}</span>,
            <Badge key="role" t={u.role === 'admin' ? 'warn' : u.role === 'dispatcher' ? 'ok' : 'mute'}>
              {u.role.toUpperCase()}
            </Badge>,
            <span key="auth" className="text-xs text-[#30280D]/75">
              {u.role === 'admin'
                ? 'Full system authority, team management, and disruption execution'
                : u.role === 'dispatcher'
                ? 'Can intake, preview, and confirm route disruption replans'
                : 'Read-only access to plans, fleet grid, and manifest records'}
            </span>,
          ])}
        />
      </Card>

      {/* Security Policies Info Box */}
      <div className="rounded-xl border border-[#30280D]/10 bg-[#f8f9f4] p-4 text-xs text-[#30280D]/80 flex items-start gap-3">
        <Lock size={17} className="text-[#243607] shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-[#30280D] block mb-0.5">Database Trigger Enforcement</span>
          <span>
            Self-promotion is prohibited by PostgreSQL trigger <code className="rounded bg-black/06 px-1 font-mono text-[11px]">guard_user_role_mutation()</code>. Only users with the <code className="font-mono">admin</code> role can modify organizational team roles.
          </span>
        </div>
      </div>
    </div>
  )
}
