import { useState } from 'react'

interface Category {
  id: number
  name: string
  parent_id: number | null
  parent_name: string | null
  is_system: number
  is_active: number
  sort_order: number
}

interface Props {
  categories: Category[]
  onClose: () => void
  onChanged: () => void
}

export default function CategoryPanel({ categories, onClose, onChanged }: Props) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [addingParentId, setAddingParentId] = useState<number | null | undefined>(undefined)
  const [newName, setNewName] = useState('')
  const [showAddTop, setShowAddTop] = useState(false)
  const [error, setError] = useState('')

  const parents = categories
    .filter(c => c.parent_id === null && c.is_system === 0)
    .sort((a, b) => a.sort_order - b.sort_order)
  const uncategorized = categories.find(c => c.is_system === 1)

  function childrenOf(parentId: number) {
    return categories
      .filter(c => c.parent_id === parentId)
      .sort((a, b) => a.sort_order - b.sort_order)
  }

  async function rename(id: number) {
    if (!editName.trim()) return
    const r = await fetch(`/api/categories/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim() }),
    })
    if (r.ok) {
      setEditingId(null)
      setEditName('')
      onChanged()
    } else {
      const body = await r.json()
      setError(body.error ?? 'Rename failed')
    }
  }

  async function deactivate(id: number) {
    const r = await fetch(`/api/categories/${id}`, { method: 'DELETE' })
    if (r.ok) {
      onChanged()
    } else {
      const body = await r.json()
      setError(body.error ?? 'Remove failed')
    }
  }

  async function addCategory(name: string, parentId: number | null) {
    if (!name.trim()) return
    const payload: { name: string; parent_id?: number } = { name: name.trim() }
    if (parentId !== null) payload.parent_id = parentId
    const r = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (r.ok) {
      setNewName('')
      setAddingParentId(undefined)
      setShowAddTop(false)
      onChanged()
    } else {
      const body = await r.json()
      setError(body.error ?? 'Add failed')
    }
  }

  async function swap(catA: Category, catB: Category) {
    await fetch('/api/categories/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        categories: [
          { id: catA.id, sort_order: catB.sort_order },
          { id: catB.id, sort_order: catA.sort_order },
        ],
      }),
    })
    onChanged()
  }

  function renderControls(cat: Category, siblings: Category[], isChild = false) {
    const idx = siblings.findIndex(c => c.id === cat.id)
    if (editingId === cat.id) {
      return (
        <div className={`flex items-center gap-2 py-1 ${isChild ? 'pl-4' : ''}`}>
          <input
            autoFocus
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') rename(cat.id)
              if (e.key === 'Escape') { setEditingId(null); setError('') }
            }}
            className="border rounded px-2 py-0.5 text-sm flex-1"
          />
          <button onClick={() => rename(cat.id)} className="text-xs text-indigo-600 hover:underline">Save</button>
          <button onClick={() => { setEditingId(null); setError('') }} className="text-xs text-gray-400 hover:underline">Cancel</button>
        </div>
      )
    }
    return (
      <div className={`flex items-center gap-1 py-1 ${isChild ? 'pl-4' : ''}`}>
        <span className="flex-1 text-sm">{cat.name}</span>
        <button
          onClick={() => idx > 0 && swap(cat, siblings[idx - 1])}
          disabled={idx === 0}
          className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1 text-xs"
          title="Move up"
        >↑</button>
        <button
          onClick={() => idx < siblings.length - 1 && swap(cat, siblings[idx + 1])}
          disabled={idx === siblings.length - 1}
          className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-1 text-xs"
          title="Move down"
        >↓</button>
        <button
          onClick={() => { setEditingId(cat.id); setEditName(cat.name) }}
          className="text-xs text-gray-500 hover:text-indigo-600 px-1"
        >Rename</button>
        <button
          onClick={() => deactivate(cat.id)}
          className="text-xs text-gray-500 hover:text-red-600 px-1"
        >Remove</button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-80 bg-white shadow-xl overflow-y-auto flex flex-col">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="font-semibold">Manage Categories</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        {error && (
          <div className="mx-4 mt-3 p-2 bg-red-50 text-red-700 text-xs rounded flex justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="underline ml-2">Dismiss</button>
          </div>
        )}

        <div className="p-4 flex-1">
          {parents.map(parent => {
            const children = childrenOf(parent.id)
            return (
              <div key={parent.id} className="mb-4">
                <div className="border-b pb-1 mb-1 font-medium text-sm">
                  {renderControls(parent, parents)}
                </div>
                {children.map(child => renderControls(child, children, true))}
                {addingParentId === parent.id ? (
                  <div className="pl-4 flex gap-2 mt-1">
                    <input
                      autoFocus
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') addCategory(newName, parent.id)
                        if (e.key === 'Escape') setAddingParentId(undefined)
                      }}
                      placeholder="Category name"
                      className="border rounded px-2 py-0.5 text-sm flex-1"
                    />
                    <button onClick={() => addCategory(newName, parent.id)} className="text-xs text-indigo-600">Add</button>
                    <button onClick={() => setAddingParentId(undefined)} className="text-xs text-gray-400">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAddingParentId(parent.id); setNewName('') }}
                    className="pl-4 text-xs text-indigo-500 hover:underline mt-0.5"
                  >
                    + Add child
                  </button>
                )}
              </div>
            )
          })}

          {showAddTop ? (
            <div className="flex gap-2 mt-2">
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') addCategory(newName, null)
                  if (e.key === 'Escape') setShowAddTop(false)
                }}
                placeholder="New category name"
                className="border rounded px-2 py-0.5 text-sm flex-1"
              />
              <button onClick={() => addCategory(newName, null)} className="text-xs text-indigo-600">Add</button>
              <button onClick={() => setShowAddTop(false)} className="text-xs text-gray-400">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => { setShowAddTop(true); setNewName('') }}
              className="text-xs text-indigo-500 hover:underline mt-2"
            >
              + Add top-level category
            </button>
          )}

          {uncategorized && (
            <div className="mt-6 pt-4 border-t">
              <span className="text-sm text-gray-400 italic">{uncategorized.name}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
