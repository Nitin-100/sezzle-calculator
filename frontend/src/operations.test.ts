import { describe, expect, it } from 'vitest'
import { describeCalculation, formatNumber } from './operations'

describe('formatNumber', () => {
  it.each([
    [0.1 + 0.2, '0.3'],
    [1 / 3, '0.333333333333333'],
    [1024, '1024'],
    [-2.5, '-2.5'],
    [1e21, '1e+21'],
  ])('formats %d as %s', (value, expected) => {
    expect(formatNumber(value)).toBe(expected)
  })
})

describe('describeCalculation', () => {
  it('describes binary operations', () => {
    expect(describeCalculation('divide', 12, 4)).toBe('12 / 4')
    expect(describeCalculation('power', 2, 10)).toBe('2 ^ 10')
  })

  it('describes square root', () => {
    expect(describeCalculation('sqrt', 16)).toBe('sqrt(16)')
  })

  it('describes percentage', () => {
    expect(describeCalculation('percentage', 15, 200)).toBe('15% of 200')
  })
})
