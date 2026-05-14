import { useState } from 'react'

export interface QueueRow {
  id: number
  account_id: number
  plaid_transaction_id: string
  plaid_date: string
  plaid_payee: string
  plaid_amount: number
  plaid_check_number: string | null
  match_transaction_id: number | null
  match_reason: string | null
  match_confidence: number | null
  match_payee: string | null
  match_date: string | null
  status: 'auto_matched' | 'needs_review' | 'new'
}

export interface SyncQueueProps {
  accountName: string
  rows: QueueRow[]
  onHighlight: (txId: number | null) => void
  onQueueChange: () => void
  onPickModeChange: (queueRowId: number | null) => void
}

function fmtAmt(amount: number): string {
  const abs = Math.abs(amount).toFixed(2)
  return amount < 0 ? `-$${abs}` : `$${abs}`
}

function confidenceLabel(row: QueueRow): string {
  if (row.match_confidence == null) return ''
  const pct = Math.round(row.match_confidence * 100)
  if (row.match_confidence >= 0.92) return `${pct}% — strong match`
  if (row.match_confidence >= 0.70) return `${pct}% — likely match`
  return `${pct}% — possible match`
}

export default function SyncQueue({ accountName, rows, onHighlight, onQueueChange, onPickModeChange }: SyncQueueProps) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [pickModeId, setPickModeId] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (rows.length === 0) return null

  if (collapsed) {
    return (
      <div className="border-b border-blue-200 bg-blue-50 px-3 py-2 flex justify-between items-center text-sm">
        <span className="text-blue-800 font-medium">{rows.length} transaction{rows.length !== 1 ? 's' : ''} pending review</span>
        <button onClick={() => setCollapsed(false)} className="text-blue-600 hover:underline text-xs">Show</button>
      </div>
    )
  }

  async function callApi(path: string, body?: Record<string, unknown>) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
    }
    return res.json()
  }

  async function withErrorHandling(fn: () => Promise<void>) {
    try { await fn() } catch (e) { setActionError((e as Error).message) }
  }

  function clearSelection() {
    setSelectedId(null)
    setPickModeId(null)
    onHighlight(null)
    onPickModeChange(null)
  }

  async function handleAccept(row: QueueRow, forceNew = false) {
    await withErrorHandling(async () => {
      await callApi(`/api/sync/queue/${row.id}/accept`, forceNew ? { force_new: true } : undefined)
      clearSelection()
      onQueueChange()
    })
  }

  async function handleReject(row: QueueRow) {
    await withErrorHandling(async () => {
      await callApi(`/api/sync/queue/${row.id}/reject`)
      clearSelection()
      onQueueChange()
    })
  }

  async function handleUndo(row: QueueRow) {
    await withErrorHandling(async () => {
      await callApi(`/api/sync/queue/${row.id}/undo-match`)
      onQueueChange()
    })
  }

  async function handleAcceptAll() {
    await withErrorHandling(async () => {
      await callApi('/api/sync/queue/accept-all', { account_id: rows[0]?.account_id })
      clearSelection()
      setCollapsed(true)
      onQueueChange()
    })
  }

  function enterPickMode(row: QueueRow) {
    setPickModeId(row.id)
    onPickModeChange(row.id)
  }

  function exitPickMode() {
    setPickModeId(null)
    onPickModeChange(null)
  }

  function selectRow(row: QueueRow) {
    if (row.status === 'new') return
    const newId = selectedId === row.id ? null : row.id
    setSelectedId(newId)
    onHighlight(newId !== null ? (row.match_transaction_id ?? null) : null)
    if (pickModeId !== null && newId === null) exitPickMode()
  }

  return (
    <div>
      {/* Header */}
      <div className="bg-blue-900 text-white px-3 py-2 flex justify-between items-center text-sm">
        <span className="font-semibold">
          {rows.length} transaction{rows.length !== 1 ? 's' : ''} downloaded from Plaid · {accountName}
        </span>
        <div className="flex gap-2">
          <button
            onClick={handleAcceptAll}
            className="text-xs bg-white bg-opacity-20 hover:bg-opacity-30 text-white px-3 py-1 rounded"
          >
            Accept all &amp; close
          </button>
          <button
            onClick={() => { clearSelection(); setCollapsed(true) }}
            className="text-xs text-white opacity-70 hover:opacity-100 px-2 py-1 border border-white border-opacity-30 rounded"
          >
            ✕
          </button>
        </div>
      </div>

      {actionError && (
        <div className="bg-red-50 border-b border-red-200 text-red-700 text-xs px-3 py-1 flex justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="underline ml-2">Dismiss</button>
        </div>
      )}

      {/* Column headers */}
      <div className="flex gap-2 px-3 py-1 bg-blue-100 text-blue-800 text-xs font-bold tracking-wide border-b border-blue-200">
        <span className="w-20">DATE</span>
        <span className="flex-1">PAYEE (from Plaid)</span>
        <span className="w-20 text-right">AMOUNT</span>
        <span className="w-56 pl-2">STATUS &amp; ACTION</span>
      </div>

      {/* Rows */}
      {rows.map(row => {
        const isSelected = selectedId === row.id
        const inPick = pickModeId === row.id
        const isDimmed = selectedId !== null && !isSelected

        const baseBg = row.status === 'auto_matched' ? 'bg-green-50' : 'bg-white'
        const selectedStyle = isSelected ? 'bg-amber-50 border-l-4 border-amber-400' : baseBg

        return (
          <div key={row.id} className={`${selectedStyle} ${isDimmed ? 'opacity-40' : ''} border-b border-gray-100`}>
            <div
              className={`flex gap-2 items-center px-3 py-1.5 text-sm ${row.status !== 'new' ? 'cursor-pointer' : ''}`}
              onClick={() => selectRow(row)}
            >
              <span className="w-20 text-gray-500 text-xs">{row.plaid_date}</span>
              <span className={`flex-1 font-medium ${isSelected ? 'text-amber-900' : ''}`}>{row.plaid_payee}</span>
              <span className={`w-20 text-right font-mono text-xs ${row.plaid_amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {fmtAmt(row.plaid_amount)}
              </span>
              <div className="w-56 pl-2 flex items-center gap-1 text-xs">
                {row.status === 'auto_matched' && (
                  <>
                    <span className="bg-green-600 text-white px-1.5 py-0.5 rounded whitespace-nowrap">✓ matched</span>
                    <span className="text-gray-500 truncate">→ {row.match_payee}</span>
                    <button
                      onClick={e => { e.stopPropagation(); handleUndo(row) }}
                      className="text-gray-400 hover:text-gray-600 underline ml-1 shrink-0"
                    >undo</button>
                  </>
                )}
                {row.status === 'needs_review' && (
                  <>
                    <span className="bg-amber-400 text-white px-1.5 py-0.5 rounded whitespace-nowrap">⚡ review</span>
                    <span className="text-amber-700 truncate">{confidenceLabel(row)}{row.match_payee ? ` — ${row.match_payee}` : ''}</span>
                  </>
                )}
                {row.status === 'new' && (
                  <>
                    <span className="bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded whitespace-nowrap">new</span>
                    <button
                      onClick={e => { e.stopPropagation(); handleAccept(row) }}
                      className="text-xs bg-green-600 text-white px-2 py-0.5 rounded hover:bg-green-700 shrink-0"
                    >✓ Add</button>
                    <button
                      onClick={e => { e.stopPropagation(); handleReject(row) }}
                      className="text-red-500 hover:text-red-700 ml-1 shrink-0"
                    >✕ skip</button>
                  </>
                )}
              </div>
            </div>

            {/* Inline actions — needs_review selected, not in pick mode */}
            {isSelected && row.status === 'needs_review' && !inPick && (
              <div className="px-3 pb-2 flex gap-2 flex-wrap">
                <button onClick={() => handleAccept(row)} className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">✓ Yes, merge</button>
                <button onClick={() => handleAccept(row, true)} className="text-xs bg-white text-gray-700 border border-gray-300 px-3 py-1 rounded hover:bg-gray-50">Add as new</button>
                <button onClick={() => enterPickMode(row)} className="text-xs bg-white text-gray-700 border border-gray-300 px-3 py-1 rounded hover:bg-gray-50">Merge with…</button>
                <button onClick={() => handleReject(row)} className="text-xs bg-white text-red-600 border border-red-300 px-3 py-1 rounded hover:bg-red-50">Discard</button>
              </div>
            )}

            {/* Pick mode message */}
            {isSelected && inPick && (
              <div className="px-3 pb-2 flex items-center gap-3 text-xs text-amber-800">
                <span>Scroll down and tap a transaction to merge with.</span>
                <button onClick={exitPickMode} className="underline text-gray-500">Cancel</button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
