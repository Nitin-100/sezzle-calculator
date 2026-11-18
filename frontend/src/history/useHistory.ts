import { useCallback, useEffect, useState } from 'react'
import { addEntry, createEntry, type HistoryEntry, type HistoryStore } from './history'

export function useHistory(store: HistoryStore) {
  const [entries, setEntries] = useState<HistoryEntry[]>(() => store.load())

  // Keeps several open tabs in step.
  useEffect(() => store.subscribe(setEntries), [store])

  const add = useCallback(
    (expression: string, result: number) => {
      const entry = createEntry(expression, result)
      setEntries((prev) => {
        const next = addEntry(prev, entry)
        // Saving inside the updater uses the latest list even when results arrive
        // back to back. React strict mode runs updaters twice; both runs save the same list.
        store.save(next)
        return next
      })
    },
    [store],
  )

  const clear = useCallback(() => {
    store.save([])
    setEntries([])
  }, [store])

  return { entries, add, clear }
}
