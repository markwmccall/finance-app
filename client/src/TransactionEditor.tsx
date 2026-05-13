import { useState } from 'react'

interface Split {
  amount: number
}

interface TransactionForEditor {
  id: number
  date: string
  payee: string
  amount: number
  check_number: string | null
  splits: Split[]
}

interface TransactionEditorProps {
  tx: TransactionForEditor
  onSaved: () => void
  onCancel: () => void
}

export default function TransactionEditor({ tx, onSaved, onCancel }: TransactionEditorProps) {
  const [date, setDate] = useState(tx.date)
  const [payee, setPayee] = useState(tx.payee)
  const [amount, setAmount] = useState(tx.amount.toFixed(2))
  const [checkNumber, setCheckNumber] = useState(tx.check_number ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const parsedAmount = parseFloat(amount) || 0
  const splitSum = tx.splits.reduce((s, sp) => s + sp.amount, 0)
  const remainder = parseFloat((parsedAmount - splitSum).toFixed(2))

  async function save() {
    if (Math.abs(remainder) > 0.001) return
    setSaving(true)
    setError('')
    try {
      const r = await fetch(`/api/transactions/${tx.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          payee: payee.trim(),
          amount: parsedAmount,
          check_number: checkNumber.trim() || null,
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
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
            className="w-full border rounded px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Amount (– for expense)</label>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm font-mono"
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
      {Math.abs(remainder) > 0.001 && (
        <div className={`text-xs font-mono mb-2 ${remainder < 0 ? 'text-red-500' : 'text-amber-600'}`}>
          Remaining: {remainder > 0 ? '+' : ''}{remainder.toFixed(2)} — update splits before changing amount
        </div>
      )}
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-sm px-3 py-1 border rounded text-gray-600 hover:bg-gray-100"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving || Math.abs(remainder) > 0.001}
          className="text-sm px-3 py-1 bg-indigo-600 text-white rounded disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
    </div>
  )
}
