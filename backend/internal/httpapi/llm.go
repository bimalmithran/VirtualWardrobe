package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/llmgateway"
)

type llmHandler struct {
	llm   Completer
	stats ModelStatsReporter
	errs  errorWriter
}

type llmRequest struct {
	Prompt          string  `json:"prompt"`
	MaxOutputTokens int     `json:"max_output_tokens"`
	MinQuality      int     `json:"min_quality"`
	CostCeilingUSD  float64 `json:"cost_ceiling_usd"`
}

func (h *llmHandler) complete(w http.ResponseWriter, r *http.Request) {
	var req llmRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Prompt == "" {
		writeError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	resp, err := h.llm.Complete(ctx, llmgateway.Request{
		Prompt: req.Prompt, MaxOutputTokens: req.MaxOutputTokens, MinQuality: req.MinQuality, CostCeilingUSD: req.CostCeilingUSD,
	})
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, resp)
	case len(resp.Attempts) > 0: // every eligible upstream failed
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error(), "attempts": resp.Attempts})
	default:
		h.errs.write(w, err)
	}
}

func (h *llmHandler) models(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"models": h.stats.Stats()})
}
