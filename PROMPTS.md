# AI Prompts and Engineering Workflow

I used GitHub Copilot as a pair programmer while keeping ownership of the architecture, UX decisions, security boundaries, and verification. I set the requirements and quality bar for each step, reviewed every diff, pushed back when a design fell short, and verified the result against unit tests, browser checks, and the running Docker container.

Following the assignment's guidance to prioritize correctness, clarity, and maintainability over extra features, the runtime codebase stays small enough to read in one sitting: standard library Go plus the Prometheus client on the backend, and React + TypeScript with zero UI framework dependencies on the frontend. AI speed went into holding a strict bar on edge cases, security hardening, operational readiness, tests, and documentation.

Below are the prompts that drove each iteration (edited for clarity), along with what I was aiming for and what changed as a result.

---

## 1. Clean full-stack foundation with strict domain boundaries

> Build a full-stack calculator with a React + TypeScript frontend and a Go REST microservice backend. Every arithmetic operation must be evaluated by the backend API—the frontend must not compute math locally.
>
> Requirements:
> - Operations: `add`, `subtract`, `multiply`, `divide`, plus `power`, `sqrt`, and `percentage`.
> - Backend: versioned JSON endpoints (`POST /api/v1/{operation}`), strict input validation, explicit handling of arithmetic edge cases (division by zero, negative square root, undefined/NaN results, float64 overflow, negative zero), and consistent structured JSON errors with stable machine-readable codes and clear user messages.
> - Frontend: responsive layout for desktop and mobile, strict TypeScript, input validation, and clear error handling.
> - Deliverables: idiomatic, minimal code in both layers, unit tests with coverage reports, a multi-stage Dockerfile running the full stack from one image, and a clear README covering setup, API usage, and design decisions.
>
> Keep the pure calculator math isolated from HTTP, avoid unnecessary dependencies or boilerplate abstractions, and write plain, direct code and documentation.

**What I was aiming for and what changed:**

- **Readable in one sitting:** Every file has one clear responsibility (`internal/calculator` for pure math, `internal/api` for HTTP transport and middleware, `cmd/server` for process wiring).
- **Decoupled domain logic:** `internal/calculator` has zero HTTP or JSON imports, making all arithmetic rules and domain errors fast to test directly.
- **Contract-first validation:** Pointer operands (`*float64`) distinguish missing or `null` fields from `0`, unary `sqrt` rejects an extra `b` field, unknown JSON fields are rejected, and HTTP status codes clearly separate malformed requests (`400`, `413`, `415`) from domain math errors (`422`).
- **Single-origin container:** A multi-stage Dockerfile builds the Vite bundle and static Go binary so one server hosts both `/` and `/api/v1` in production, while Vite proxies `/api` during local development.

---

## 2. Handheld calculator UX, accessibility, and async input queueing

> Replace the two-input form UI with a real keypad calculator modeled as a pure, unit-testable state machine (`engine.ts`) separate from React components.
>
> Make it behave the way users expect a calculator to work:
> - Show digits immediately on the main display as they are typed, with a secondary expression line above (`12 /` while entering, `12 / 4 =` on completion).
> - Support chained operations (`2 + 3 x 4 =`), unary square root mid-calculation (`5 + 9 sqrt =`), sign toggle (`+/-`), backspace, `AC`, full keyboard shortcuts, clipboard paste with validation, and inline errors that clear cleanly when starting the next entry.
> - Include mobile-sized tap targets, responsive phone/desktop layouts, system light and dark themes, visible `:focus-visible` outlines, and accessible button/live-region ARIA attributes (`aria-live`, `aria-pressed`, `aria-busy`).
> - Ensure fast keyboard typing never drops or reorders inputs while an API request is in flight.

**What I was aiming for and what changed:**

- **Pure keypad reducer:** Putting all state transitions in `engine.ts` let every keypad rule be unit tested directly without DOM or network setup.
- **Fixing dropped keystrokes under latency:** Testing fast keyboard entry (`125/5*2`) in the browser exposed a race where keys typed while `POST /api/v1/divide` was running were lost. Adding a sequential promise queue backed by a synchronous state ref in `useCalculator.ts` preserved exact keystroke order and was locked in with a regression test.
- **Keyboard ergonomics:** Prevented `/` from opening browser quick-find or `Enter` from double-triggering focused keypad buttons, preserved `Enter`/`Space` on buttons outside the keypad, and left `Ctrl`/`Cmd`/`Alt` shortcuts and IME composition untouched.

---

## 3. Production operability: observability, resilience, and horizontal scale

> Harden the service for production operations—observability, graceful failure handling, and horizontal scaling—without adding stateful complexity:
> - Observability: structured JSON request logs (`log/slog`) correlated via `X-Request-ID`, Prometheus metrics at `/metrics` with bounded label cardinality, and quiet `debug`-level logging for health and metrics probes.
> - Failure handling and zero-downtime deploys: separate `/healthz` (liveness) and `/readyz` (readiness) endpoints, `SIGTERM` readiness draining before closing listeners, a built-in `-healthcheck` flag for distroless Docker, panic recovery that logs stack traces with the request ID, HTTP server timeouts, and a 5-second browser timeout with a single retry on transient network or `502`/`503`/`504` gateway errors.
> - Scaling and caching: keep replicas stateless, benchmark per-request overhead, configure immutable cache headers for hashed `/assets/*` files alongside `no-cache` for `index.html` and `no-store` for API responses, and document gateway responsibilities (TLS, rate limiting, restricting `/metrics`).

**What I was aiming for and what changed:**

- **Bounded metrics and traceable logs:** Metric labels use matched route patterns and known operations only, preventing cardinality blowups from arbitrary paths. Incoming `X-Request-ID` headers are validated (`<= 64` safe ASCII chars) before reuse to prevent log injection.
- **Safe client retries:** Because arithmetic calls are side-effect-free, retrying once after 300 ms hides brief rolling-deploy blips without retrying `4xx` validation or math errors.
- **Verified graceful drain:** Flipping readiness to `503` for `SHUTDOWN_DRAIN_DELAY` before `http.Server.Shutdown` lets load balancers stop routing traffic before connections close.

---

## 4. SOLID boundaries, API contract, CI gates, and release automation

> Audit the codebase against SOLID principles where they genuinely improve testability and maintainability, add a formal OpenAPI contract, tighten CI quality and supply-chain gates, and set up automated multi-arch release management.

**What I was aiming for and what changed:**

- **Pragmatic dependency inversion:** The HTTP layer now depends on a narrow two-method `Calculator` interface wired by `main`, enabling a deterministic test with a failing double to prove unexpected `500` errors are logged with `request_id` and never leaked to clients. On the frontend, `App` accepts `calculate` and `historyStore` props for clean test injection—stopping there rather than adding ceremonial DI containers or extra layers.
- **Traceable builds and SemVer releases:** Compiled `version` and `commit` into the Go binary via `-ldflags` (surfaced in `/healthz`, startup logs, and `calculator_build_info`). Added `CHANGELOG.md` and a tag-driven `release.yml` workflow that reruns CI, verifies changelog notes exist, cross-compiles `linux/amd64` and `linux/arm64` distroless images without QEMU emulation, attaches SBOM + provenance attestations, and publishes to GHCR and GitHub Releases.
- **Hardened CI & current runtimes:** Upgraded Node to `24 LTS`, pinned all GitHub Actions to full commit SHAs with Dependabot updates, enforced coverage gates (`>= 90%` backend `internal`, `>= 95%` statements/lines frontend), added `golangci-lint`, `govulncheck`, `npm audit`, container smoke tests, Trivy image scanning, and a linted OpenAPI 3.1 specification (`docs/openapi.yaml`).

---

## 5. Stateless calculation history, profiling Go allocations, and edge-case audit

> Compare approaches for saving calculation history without user login (`localStorage`, `sessionStorage`, anonymous cookies with server storage, and device fingerprinting) and implement the cleanest option behind a swappable interface. Profile the Go HTTP stack with `pprof` to optimize real hot spots, run a full frontend/backend edge-case audit, and add architecture, sequence, state-machine, shutdown, and release diagrams to the README.

**What I was aiming for and what changed:**

- **Privacy-preserving browser history:** Selected `localStorage` behind a three-method `HistoryStore` interface (rejecting device fingerprinting for privacy/reliability reasons and documenting how cookie-backed server storage would plug into `HistoryStore` if ever needed). Handled corrupted JSON, schema validation, a 50-entry cap, cross-tab `storage` events, and fallback to in-memory history when storage is blocked or full.
- **Measured Go optimization (`pprof` + `hey`):** Replaced `httptest.ResponseRecorder` in benchmarks so profiling measured the handler rather than test scaffolding. Prebuilt constant header slices, `slog.LogAttrs`, and a fast path for `Content-Type: application/json` cut allocations from 35 to 23 per request (~36,200 req/s, p99 3.7 ms, zero errors, flat 18–22 MB RSS under 50-client load).
- **Bugs caught and fixed with regression tests:**
  - `7% of 300` returned `21.000000000000004` -> fixed by computing `(a * b) / 100` first with `(a / 100) * b` fallback on overflow.
  - `1 / 3 x 3` gave `0.999999999999999` -> fixed by retaining full-precision `exact` alongside the 15-digit formatted display string.
  - Typing a digit after paste (`1e-7` then `5`) produced `1e-75` -> fixed by marking pasted/recalled numbers `fresh: true`.
  - `-0` operands echoed as `-0` -> normalized to `0` on both input echo and output.
  - Static file server exposed directory listings and accepted non-`GET`/`HEAD` verbs -> wrapped `http.Dir` in `noListingFS` and restricted methods to `GET, HEAD`.
  - Panic after response body started corrupted output -> panicked with `http.ErrAbortHandler` once headers were written.
  - History listener failure could mask a valid API result -> moved `onCalculated` outside the calculation `try/catch`.

---

## 6. Independent code & security review and defense-in-depth pass

> Run an independent read-only code, UX, and security review across the entire repository, verify every finding against the code, fix all confirmed edge cases with tests, enable `gosec` in CI, verify hardened container execution, and document a concrete threat model in the README.

**What this final review caught and closed:**

- **Stray closing brackets in JSON bodies (`{"a":1,"b":2}}`):** Go's `json.Decoder.More()` returns `false` on `}` or `]`, allowing trailing closing brackets through. Replaced `dec.More()` with a second `dec.Decode(&struct{}{})` check requiring `io.EOF` (while still mapping oversized trailing data to `413`).
- **Direct Go calls with `NaN`/`Inf` operands:** JSON rejects `NaN`/`Infinity` at decode time, but direct Go calls like `Calculate(Power, 1, math.NaN())` returned `1` under IEEE-754 rules. `Calculator.Calculate` now validates operand finiteness upfront and returns `ErrInvalidOperand`.
- **Pressing `=`, `sqrt`, or an operator while an error is shown:** After a rejected paste, pressing a calculation key could previously submit the hidden number behind the error message. Calculation and operator keys are now ignored until the error is cleared by typing, pasting, recalling from history, backspace, or `AC`.
- **Cross-tab history ID uniqueness:** Added a random base-36 suffix to `createEntry` so two tabs recording calculations within the same millisecond cannot collide.
- **Dotfile exposure in static serving:** Hardened `noListingFS` to return `404` for any dotfile path (such as `/.env` or `/.git/config`) if one ever landed in the static directory.
- **Explicit config diagnostics & version alignment:** Logged a structured startup warning when `LOG_LEVEL` is invalid instead of falling back silently, aligned `go.mod` (`1.27.0`), CI, and `Dockerfile` on Go 1.27, and consolidated `CHANGELOG.md` cleanly under `1.0.0`.
- **Security tooling, CSP, and runtime hardening:** Enabled `gosec` inside `.golangci.yml` (fixing test-file permissions it flagged), tightened CSP to `default-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'`, verified the image runs cleanly with `--read-only --cap-drop ALL --security-opt no-new-privileges`, and added a threat-to-mitigation table in `README.md`.

---

## Verification Summary

No commits or pushes were delegated automatically; every change was reviewed and verified before acceptance:

- **Backend:** `gofmt`, `golangci-lint` (with `gosec`), `govulncheck ./...`, `go test -cover ./...` (`100%` in `internal/calculator`, `96.3%` in `internal/api`; `-race` enabled in Linux CI), `pprof` allocation benchmarks, and `hey` container load testing.
- **Frontend:** ESLint, `tsc --noEmit`, `npm audit --omit=dev --audit-level=high`, `vitest run --coverage` (`100%` statements, `98.75%` branches), production builds on Node 20 and Node 24, and manual browser checks at desktop and mobile widths.
- **Container, Contracts & Docs:** `linux/amd64` and `linux/arm64` Docker builds, Trivy `HIGH`/`CRITICAL` scan, hardened read-only/dropped-capabilities container test, `SIGTERM` drain verification, OpenAPI 3.1 linting, GitHub Actions workflow checks, and Mermaid diagram rendering verification.
