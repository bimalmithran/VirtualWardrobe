// Package llmgateway routes completion requests across several LLM backends.
//
// Routing policy, per request:
//  1. Estimate the request's worst-case cost on every model (prompt tokens + max output
//     tokens at that model's prices) and drop models above the cost ceiling.
//  2. Drop models below the requested quality tier and models in failure cooldown.
//  3. Try models that have never been measured first (cheapest first), so every model
//     gets a latency sample. Then try the rest by ascending EMA latency, cheaper first on ties.
//  4. On error, fall through to the next candidate. After FailureThreshold consecutive
//     errors a model is benched for Cooldown.
//
// Each successful call updates that model's latency EMA:
//
//	ema = alpha*observed + (1-alpha)*ema
//
// A high alpha reacts quickly to a provider slowing down; a low alpha smooths out jitter.
package llmgateway

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

// Provider is one callable model. Real clients (OpenAI, Anthropic, a local llama.cpp
// server, ...) implement this; MockProvider simulates one for the POC.
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
	// Optional per-request ceiling. The effective ceiling is the lower of this and the gateway's.
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

type Config struct {
	CostCeilingUSD   float64       // hard per-request ceiling; required
	Alpha            float64       // EMA smoothing factor in (0, 1]; default 0.3
	FailureThreshold int           // consecutive failures before cooldown; default 3
	Cooldown         time.Duration // default 30s
	Now              func() time.Time
}

var ErrNoEligibleModel = errors.New("no model satisfies the cost ceiling and quality requirement")

type Gateway struct {
	cfg Config

	mu     sync.Mutex
	models []*modelState
}

type modelState struct {
	Model
	ema         time.Duration
	samples     int
	consecFails int
	benchedTill time.Time
}

func New(cfg Config, models ...Model) (*Gateway, error) {
	if cfg.CostCeilingUSD <= 0 {
		return nil, errors.New("CostCeilingUSD must be positive")
	}
	if cfg.Alpha <= 0 || cfg.Alpha > 1 {
		cfg.Alpha = 0.3
	}
	if cfg.FailureThreshold <= 0 {
		cfg.FailureThreshold = 3
	}
	if cfg.Cooldown <= 0 {
		cfg.Cooldown = 30 * time.Second
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if len(models) == 0 {
		return nil, errors.New("at least one model is required")
	}
	g := &Gateway{cfg: cfg}
	for _, m := range models {
		g.models = append(g.models, &modelState{Model: m})
	}
	return g, nil
}

// EstimateTokens is a deliberately rough ~4 characters per token heuristic. Swap in the
// provider's tokenizer when cost accuracy matters.
func EstimateTokens(s string) int {
	return (len(s) + 3) / 4
}

func (m Model) estimateCost(req Request) float64 {
	in := float64(EstimateTokens(req.Prompt))
	out := float64(req.MaxOutputTokens)
	return (in*m.InputPricePerMTok + out*m.OutputPricePerMTok) / 1e6
}

func (g *Gateway) Complete(ctx context.Context, req Request) (Response, error) {
	if req.MaxOutputTokens <= 0 {
		req.MaxOutputTokens = 256
	}
	candidates, err := g.plan(req)
	if err != nil {
		return Response{}, err
	}

	var attempts []Attempt
	for _, c := range candidates {
		if err := ctx.Err(); err != nil {
			return Response{Attempts: attempts}, err
		}
		start := g.cfg.Now()
		text, err := c.Provider.Complete(ctx, req)
		elapsed := g.cfg.Now().Sub(start)
		g.record(c, elapsed, err)
		if err != nil {
			attempts = append(attempts, Attempt{Model: c.Name, Error: err.Error()})
			continue
		}
		return Response{
			Model:            c.Name,
			Text:             text,
			Latency:          elapsed,
			EstimatedCostUSD: c.estimateCost(req),
			Attempts:         attempts,
		}, nil
	}
	return Response{Attempts: attempts}, fmt.Errorf("all %d eligible models failed: %s", len(candidates), summarize(attempts))
}

// plan returns the eligible models in the order they should be tried. It works on
// snapshots so the lock is not held during network calls.
func (g *Gateway) plan(req Request) ([]modelState, error) {
	ceiling := g.cfg.CostCeilingUSD
	if req.CostCeilingUSD > 0 && req.CostCeilingUSD < ceiling {
		ceiling = req.CostCeilingUSD
	}
	now := g.cfg.Now()

	g.mu.Lock()
	var eligible []modelState
	for _, m := range g.models {
		if m.Quality < req.MinQuality || m.estimateCost(req) > ceiling || now.Before(m.benchedTill) {
			continue
		}
		eligible = append(eligible, *m)
	}
	g.mu.Unlock()

	if len(eligible) == 0 {
		return nil, fmt.Errorf("%w (ceiling $%.6f, min quality %d)", ErrNoEligibleModel, ceiling, req.MinQuality)
	}
	sort.SliceStable(eligible, func(i, j int) bool {
		a, b := eligible[i], eligible[j]
		if (a.samples == 0) != (b.samples == 0) {
			return a.samples == 0 // explore unmeasured models first
		}
		if a.samples > 0 && a.ema != b.ema {
			return a.ema < b.ema
		}
		return a.estimateCost(req) < b.estimateCost(req)
	})
	return eligible, nil
}

func (g *Gateway) record(snapshot modelState, elapsed time.Duration, callErr error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, m := range g.models {
		if m.Name != snapshot.Name {
			continue
		}
		if callErr != nil {
			m.consecFails++
			if m.consecFails >= g.cfg.FailureThreshold {
				m.benchedTill = g.cfg.Now().Add(g.cfg.Cooldown)
				m.consecFails = 0
			}
			return
		}
		m.consecFails = 0
		if m.samples == 0 {
			m.ema = elapsed // seed with the first observation instead of decaying from zero
		} else {
			a := g.cfg.Alpha
			m.ema = time.Duration(a*float64(elapsed) + (1-a)*float64(m.ema))
		}
		m.samples++
		return
	}
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
	g.mu.Lock()
	defer g.mu.Unlock()
	out := make([]ModelStats, 0, len(g.models))
	for _, m := range g.models {
		s := ModelStats{
			Name:               m.Name,
			Quality:            m.Quality,
			InputPricePerMTok:  m.InputPricePerMTok,
			OutputPricePerMTok: m.OutputPricePerMTok,
			EMALatencyMs:       float64(m.ema) / float64(time.Millisecond),
			Samples:            m.samples,
			ConsecutiveFails:   m.consecFails,
		}
		if g.cfg.Now().Before(m.benchedTill) {
			s.BenchedUntil = m.benchedTill
		}
		out = append(out, s)
	}
	return out
}

func (g *Gateway) CostCeilingUSD() float64 { return g.cfg.CostCeilingUSD }

func summarize(attempts []Attempt) string {
	parts := make([]string, len(attempts))
	for i, a := range attempts {
		parts[i] = a.Model + ": " + a.Error
	}
	return strings.Join(parts, "; ")
}
