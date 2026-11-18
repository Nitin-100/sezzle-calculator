// Package api exposes the calculator as a small JSON REST API.
package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"

	"github.com/nitin-100/sezzle-calculator/backend/internal/calculator"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

const maxBodyBytes = 4 << 10

// Calculator is the domain behaviour the HTTP layer depends on. The handler
// only knows this interface, so the math can change or be faked in tests
// without touching HTTP code.
type Calculator interface {
	Arity(op calculator.Operation) (int, error)
	Calculate(op calculator.Operation, a, b float64) (float64, error)
}

// Config controls optional behaviour of the HTTP handler.
type Config struct {
	Logger *slog.Logger
	// Calculator performs the math. Nil means calculator.New().
	Calculator Calculator
	// Version is reported by /healthz so a deploy can be verified.
	Version string
	// StaticDir, when set, is served at the root path (the built frontend).
	StaticDir string
	// AllowedOrigins lists origins allowed to call the API cross origin.
	// Use "*" to allow any origin. Empty disables CORS.
	AllowedOrigins []string
	// Registry receives the service metrics and is served at /metrics.
	// When nil a private registry is used.
	Registry *prometheus.Registry
	// Ready reports whether this instance should receive traffic. It turns
	// false during shutdown so load balancers stop routing to it. Nil means
	// always ready.
	Ready func() bool
}

type server struct {
	calc    Calculator
	logger  *slog.Logger
	metrics *metrics
	ready   func() bool
	version string
}

// NewHandler builds the routes and wraps them in the standard middleware.
func NewHandler(cfg Config) http.Handler {
	s := &server{
		calc:    cfg.Calculator,
		logger:  cfg.Logger,
		ready:   cfg.Ready,
		version: cfg.Version,
	}
	if s.calc == nil {
		s.calc = calculator.New()
	}
	if s.logger == nil {
		s.logger = slog.New(slog.DiscardHandler)
	}
	if s.ready == nil {
		s.ready = func() bool { return true }
	}
	if s.version == "" {
		s.version = "dev"
	}
	reg := cfg.Registry
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	s.metrics = newMetrics(reg)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("GET /readyz", s.handleReady)
	mux.Handle("GET /metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{}))
	mux.HandleFunc("/api/v1/{operation}", s.handleCalculate)
	mux.HandleFunc("/api/", handleNotFound)
	if cfg.StaticDir != "" {
		mux.Handle("/", newStaticHandler(cfg.StaticDir))
	}

	var h http.Handler = mux
	h = withCORS(h, cfg.AllowedOrigins)
	h = withSecurityHeaders(h)
	h = withRecovery(h, s.logger)
	h = withObservability(h, s.logger, s.metrics)
	return h
}

type calculateRequest struct {
	A *float64 `json:"a"`
	B *float64 `json:"b"`
}

type calculateResponse struct {
	Operation calculator.Operation `json:"operation"`
	A         float64              `json:"a"`
	B         *float64             `json:"b,omitempty"`
	Result    float64              `json:"result"`
}

type apiError struct {
	status  int
	Code    string `json:"code"`
	Message string `json:"message"`
}

func badRequest(format string, args ...any) *apiError {
	return &apiError{http.StatusBadRequest, "invalid_request", fmt.Sprintf(format, args...)}
}

// domainErrors maps calculator errors to HTTP statuses and stable API error codes.
var domainErrors = []struct {
	err     error
	status  int
	code    string
	message string
}{
	{calculator.ErrDivisionByZero, http.StatusUnprocessableEntity, "division_by_zero", "Division by zero is not allowed"},
	{calculator.ErrNegativeSqrt, http.StatusUnprocessableEntity, "negative_square_root", "Cannot take the square root of a negative number"},
	{calculator.ErrUndefined, http.StatusUnprocessableEntity, "undefined_result", "The result is not a real number"},
	{calculator.ErrOverflow, http.StatusUnprocessableEntity, "result_out_of_range", "The result is too large to represent"},
	{calculator.ErrInvalidOperand, http.StatusBadRequest, "invalid_request", "Operands must be finite numbers"},
}

func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": s.version})
}

func handleNotFound(w http.ResponseWriter, _ *http.Request) {
	writeError(w, &apiError{http.StatusNotFound, "not_found", "Resource not found"})
}

func (s *server) handleReady(w http.ResponseWriter, _ *http.Request) {
	if !s.ready() {
		writeError(w, &apiError{http.StatusServiceUnavailable, "not_ready", "Service is shutting down"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) handleCalculate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeError(w, &apiError{http.StatusMethodNotAllowed, "method_not_allowed", "Use POST for calculator operations"})
		return
	}

	op := calculator.Operation(r.PathValue("operation"))
	arity, err := s.calc.Arity(op)
	if err != nil {
		writeError(w, &apiError{http.StatusNotFound, "unknown_operation", fmt.Sprintf("Unknown operation %q", op)})
		return
	}

	// Only known operations are counted, which keeps metric labels bounded.
	fail := func(e *apiError) {
		s.metrics.operations.WithLabelValues(string(op), e.Code).Inc()
		writeError(w, e)
	}

	req, apiErr := decodeRequest(w, r)
	if apiErr == nil {
		apiErr = validateOperands(op, arity, req)
	}
	if apiErr != nil {
		fail(apiErr)
		return
	}

	// JSON allows -0. Echo operands as 0, the same way the result is normalized.
	a := *req.A
	if a == 0 {
		a = 0
	}
	var b float64
	if req.B != nil {
		if b = *req.B; b == 0 {
			b = 0
		}
		req.B = &b
	}
	result, err := s.calc.Calculate(op, a, b)
	if err != nil {
		apiErr := toAPIError(err)
		if apiErr.status >= http.StatusInternalServerError {
			s.logger.Error("calculation failed",
				"request_id", w.Header().Get(requestIDHeader),
				"operation", op,
				"error", err,
			)
		}
		fail(apiErr)
		return
	}

	s.metrics.operations.WithLabelValues(string(op), "ok").Inc()
	writeJSON(w, http.StatusOK, calculateResponse{Operation: op, A: a, B: req.B, Result: result})
}

func decodeRequest(w http.ResponseWriter, r *http.Request) (calculateRequest, *apiError) {
	var req calculateRequest

	// The exact match is the common case and skips parsing.
	if ct := r.Header.Get("Content-Type"); ct != "" && ct != "application/json" {
		if mediaType, _, err := mime.ParseMediaType(ct); err != nil || mediaType != "application/json" {
			return req, &apiError{http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json"}
		}
	}

	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes))
	dec.DisallowUnknownFields()

	if err := dec.Decode(&req); err != nil {
		var typeErr *json.UnmarshalTypeError
		var maxBytesErr *http.MaxBytesError
		switch {
		case errors.Is(err, io.EOF):
			return req, badRequest("Request body is empty")
		case errors.As(err, &maxBytesErr):
			return req, &apiError{http.StatusRequestEntityTooLarge, "request_too_large", "Request body is too large"}
		case errors.As(err, &typeErr):
			return req, badRequest("Field %q must be a valid number", typeErr.Field)
		case strings.HasPrefix(err.Error(), "json: unknown field "):
			return req, badRequest("Unknown field %s", strings.TrimPrefix(err.Error(), "json: unknown field "))
		default:
			return req, badRequest("Request body is not valid JSON")
		}
	}
	// More() reports false for a stray "}" or "]", so decode once more and
	// require a clean end of input.
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return req, &apiError{http.StatusRequestEntityTooLarge, "request_too_large", "Request body is too large"}
		}
		return req, badRequest("Request body must contain a single JSON object")
	}
	return req, nil
}

func validateOperands(op calculator.Operation, arity int, req calculateRequest) *apiError {
	if req.A == nil {
		return badRequest(`Field "a" is required`)
	}
	if arity == 2 && req.B == nil {
		return badRequest(`Field "b" is required`)
	}
	if arity == 1 && req.B != nil {
		return badRequest(`Operation %q takes only field "a"`, op)
	}
	return nil
}

func toAPIError(err error) *apiError {
	for _, d := range domainErrors {
		if errors.Is(err, d.err) {
			return &apiError{d.status, d.code, d.message}
		}
	}
	return &apiError{http.StatusInternalServerError, "internal_error", "Internal server error"}
}

// Constant header values are built once and assigned directly, which avoids
// the allocation and key canonicalization of Header.Set on every request.
// The slices are never modified in place; Header.Add appends, and appending
// to a full slice copies it.
var (
	jsonContentType = []string{"application/json"}
	noStore         = []string{"no-store"}
)

func writeJSON(w http.ResponseWriter, status int, body any) {
	h := w.Header()
	h["Content-Type"] = jsonContentType
	h["Cache-Control"] = noStore
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

type errorBody struct {
	Error *apiError `json:"error"`
}

func writeError(w http.ResponseWriter, e *apiError) {
	writeJSON(w, e.status, errorBody{e})
}
