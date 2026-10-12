package llmgateway

// CostEstimator predicts what a request will cost on a model, in USD.
type CostEstimator interface {
	EstimateUSD(m Model, req Request) float64
}

// TokenHeuristic assumes ~4 characters per prompt token and that the model uses all of
// MaxOutputTokens (worst case). Swap in a tokenizer-backed estimator when accuracy matters.
type TokenHeuristic struct{}

func (TokenHeuristic) EstimateUSD(m Model, req Request) float64 {
	in := float64(EstimateTokens(req.Prompt))
	out := float64(req.MaxOutputTokens)
	return (in*m.InputPricePerMTok + out*m.OutputPricePerMTok) / 1e6
}

func EstimateTokens(s string) int {
	return (len(s) + 3) / 4
}
