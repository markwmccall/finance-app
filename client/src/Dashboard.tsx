import SyncWidget from './SyncWidget'

export default function Dashboard() {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SyncWidget />
      </div>
    </div>
  )
}
