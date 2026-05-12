import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'

function Dashboard() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Dashboard</h1><p className="text-gray-500 mt-2">Coming soon.</p></div>
}
function Register() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Register</h1><p className="text-gray-500 mt-2">Coming soon.</p></div>
}
function Calendar() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Calendar</h1><p className="text-gray-500 mt-2">Coming soon.</p></div>
}
function Scheduled() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Scheduled</h1><p className="text-gray-500 mt-2">Coming soon.</p></div>
}
function Accounts() {
  return <div className="p-6"><h1 className="text-2xl font-bold">Accounts</h1><p className="text-gray-500 mt-2">Coming soon.</p></div>
}

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/register', label: 'Register', end: false },
  { to: '/calendar', label: 'Calendar', end: false },
  { to: '/scheduled', label: 'Scheduled', end: false },
  { to: '/accounts', label: 'Accounts', end: false },
]

function Nav() {
  return (
    <nav className="bg-indigo-600 text-white px-4 py-3 flex items-center gap-6 shadow">
      <span className="font-semibold text-lg mr-2">
        {import.meta.env.VITE_APP_NAME}
      </span>
      {navItems.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            isActive ? 'font-semibold underline underline-offset-4' : 'opacity-75 hover:opacity-100 transition-opacity'
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <Nav />
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/register" element={<Register />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/scheduled" element={<Scheduled />} />
            <Route path="/accounts" element={<Accounts />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App
