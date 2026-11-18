import { useCallback, useRef, useState } from 'react'
import { ApiError, type CalculateFn } from '../api'
import {
  calculatorReducer,
  initialState,
  requestFor,
  type CalculationKey,
  type CalculationRequest,
  type CalculatorAction,
} from './engine'

export type OnCalculated = (request: CalculationRequest, result: number) => void

// Runs the calculator engine and talks to the API. Input that arrives while a
// request is in flight is queued and applied in order, so fast typing such as
// "125/5*2" never loses keystrokes.
export function useCalculator(calculate: CalculateFn, onCalculated?: OnCalculated) {
  const [state, setState] = useState(initialState)
  const [busy, setBusy] = useState(false)
  const stateRef = useRef(initialState)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const pending = useRef(0)
  const onCalculatedRef = useRef(onCalculated)
  onCalculatedRef.current = onCalculated

  const apply = useCallback((action: CalculatorAction) => {
    stateRef.current = calculatorReducer(stateRef.current, action)
    setState(stateRef.current)
  }, [])

  const enqueue = useCallback((task: () => void | Promise<void>) => {
    pending.current += 1
    queue.current = queue.current
      .then(task)
      // A failing task must not stop the queue, or every later key press would be ignored.
      .catch((err: unknown) => console.error('Calculator task failed', err))
      .finally(() => {
        pending.current -= 1
      })
  }, [])

  const input = useCallback(
    (action: CalculatorAction) => {
      if (pending.current === 0) apply(action)
      else enqueue(() => apply(action))
    },
    [apply, enqueue],
  )

  const press = useCallback(
    (key: CalculationKey) => {
      enqueue(async () => {
        const request = requestFor(stateRef.current, key)
        if (!request) {
          if (key !== 'equals' && key !== 'sqrt') apply({ type: 'operator', operator: key })
          return
        }

        setBusy(true)
        let result: number
        try {
          result = (await calculate(request.operation, request.a, request.b)).result
        } catch (err) {
          const message = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'
          apply({ type: 'error', message })
          return
        } finally {
          setBusy(false)
        }

        apply({ type: 'result', request, result, next: key === 'equals' || key === 'sqrt' ? null : key })
        // Outside the try block: a failing listener (such as history storage) must not turn a correct result into an error.
        onCalculatedRef.current?.(request, result)
      })
    },
    [apply, enqueue, calculate],
  )

  return { state, busy, input, press }
}
