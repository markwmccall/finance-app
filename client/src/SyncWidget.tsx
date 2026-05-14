import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface QueueSummary {
  total_pending: number
}

interface PlaidStatusItem {
  last_synced_at: string | null
}

export default function SyncWidget() {
  const navigate = useNavigate()
  const [totalPending, setTotalPending] = useState<number | null>(null)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/sync/queue').then(r => r.json() as Promise<QueueSummary>),
      fetch('/api/plaid/status').then(r => r.json() as Promise<{ items: PlaidStatusItem[] }>),
    ])
      .then(([queue, status]) => {
        setTotalPending(queue.total_pending)
        const timestamps = status.items
          .map(i => i.last_synced_at)
          .filter((t): t is string => t != null)
          .sort()
          .reverse()
        setLastSynced(timestamps[0] ?? null)
      })
      .catch(() => { /* silent — widget is non-critical */ })
      .finally(() => setLoading(false))
  }, [])

  function handleSyncNow() {
    navigate('/accounts?sync=1')
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg border p-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
        <div className="h-3 bg-gray-100 rounded w-3/4" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold text-sm text-gray-700">Bank Sync</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {lastSynced
              ? `Last synced ${new Date(lastSynced + 'Z').toLocaleDateString()}`
              : 'Never synced'}
          </p>
          {totalPending != null && totalPending > 0 && (
            <p className="mt-1 text-xs font-medium text-amber-700">
              {totalPending} transaction{totalPending !== 1 ? 's' : ''} pending review
            </p>
          )}
        </div>
        <button
          onClick={handleSyncNow}
          className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded hover:bg-indigo-700"
        >
          Sync now
        </button>
      </div>
    </div>
  )
}
