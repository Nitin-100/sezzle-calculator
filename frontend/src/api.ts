import type { Operation } from './operations'

export interface CalculationResult {
  operation: Operation
  a: number
  b?: number
  result: number
}

// The UI depends on this function type, not on fetch, so any client can be plugged in.
export type CalculateFn = (operation: Operation, a: number, b?: number) => Promise<CalculationResult>

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')
const TIMEOUT_MS = 5000
const MAX_ATTEMPTS = 2
const RETRY_DELAY_MS = 300
const RETRYABLE_STATUS = new Set([502, 503, 504])

export async function calculate(operation: Operation, a: number, b?: number): Promise<CalculationResult> {
  const response = await post(`${BASE_URL}/api/v1/${operation}`, JSON.stringify(b === undefined ? { a } : { a, b }))
  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const error = isErrorBody(body) ? body.error : undefined
    throw new ApiError(
      error?.message ?? `Request failed with status ${response.status}`,
      error?.code ?? 'unknown_error',
      response.status,
    )
  }
  if (!isCalculationResult(body)) {
    throw new ApiError('Received an invalid response from the server', 'invalid_response', response.status)
  }
  return body
}

// Calculations have no side effects, so network failures, timeouts and
// gateway errors (for example during a deploy) are retried once.
async function post(url: string, body: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_ATTEMPTS) return response
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) throw toNetworkError(err)
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
  }
}

function toNetworkError(err: unknown): ApiError {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return new ApiError('The calculator service took too long to respond. Please try again.', 'timeout', 0)
  }
  return new ApiError('Could not reach the calculator service. Please try again.', 'network_error', 0)
}

function isErrorBody(body: unknown): body is { error: { code: string; message: string } } {
  if (typeof body !== 'object' || body === null || !('error' in body)) return false
  const { error } = body as { error: unknown }
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  )
}

function isCalculationResult(body: unknown): body is CalculationResult {
  return typeof body === 'object' && body !== null && typeof (body as { result?: unknown }).result === 'number'
}
