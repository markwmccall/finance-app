import { useState, useRef, useEffect } from 'react'

interface Category {
  id: number
  name: string
  parent_id: number | null
  parent_name: string | null
}

interface Props {
  categories: Category[]
  value: number | null
  onChange: (categoryId: number) => void
  placeholder?: string
}

function displayName(cat: Category): string {
  return cat.parent_name ? `${cat.parent_name} · ${cat.name}` : cat.name
}

export default function CategoryPicker({ categories, value, onChange, placeholder = 'Select category' }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = value !== null ? categories.find(c => c.id === value) : null

  const filtered = search.length === 0
    ? categories
    : categories.filter(c => displayName(c).toLowerCase().includes(search.toLowerCase()))

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function handleSelect(cat: Category) {
    onChange(cat.id)
    setOpen(false)
    setSearch('')
  }

  function handleButtonClick() {
    setOpen(prev => !prev)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleButtonClick}
        className="w-full text-left border rounded px-2 py-1 text-sm bg-white flex justify-between items-center gap-1"
      >
        <span className={selected ? '' : 'text-gray-400'}>
          {selected ? displayName(selected) : placeholder}
        </span>
        <span className="text-gray-400 text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] bg-white border rounded shadow-lg">
          <div className="p-2 border-b">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full text-sm border rounded px-2 py-1 outline-none"
            />
          </div>
          <ul className="max-h-52 overflow-y-auto">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-400">No matches</li>
            )}
            {filtered.map(cat => (
              <li
                key={cat.id}
                onMouseDown={() => handleSelect(cat)}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-indigo-50 ${cat.id === value ? 'bg-indigo-100 font-medium' : ''}`}
              >
                {displayName(cat)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
