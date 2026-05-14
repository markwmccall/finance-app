import { useEffect, useRef, useState, useCallback, Fragment } from 'react'
import CategoryPicker from './CategoryPicker'
import CategoryPanel from './CategoryPanel'
import TransactionEditor from './TransactionEditor'
import SyncQueue, { type QueueRow } from './SyncQueue'

interface Account {
  id: number
  name: string
  type: string
  current_balance: number
}

interface Category {
  id: number
  name: string
  parent_id: number | null
  parent_name: string | null
  is_system: 0 | 1
  is_active: 0 | 1
  sort_order: number
}

interface Split {
  id: number
  category_id: number
  category_name: string
  parent_category_name: string | null
  amount: number
}

interface Transaction {
  id: number
  account_id: number
  account_name: string
  date: string
  payee: string
  check_number: string | null
  amount: number
  is_cleared: 0 | 1
  is_manual: 0 | 1
  splits: Split[]
  running_balance: number
}

function fmtAmount(amount: number): string {
  const abs = Math.abs(amount).toFixed(2)
  return amount < 0 ? `-$${abs}` : `$${abs}`
}

function fmtBalance(balance: number): string {
  return `$${balance.toFixed(2)}`
}

function categoryLabel(tx: Transaction): string {
  if (tx.splits.length === 0) return 'Uncategorized'
  if (tx.splits.length === 1) return tx.splits[0].category_name
  return 'Split →'
}

interface SplitDraft {
  category_id: number | null
  amount: string
}

interface SplitEditorProps {
  tx: Transaction
  categories: Category[]
  onSaved: () => void
}

function SplitEditor({ tx, categories, onSaved }: SplitEditorProps) {
  const leafCategories = categories.filter(
    c => !categories.some(other => other.parent_id === c.id)
  )
  const uncategorized = categories.find(c => c.name === 'Uncategorized')

  const initialDrafts: SplitDraft[] = tx.splits.length > 0
    ? tx.splits.map(s => ({ category_id: s.category_id, amount: s.amount.toFixed(2) }))
    : [{ category_id: uncategorized?.id ?? null, amount: tx.amount.toFixed(2) }]

  const [drafts, setDrafts] = useState<SplitDraft[]>(initialDrafts)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const assignedSum = drafts.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0)
  const remainder = parseFloat((tx.amount - assignedSum).toFixed(2))

  function updateDraft(i: number, patch: Partial<SplitDraft>) {
    setDrafts(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d))
  }

  function addRow() {
    setDrafts(prev => [...prev, { category_id: null, amount: '' }])
  }

  function removeRow(i: number) {
    setDrafts(prev => prev.filter((_, idx) => idx !== i))
  }

  function autoFillRemainder() {
    if (!uncategorized || Math.abs(remainder) < 0.001) return
    setDrafts(prev => [...prev, { category_id: uncategorized.id, amount: remainder.toFixed(2) }])
  }

  async function save() {
    if (Math.abs(remainder) > 0.001) {
      setError(`Remaining $${remainder.toFixed(2)} must be $0.00 before saving`)
      return
    }
    if (drafts.some(d => d.category_id === null)) {
      setError('All rows must have a category selected')
      return
    }
    setSaving(true)
    setError('')
    try {
      const r = await fetch(`/api/transactions/${tx.id}/splits`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          splits: drafts.map(d => ({ category_id: d.category_id, amount: parseFloat(d.amount) })),
        }),
      })
      if (!r.ok) {
        const body = await r.json()
        setError(body.error ?? 'Save failed')
      } else {
        onSaved()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 p-3 bg-gray-50 rounded border text-sm">
      <div className="space-y-2">
        {drafts.map((draft, i) => (
          <div key={i} className="flex gap-2 items-center">
            <div className="flex-1">
              <CategoryPicker
                categories={leafCategories}
                value={draft.category_id}
                onChange={catId => updateDraft(i, { category_id: catId })}
              />
            </div>
            <input
              type="number"
              step="0.01"
              value={draft.amount}
              onChange={e => updateDraft(i, { amount: e.target.value })}
              className="w-28 border rounded px-2 py-1 text-right text-sm font-mono"
            />
            {drafts.length > 1 && (
              <button
                onClick={() => removeRow(i)}
                className="text-gray-400 hover:text-red-500 text-lg leading-none"
                title="Remove row"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-3 flex-wrap">
        <button onClick={addRow} className="text-indigo-600 text-xs hover:underline">+ Add row</button>
        {Math.abs(remainder) > 0.001 && (
          <>
            <span className={`text-xs font-mono ${remainder < 0 ? 'text-red-500' : 'text-amber-600'}`}>
              Remaining: {remainder > 0 ? '+' : ''}{remainder.toFixed(2)}
            </span>
            <button onClick={autoFillRemainder} className="text-xs text-gray-500 hover:underline">
              Auto-fill to Uncategorized
            </button>
          </>
        )}
        {Math.abs(remainder) <= 0.001 && (
          <span className="text-xs text-green-600">✓ Balanced</span>
        )}
        <button
          onClick={save}
          disabled={saving || Math.abs(remainder) > 0.001}
          className="ml-auto bg-indigo-600 text-white text-xs px-3 py-1 rounded disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
    </div>
  )
}

interface ManualEntryFormProps {
  accounts: Account[]
  categories: Category[]
  onSaved: () => void
  onCancel: () => void
}

function ManualEntryForm({ accounts, categories, onSaved, onCancel }: ManualEntryFormProps) {
  const today = new Date().toISOString().slice(0, 10)
  const uncategorized = categories.find(c => c.name === 'Uncategorized')
  const leafCategories = categories.filter(
    c => !categories.some(other => other.parent_id === c.id)
  )

  const [date, setDate] = useState(today)
  const [payee, setPayee] = useState('')
  const [accountId, setAccountId] = useState<number | ''>(accounts[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [checkNumber, setCheckNumber] = useState('')
  const [drafts, setDrafts] = useState<SplitDraft[]>([
    { category_id: uncategorized?.id ?? null, amount: '' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const parsedAmount = parseFloat(amount) || 0
  const assignedSum = drafts.reduce((sum, d) => sum + (parseFloat(d.amount) || 0), 0)
  const remainder = parseFloat((parsedAmount - assignedSum).toFixed(2))

  function updateDraft(i: number, patch: Partial<SplitDraft>) {
    setDrafts(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d))
  }

  function addRow() {
    setDrafts(prev => [...prev, { category_id: null, amount: '' }])
  }

  function removeRow(i: number) {
    setDrafts(prev => prev.filter((_, idx) => idx !== i))
  }

  function autoFill() {
    if (!uncategorized || Math.abs(remainder) < 0.001) return
    setDrafts(prev => [...prev, { category_id: uncategorized.id, amount: remainder.toFixed(2) }])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!payee.trim()) { setError('Payee is required'); return }
    if (accountId === '') { setError('Account is required'); return }
    if (!parsedAmount) { setError('Amount is required'); return }
    if (drafts.some(d => d.category_id === null)) { setError('All splits need a category'); return }
    if (Math.abs(remainder) > 0.001) { setError('Splits must sum to transaction amount'); return }

    setSaving(true)
    setError('')
    try {
      const r = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: Number(accountId),
          date,
          payee: payee.trim(),
          amount: parsedAmount,
          check_number: checkNumber.trim() || null,
          splits: drafts.map(d => ({
            category_id: d.category_id,
            amount: parseFloat(d.amount),
          })),
        }),
      })
      if (!r.ok) {
        const body = await r.json()
        setError(body.error ?? 'Save failed')
      } else {
        onSaved()
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-4 p-4 border rounded bg-white shadow-sm">
      <h3 className="font-semibold text-sm mb-3">New Transaction</h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Payee</label>
          <input
            type="text"
            value={payee}
            onChange={e => setPayee(e.target.value)}
            placeholder="Payee"
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Account</label>
          <select
            value={accountId}
            onChange={e => setAccountId(Number(e.target.value))}
            className="w-full border rounded px-2 py-1 text-sm"
          >
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Amount (– for expense)</label>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={e => {
              setAmount(e.target.value)
              const val = parseFloat(e.target.value) || 0
              setDrafts([{ category_id: uncategorized?.id ?? null, amount: val ? val.toFixed(2) : '' }])
            }}
            placeholder="-50.00"
            className="w-full border rounded px-2 py-1 text-sm font-mono text-right"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Check #</label>
          <input
            type="text"
            value={checkNumber}
            onChange={e => setCheckNumber(e.target.value)}
            placeholder="Optional"
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
      </div>

      <div className="text-xs text-gray-500 mb-1 font-medium">Splits</div>
      <div className="space-y-2 mb-2">
        {drafts.map((draft, i) => (
          <div key={i} className="flex gap-2 items-center">
            <div className="flex-1">
              <CategoryPicker
                categories={leafCategories}
                value={draft.category_id}
                onChange={catId => updateDraft(i, { category_id: catId })}
              />
            </div>
            <input
              type="number"
              step="0.01"
              value={draft.amount}
              onChange={e => updateDraft(i, { amount: e.target.value })}
              className="w-28 border rounded px-2 py-1 text-right text-sm font-mono"
            />
            {drafts.length > 1 && (
              <button type="button" onClick={() => removeRow(i)} className="text-gray-400 hover:text-red-500 text-lg">×</button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-3">
        <button type="button" onClick={addRow} className="text-indigo-600 text-xs hover:underline">+ Add row</button>
        {Math.abs(remainder) > 0.001 && parsedAmount !== 0 && (
          <>
            <span className={`text-xs font-mono ${remainder < 0 ? 'text-red-500' : 'text-amber-600'}`}>
              Remaining: {remainder > 0 ? '+' : ''}{remainder.toFixed(2)}
            </span>
            <button type="button" onClick={autoFill} className="text-xs text-gray-500 hover:underline">
              Auto-fill to Uncategorized
            </button>
          </>
        )}
        {parsedAmount !== 0 && Math.abs(remainder) <= 0.001 && (
          <span className="text-xs text-green-600">✓ Balanced</span>
        )}
      </div>

      {error && <div className="text-xs text-red-600 mb-2">{error}</div>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm px-4 py-1.5 rounded border hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

const INITIAL_TX_LIMIT = 500

export default function Register() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [selectedAccount, setSelectedAccount] = useState<number | ''>('')
  const [selectedCategory, setSelectedCategory] = useState<number | ''>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedTxId, setExpandedTxId] = useState<number | null>(null)
  const [editingTxId, setEditingTxId] = useState<number | null>(null)
  const [showEntryForm, setShowEntryForm] = useState(false)
  const [showCategoryPanel, setShowCategoryPanel] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const pendingScrollToTxId = useRef<number | null>(null)
  const [queue, setQueue] = useState<QueueRow[]>([])
  const [queueSummary, setQueueSummary] = useState<Array<{ account_id: number; account_name: string; total: number }>>([])
  const [highlightTxId, setHighlightTxId] = useState<number | null>(null)
  const [pickModeQueueRowId, setPickModeQueueRowId] = useState<number | null>(null)

  useEffect(() => {
    if (!loading && pendingScrollToTxId.current !== null) {
      const id = pendingScrollToTxId.current
      pendingScrollToTxId.current = null
      const el = Array.from(document.querySelectorAll(`[data-tx-id="${id}"]`))
        .find(e => (e as HTMLElement).offsetParent !== null) as HTMLElement | undefined
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [loading])

  useEffect(() => {
    Promise.all([
      fetch('/api/accounts').then(r => { if (!r.ok) throw new Error(`accounts: HTTP ${r.status}`); return r.json() }),
      fetch('/api/categories').then(r => { if (!r.ok) throw new Error(`categories: HTTP ${r.status}`); return r.json() }),
    ])
      .then(([accts, cats]) => {
        setAccounts(accts)
        setCategories(cats)
      })
      .catch(err => setError(String(err)))
  }, [])

  const loadTransactions = useCallback((signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (selectedAccount !== '') params.set('account_id', String(selectedAccount))
    if (selectedCategory !== '') params.set('category_id', String(selectedCategory))
    params.set('limit', String(INITIAL_TX_LIMIT))
    params.set('offset', '0')
    setLoading(true)
    fetch(`/api/transactions?${params}`, { signal })
      .then(r => { if (!r.ok) throw new Error(`transactions: HTTP ${r.status}`); return r.json() })
      .then(data => {
        setTransactions(data.transactions)
        setTotal(data.total)
        setError(null)
      })
      .catch(err => {
        if ((err as Error).name !== 'AbortError') setError(String(err))
      })
      .finally(() => setLoading(false))
  }, [selectedAccount, selectedCategory])

  useEffect(() => {
    const ctrl = new AbortController()
    loadTransactions(ctrl.signal)
    return () => ctrl.abort()
  }, [loadTransactions])

  const loadQueue = useCallback(() => {
    fetch('/api/sync/queue')
      .then(r => r.json())
      .then(data => {
        type AccountBucket = { account_id: number; account_name: string; auto_matched: QueueRow[]; needs_review: QueueRow[]; new: QueueRow[] }
        const allAccounts = data.accounts as AccountBucket[]
        setQueueSummary(
          allAccounts
            .map(a => ({ account_id: a.account_id, account_name: a.account_name, total: a.auto_matched.length + a.needs_review.length + a.new.length }))
            .filter(a => a.total > 0)
        )
        const acct = allAccounts.find(a => a.account_id === selectedAccount)
        setQueue(acct ? [...acct.auto_matched, ...acct.needs_review, ...acct.new] : [])
      })
      .catch(() => { setQueue([]); setQueueSummary([]) })
  }, [selectedAccount])

  useEffect(() => {
    loadQueue()
  }, [loadQueue])

  async function handleMergeWithTx(transactionId: number) {
    if (pickModeQueueRowId == null) return
    try {
      const res = await fetch(`/api/sync/queue/${pickModeQueueRowId}/merge-with`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: transactionId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError((data as { error?: string }).error ?? `Merge failed: HTTP ${res.status}`)
        return
      }
      setPickModeQueueRowId(null)
      setHighlightTxId(null)
      loadQueue()
    } catch (e) {
      setError(String(e))
    }
  }

  async function toggleCleared(tx: Transaction) {
    const prev = transactions
    setTransactions(txs =>
      txs.map(t => t.id === tx.id ? { ...t, is_cleared: (t.is_cleared ? 0 : 1) as 0 | 1 } : t)
    )
    const res = await fetch(`/api/transactions/${tx.id}/cleared`, { method: 'PATCH' })
    if (!res.ok) {
      setTransactions(prev)
      setError(`Failed to update cleared status: HTTP ${res.status}`)
    }
  }

  function loadOlderTransactions() {
    const params = new URLSearchParams()
    if (selectedAccount !== '') params.set('account_id', String(selectedAccount))
    if (selectedCategory !== '') params.set('category_id', String(selectedCategory))
    params.set('offset', String(transactions.length))
    params.set('limit', String(total - transactions.length))
    setLoadingMore(true)
    fetch(`/api/transactions?${params}`)
      .then(r => { if (!r.ok) throw new Error(`transactions: HTTP ${r.status}`); return r.json() })
      .then(data => {
        setTransactions(prev => [...prev, ...data.transactions])
        setError(null)
      })
      .catch(err => setError(String(err)))
      .finally(() => setLoadingMore(false))
  }

  const parentCategories = categories.filter(c => c.parent_id === null && c.is_system === 0)
  const childCategories = categories.filter(c => c.parent_id !== null)

  return (
    <div className="p-4">
      {error && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {queue.length > 0 && (
        <SyncQueue
          accountName={accounts.find(a => a.id === selectedAccount)?.name ?? ''}
          rows={queue}
          onHighlight={setHighlightTxId}
          onQueueChange={() => { loadQueue(); loadTransactions() }}
          onPickModeChange={setPickModeQueueRowId}
        />
      )}

      {queueSummary.length > 0 && queue.length === 0 && (
        <div className="mb-3 flex items-center gap-2 flex-wrap text-sm bg-amber-50 border border-amber-200 rounded px-3 py-2">
          <span className="text-amber-800 font-medium">Pending review:</span>
          {queueSummary.map(s => (
            <button
              key={s.account_id}
              onClick={() => setSelectedAccount(s.account_id)}
              className="text-indigo-600 hover:underline"
            >
              {s.account_name} ({s.total})
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <select
          className="border rounded px-2 py-1 text-sm"
          value={selectedAccount}
          onChange={e => setSelectedAccount(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">All Accounts</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <select
            className="border rounded px-2 py-1 text-sm"
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">All Categories</option>
            {parentCategories.map(p => (
              <optgroup key={p.id} label={p.name}>
                <option value={p.id}>{p.name} (all)</option>
                {childCategories
                  .filter(c => c.parent_id === p.id)
                  .map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
              </optgroup>
            ))}
          </select>
          <button
            className="p-1 rounded hover:bg-gray-100 text-gray-500"
            title="Manage categories"
            onClick={() => setShowCategoryPanel(true)}
          >
            ⚙
          </button>
        </div>

        <button
          onClick={() => setShowEntryForm(true)}
          className="bg-indigo-600 text-white text-sm px-3 py-1 rounded hover:bg-indigo-700"
        >
          + Add Transaction
        </button>

        <span className="ml-auto text-sm text-gray-500">{total} transactions</span>
      </div>

      {showEntryForm && (
        <ManualEntryForm
          accounts={accounts}
          categories={categories}
          onSaved={() => { loadTransactions(); setShowEntryForm(false) }}
          onCancel={() => setShowEntryForm(false)}
        />
      )}

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-2 pr-4 font-medium">Date</th>
              <th className="py-2 pr-4 font-medium">Payee</th>
              <th className="py-2 pr-4 font-medium">Category</th>
              <th className="py-2 pr-4 font-medium text-right">Amount</th>
              <th className="py-2 pr-4 font-medium text-right">Balance</th>
              <th className="py-2 font-medium text-center">Cleared</th>
              <th className="py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="py-8 text-center text-gray-400 text-sm">Loading…</td></tr>
            ) : transactions.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-gray-400 text-sm">No transactions match these filters.</td></tr>
            ) : transactions.map(tx => (
              <Fragment key={tx.id}>
                <tr
                  className={`border-b group ${
                    highlightTxId === tx.id
                      ? 'bg-amber-50 border-l-4 border-amber-400'
                      : highlightTxId !== null
                      ? 'opacity-30'
                      : 'hover:bg-gray-50'
                  }`}
                  data-tx-id={tx.id}
                >
                  <td className="py-2 pr-4 text-gray-600">{tx.date}</td>
                  <td className="py-2 pr-4 font-medium">
                    {tx.payee}
                    {tx.check_number && (
                      <span className="text-gray-400 text-xs ml-1">· Check #{tx.check_number}</span>
                    )}
                  </td>
                  <td
                    className="py-2 pr-4 text-gray-600 cursor-pointer hover:text-indigo-600"
                    onClick={() => { setExpandedTxId(prev => prev === tx.id ? null : tx.id); setEditingTxId(null) }}
                  >
                    {categoryLabel(tx)}
                  </td>
                  <td className={`py-2 pr-4 text-right font-mono ${tx.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {fmtAmount(tx.amount)}
                  </td>
                  <td className="py-2 pr-4 text-right font-mono text-gray-700">
                    {fmtBalance(tx.running_balance)}
                  </td>
                  <td className="py-2 text-center">
                    <button
                      onClick={() => toggleCleared(tx)}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center mx-auto ${tx.is_cleared ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-400'}`}
                      title={tx.is_cleared ? 'Mark uncleared' : 'Mark cleared'}
                    >
                      {tx.is_cleared ? '✓' : ''}
                    </button>
                  </td>
                  <td className="py-2 text-center">
                    {pickModeQueueRowId !== null && (
                      <button
                        onClick={() => handleMergeWithTx(tx.id)}
                        className="text-xs bg-amber-500 text-white px-2 py-0.5 rounded hover:bg-amber-600"
                        title="Merge this transaction with the selected Plaid transaction"
                      >
                        ↑ merge
                      </button>
                    )}
                    {editingTxId !== tx.id && pickModeQueueRowId === null && (
                      <button
                        onClick={() => { setEditingTxId(tx.id); setExpandedTxId(null) }}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-indigo-600 text-sm px-1"
                        title="Edit transaction"
                      >
                        ✎
                      </button>
                    )}
                  </td>
                </tr>
                {expandedTxId === tx.id && (
                  <tr>
                    <td colSpan={7} className="px-4 pb-3">
                      <SplitEditor
                        tx={tx}
                        categories={categories}
                        onSaved={() => { loadTransactions(); setExpandedTxId(null) }}
                      />
                    </td>
                  </tr>
                )}
                {editingTxId === tx.id && (
                  <tr>
                    <td colSpan={7} className="px-4 pb-3">
                      <TransactionEditor
                        tx={tx}
                        onSaved={() => { pendingScrollToTxId.current = tx.id; loadTransactions(); setEditingTxId(null) }}
                        onCancel={() => setEditingTxId(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <p className="text-center text-gray-400 text-sm py-8">Loading…</p>
        ) : transactions.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-8">No transactions match these filters.</p>
        ) : transactions.map(tx => (
          <div
            key={tx.id}
            className={`rounded border ${
              highlightTxId === tx.id
                ? 'bg-amber-50 border-amber-400 border-l-4'
                : highlightTxId !== null
                ? 'opacity-30'
                : 'bg-white'
            }`}
            data-tx-id={tx.id}
          >
            <div
              className="p-3 flex items-start gap-3 cursor-pointer"
              onClick={() => { setExpandedTxId(prev => prev === tx.id ? null : tx.id); setEditingTxId(null) }}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">
                  {tx.payee}
                  {tx.check_number && (
                    <span className="text-gray-400 text-xs ml-1">· Check #{tx.check_number}</span>
                  )}
                </div>
                <div className="text-xs text-gray-500">{tx.date} · {fmtBalance(tx.running_balance)}</div>
                <div className="text-xs text-gray-400 mt-0.5">{categoryLabel(tx)}</div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`font-mono text-sm ${tx.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {fmtAmount(tx.amount)}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); toggleCleared(tx) }}
                  className={`w-6 h-6 rounded border-2 flex items-center justify-center ${tx.is_cleared ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-400'}`}
                >
                  {tx.is_cleared ? '✓' : ''}
                </button>
                {pickModeQueueRowId !== null && (
                  <button
                    onClick={e => { e.stopPropagation(); handleMergeWithTx(tx.id) }}
                    className="text-xs bg-amber-500 text-white px-2 py-0.5 rounded"
                  >
                    ↑ merge
                  </button>
                )}
                <button
                  onClick={e => { e.stopPropagation(); setEditingTxId(prev => prev === tx.id ? null : tx.id); setExpandedTxId(null) }}
                  className="text-gray-400 hover:text-indigo-600 text-sm px-1"
                  title="Edit transaction"
                >
                  ✎
                </button>
              </div>
            </div>
            {expandedTxId === tx.id && (
              <div className="px-3 pb-3 border-t">
                <SplitEditor
                  tx={tx}
                  categories={categories}
                  onSaved={() => { loadTransactions(); setExpandedTxId(null) }}
                />
              </div>
            )}
            {editingTxId === tx.id && (
              <div className="px-3 pb-3 border-t">
                <TransactionEditor
                  tx={tx}
                  onSaved={() => { loadTransactions(); setEditingTxId(null) }}
                  onCancel={() => setEditingTxId(null)}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {transactions.length > 0 && transactions.length < total && (
        <div className="mt-4 text-center">
          <button
            onClick={loadOlderTransactions}
            disabled={loadingMore}
            className="text-sm text-indigo-600 hover:underline disabled:opacity-40"
          >
            {loadingMore ? 'Loading…' : `Load ${total - transactions.length} older transactions`}
          </button>
        </div>
      )}

      {showCategoryPanel && (
        <CategoryPanel
          categories={categories}
          onClose={() => setShowCategoryPanel(false)}
          onChanged={() => {
            fetch('/api/categories').then(r => r.json()).then(setCategories)
            loadTransactions()
          }}
        />
      )}

    </div>
  )
}
