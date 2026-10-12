package llmgateway

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Gateway asks its policy for an ordered plan, then calls models in that order until
// one succeeds, reporting every outcome to the health tracker.
type Gateway struct {
	models    []Model
	policy    RoutingPolicy
	health    HealthTracker
	estimator CostEstimator
	now       func() time.Time
}

type Options struct {
	Policy    RoutingPolicy // required
	Health    HealthTracker // default: NewEMATracker with defaults
	Estimator CostEstimator // default: TokenHeuristic
	Now       func() time.Time
}

func New(models []Model, opts Options) (*Gateway, error) {
	if len(models) == 0 {
		return nil, errors.New("at least one model is required")
	}
	if opts.Policy == nil {
		return nil, errors.New("a routing policy is required")
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if opts.Health == nil {
		opts.Health = NewEMATracker(EMAConfig{Now: opts.Now})
	}
	if opts.Estimator == nil {
		opts.Estimator = TokenHeuristic{}
	}
	return &Gateway{models: models, policy: opts.Policy, health: opts.Health, estimator: opts.Estimator, now: opts.Now}, nil
}

func (g *Gateway) Complete(ctx context.Context, req Request) (Response, error) {
	if req.MaxOutputTokens <= 0 {
		req.MaxOutputTokens = 256
	}
	plan, err := g.policy.Plan(req, g.candidates(req), g.now())
	if err != nil {
		return Response{}, err
	}

	var attempts []Attempt
	for _, c := range plan {
		if err := ctx.Err(); err != nil {
			return Response{Attempts: attempts}, err
		}
		start := g.now()
		text, err := c.Provider.Complete(ctx, req)
		elapsed := g.now().Sub(start)
		g.health.Record(c.Name, elapsed, err)
		if err != nil {
			attempts = append(attempts, Attempt{Model: c.Name, Error: err.Error()})
			continue
		}
		return Response{Model: c.Name, Text: text, Latency: elapsed, EstimatedCostUSD: c.EstimatedCostUSD, Attempts: attempts}, nil
	}
	return Response{Attempts: attempts}, fmt.Errorf("all %d eligible models failed: %s", len(plan), summarize(attempts))
}

func (g *Gateway) candidates(req Request) []Candidate {
	out := make([]Candidate, len(g.models))
	for i, m := range g.models {
		out[i] = Candidate{Model: m, Health: g.health.Health(m.Name), EstimatedCostUSD: g.estimator.EstimateUSD(m, req)}
	}
	return out
}

type ModelStats struct {
	Name               string    `json:"name"`
	Quality            int       `json:"quality"`
	InputPricePerMTok  float64   `json:"input_price_per_mtok"`
	OutputPricePerMTok float64   `json:"output_price_per_mtok"`
	EMALatencyMs       float64   `json:"ema_latency_ms"`
	Samples            int       `json:"samples"`
	ConsecutiveFails   int       `json:"consecutive_failures"`
	BenchedUntil       time.Time `json:"benched_until,omitzero"`
}

func (g *Gateway) Stats() []ModelStats {
	now := g.now()
	out := make([]ModelStats, len(g.models))
	for i, m := range g.models {
		h := g.health.Health(m.Name)
		out[i] = ModelStats{
			Name:               m.Name,
			Quality:            m.Quality,
			InputPricePerMTok:  m.InputPricePerMTok,
			OutputPricePerMTok: m.OutputPricePerMTok,
			EMALatencyMs:       float64(h.EMALatency) / float64(time.Millisecond),
			Samples:            h.Samples,
			ConsecutiveFails:   h.ConsecutiveFails,
		}
		if h.Benched(now) {
			out[i].BenchedUntil = h.BenchedUntil
		}
	}
	return out
}

func summarize(attempts []Attempt) string {
	parts := make([]string, len(attempts))
	for i, a := range attempts {
		parts[i] = a.Model + ": " + a.Error
	}
	return strings.Join(parts, "; ")
}
