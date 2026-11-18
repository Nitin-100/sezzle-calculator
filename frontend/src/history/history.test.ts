import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HISTORY_KEY,
  MAX_HISTORY,
  addEntry,
  createBrowserStore,
  createEntry,
  parseHistory,
  type HistoryEntry,
} from './history'

const entry = (n: number): HistoryEntry => ({ id: String(n), expression: `${n} + 0`, result: n, createdAt: n })

function fakeStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('addEntry', () => {
  it('puts the newest entry first and keeps at most MAX_HISTORY', () => {
    const full = Array.from({ length: MAX_HISTORY }, (_, i) => entry(i))
    const next = addEntry(full, entry(999))
    expect(next).toHaveLength(MAX_HISTORY)
    expect(next[0].id).toBe('999')
    expect(next[next.length - 1].id).toBe(String(MAX_HISTORY - 2))
  })
})

describe('createEntry', () => {
  it('creates unique IDs even within the same millisecond', () => {
    expect(createEntry('1 + 1', 2, 1000).id).not.toBe(createEntry('1 + 1', 2, 1000).id)
  })
})

describe('parseHistory', () => {
  it.each([
    ['nothing stored', null],
    ['empty string', ''],
    ['invalid JSON', '{not json'],
    ['not an array', '{"id":"1"}'],
  ])('returns an empty list for %s', (_, raw) => {
    expect(parseHistory(raw)).toEqual([])
  })

  it('keeps valid entries and drops invalid ones', () => {
    const raw = JSON.stringify([
      entry(1),
      { ...entry(2), result: 'NaN' },
      null,
      { ...entry(3), expression: 'x'.repeat(201) },
      { id: '4', expression: '4', result: 4 },
      entry(5),
    ])
    expect(parseHistory(raw).map((e) => e.id)).toEqual(['1', '5'])
  })

  it('caps very long stored lists', () => {
    const raw = JSON.stringify(Array.from({ length: MAX_HISTORY + 10 }, (_, i) => entry(i)))
    expect(parseHistory(raw)).toHaveLength(MAX_HISTORY)
  })
})

describe('createBrowserStore', () => {
  it('saves and loads history, and removes the key when cleared', () => {
    const storage = fakeStorage()
    const store = createBrowserStore(() => storage)

    store.save([entry(1)])
    expect(createBrowserStore(() => storage).load()).toEqual([entry(1)])

    store.save([])
    expect(storage.getItem(HISTORY_KEY)).toBeNull()
  })

  it('works without persistence when storage is blocked', () => {
    const store = createBrowserStore(() => {
      throw new DOMException('Access denied', 'SecurityError')
    })
    expect(store.load()).toEqual([])
    expect(() => store.save([entry(1)])).not.toThrow()
  })

  it('ignores write failures such as a full quota', () => {
    const storage = fakeStorage()
    storage.setItem = () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    }
    expect(() => createBrowserStore(() => storage).save([entry(1)])).not.toThrow()
  })

  it('treats read failures as empty history', () => {
    const storage = fakeStorage()
    storage.getItem = () => {
      throw new Error('read failed')
    }
    expect(createBrowserStore(() => storage).load()).toEqual([])
  })

  it('reports changes made in other tabs for its key only', () => {
    const onChange = vi.fn()
    const unsubscribe = createBrowserStore(fakeStorage).subscribe(onChange)

    window.dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: '[]' }))
    window.dispatchEvent(new StorageEvent('storage', { key: HISTORY_KEY, newValue: JSON.stringify([entry(7)]) }))
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))

    expect(onChange.mock.calls).toEqual([[[entry(7)]], [[]]])

    unsubscribe()
    window.dispatchEvent(new StorageEvent('storage', { key: HISTORY_KEY, newValue: '[]' }))
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})
