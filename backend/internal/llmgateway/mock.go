package llmgateway

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"
)

// MockProvider simulates a hosted model: a base latency with jitter and a random
// failure rate. It lets the POC show EMA routing and failover without API keys.
type MockProvider struct {
	Name        string
	BaseLatency time.Duration
	Jitter      time.Duration
	FailureRate float64 // 0..1
}

func (p *MockProvider) Complete(ctx context.Context, req Request) (string, error) {
	delay := p.BaseLatency
	if p.Jitter > 0 {
		delay += time.Duration(rand.Int64N(int64(p.Jitter)))
	}
	select {
	case <-time.After(delay):
	case <-ctx.Done():
		return "", ctx.Err()
	}
	if rand.Float64() < p.FailureRate {
		return "", errors.New("simulated upstream 503")
	}
	return fmt.Sprintf("[%s] simulated reply to a %d-token prompt", p.Name, EstimateTokens(req.Prompt)), nil
}

// DemoModels is the POC's model table. Names and prices are placeholders for local
// testing, not real provider pricing; replace them with your providers' published rates.
func DemoModels() []Model {
	return []Model{
		{
			Name:              "small-fast",
			Provider:          &MockProvider{Name: "small-fast", BaseLatency: 150 * time.Millisecond, Jitter: 100 * time.Millisecond, FailureRate: 0.05},
			InputPricePerMTok: 0.10, OutputPricePerMTok: 0.40, Quality: 1,
		},
		{
			Name:              "balanced",
			Provider:          &MockProvider{Name: "balanced", BaseLatency: 400 * time.Millisecond, Jitter: 300 * time.Millisecond, FailureRate: 0.05},
			InputPricePerMTok: 1.00, OutputPricePerMTok: 4.00, Quality: 2,
		},
		{
			Name:              "frontier",
			Provider:          &MockProvider{Name: "frontier", BaseLatency: 900 * time.Millisecond, Jitter: 600 * time.Millisecond, FailureRate: 0.02},
			InputPricePerMTok: 5.00, OutputPricePerMTok: 25.00, Quality: 3,
		},
	}
}
