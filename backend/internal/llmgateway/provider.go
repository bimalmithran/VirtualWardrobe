// Package llmgateway routes completion requests across several LLM backends.
//
// It is built from single-purpose parts that the Gateway composes:
//
//	Provider       calls one model (real SDK client, local server, or MockProvider)
//	CostEstimator  predicts a request's worst-case cost on a model
//	HealthTracker  keeps a latency EMA per model and benches models that keep failing
//	RoutingPolicy  decides which models are eligible and in which order to try them
//
// Any part can be swapped (e.g. a tokenizer-accurate estimator, or a policy that weighs
// quality against latency) without touching the Gateway.
package llmgateway

import (
	"context"
	"time"
)

// Provider is one callable model.
type Provider interface {
	Complete(ctx context.Context, req Request) (string, error)
}

type Model struct {
	Name     string
	Provider Provider
	// USD per million tokens.
	InputPricePerMTok  float64
	OutputPricePerMTok float64
	// Coarse capability tier (1 = small/fast ... 3 = frontier). Requests can demand a minimum.
	Quality int
}

type Request struct {
	Prompt          string
	MaxOutputTokens int
	MinQuality      int
	// Optional per-request ceiling. A policy may only tighten its own ceiling with it.
	CostCeilingUSD float64
}

type Response struct {
	Model            string        `json:"model"`
	Text             string        `json:"text"`
	Latency          time.Duration `json:"latency_ns"`
	EstimatedCostUSD float64       `json:"estimated_cost_usd"`
	// Models tried before this one, with their errors.
	Attempts []Attempt `json:"attempts,omitempty"`
}

type Attempt struct {
	Model string `json:"model"`
	Error string `json:"error"`
}
