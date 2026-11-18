import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type CalculateFn } from './api'
import { App } from './App'
import type { HistoryEntry, HistoryStore } from './history/history'

const calculateMock = vi.fn<CalculateFn>()

// In-memory history, so tests do not depend on (or leak into) localStorage.
function memoryStore(initial: HistoryEntry[] = []): HistoryStore & { saved: HistoryEntry[] } {
  const store = {
    saved: initial,
    load: () => store.saved,
    save: (entries: HistoryEntry[]) => {
      store.saved = entries
    },
    subscribe: () => () => {},
  }
  return store
}

function setup(historyStore: HistoryStore = memoryStore()) {
  const user = userEvent.setup()
  render(<App calculate={calculateMock} historyStore={historyStore} />)
  const click = async (...names: string[]) => {
    for (const name of names) await user.click(screen.getByRole('button', { name }))
  }
  return { user, click }
}

const display = () => screen.getByTestId('display')
const expression = () => screen.getByTestId('expression')

beforeEach(() => {
  calculateMock.mockReset()
})

describe('Calculator', () => {
  it('shows numbers on the display as they are typed', async () => {
    const { click } = setup()

    expect(display()).toHaveTextContent('0')
    await click('1', '2', 'Decimal point', '5')

    expect(display()).toHaveTextContent('12.5')
  })

  it('calculates with the keypad and shows the expression', async () => {
    calculateMock.mockResolvedValue({ operation: 'divide', a: 12, b: 4, result: 3 })
    const { click } = setup()

    await click('1', '2', 'Divide')
    expect(expression()).toHaveTextContent('12 /')
    expect(screen.getByRole('button', { name: 'Divide' })).toHaveAttribute('aria-pressed', 'true')

    await click('4', 'Equals')

    expect(calculateMock).toHaveBeenCalledWith('divide', 12, 4)
    expect(display()).toHaveTextContent('3')
    expect(expression()).toHaveTextContent('12 / 4 =')
  })

  it('chains operations using the previous result', async () => {
    calculateMock
      .mockResolvedValueOnce({ operation: 'add', a: 2, b: 3, result: 5 })
      .mockResolvedValueOnce({ operation: 'multiply', a: 5, b: 4, result: 20 })
    const { click } = setup()

    await click('2', 'Add', '3', 'Multiply')
    expect(display()).toHaveTextContent('5')
    expect(expression()).toHaveTextContent('5 x')

    await click('4', 'Equals')

    expect(calculateMock).toHaveBeenNthCalledWith(1, 'add', 2, 3)
    expect(calculateMock).toHaveBeenNthCalledWith(2, 'multiply', 5, 4)
    expect(display()).toHaveTextContent('20')
  })

  it('calculates square root immediately', async () => {
    calculateMock.mockResolvedValue({ operation: 'sqrt', a: 16, result: 4 })
    const { click } = setup()

    await click('1', '6', 'Square root')

    expect(calculateMock).toHaveBeenCalledWith('sqrt', 16, undefined)
    expect(display()).toHaveTextContent('4')
    expect(expression()).toHaveTextContent('sqrt(16) =')
  })

  it('supports keyboard input', async () => {
    calculateMock.mockResolvedValue({ operation: 'power', a: 2, b: 10, result: 1024 })
    const { user } = setup()

    await user.keyboard('2^10{Enter}')

    expect(calculateMock).toHaveBeenCalledWith('power', 2, 10)
    expect(display()).toHaveTextContent('1024')

    await user.keyboard('{Escape}')
    expect(display()).toHaveTextContent('0')
  })

  it('edits the entry with the change sign, backspace and clear keys', async () => {
    const { user, click } = setup()

    await click('4', '2', 'Change sign')
    expect(display()).toHaveTextContent('-42')

    await click('Backspace')
    expect(display()).toHaveTextContent('-4')

    await user.keyboard('{Control>}5{/Control}')
    expect(display()).toHaveTextContent('-4')

    await click('All clear')
    expect(display()).toHaveTextContent('0')
  })

  it('accepts a pasted number', async () => {
    setup()

    const data = { getData: () => '42.5' } as unknown as DataTransfer
    fireEvent.paste(window, { clipboardData: data })

    expect(display()).toHaveTextContent('42.5')
  })

  it('shows API errors on the display and recovers on the next key', async () => {
    calculateMock.mockRejectedValue(new ApiError('Division by zero is not allowed', 'division_by_zero', 422))
    const { click } = setup()

    await click('1', 'Divide', '0', 'Equals')
    expect(display()).toHaveTextContent('Division by zero is not allowed')

    await click('7')
    expect(display()).toHaveTextContent('7')
  })

  it('shows a generic message for unexpected errors', async () => {
    calculateMock.mockRejectedValue(new Error('boom'))
    const { click } = setup()

    await click('1', 'Add', '1', 'Equals')

    expect(display()).toHaveTextContent('Something went wrong')
  })

  it('queues input typed while a request is in flight', async () => {
    let resolve: (value: Awaited<ReturnType<CalculateFn>>) => void = () => {}
    calculateMock
      .mockReturnValueOnce(new Promise((r) => (resolve = r)))
      .mockResolvedValueOnce({ operation: 'multiply', a: 25, b: 2, result: 50 })
    const { user } = setup()

    await user.keyboard('125/5*2')
    expect(screen.getByRole('region', { name: 'Calculator' })).toHaveAttribute('aria-busy', 'true')

    resolve({ operation: 'divide', a: 125, b: 5, result: 25 })
    await waitFor(() => expect(expression()).toHaveTextContent('25 x'))
    expect(display()).toHaveTextContent('2')

    await user.keyboard('{Enter}')

    await waitFor(() => expect(display()).toHaveTextContent('50'))
    expect(calculateMock).toHaveBeenNthCalledWith(1, 'divide', 125, 5)
    expect(calculateMock).toHaveBeenNthCalledWith(2, 'multiply', 25, 2)
    expect(screen.getByRole('region', { name: 'Calculator' })).toHaveAttribute('aria-busy', 'false')
  })
})

describe('History', () => {
  it('records each calculation, newest first, and saves it', async () => {
    calculateMock
      .mockResolvedValueOnce({ operation: 'add', a: 2, b: 3, result: 5 })
      .mockResolvedValueOnce({ operation: 'multiply', a: 5, b: 4, result: 20 })
    const store = memoryStore()
    const { click } = setup(store)

    expect(screen.getByText('Your calculations will appear here.')).toBeInTheDocument()
    await click('2', 'Add', '3', 'Multiply', '4', 'Equals')

    const items = within(screen.getByRole('list')).getAllByRole('button')
    expect(items.map((item) => item.textContent)).toEqual(['5 x 4 =20', '2 + 3 =5'])
    expect(store.saved.map((e) => e.expression)).toEqual(['5 x 4', '2 + 3'])
  })

  it('does not record failed calculations', async () => {
    calculateMock.mockRejectedValue(new ApiError('Division by zero is not allowed', 'division_by_zero', 422))
    const store = memoryStore()
    const { click } = setup(store)

    await click('1', 'Divide', '0', 'Equals')

    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(store.saved).toEqual([])
  })

  it('loads saved history and reuses a result as the next operand', async () => {
    calculateMock.mockResolvedValue({ operation: 'add', a: 1, b: 0.1, result: 1.1 })
    const { click } = setup(memoryStore([{ id: '1', expression: '1 / 3', result: 1 / 3, createdAt: 0 }]))

    await click('1', 'Add', '1 / 3 = 0.333333333333333. Use this result')
    expect(display()).toHaveTextContent('0.333333333333333')

    await click('Equals')
    // The full precision value is sent, not the rounded display.
    expect(calculateMock).toHaveBeenCalledWith('add', 1, 1 / 3)
  })

  it('selects a history item with Enter instead of calculating', async () => {
    const { user } = setup(memoryStore([{ id: '1', expression: '6 x 7', result: 42, createdAt: 0 }]))

    screen.getByRole('button', { name: '6 x 7 = 42. Use this result' }).focus()
    await user.keyboard('{Enter}')

    expect(display()).toHaveTextContent('42')
    expect(calculateMock).not.toHaveBeenCalled()
  })

  it('clears history', async () => {
    const store = memoryStore([{ id: '1', expression: '6 x 7', result: 42, createdAt: 0 }])
    const { click } = setup(store)

    await click('Clear')

    expect(screen.getByText('Your calculations will appear here.')).toBeInTheDocument()
    expect(store.saved).toEqual([])
  })
})
