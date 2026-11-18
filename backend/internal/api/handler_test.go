package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nitin-100/sezzle-calculator/backend/internal/calculator"
	"github.com/prometheus/client_golang/prometheus"
)

type errorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func do(t *testing.T, h http.Handler, method, path, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestCalculateSuccess(t *testing.T) {
	h := NewHandler(Config{})
	tests := []struct {
		path, body, want string
	}{
		{"/api/v1/add", `{"a": 2, "b": 3}`, `{"operation":"add","a":2,"b":3,"result":5}`},
		{"/api/v1/subtract", `{"a": 2, "b": 3}`, `{"operation":"subtract","a":2,"b":3,"result":-1}`},
		{"/api/v1/multiply", `{"a": 1.5, "b": 4}`, `{"operation":"multiply","a":1.5,"b":4,"result":6}`},
		{"/api/v1/divide", `{"a": 1, "b": 4}`, `{"operation":"divide","a":1,"b":4,"result":0.25}`},
		{"/api/v1/power", `{"a": 2, "b": 8}`, `{"operation":"power","a":2,"b":8,"result":256}`},
		{"/api/v1/sqrt", `{"a": 81}`, `{"operation":"sqrt","a":81,"result":9}`},
		{"/api/v1/percentage", `{"a": 20, "b": 50}`, `{"operation":"percentage","a":20,"b":50,"result":10}`},
		{"/api/v1/add", `{"a": 0, "b": 0}`, `{"operation":"add","a":0,"b":0,"result":0}`},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			rec := do(t, h, http.MethodPost, tt.path, tt.body, nil)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Errorf("Content-Type = %q", ct)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != tt.want {
				t.Errorf("body = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestCalculateErrors(t *testing.T) {
	h := NewHandler(Config{})
	tests := []struct {
		name       string
		method     string
		path       string
		body       string
		headers    map[string]string
		wantStatus int
		wantCode   string
	}{
		{"division by zero", "POST", "/api/v1/divide", `{"a": 1, "b": 0}`, nil, 422, "division_by_zero"},
		{"negative sqrt", "POST", "/api/v1/sqrt", `{"a": -1}`, nil, 422, "negative_square_root"},
		{"undefined power", "POST", "/api/v1/power", `{"a": -8, "b": 0.5}`, nil, 422, "undefined_result"},
		{"overflow", "POST", "/api/v1/power", `{"a": 10, "b": 400}`, nil, 422, "result_out_of_range"},
		{"unknown operation", "POST", "/api/v1/modulo", `{"a": 1, "b": 2}`, nil, 404, "unknown_operation"},
		{"wrong method", "GET", "/api/v1/add", "", nil, 405, "method_not_allowed"},
		{"unknown api path", "GET", "/api/v2/add", "", nil, 404, "not_found"},
		{"empty body", "POST", "/api/v1/add", "", nil, 400, "invalid_request"},
		{"malformed json", "POST", "/api/v1/add", `{"a": 1,`, nil, 400, "invalid_request"},
		{"string operand", "POST", "/api/v1/add", `{"a": "1", "b": 2}`, nil, 400, "invalid_request"},
		{"number out of float range", "POST", "/api/v1/add", `{"a": 1e400, "b": 2}`, nil, 400, "invalid_request"},
		{"missing a", "POST", "/api/v1/add", `{"b": 2}`, nil, 400, "invalid_request"},
		{"null a", "POST", "/api/v1/add", `{"a": null, "b": 2}`, nil, 400, "invalid_request"},
		{"missing b", "POST", "/api/v1/add", `{"a": 2}`, nil, 400, "invalid_request"},
		{"b on unary operation", "POST", "/api/v1/sqrt", `{"a": 4, "b": 2}`, nil, 400, "invalid_request"},
		{"unknown field", "POST", "/api/v1/add", `{"a": 1, "b": 2, "c": 3}`, nil, 400, "invalid_request"},
		{"trailing data", "POST", "/api/v1/add", `{"a": 1, "b": 2}{"a": 1}`, nil, 400, "invalid_request"},
		{"trailing closing brace", "POST", "/api/v1/add", `{"a": 1, "b": 2}}`, nil, 400, "invalid_request"},
		{"trailing closing bracket", "POST", "/api/v1/add", `{"a": 1, "b": 2}]`, nil, 400, "invalid_request"},
		{"trailing null", "POST", "/api/v1/add", `{"a": 1, "b": 2} null`, nil, 400, "invalid_request"},
		{"oversized trailing data", "POST", "/api/v1/add", `{"a": 1, "b": 2}` + strings.Repeat(" ", maxBodyBytes) + "x", nil, 413, "request_too_large"},
		{"array body", "POST", "/api/v1/add", `[1, 2]`, nil, 400, "invalid_request"},
		{"wrong content type", "POST", "/api/v1/add", `{"a": 1, "b": 2}`, map[string]string{"Content-Type": "text/plain"}, 415, "unsupported_media_type"},
		{"body too large", "POST", "/api/v1/add", `{"a": 1, "b": 2` + strings.Repeat(" ", maxBodyBytes) + `}`, nil, 413, "request_too_large"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := do(t, h, tt.method, tt.path, tt.body, tt.headers)
			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body)
			}
			var got errorResponse
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("response is not JSON: %v", err)
			}
			if got.Error.Code != tt.wantCode || got.Error.Message == "" {
				t.Errorf("error = %+v, want code %q with a message", got.Error, tt.wantCode)
			}
		})
	}
}

func TestMethodNotAllowedSetsAllowHeader(t *testing.T) {
	rec := do(t, NewHandler(Config{}), http.MethodGet, "/api/v1/add", "", nil)
	if got := rec.Header().Get("Allow"); got != http.MethodPost {
		t.Errorf("Allow = %q, want POST", got)
	}
}

func TestContentTypeWithCharsetIsAccepted(t *testing.T) {
	rec := do(t, NewHandler(Config{}), http.MethodPost, "/api/v1/add", `{"a": 1, "b": 1}`,
		map[string]string{"Content-Type": "application/json; charset=utf-8"})
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, body = %s", rec.Code, rec.Body)
	}
}

func TestHealth(t *testing.T) {
	rec := do(t, NewHandler(Config{Version: "1.2.3"}), http.MethodGet, "/healthz", "", nil)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"status":"ok","version":"1.2.3"}` {
		t.Errorf("status = %d, body = %s", rec.Code, rec.Body)
	}
}

type failingCalculator struct{ err error }

func (failingCalculator) Arity(calculator.Operation) (int, error) { return 2, nil }
func (f failingCalculator) Calculate(calculator.Operation, float64, float64) (float64, error) {
	return 0, f.err
}

func TestUnexpectedCalculatorErrorIsLoggedAndHidden(t *testing.T) {
	var logs bytes.Buffer
	h := NewHandler(Config{
		Calculator: failingCalculator{errors.New("database exploded")},
		Logger:     slog.New(slog.NewJSONHandler(&logs, nil)),
	})

	rec := do(t, h, http.MethodPost, "/api/v1/add", `{"a": 1, "b": 1}`, map[string]string{requestIDHeader: "req-9"})

	var got errorResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusInternalServerError || got.Error.Code != "internal_error" {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "database exploded") {
		t.Error("internal error details must not reach the client")
	}
	if !strings.Contains(logs.String(), "database exploded") || !strings.Contains(logs.String(), `"request_id":"req-9"`) {
		t.Errorf("error was not logged with its request ID:\n%s", logs.String())
	}
}

func TestServesStaticFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<h1>calculator</h1>"), 0o600); err != nil {
		t.Fatal(err)
	}
	h := NewHandler(Config{StaticDir: dir})

	rec := do(t, h, http.MethodGet, "/", "", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "calculator") {
		t.Errorf("status = %d, body = %s", rec.Code, rec.Body)
	}

	rec = do(t, h, http.MethodPost, "/api/v1/add", `{"a": 1, "b": 1}`, nil)
	if rec.Code != http.StatusOK {
		t.Errorf("API not reachable with static files enabled: status = %d", rec.Code)
	}
}

func TestCORS(t *testing.T) {
	h := NewHandler(Config{AllowedOrigins: []string{"http://localhost:5173"}})

	preflight := do(t, h, http.MethodOptions, "/api/v1/add", "", map[string]string{
		"Origin":                        "http://localhost:5173",
		"Access-Control-Request-Method": "POST",
	})
	if preflight.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d", preflight.Code)
	}
	if got := preflight.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Errorf("Allow-Origin = %q", got)
	}

	rec := do(t, h, http.MethodPost, "/api/v1/add", `{"a": 1, "b": 1}`, map[string]string{"Origin": "http://localhost:5173"})
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Errorf("Allow-Origin on request = %q", got)
	}

	rec = do(t, h, http.MethodPost, "/api/v1/add", `{"a": 1, "b": 1}`, map[string]string{"Origin": "http://evil.example"})
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("disallowed origin got Allow-Origin = %q", got)
	}
}

func TestRecoveryReturnsJSON500(t *testing.T) {
	h := withRecovery(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}), slog.New(slog.NewTextHandler(io.Discard, nil)))

	rec := do(t, h, http.MethodGet, "/", "", nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", rec.Code)
	}
	var got errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || got.Error.Code != "internal_error" {
		t.Errorf("body = %s", rec.Body)
	}
}

func TestReadiness(t *testing.T) {
	ready := true
	h := NewHandler(Config{Ready: func() bool { return ready }})

	if rec := do(t, h, http.MethodGet, "/readyz", "", nil); rec.Code != http.StatusOK {
		t.Errorf("ready status = %d", rec.Code)
	}

	ready = false
	rec := do(t, h, http.MethodGet, "/readyz", "", nil)
	var got errorResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &got)
	if rec.Code != http.StatusServiceUnavailable || got.Error.Code != "not_ready" {
		t.Errorf("draining status = %d, body = %s", rec.Code, rec.Body)
	}

	if rec := do(t, h, http.MethodGet, "/healthz", "", nil); rec.Code != http.StatusOK {
		t.Errorf("liveness must stay healthy while draining, status = %d", rec.Code)
	}
}

func TestRequestID(t *testing.T) {
	h := NewHandler(Config{})

	generated := do(t, h, http.MethodGet, "/healthz", "", nil).Header().Get(requestIDHeader)
	if len(generated) != 16 {
		t.Errorf("generated request ID = %q", generated)
	}

	got := do(t, h, http.MethodGet, "/healthz", "", map[string]string{requestIDHeader: "abc-123"}).Header().Get(requestIDHeader)
	if got != "abc-123" {
		t.Errorf("incoming request ID not kept, got %q", got)
	}

	for _, bad := range []string{"has spaces", "line\nbreak", strings.Repeat("a", 65)} {
		got := do(t, h, http.MethodGet, "/healthz", "", map[string]string{requestIDHeader: bad}).Header().Get(requestIDHeader)
		if got == bad || len(got) != 16 {
			t.Errorf("unsafe request ID %q was not replaced, got %q", bad, got)
		}
	}
}

func TestRequestLog(t *testing.T) {
	var buf bytes.Buffer
	h := NewHandler(Config{Logger: slog.New(slog.NewJSONHandler(&buf, nil))})

	do(t, h, http.MethodPost, "/api/v1/add", `{"a": 1, "b": 1}`, map[string]string{requestIDHeader: "req-1"})
	do(t, h, http.MethodGet, "/healthz", "", nil)

	var entry map[string]any
	if err := json.Unmarshal(bytes.SplitN(buf.Bytes(), []byte("\n"), 2)[0], &entry); err != nil {
		t.Fatalf("log line is not JSON: %v\n%s", err, buf.String())
	}
	if entry["request_id"] != "req-1" || entry["route"] != "/api/v1/{operation}" || entry["status"] != float64(200) {
		t.Errorf("log entry = %v", entry)
	}
	if strings.Contains(buf.String(), "/healthz") {
		t.Error("health checks should be logged at debug level only")
	}
}

func TestMetrics(t *testing.T) {
	h := NewHandler(Config{})
	do(t, h, http.MethodPost, "/api/v1/add", `{"a": 1, "b": 1}`, nil)
	do(t, h, http.MethodPost, "/api/v1/divide", `{"a": 1, "b": 0}`, nil)
	do(t, h, http.MethodPost, "/api/v1/modulo", `{"a": 1, "b": 0}`, nil)

	body := do(t, h, http.MethodGet, "/metrics", "", nil).Body.String()
	for _, want := range []string{
		`calculator_operations_total{operation="add",outcome="ok"} 1`,
		`calculator_operations_total{operation="divide",outcome="division_by_zero"} 1`,
		`http_requests_total{code="200",method="POST",route="/api/v1/{operation}"} 1`,
		`http_requests_total{code="422",method="POST",route="/api/v1/{operation}"} 1`,
		`http_request_duration_seconds_count{method="POST",route="/api/v1/{operation}"} 3`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics missing %s", want)
		}
	}
	if strings.Contains(body, `operation="modulo"`) {
		t.Error("unknown operations must not create metric labels")
	}
}

func TestSecurityAndCacheHeaders(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o750); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{"index.html": "<h1>hi</h1>", "assets/app-1a2b.js": "console.log(1)"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	h := NewHandler(Config{StaticDir: dir})

	api := do(t, h, http.MethodPost, "/api/v1/add", `{"a": 1, "b": 1}`, nil)
	for header, want := range map[string]string{
		"Cache-Control":           "no-store",
		"X-Content-Type-Options":  "nosniff",
		"X-Frame-Options":         "DENY",
		"Content-Security-Policy": "default-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'",
	} {
		if got := api.Header().Get(header); got != want {
			t.Errorf("API %s = %q, want %q", header, got, want)
		}
	}

	cases := map[string]string{
		"/":                     "no-cache",
		"/assets/app-1a2b.js":   "public, max-age=31536000, immutable",
		"/assets/missing-99.js": "",
	}
	for path, want := range cases {
		if got := do(t, h, http.MethodGet, path, "", nil).Header().Get("Cache-Control"); got != want {
			t.Errorf("%s Cache-Control = %q, want %q", path, got, want)
		}
	}
}

// discardWriter is a minimal ResponseWriter, so the benchmark measures the
// handler and middleware rather than httptest bookkeeping.
type discardWriter struct {
	header http.Header
	status int
}

func (d *discardWriter) Header() http.Header         { return d.header }
func (d *discardWriter) Write(p []byte) (int, error) { return len(p), nil }
func (d *discardWriter) WriteHeader(status int)      { d.status = status }

// BenchmarkCalculate measures one calculation through the full middleware
// chain, with logging disabled and with production JSON logging.
func BenchmarkCalculate(b *testing.B) {
	loggers := map[string]*slog.Logger{
		"no-logs":   nil,
		"json-logs": slog.New(slog.NewJSONHandler(io.Discard, nil)),
	}
	body := []byte(`{"a": 12.5, "b": 4}`)

	for name, logger := range loggers {
		b.Run(name, func(b *testing.B) {
			h := NewHandler(Config{Logger: logger})
			b.ReportAllocs()
			b.RunParallel(func(pb *testing.PB) {
				req, err := http.NewRequest(http.MethodPost, "/api/v1/divide", nil)
				if err != nil {
					b.Error(err)
					return
				}
				req.Header.Set("Content-Type", "application/json")
				w := &discardWriter{}
				for pb.Next() {
					req.Body = io.NopCloser(bytes.NewReader(body))
					w.header, w.status = http.Header{}, 0
					h.ServeHTTP(w, req)
					if w.status != http.StatusOK {
						b.Errorf("status = %d", w.status)
						return
					}
				}
			})
		})
	}
}

func TestEdgeCaseRequests(t *testing.T) {
	h := NewHandler(Config{})
	tests := []struct {
		name, method, path, body, want string
		headers                        map[string]string
		wantStatus                     int
	}{
		{"negative zero operands are echoed as zero", "POST", "/api/v1/add", `{"a": -0, "b": -0}`, `{"operation":"add","a":0,"b":0,"result":0}`, nil, 200},
		{"media type is case insensitive", "POST", "/api/v1/add", `{"a": 1, "b": 2}`, `{"operation":"add","a":1,"b":2,"result":3}`, map[string]string{"Content-Type": "Application/JSON"}, 200},
		{"missing content type is accepted", "POST", "/api/v1/add", `{"a": 1, "b": 2}`, `{"operation":"add","a":1,"b":2,"result":3}`, map[string]string{"Content-Type": ""}, 200},
		{"null b on unary operation is treated as absent", "POST", "/api/v1/sqrt", `{"a": 4, "b": null}`, `{"operation":"sqrt","a":4,"result":2}`, nil, 200},
		{"operation names are case sensitive", "POST", "/api/v1/ADD", `{"a": 1, "b": 2}`, "", nil, 404},
		{"empty operation", "POST", "/api/v1/", `{"a": 1, "b": 2}`, "", nil, 404},
		{"trailing slash", "POST", "/api/v1/add/", `{"a": 1, "b": 2}`, "", nil, 404},
		{"boolean operand", "POST", "/api/v1/add", `{"a": true, "b": 1}`, "", nil, 400},
		{"null body", "POST", "/api/v1/add", `null`, "", nil, 400},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := do(t, h, tt.method, tt.path, tt.body, tt.headers)
			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d, body = %s", rec.Code, tt.wantStatus, rec.Body)
			}
			if tt.want != "" && strings.TrimSpace(rec.Body.String()) != tt.want {
				t.Errorf("body = %s, want %s", rec.Body, tt.want)
			}
		})
	}
}

func TestStaticHandlerHardening(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<h1>hi</h1>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "app.js"), []byte("1"), 0o600); err != nil {
		t.Fatal(err)
	}
	h := NewHandler(Config{StaticDir: dir})

	if rec := do(t, h, http.MethodGet, "/assets/", "", nil); rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "app.js") {
		t.Errorf("directory listing exposed: status = %d, body = %s", rec.Code, rec.Body)
	}
	if rec := do(t, h, http.MethodPost, "/", "", nil); rec.Code != http.StatusMethodNotAllowed || rec.Header().Get("Allow") != "GET, HEAD" {
		t.Errorf("POST to static path: status = %d, Allow = %q", rec.Code, rec.Header().Get("Allow"))
	}
	if rec := do(t, h, http.MethodHead, "/", "", nil); rec.Code != http.StatusOK {
		t.Errorf("HEAD / status = %d", rec.Code)
	}

	for _, name := range []string{".env", filepath.Join("assets", ".secret")} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("TOKEN=abc"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []string{"/.env", "/assets/.secret", "/.git/config"} {
		if rec := do(t, h, http.MethodGet, p, "", nil); rec.Code != http.StatusNotFound || strings.Contains(rec.Body.String(), "TOKEN") {
			t.Errorf("dotfile %s exposed: status = %d", p, rec.Code)
		}
	}
}

func TestPanicAfterResponseStartedAbortsConnection(t *testing.T) {
	h := withObservability(withRecovery(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("partial"))
		panic("boom")
	}), slog.New(slog.DiscardHandler)), slog.New(slog.DiscardHandler), newMetrics(prometheus.NewRegistry()))

	defer func() {
		if v := recover(); v != http.ErrAbortHandler {
			t.Errorf("recovered %v, want http.ErrAbortHandler", v)
		}
	}()
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))
}
