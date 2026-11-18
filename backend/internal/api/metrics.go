package api

import "github.com/prometheus/client_golang/prometheus"

type metrics struct {
	requests   *prometheus.CounterVec
	duration   *prometheus.HistogramVec
	operations *prometheus.CounterVec
}

func newMetrics(reg prometheus.Registerer) *metrics {
	m := &metrics{
		requests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "HTTP requests by method, route and status code.",
		}, []string{"method", "route", "code"}),
		duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request latency by method and route.",
			Buckets: []float64{.0005, .001, .0025, .005, .01, .025, .05, .1, .25, .5, 1},
		}, []string{"method", "route"}),
		operations: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "calculator_operations_total",
			Help: "Calculations by operation and outcome (ok or an error code).",
		}, []string{"operation", "outcome"}),
	}
	reg.MustRegister(m.requests, m.duration, m.operations)
	return m
}
