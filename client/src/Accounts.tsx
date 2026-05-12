// client/src/Accounts.tsx
import { useEffect, useState, useCallback } from 'react'
import { usePlaidLink } from 'react-plaid-link'

type PlaidItem = {
  id: number
  institution_name: string
  status: 'active' | 'needs_reauth'
  account_count: number
  last_synced_at: string | null
}

type ConnectButtonProps = {
  linkToken: string
  onConnected: () => void
}

function ConnectButton({ linkToken, onConnected }: ConnectButtonProps) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token, metadata) => {
      await fetch('/api/plaid/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          public_token,
          institution_name: metadata.institution?.name ?? 'Unknown',
        }),
      })
      onConnected()
    },
  })

  return (
    <button
      onClick={() => open()}
      disabled={!ready}
      className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
    >
      Connect Account
    </button>
  )
}

export default function Accounts() {
  const [items, setItems] = useState<PlaidItem[]>([])
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResults, setSyncResults] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    const res = await fetch('/api/plaid/status')
    const data = await res.json()
    setItems(data.items)
  }, [])

  const fetchLinkToken = useCallback(async () => {
    const res = await fetch('/api/plaid/link-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    setLinkToken(data.link_token)
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchLinkToken()
  }, [fetchStatus, fetchLinkToken])

  const handleConnected = useCallback(() => {
    fetchStatus()
    fetchLinkToken()  // refresh token for next connection
  }, [fetchStatus, fetchLinkToken])

  const handleSync = async () => {
    setSyncing(true)
    setSyncResults(null)
    try {
      const res = await fetch('/api/plaid/sync', { method: 'POST' })
      const data = await res.json()
      const summary = data.results
        .map((r: { id: number; status: string; added?: number }) =>
          r.status === 'ok' ? `+${r.added ?? 0} transactions` : r.status
        )
        .join(', ')
      setSyncResults(summary)
      await fetchStatus()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Accounts</h1>
        <div className="flex gap-3">
          {linkToken && (
            <ConnectButton linkToken={linkToken} onConnected={handleConnected} />
          )}
          <button
            onClick={handleSync}
            disabled={syncing || items.length === 0}
            className="px-4 py-2 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>

      {syncResults && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">
          Sync complete: {syncResults}
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="mb-4">No accounts connected yet.</p>
          {linkToken && (
            <ConnectButton linkToken={linkToken} onConnected={handleConnected} />
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} onReauth={fetchStatus} />
          ))}
        </div>
      )}
    </div>
  )
}

function ItemCard({ item, onReauth }: { item: PlaidItem; onReauth: () => void }) {
  const [reAuthToken, setReAuthToken] = useState<string | null>(null)

  const fetchUpdateToken = useCallback(async () => {
    const res = await fetch('/api/plaid/link-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id }),
    })
    const data = await res.json()
    setReAuthToken(data.link_token)
  }, [item.id])

  useEffect(() => {
    if (item.status === 'needs_reauth') {
      fetchUpdateToken()
    }
  }, [item.status, fetchUpdateToken])

  return (
    <div className={`p-4 border rounded-lg ${item.status === 'needs_reauth' ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">{item.institution_name}</h2>
          <p className="text-sm text-gray-500">
            {item.account_count} account{item.account_count !== 1 ? 's' : ''}
            {item.last_synced_at && ` · Last synced ${new Date(item.last_synced_at + 'Z').toLocaleDateString()}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {item.status === 'needs_reauth' ? (
            <>
              <span className="text-sm text-amber-700 font-medium">Needs reconnect</span>
              {reAuthToken && (
                <ReAuthButton token={reAuthToken} onSuccess={onReauth} />
              )}
            </>
          ) : (
            <span className="text-sm text-green-700">Connected</span>
          )}
        </div>
      </div>
    </div>
  )
}

function ReAuthButton({ token, onSuccess }: { token: string; onSuccess: () => void }) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async () => {
      // After re-auth, trigger a sync to restore active status
      await fetch('/api/plaid/sync', { method: 'POST' })
      onSuccess()
    },
  })

  return (
    <button
      onClick={() => open()}
      disabled={!ready}
      className="px-3 py-1.5 bg-amber-600 text-white text-sm rounded hover:bg-amber-700 disabled:opacity-50"
    >
      Reconnect
    </button>
  )
}
