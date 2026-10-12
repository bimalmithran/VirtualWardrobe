package llmgateway

import (
	"errors"
	"fmt"
	"sort"
	"time"
)

var ErrNoEligibleModel = errors.New("no model satisfies the cost ceiling and quality requirement")

// Candidate is a model with everything a policy needs to judge it.
type Candidate struct {
	Model
	Health           Health
	EstimatedCostUSD float64
}

// RoutingPolicy filters and orders candidates. The gateway tries them in order until one
// succeeds. Returning an empty slice means nothing is eligible.
type RoutingPolicy interface {
	Plan(req Request, candidates []Candidate, now time.Time) ([]Candidate, error)
}

// CheapestFastestUnderCeiling is the default policy:
//  1. drop models over the cost ceiling, below MinQuality, or benched;
//  2. try never-measured models first (cheapest first) so every model gets a latency sample;
//  3. then order by ascending EMA latency, cheaper first on ties.
type CheapestFastestUnderCeiling struct {
	CeilingUSD float64
}

func (p CheapestFastestUnderCeiling) Plan(req Request, candidates []Candidate, now time.Time) ([]Candidate, error) {
	ceiling := p.CeilingUSD
	if req.CostCeilingUSD > 0 && req.CostCeilingUSD < ceiling {
		ceiling = req.CostCeilingUSD
	}
	var eligible []Candidate
	for _, c := range candidates {
		if c.Quality >= req.MinQuality && c.EstimatedCostUSD <= ceiling && !c.Health.Benched(now) {
			eligible = append(eligible, c)
		}
	}
	if len(eligible) == 0 {
		return nil, fmt.Errorf("%w (ceiling $%.6f, min quality %d)", ErrNoEligibleModel, ceiling, req.MinQuality)
	}
	sort.SliceStable(eligible, func(i, j int) bool {
		a, b := eligible[i], eligible[j]
		if (a.Health.Samples == 0) != (b.Health.Samples == 0) {
			return a.Health.Samples == 0
		}
		if a.Health.Samples > 0 && a.Health.EMALatency != b.Health.EMALatency {
			return a.Health.EMALatency < b.Health.EMALatency
		}
		return a.EstimatedCostUSD < b.EstimatedCostUSD
	})
	return eligible, nil
}
