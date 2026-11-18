export interface HistoryEntry {
  id: string
  // The calculation without the result, for example "12 / 4".
  expression: string
  result: number
  createdAt: number
}

// Where history is kept. The UI only knows this interface, so storage can be
// swapped (for example for a server API) without touching components.
export interface HistoryStore {
  load(): HistoryEntry[]
  save(entries: HistoryEntry[]): void
  // Calls onChange when another tab changes the history. Returns an unsubscribe function.
  subscribe(onChange: (entries: HistoryEntry[]) => void): () => void
}

// Versioned so a future format change can migrate or ignore old data.
export const HISTORY_KEY = 'calculator.history.v1'
export const MAX_HISTORY = 50
const MAX_EXPRESSION_LENGTH = 200

let sequence = 0

export function createEntry(expression: string, result: number, now = Date.now()): HistoryEntry {
  // crypto.randomUUID only exists on HTTPS and localhost. The random part keeps
  // IDs unique when two tabs add an entry in the same millisecond.
  sequence += 1
  const random = Math.random().toString(36).slice(2, 8)
  return { id: `${now.toString(36)}-${sequence.toString(36)}-${random}`, expression, result, createdAt: now }
}

export function addEntry(entries: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...entries].slice(0, MAX_HISTORY)
}

// Reads stored history defensively. Storage can hold anything: data from an
// older version, a manual edit, or a truncated write. Bad data is dropped
// instead of breaking the page.
export function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  return data.filter(isHistoryEntry).slice(0, MAX_HISTORY)
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Record<string, unknown>
  return (
    typeof e.id === 'string' &&
    typeof e.expression === 'string' &&
    e.expression.length <= MAX_EXPRESSION_LENGTH &&
    typeof e.result === 'number' &&
    Number.isFinite(e.result) &&
    typeof e.createdAt === 'number' &&
    Number.isFinite(e.createdAt)
  )
}

// Keeps history in the browser's localStorage. If storage is blocked (some
// privacy settings) or full, history still works for the open page and is
// simply not kept after a reload.
export function createBrowserStore(getStorage: () => Storage = () => window.localStorage): HistoryStore {
  let storage: Storage | null = null
  try {
    storage = getStorage()
  } catch {
    storage = null
  }

  return {
    load() {
      try {
        return parseHistory(storage?.getItem(HISTORY_KEY) ?? null)
      } catch {
        return []
      }
    },
    save(entries) {
      try {
        if (entries.length === 0) storage?.removeItem(HISTORY_KEY)
        else storage?.setItem(HISTORY_KEY, JSON.stringify(entries))
      } catch {
        // Quota exceeded or storage disabled; the in-memory history still works.
      }
    },
    subscribe(onChange) {
      const listener = (event: StorageEvent) => {
        // A null key means another tab cleared all storage.
        if (event.key === HISTORY_KEY || event.key === null) onChange(parseHistory(event.newValue))
      }
      window.addEventListener('storage', listener)
      return () => window.removeEventListener('storage', listener)
    },
  }
}
