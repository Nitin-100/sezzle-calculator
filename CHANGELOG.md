# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The release workflow copies the section for a version into its GitHub release
notes, so every tag needs an entry here.

## [Unreleased]

## [1.0.0] - 2026-11-18

First release.

### Calculator

- Go REST API with one endpoint per operation under `/api/v1`: add, subtract, multiply, divide, power, square root and percentage.
- Strict request validation with stable JSON error codes for invalid input, division by zero, negative square roots, undefined results and overflow.
- Exact results where floats allow it: whole number percentages (7% of 300 is 21) and negative zero normalized to 0.
- React and TypeScript keypad calculator with keyboard and paste support, chained operations, full precision kept behind the rounded display, and accessible markup.
- Calculation history kept in the browser, with no login and no server state. Entries can be reused, survive reloads, stay in step across tabs, and can be cleared.

### Operations

- Prometheus metrics, request IDs, structured JSON logs, liveness and readiness endpoints, and graceful shutdown with connection draining.
- Request timeout and a single safe retry in the frontend.
- Handler tuned with profiling: 23 allocations per request. Load tested at about 36,000 requests per second with a p99 of 3.7 ms.

### Security

- Security headers including a strict Content Security Policy, body and header limits, server timeouts, and request ID validation against log injection.
- Static file server limited to GET and HEAD, with no directory listings and no dotfiles.
- Distroless, non root, multi-arch image that also runs with a read-only filesystem and no capabilities.
- CI with golangci-lint and gosec, govulncheck, npm audit, coverage thresholds, a container smoke test and a Trivy image scan. Actions pinned to commit SHAs.

### Delivery

- Tag driven release workflow that publishes a multi-arch image with an SBOM and provenance, plus Dependabot updates.
- OpenAPI 3.1 description of the API in `docs/openapi.yaml`.

[Unreleased]: https://github.com/Nitin-100/sezzle-calculator/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Nitin-100/sezzle-calculator/releases/tag/v1.0.0
