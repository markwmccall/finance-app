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

type SyncState =
  | 'waiting'
  | 'fetching_balances'
  | 'fetching_transactions'
  | 'processing'
  | 'done'
  | 'error'
  | 'needs_reauth'

type ItemProgress = {
  item_id: number
  institution_name: string
  state: SyncState
  page?: number
  added?: number
  needs_review?: number
  auto_matched?: number
  error_code?: string
  error_message?: string
  request_id?: string
  error_expanded?: boolean
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
  const [syncProgress, setSyncProgress] = useState<ItemProgress[]>([])

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
    setSyncProgress(items.map(item => ({
      item_id: item.id,
      institution_name: item.institution_name,
      state: 'waiting',
    })))

    function updateProgress(item_id: number, patch: Partial<ItemProgress>) {
      setSyncProgress(prev => prev.map(p => p.item_id === item_id ? { ...p, ...patch } : p))
    }

    try {
      const response = await fetch('/api/plaid/sync', {
        method: 'POST',
        headers: { Accept: 'text/event-stream' },
      })

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''

        for (const block of blocks) {
          const match = block.match(/^data:\s*(.+)$/m)
          if (!match) continue
          const event = JSON.parse(match[1]) as Record<string, unknown>

          if (event.type === 'complete') {
            await fetchStatus()
            continue
          }
          const item_id = event.item_id as number
          const state = event.state as SyncState
          updateProgress(item_id, {
            state,
            page: event.page as number | undefined,
            added: event.added as number | undefined,
            needs_review: event.needs_review as number | undefined,
            auto_matched: event.auto_matched as number | undefined,
            error_code: event.error_code as string | undefined,
            error_message: event.error_message as string | undefined,
            request_id: event.request_id as string | undefined,
          })
        }
      }
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

      {syncProgress.length > 0 && (
        <div className="mb-4 border rounded divide-y text-sm">
          {syncProgress.map(p => (
            <div key={p.item_id} className="px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium">{p.institution_name}</span>
                <span className="text-xs text-gray-500">
                  {p.state === 'waiting' && 'waiting…'}
                  {p.state === 'fetching_balances' && 'Fetching balances…'}
                  {p.state === 'fetching_transactions' && `Fetching transactions${p.page && p.page > 1 ? ` (page ${p.page})` : ''}…`}
                  {p.state === 'processing' && 'Processing…'}
                  {p.state === 'done' && (
                    <span>
                      Done — {p.added ?? 0} new · {p.needs_review ?? 0} review needed{' '}
                      <a href="/register" className="underline text-indigo-600 ml-1">Review →</a>
                    </span>
                  )}
                  {p.state === 'needs_reauth' && <span className="text-amber-700">Re-auth required</span>}
                  {p.state === 'error' && (
                    <span className="text-red-700">
                      Error — {p.error_code}{' '}
                      <button
                        onClick={() => setSyncProgress(prev => prev.map(x => x.item_id === p.item_id ? { ...x, error_expanded: !x.error_expanded } : x))}
                        className="underline"
                      >
                        ▸ details
                      </button>
                    </span>
                  )}
                </span>
              </div>
              {(p.state === 'fetching_balances' || p.state === 'fetching_transactions' || p.state === 'processing') && (
                <div className="h-1 rounded bg-gray-200 overflow-hidden">
                  <div className="h-full bg-blue-500 animate-[slide_1.5s_ease-in-out_infinite] w-1/3" />
                </div>
              )}
              {p.state === 'done' && <div className="h-1 rounded bg-green-500" />}
              {p.error_expanded && (
                <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-xs space-y-1">
                  <div><span className="font-medium">Error code:</span> {p.error_code}</div>
                  <div><span className="font-medium">Message:</span> {p.error_message}</div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Plaid request ID:</span>
                    <code className="font-mono bg-gray-100 px-1 rounded">{p.request_id}</code>
                    <button
                      onClick={() => p.request_id && navigator.clipboard.writeText(p.request_id)}
                      className="text-blue-600 hover:underline"
                    >Copy</button>
                  </div>
                </div>
              )}
            </div>
          ))}
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
      const response = await fetch('/api/plaid/sync', {
        method: 'POST',
        headers: { Accept: 'text/event-stream' },
      })
      const reader = response.body!.getReader()
      while (true) {
        const { done } = await reader.read()
        if (done) break
      }
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
