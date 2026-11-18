export type ParseResult = { ok: true; value: number } | { ok: false; error: string }

const NUMBER_PATTERN = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

export function parseOperand(raw: string): ParseResult {
  const text = raw.trim()
  if (text === '') return { ok: false, error: 'Enter a number' }
  if (!NUMBER_PATTERN.test(text)) return { ok: false, error: 'Enter a valid number, for example 12.5 or -3' }

  const value = Number(text)
  if (!Number.isFinite(value)) return { ok: false, error: 'Number is too large' }
  return { ok: true, value }
}
