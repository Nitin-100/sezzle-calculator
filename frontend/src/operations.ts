export type Operation = 'add' | 'subtract' | 'multiply' | 'divide' | 'power' | 'sqrt' | 'percentage'

export interface OperationInfo {
  id: Operation
  symbol: string
  arity: 1 | 2
}

export const OPERATIONS: readonly OperationInfo[] = [
  { id: 'add', symbol: '+', arity: 2 },
  { id: 'subtract', symbol: '-', arity: 2 },
  { id: 'multiply', symbol: 'x', arity: 2 },
  { id: 'divide', symbol: '/', arity: 2 },
  { id: 'power', symbol: '^', arity: 2 },
  { id: 'sqrt', symbol: 'sqrt', arity: 1 },
  { id: 'percentage', symbol: '%', arity: 2 },
]

export function getOperation(id: Operation): OperationInfo {
  const info = OPERATIONS.find((op) => op.id === id)
  if (!info) throw new Error(`Unknown operation: ${id}`)
  return info
}

// Display only: trims float artifacts such as 0.1 + 0.2 = 0.30000000000000004.
export function formatNumber(value: number): string {
  return String(Number(value.toPrecision(15)))
}

export function describeCalculation(id: Operation, a: number, b?: number): string {
  const { symbol, arity } = getOperation(id)
  if (arity === 1) return `${symbol}(${formatNumber(a)})`
  const right = formatNumber(b ?? 0)
  if (id === 'percentage') return `${formatNumber(a)}% of ${right}`
  return `${formatNumber(a)} ${symbol} ${right}`
}
