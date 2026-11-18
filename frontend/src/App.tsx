import { useCallback } from 'react'
import { calculate as calculateWithApi, type CalculateFn } from './api'
import type { CalculationRequest } from './calculator/engine'
import { useCalculator } from './calculator/useCalculator'
import { Calculator } from './components/Calculator'
import { HistoryPanel } from './components/HistoryPanel'
import { createBrowserStore, type HistoryStore } from './history/history'
import { useHistory } from './history/useHistory'
import { describeCalculation } from './operations'

const browserHistory = createBrowserStore()

interface AppProps {
  calculate?: CalculateFn
  historyStore?: HistoryStore
}

// Wires the pieces together. Dependencies come in as props, so tests and other
// hosts can supply their own API client and history storage.
export function App({ calculate = calculateWithApi, historyStore = browserHistory }: AppProps) {
  const history = useHistory(historyStore)
  const { add } = history

  const onCalculated = useCallback(
    (request: CalculationRequest, result: number) => {
      add(describeCalculation(request.operation, request.a, request.b), result)
    },
    [add],
  )
  const { state, busy, input, press } = useCalculator(calculate, onCalculated)

  return (
    <main className="page">
      <h1 className="visually-hidden">Calculator</h1>
      <div className="layout">
        <Calculator state={state} busy={busy} input={input} press={press} />
        <HistoryPanel
          entries={history.entries}
          onSelect={(value) => input({ type: 'recall', value })}
          onClear={history.clear}
        />
      </div>
    </main>
  )
}
