import { NavLink, Route, Routes } from 'react-router-dom'
import Dashboard from './Dashboard'
import Libraries from './Libraries'
import Users from './Users'

export default function AdminPage() {
  const tab = ({ isActive }: { isActive: boolean }) => `px-4 h-10 inline-flex items-center rounded-full text-sm font-semibold transition ${isActive ? 'bg-white text-black' : 'bg-white/10 hover:bg-white/20'}`
  return (
    <div className="pt-20 md:pt-24 px-4 md:px-10 pb-16 max-w-6xl">
      <h1 className="text-2xl md:text-3xl font-black tracking-tight mb-5">Server admin</h1>
      <div className="flex gap-2 mb-8 overflow-x-auto scrollbar-none">
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
