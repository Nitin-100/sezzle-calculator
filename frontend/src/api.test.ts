import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, calculate } from './api'

type FetchImpl = () => Promise<Response>

function mockFetch(...impls: FetchImpl[]) {
  const fn = vi.fn<typeof fetch>()
  for (const impl of impls) fn.mockImplementationOnce(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const ok = (body: unknown) => async () => jsonResponse(200, body)
const networkFailure = async (): Promise<Response> => {
  throw new TypeError('Failed to fetch')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('calculate', () => {
  it('posts both operands with a timeout and returns the result', async () => {
    const fetchMock = mockFetch(ok({ operation: 'add', a: 2, b: 3, result: 5 }))

    await expect(calculate('add', 2, 3)).resolves.toEqual({ operation: 'add', a: 2, b: 3, result: 5 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/add')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: 2, b: 3 }),
    })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('omits b for unary operations', async () => {
    const fetchMock = mockFetch(ok({ operation: 'sqrt', a: 9, result: 3 }))

    await calculate('sqrt', 9)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ body: JSON.stringify({ a: 9 }) })
  })

  it('surfaces API errors with code and status without retrying', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse(422, { error: { code: 'division_by_zero', message: 'Division by zero is not allowed' } }),
    )

    const error = await calculate('divide', 1, 0).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ message: 'Division by zero is not allowed', code: 'division_by_zero', status: 422 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('handles error responses that are not JSON', async () => {
    mockFetch(async () => new Response('Internal Server Error', { status: 500 }))

    await expect(calculate('add', 1, 1)).rejects.toMatchObject({
      message: 'Request failed with status 500',
      code: 'unknown_error',
      status: 500,
    })
  })

  it('rejects malformed success responses', async () => {
    mockFetch(ok({ unexpected: true }))

    await expect(calculate('add', 1, 1)).rejects.toMatchObject({ code: 'invalid_response' })
  })

  it('retries once after a network failure', async () => {
    const fetchMock = mockFetch(networkFailure, ok({ operation: 'add', a: 1, b: 1, result: 2 }))

    await expect(calculate('add', 1, 1)).resolves.toMatchObject({ result: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries once on a gateway error', async () => {
    const fetchMock = mockFetch(
      async () => new Response('Service Unavailable', { status: 503 }),
      ok({ operation: 'add', a: 1, b: 1, result: 2 }),
    )

    await expect(calculate('add', 1, 1)).resolves.toMatchObject({ result: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports network failures after the retry', async () => {
    const fetchMock = mockFetch(networkFailure, networkFailure)

    await expect(calculate('add', 1, 1)).rejects.toMatchObject({ code: 'network_error', status: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports timeouts', async () => {
    const timeout = async (): Promise<Response> => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    }
    mockFetch(timeout, timeout)

    await expect(calculate('add', 1, 1)).rejects.toMatchObject({
      code: 'timeout',
      message: 'The calculator service took too long to respond. Please try again.',
    })
  })
})
