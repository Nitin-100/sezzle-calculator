import { describe, expect, it } from 'vitest'
import { parseOperand } from './validation'

describe('parseOperand', () => {
  it.each([
    ['42', 42],
    ['-3.5', -3.5],
    ['+7', 7],
    ['.5', 0.5],
    ['5.', 5],
    ['  12  ', 12],
    ['1e3', 1000],
    ['2.5E-2', 0.025],
  ])('accepts %j', (input, expected) => {
    expect(parseOperand(input)).toEqual({ ok: true, value: expected })
  })

  it.each(['', '   '])('asks for a number when input is %j', (input) => {
    expect(parseOperand(input)).toEqual({ ok: false, error: 'Enter a number' })
  })

  it.each(['abc', '1,000', '1.2.3', '0x10', '--1', 'Infinity', 'NaN', '1e', '.'])('rejects %j', (input) => {
    const result = parseOperand(input)
    expect(result.ok).toBe(false)
  })

  it('rejects numbers outside the float64 range', () => {
    expect(parseOperand('1e400')).toEqual({ ok: false, error: 'Number is too large' })
  })
})
