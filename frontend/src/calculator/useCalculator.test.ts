import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CalculateFn } from '../api'
import { useCalculator } from './useCalculator'

describe('useCalculator', () => {
  it('keeps processing input after a callback throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const calculate = vi.fn<CalculateFn>(async (operation, a, b) => ({ operation, a, b, result: a + (b ?? 0) }))
    const onCalculated = vi.fn(() => {
      throw new Error('history failed')
    })
    const { result } = renderHook(() => useCalculator(calculate, onCalculated))

    act(() => {
      result.current.input({ type: 'digit', digit: '2' })
      result.current.press('add')
      result.current.input({ type: 'digit', digit: '3' })
      result.current.press('equals')
    })
    await waitFor(() => expect(result.current.state.entry).toBe('5'))

    act(() => {
      result.current.press('add')
      result.current.input({ type: 'digit', digit: '1' })
      result.current.press('equals')
    })
    await waitFor(() => expect(result.current.state.entry).toBe('6'))
    expect(onCalculated).toHaveBeenCalledTimes(2)
    expect(console.error).toHaveBeenCalledWith('Calculator task failed', expect.any(Error))
  })
})
