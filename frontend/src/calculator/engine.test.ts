import { describe, expect, it } from 'vitest'
import {
  calculatorReducer,
  commandForKey,
  initialState,
  requestFor,
  type CalculatorAction,
  type CalculatorState,
} from './engine'

function run(...actions: CalculatorAction[]): CalculatorState {
  return actions.reduce(calculatorReducer, initialState)
}

const digits = (text: string): CalculatorAction[] =>
  [...text].map((c) => (c === '.' ? { type: 'decimal' } : { type: 'digit', digit: c }))

describe('number entry', () => {
  it('replaces the initial zero and appends digits', () => {
    expect(run(...digits('120')).entry).toBe('120')
  })

  it('does not allow leading zeros', () => {
    expect(run(...digits('007')).entry).toBe('7')
  })

  it('allows a single decimal point', () => {
    expect(run(...digits('1.2.5')).entry).toBe('1.25')
    expect(run({ type: 'decimal' }).entry).toBe('0.')
  })

  it('limits input to 15 digits', () => {
    expect(run(...digits('1234567890123456789')).entry).toBe('123456789012345')
  })

  it('removes the last character on backspace', () => {
    expect(run(...digits('12'), { type: 'backspace' }).entry).toBe('1')
    expect(run(...digits('5'), { type: 'backspace' }).entry).toBe('0')
  })

  it('toggles the sign, including before typing digits', () => {
    expect(run(...digits('5'), { type: 'toggleSign' }).entry).toBe('-5')
    expect(run(...digits('5'), { type: 'toggleSign' }, { type: 'toggleSign' }).entry).toBe('5')
    expect(run({ type: 'toggleSign' }, ...digits('3')).entry).toBe('-3')
    expect(run(...digits('5'), { type: 'toggleSign' }, { type: 'backspace' }).entry).toBe('0')
  })

  it('clears everything', () => {
    expect(run(...digits('5'), { type: 'operator', operator: 'add' }, { type: 'clear' })).toEqual(initialState)
  })
})

describe('operators', () => {
  it('stores the operand and shows the pending expression', () => {
    const s = run(...digits('12'), { type: 'operator', operator: 'divide' })
    expect(s).toMatchObject({ operand: 12, operator: 'divide', expression: '12 /', entry: '12', awaitingOperand: true })
  })

  it('describes percentage in words', () => {
    expect(run(...digits('15'), { type: 'operator', operator: 'percentage' }).expression).toBe('15% of')
  })

  it('starts a new entry after an operator', () => {
    const s = run(...digits('12'), { type: 'operator', operator: 'divide' }, ...digits('4'))
    expect(s).toMatchObject({ entry: '4', expression: '12 /', awaitingOperand: false })
  })

  it('starts a negative right operand with change sign', () => {
    const s = run(...digits('2'), { type: 'operator', operator: 'add' }, { type: 'toggleSign' })
    expect(s).toMatchObject({ entry: '-0', operand: 2 })
  })
})

describe('requestFor', () => {
  it('needs no request for the first operator', () => {
    expect(requestFor(run(...digits('2')), 'add')).toBeNull()
  })

  it('needs no request when replacing an operator', () => {
    expect(requestFor(run(...digits('2'), { type: 'operator', operator: 'add' }), 'multiply')).toBeNull()
  })

  it('computes the pending operation when chaining', () => {
    const s = run(...digits('2'), { type: 'operator', operator: 'add' }, ...digits('3'))
    expect(requestFor(s, 'multiply')).toEqual({ operation: 'add', a: 2, b: 3 })
    expect(requestFor(s, 'equals')).toEqual({ operation: 'add', a: 2, b: 3 })
  })

  it('reuses the left operand when equals is pressed straight after an operator', () => {
    const s = run(...digits('5'), { type: 'operator', operator: 'multiply' })
    expect(requestFor(s, 'equals')).toEqual({ operation: 'multiply', a: 5, b: 5 })
  })

  it('does nothing for equals without an operator', () => {
    expect(requestFor(run(...digits('5')), 'equals')).toBeNull()
  })

  it('applies square root to the current entry', () => {
    expect(requestFor(run(...digits('16')), 'sqrt')).toEqual({ operation: 'sqrt', a: 16 })
  })
})

describe('results', () => {
  it('shows the result and the full expression after equals', () => {
    const s = run(
      ...digits('12'),
      { type: 'operator', operator: 'divide' },
      ...digits('4'),
      { type: 'result', request: { operation: 'divide', a: 12, b: 4 }, result: 3, next: null },
    )
    expect(s).toMatchObject({ entry: '3', expression: '12 / 4 =', operator: null, fresh: true })
  })

  it('formats float artifacts in the result', () => {
    const s = run({ type: 'result', request: { operation: 'add', a: 0.1, b: 0.2 }, result: 0.30000000000000004, next: null })
    expect(s.entry).toBe('0.3')
  })

  it('continues with the next operator when chaining', () => {
    const s = run({ type: 'result', request: { operation: 'add', a: 2, b: 3 }, result: 5, next: 'multiply' })
    expect(s).toMatchObject({ entry: '5', operand: 5, operator: 'multiply', expression: '5 x', awaitingOperand: true })
  })

  it('keeps the pending operation after a square root of the right operand', () => {
    const s = run(
      ...digits('5'),
      { type: 'operator', operator: 'add' },
      ...digits('9'),
      { type: 'result', request: { operation: 'sqrt', a: 9 }, result: 3, next: null },
    )
    expect(s).toMatchObject({ entry: '3', operand: 5, operator: 'add', expression: '5 +' })
    expect(requestFor(s, 'equals')).toEqual({ operation: 'add', a: 5, b: 3 })
  })

  it('starts a new calculation when a digit follows a result', () => {
    const s = run(
      { type: 'result', request: { operation: 'add', a: 2, b: 3 }, result: 5, next: null },
      ...digits('7'),
    )
    expect(s).toMatchObject({ entry: '7', expression: '' })
  })

  it('does not edit a result with backspace', () => {
    const s = run({ type: 'result', request: { operation: 'add', a: 2, b: 3 }, result: 5, next: null }, { type: 'backspace' })
    expect(s.entry).toBe('5')
  })
})

describe('errors', () => {
  it('resets the calculation and shows the message', () => {
    const s = run(...digits('1'), { type: 'operator', operator: 'divide' }, { type: 'error', message: 'Division by zero is not allowed' })
    expect(s).toMatchObject({ error: 'Division by zero is not allowed', operator: null, entry: '0' })
  })

  it('clears the error when typing again', () => {
    const s = run({ type: 'error', message: 'boom' }, ...digits('4'))
    expect(s).toMatchObject({ error: null, entry: '4' })
  })

  it('clears the error on backspace', () => {
    expect(run({ type: 'error', message: 'boom' }, { type: 'backspace' }).error).toBeNull()
  })

  it('ignores change sign while an error is shown', () => {
    const errored = run({ type: 'error', message: 'boom' })
    expect(calculatorReducer(errored, { type: 'toggleSign' })).toBe(errored)
  })
})

describe('paste', () => {
  it('uses a pasted number as the entry', () => {
    expect(run({ type: 'paste', text: ' -12.5 ' }).entry).toBe('-12.5')
  })

  it('rejects text that is not a number and keeps the pending operation', () => {
    const s = run(...digits('5'), { type: 'operator', operator: 'add' }, { type: 'paste', text: 'hello' })
    expect(s).toMatchObject({ error: 'Pasted text is not a valid number', operator: 'add', operand: 5 })
  })
})

describe('commandForKey', () => {
  it.each([
    ['7', { kind: 'action', action: { type: 'digit', digit: '7' } }],
    ['.', { kind: 'action', action: { type: 'decimal' } }],
    ['Backspace', { kind: 'action', action: { type: 'backspace' } }],
    ['Escape', { kind: 'action', action: { type: 'clear' } }],
    ['*', { kind: 'calculate', key: 'multiply' }],
    ['Enter', { kind: 'calculate', key: 'equals' }],
  ])('maps %s', (key, expected) => {
    expect(commandForKey(key)).toEqual(expected)
  })

  it.each(['a', 'Shift', 'constructor', 'F5'])('ignores %s', (key) => {
    expect(commandForKey(key)).toBeNull()
  })
})

describe('full precision behind the display', () => {
  const third = { type: 'result', request: { operation: 'divide', a: 1, b: 3 }, result: 1 / 3, next: null } as const

  it('uses the exact result, not the rounded display, as the next operand', () => {
    const s = run(third, { type: 'operator', operator: 'multiply' }, ...digits('3'))
    expect(s.expression).toBe('0.333333333333333 x')
    expect(requestFor(s, 'equals')).toEqual({ operation: 'multiply', a: 1 / 3, b: 3 })
  })

  it('keeps precision through a sign change', () => {
    const s = run(third, { type: 'toggleSign' })
    expect(s.entry).toBe('-0.333333333333333')
    expect(requestFor(s, 'sqrt')).toEqual({ operation: 'sqrt', a: -1 / 3 })
  })

  it('drops the exact value once the user types', () => {
    const s = run(third, ...digits('5'))
    expect(s).toMatchObject({ entry: '5', exact: null })
  })

  it('uses the exact value when equals repeats the left operand', () => {
    const s = run(third, { type: 'operator', operator: 'add' })
    expect(requestFor(s, 'equals')).toEqual({ operation: 'add', a: 1 / 3, b: 1 / 3 })
  })
})

describe('recall', () => {
  it('shows a history value as a complete number', () => {
    const s = run(...digits('12'), { type: 'recall', value: 2 / 3 })
    expect(s).toMatchObject({ entry: '0.666666666666667', exact: 2 / 3, fresh: true })
  })

  it('fills the right operand of a pending operation', () => {
    const s = run(...digits('1'), { type: 'operator', operator: 'add' }, { type: 'recall', value: 41 })
    expect(s).toMatchObject({ expression: '1 +', awaitingOperand: false })
    expect(requestFor(s, 'equals')).toEqual({ operation: 'add', a: 1, b: 41 })
  })

  it('clears an error', () => {
    expect(run({ type: 'error', message: 'boom' }, { type: 'recall', value: 3 })).toMatchObject({ error: null, entry: '3' })
  })
})

describe('paste follow up', () => {
  it('starts a new number when a digit follows a pasted value', () => {
    expect(run({ type: 'paste', text: '1e-7' }, ...digits('5')).entry).toBe('5')
  })
})

describe('caps lock', () => {
  it.each([
    ['X', 'multiply'],
    ['R', 'sqrt'],
  ])('maps %s', (key, operation) => {
    expect(commandForKey(key)).toEqual({ kind: 'calculate', key: operation })
  })
})

describe('calculation keys while an error is shown', () => {
  const afterBadPaste = run(...digits('5'), { type: 'operator', operator: 'add' }, ...digits('3'), { type: 'paste', text: 'hello' })

  it('does not calculate with the value hidden behind the error', () => {
    expect(afterBadPaste.error).toBe('Pasted text is not a valid number')
    expect(requestFor(afterBadPaste, 'equals')).toBeNull()
    expect(requestFor(afterBadPaste, 'sqrt')).toBeNull()
    expect(requestFor(afterBadPaste, 'multiply')).toBeNull()
  })

  it('ignores operators', () => {
    expect(calculatorReducer(afterBadPaste, { type: 'operator', operator: 'multiply' })).toBe(afterBadPaste)
  })

  it('keeps the pending operation once a number is typed', () => {
    const s = calculatorReducer(afterBadPaste, { type: 'digit', digit: '4' })
    expect(s).toMatchObject({ error: null, entry: '4', expression: '5 +' })
    expect(requestFor(s, 'equals')).toEqual({ operation: 'add', a: 5, b: 4 })
  })
})
