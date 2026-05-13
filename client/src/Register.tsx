import { useEffect, useState, useCallback } from 'react'

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

export default function Register() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [selectedAccount, setSelectedAccount] = useState<number | ''>('')
  const [selectedCategory, setSelectedCategory] = useState<number | ''>('')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const limit = 50

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
    params.set('limit', String(limit))
    params.set('offset', String(offset))
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
  }, [selectedAccount, selectedCategory, offset])

  useEffect(() => {
    setOffset(0)
  }, [selectedAccount, selectedCategory])

  useEffect(() => {
    const ctrl = new AbortController()
    loadTransactions(ctrl.signal)
    return () => ctrl.abort()
  }, [loadTransactions])

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

  const parentCategories = categories.filter(c => c.parent_id === null && c.is_system === 0)
  const childCategories = categories.filter(c => c.parent_id !== null)

  return (
    <div className="p-4">
      {error && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
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
            onClick={() => {/* wired in Task 9 */}}
          >
            ⚙
          </button>
        </div>

        <button
          onClick={() => {/* wired in Task 8 */}}
          className="bg-indigo-600 text-white text-sm px-3 py-1 rounded hover:bg-indigo-700"
        >
          + Add Transaction
        </button>

        <span className="ml-auto text-sm text-gray-500">{total} transactions</span>
      </div>

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
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400 text-sm">Loading…</td></tr>
            ) : transactions.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400 text-sm">No transactions match these filters.</td></tr>
            ) : transactions.map(tx => (
              <tr key={tx.id} className="border-b hover:bg-gray-50">
                <td className="py-2 pr-4 text-gray-600">{tx.date}</td>
                <td className="py-2 pr-4 font-medium">{tx.payee}</td>
                <td className="py-2 pr-4 text-gray-600">{categoryLabel(tx)}</td>
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
              </tr>
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
          <div key={tx.id} className="bg-white rounded border p-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{tx.payee}</div>
              <div className="text-xs text-gray-500">{tx.date} · {fmtBalance(tx.running_balance)}</div>
              <div className="text-xs text-gray-400 mt-0.5">{categoryLabel(tx)}</div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`font-mono text-sm ${tx.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {fmtAmount(tx.amount)}
              </span>
              <button
                onClick={() => toggleCleared(tx)}
                className={`w-6 h-6 rounded border-2 flex items-center justify-center ${tx.is_cleared ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-400'}`}
              >
                {tx.is_cleared ? '✓' : ''}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="mt-4 flex gap-2 justify-center">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
            className="px-3 py-1 text-sm border rounded disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-sm text-gray-500 self-center">
            {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <button
            disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}
            className="px-3 py-1 text-sm border rounded disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
