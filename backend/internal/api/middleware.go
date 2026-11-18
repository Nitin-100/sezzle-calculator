package api

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strconv"
	"time"
)

// Canonical form, so Header.Get and direct map access need no conversion.
const requestIDHeader = "X-Request-Id"

type statusRecorder struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (r *statusRecorder) WriteHeader(status int) {
	if !r.wroteHeader {
		r.status, r.wroteHeader = status, true
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(p []byte) (int, error) {
	r.wroteHeader = true
	return r.ResponseWriter.Write(p)
}

func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

// withObservability assigns a request ID, records metrics and writes one log
// line per request. It must be the outermost middleware.
func withObservability(next http.Handler, logger *slog.Logger, m *metrics) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		id := r.Header.Get(requestIDHeader)
		if !validRequestID(id) {
			id = newRequestID()
		}
		w.Header()[requestIDHeader] = []string{id}

		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		elapsed := time.Since(start)

		// The mux sets r.Pattern to the matched route, which keeps labels bounded.
		route := r.Pattern
		if route == "" {
			route = "unmatched"
		}
		method := normalizeMethod(r.Method)
		m.requests.WithLabelValues(method, route, strconv.Itoa(rec.status)).Inc()
		m.duration.WithLabelValues(method, route).Observe(elapsed.Seconds())

		level := slog.LevelInfo
		switch {
		case rec.status >= http.StatusInternalServerError:
			level = slog.LevelError
		case route == "GET /healthz" || route == "GET /readyz" || route == "GET /metrics":
			level = slog.LevelDebug
		}
		// LogAttrs avoids boxing each value in an interface.
		logger.LogAttrs(r.Context(), level, "request",
			slog.String("request_id", id),
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.String("route", route),
			slog.Int("status", rec.status),
			slog.Float64("duration_ms", float64(elapsed.Microseconds())/1000),
		)
	})
}

func withRecovery(next http.Handler, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			v := recover()
			if v == nil {
				return
			}
			if v == http.ErrAbortHandler {
				panic(v)
			}
			logger.Error("panic while handling request",
				"request_id", w.Header().Get(requestIDHeader),
				"error", v,
				"stack", string(debug.Stack()),
			)
			// Once the response has started, a JSON error would corrupt it.
			// Aborting closes the connection so the client sees a failure.
			if rec, ok := w.(*statusRecorder); ok && rec.wroteHeader {
				panic(http.ErrAbortHandler)
			}
			writeError(w, &apiError{http.StatusInternalServerError, "internal_error", "Internal server error"})
		}()
		next.ServeHTTP(w, r)
	})
}

var securityHeaders = map[string][]string{
	"X-Content-Type-Options":  {"nosniff"},
	"X-Frame-Options":         {"DENY"},
	"Referrer-Policy":         {"no-referrer"},
	"Content-Security-Policy": {"default-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'"},
}

func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		for k, v := range securityHeaders {
			h[k] = v
		}
		next.ServeHTTP(w, r)
	})
}

func withCORS(next http.Handler, allowedOrigins []string) http.Handler {
	if len(allowedOrigins) == 0 {
		return next
	}
	allowed := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowed[o] = true
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			next.ServeHTTP(w, r)
			return
		}

		h := w.Header()
		h.Add("Vary", "Origin")
		if !allowed["*"] && !allowed[origin] {
			next.ServeHTTP(w, r)
			return
		}

		h.Set("Access-Control-Allow-Origin", origin)
		h.Set("Access-Control-Expose-Headers", requestIDHeader)
		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type, "+requestIDHeader)
			h.Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// validRequestID accepts IDs from upstream proxies only if they are short and
// use safe characters, so a client cannot inject arbitrary text into logs.
func validRequestID(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for _, c := range id {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '-', c == '_', c == '.':
		default:
			return false
		}
	}
	return true
}

func newRequestID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func normalizeMethod(m string) string {
	switch m {
	case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut,
		http.MethodPatch, http.MethodDelete, http.MethodOptions:
		return m
	}
	return "OTHER"
}
