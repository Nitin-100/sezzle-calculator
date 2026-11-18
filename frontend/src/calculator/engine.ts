import { describeCalculation, formatNumber, getOperation, type Operation } from '../operations'
import { parseOperand } from '../validation'

export type BinaryOperation = Exclude<Operation, 'sqrt'>
export type CalculationKey = Operation | 'equals'

const MAX_DIGITS = 15

export interface CalculatorState {
  // Text shown on the main display; always a valid number.
  entry: string
  // Full precision value behind the display when it shows a result, a pasted
  // number or a history value. The display is rounded to 15 digits, so this
  // keeps 1 / 3 x 3 equal to 1. Null while the user is typing.
  exact: number | null
  // Left operand and operator waiting for the right operand.
  operand: number | null
  operator: BinaryOperation | null
  // Secondary line above the entry, for example "12 /" or "12 / 4 =".
  expression: string
  // The next digit starts a new entry instead of appending.
  fresh: boolean
  // An operator was chosen and no right operand has been entered yet.
  awaitingOperand: boolean
  error: string | null
}

export const initialState: CalculatorState = {
  entry: '0',
  exact: null,
  operand: null,
  operator: null,
  expression: '',
  fresh: true,
  awaitingOperand: false,
  error: null,
}

export interface CalculationRequest {
  operation: Operation
  a: number
  b?: number
}

export type CalculatorAction =
  | { type: 'digit'; digit: string }
  | { type: 'decimal' }
  | { type: 'toggleSign' }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'paste'; text: string }
  | { type: 'recall'; value: number }
  | { type: 'operator'; operator: BinaryOperation }
  | { type: 'result'; request: CalculationRequest; result: number; next: BinaryOperation | null }
  | { type: 'error'; message: string }

export function calculatorReducer(state: CalculatorState, action: CalculatorAction): CalculatorState {
  switch (action.type) {
    case 'clear':
      return initialState

    case 'digit': {
      const s = startEntry(state)
      if (countDigits(s.entry) >= MAX_DIGITS) return s
      const entry = s.entry === '0' ? action.digit : s.entry === '-0' ? `-${action.digit}` : s.entry + action.digit
      return { ...s, entry }
    }

    case 'decimal': {
      const s = startEntry(state)
      return s.entry.includes('.') ? s : { ...s, entry: `${s.entry}.` }
    }

    case 'toggleSign': {
      if (state.error) return state
      const s = state.awaitingOperand || state.entry === '0' ? startEntry(state) : state
      return {
        ...s,
        entry: s.entry.startsWith('-') ? s.entry.slice(1) : `-${s.entry}`,
        exact: s.exact === null ? null : -s.exact,
      }
    }

    case 'backspace': {
      if (state.error) return { ...state, error: null }
      if (state.fresh) return state
      const entry = state.entry.slice(0, -1)
      return { ...state, entry: entry === '' || entry === '-' ? '0' : entry }
    }

    case 'paste': {
      const parsed = parseOperand(action.text)
      if (!parsed.ok) return { ...state, error: 'Pasted text is not a valid number' }
      return withValue(state, parsed.value)
    }

    case 'recall':
      return withValue(state, action.value)

    case 'operator':
      // While an error is shown the entry behind it is hidden, so it must not be used.
      if (state.error) return state
      return withOperator(currentValue(state), action.operator)

    case 'result': {
      const { request, result, next } = action
      if (next) return withOperator(result, next)
      if (request.operation === 'sqrt' && state.operator) {
        // Square root of the right operand keeps the pending operation, e.g. 5 + sqrt(9).
        return { ...withValue(state, result), awaitingOperand: false }
      }
      return {
        ...initialState,
        entry: formatNumber(result),
        exact: result,
        expression: `${describeCalculation(request.operation, request.a, request.b)} =`,
      }
    }

    case 'error':
      return { ...initialState, error: action.message }
  }
}

// Returns the API call needed when a calculation key is pressed, or null when
// the key only changes local state (choosing or replacing the operator) or an
// error is shown. Calculation keys do nothing until the error is cleared by
// typing a number, a paste, a history pick or AC.
export function requestFor(state: CalculatorState, key: CalculationKey): CalculationRequest | null {
  if (state.error) return null
  const value = currentValue(state)
  if (key === 'sqrt') return { operation: 'sqrt', a: value }
  if (state.operator === null || state.operand === null) return null
  if (key !== 'equals' && state.awaitingOperand) return null
  return { operation: state.operator, a: state.operand, b: value }
}

export type KeyCommand = { kind: 'action'; action: CalculatorAction } | { kind: 'calculate'; key: CalculationKey }

const KEY_COMMANDS = new Map<string, KeyCommand>([
  ['.', { kind: 'action', action: { type: 'decimal' } }],
  [',', { kind: 'action', action: { type: 'decimal' } }],
  ['Backspace', { kind: 'action', action: { type: 'backspace' } }],
  ['Escape', { kind: 'action', action: { type: 'clear' } }],
  ['Delete', { kind: 'action', action: { type: 'clear' } }],
  ['+', { kind: 'calculate', key: 'add' }],
  ['-', { kind: 'calculate', key: 'subtract' }],
  ['*', { kind: 'calculate', key: 'multiply' }],
  ['x', { kind: 'calculate', key: 'multiply' }],
  ['X', { kind: 'calculate', key: 'multiply' }],
  ['/', { kind: 'calculate', key: 'divide' }],
  ['^', { kind: 'calculate', key: 'power' }],
  ['%', { kind: 'calculate', key: 'percentage' }],
  ['r', { kind: 'calculate', key: 'sqrt' }],
  ['R', { kind: 'calculate', key: 'sqrt' }],
  ['=', { kind: 'calculate', key: 'equals' }],
  ['Enter', { kind: 'calculate', key: 'equals' }],
])

export function commandForKey(key: string): KeyCommand | null {
  if (/^[0-9]$/.test(key)) return { kind: 'action', action: { type: 'digit', digit: key } }
  return KEY_COMMANDS.get(key) ?? null
}

function currentValue(state: CalculatorState): number {
  return state.exact ?? Number(state.entry)
}

function withOperator(value: number, operator: BinaryOperation): CalculatorState {
  const shown = formatNumber(value)
  return {
    entry: shown,
    exact: value,
    operand: value,
    operator,
    expression: operator === 'percentage' ? `${shown}% of` : `${shown} ${getOperation(operator).symbol}`,
    fresh: true,
    awaitingOperand: true,
    error: null,
  }
}

// Shows a complete number (a result, paste or history value). The next digit
// starts a new number instead of appending to it.
function withValue(state: CalculatorState, value: number): CalculatorState {
  return { ...startEntry(state), entry: formatNumber(value), exact: value, fresh: true }
}

function startEntry(state: CalculatorState): CalculatorState {
  if (!state.fresh && !state.error) return state
  return {
    ...state,
    entry: '0',
    exact: null,
    fresh: false,
    awaitingOperand: false,
    expression: state.operator ? state.expression : '',
    error: null,
  }
}

function countDigits(entry: string): number {
  return entry.replace(/[^0-9]/g, '').length
}
