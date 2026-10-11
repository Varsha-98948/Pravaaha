import { Card, PageHead, Badge, Table, Placeholder } from '../components/ui'
import { users } from '../data/demo'
export default function Users() { return <><PageHead title="Users" sub="Roles are changed by admins only (enforced in database)" /><Card title="Team" action={<Placeholder />}><Table head={['Name', 'Email', 'Role']} rows={users.map(u => [u.name, u.email, <Badge t={u.role === 'admin' ? 'warn' : 'mute'}>{u.role}</Badge>])} /></Card></> }
