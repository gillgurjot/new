import { NavLink, Route, Routes } from 'react-router-dom'
import { PageTitle } from '../../components/ui'
import Dashboard from './Dashboard'
import Libraries from './Libraries'
import Users from './Users'

export default function AdminPage() {
  const tab = ({ isActive }: { isActive: boolean }) => (isActive ? 'pill-on' : 'pill')
  return (
    <div className="pt-20 md:pt-24 px-4 md:px-10 pb-16 max-w-6xl">
      <PageTitle>Server admin</PageTitle>
      <div className="flex gap-2 mb-7 overflow-x-auto scrollbar-none -mx-4 px-4 md:mx-0 md:px-0">
        <NavLink to="/admin" end className={tab}>Dashboard</NavLink>
        <NavLink to="/admin/libraries" className={tab}>Libraries</NavLink>
        <NavLink to="/admin/users" className={tab}>Users</NavLink>
      </div>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="libraries" element={<Libraries />} />
        <Route path="users" element={<Users />} />
      </Routes>
    </div>
  )
}
