package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/nitin-100/sezzle-calculator/backend/internal/api"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
)

// Set at build time with -ldflags "-X main.version=... -X main.commit=...".
var (
	version = "dev"
	commit  = "unknown"
)

func main() {
	// Used by the Docker HEALTHCHECK, since the distroless image has no curl.
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		os.Exit(healthcheck())
	}

	var level slog.Level
	levelErr := level.UnmarshalText([]byte(envOr("LOG_LEVEL", "info")))
	if levelErr != nil {
		level = slog.LevelInfo
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
	if levelErr != nil {
		logger.Warn("invalid LOG_LEVEL, using info", "value", os.Getenv("LOG_LEVEL"))
	}

	if err := run(logger); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	drainDelay, err := time.ParseDuration(envOr("SHUTDOWN_DRAIN_DELAY", "0s"))
	if err != nil {
		return fmt.Errorf("invalid SHUTDOWN_DRAIN_DELAY: %w", err)
	}

	reg := prometheus.NewRegistry()
	buildInfo := prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "calculator_build_info",
		Help: "Always 1. Labels identify the running release.",
	}, []string{"version", "commit"})
	buildInfo.WithLabelValues(version, commit).Set(1)
	reg.MustRegister(
		buildInfo,
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)

	var ready atomic.Bool
	addr := ":" + envOr("PORT", "8080")
	srv := &http.Server{
		Addr: addr,
		Handler: api.NewHandler(api.Config{
			Logger:         logger,
			Version:        version,
			StaticDir:      os.Getenv("STATIC_DIR"),
			AllowedOrigins: splitList(os.Getenv("ALLOWED_ORIGINS")),
			Registry:       reg,
			Ready:          ready.Load,
		}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	ready.Store(true)

	errCh := make(chan error, 1)
	go func() {
		logger.Info("server listening", "addr", addr, "version", version, "commit", commit)
		errCh <- srv.Serve(ln)
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}
	// A second signal now kills the process immediately.
	stop()

	// Fail readiness first and wait, so the load balancer stops sending new
	// requests before the listener closes. In-flight requests then finish.
	ready.Store(false)
	logger.Info("shutting down", "drain_delay", drainDelay.String())
	time.Sleep(drainDelay)

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	if err := <-errCh; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	logger.Info("server stopped cleanly")
	return nil
}

func healthcheck() int {
	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + envOr("PORT", "8080") + "/healthz")
	if err != nil {
		return 1
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func splitList(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}
