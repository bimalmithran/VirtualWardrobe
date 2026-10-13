package stylist

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/shared/constant"
)

// DefaultModel is Claude Opus 5.5.
const DefaultModel = "claude-opus-5-5"

// maxRounds bounds the show_outfit -> reply loop.
const maxRounds = 3

// Claude streams replies from the Claude Messages API.
type Claude struct {
	client anthropic.Client
	model  string
}

// NewClaude uses ANTHROPIC_API_KEY (or another credential the SDK resolves) unless apiKey is set.
func NewClaude(apiKey, model string) *Claude {
	opts := []option.RequestOption{}
	if apiKey != "" {
		opts = append(opts, option.WithAPIKey(apiKey))
	}
	if model == "" {
		model = DefaultModel
	}
	return &Claude{client: anthropic.NewClient(opts...), model: model}
}

var showOutfitTool = anthropic.BetaToolUnionParam{OfTool: &anthropic.BetaToolParam{
	Name:        "show_outfit",
	Description: anthropic.String("Show the user one outfit from their closet as a tappable card with photos. Call once per outfit, before writing the reply."),
	Strict:      anthropic.Bool(true),
	// Cards are emitted when the call completes; eager streaming keeps a long call from
	// arriving in one burst, and the input is validated before use.
	EagerInputStreaming: anthropic.Bool(true),
	InputSchema: anthropic.BetaToolInputSchemaParam{
		Properties: map[string]any{
			"title":    map[string]any{"type": "string", "description": "A short, friendly name for the look, e.g. 'Rainy dinner, smart casual'."},
			"item_ids": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Ids of the closet items in the outfit, top to bottom."},
			"reason":   map[string]any{"type": "string", "description": "One sentence on why it works for this question."},
		},
		Required:    []string{"title", "item_ids", "reason"},
		ExtraFields: map[string]any{"additionalProperties": false},
	},
}}

func (c *Claude) Stream(ctx context.Context, req Request, emit func(Event) error) error {
	closet := closetIndex(req.Closet)
	params := anthropic.BetaMessageNewParams{
		Model:     c.model,
		MaxTokens: 8000,
		// Chat is latency-sensitive: low effort answers quickly and is enough for styling.
		OutputConfig: anthropic.BetaOutputConfigParam{Effort: anthropic.BetaOutputConfigEffortLow},
		// A declined request is retried server-side on the model Anthropic recommends.
		Betas:     []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01},
		Fallbacks: anthropic.BetaFallbacksParamUnion{OfDefault: constant.ValueOf[constant.Default]()},
		Tools:     []anthropic.BetaToolUnionParam{showOutfitTool},
		// Stable instructions, then the user's closet; both cached, so follow-up turns in a
		// conversation only pay for the new messages.
		System: []anthropic.BetaTextBlockParam{
			{Text: systemPrompt},
			{Text: closetPrompt(req), CacheControl: anthropic.NewBetaCacheControlEphemeralParam()},
		},
		Messages: toParams(req),
	}

	done := Done{Provider: "claude", Model: c.model}
	cards := 0
	for round := 0; round < maxRounds; round++ {
		msg, err := c.streamRound(ctx, params, emit)
		if err != nil {
			return err
		}
		done.InputTokens += msg.Usage.InputTokens
		done.OutputTokens += msg.Usage.OutputTokens
		done.CacheRead += msg.Usage.CacheReadInputTokens
		if msg.StopReason == anthropic.BetaStopReasonRefusal {
			return ErrRefused
		}

		var results []anthropic.BetaContentBlockParamUnion
		for _, block := range msg.Content {
			use, ok := block.AsAny().(anthropic.BetaToolUseBlock)
			if !ok {
				continue
			}
			card, err := decodeCard(use.Input)
			if err != nil {
				results = append(results, anthropic.NewBetaToolResultBlock(use.ID, "Invalid input: "+err.Error(), true))
				continue
			}
			clean, ok := sanitizeCard(card, closet)
			if !ok || cards >= maxCards {
				results = append(results, anthropic.NewBetaToolResultBlock(use.ID, "Not shown: use only ids from the closet list, at most three outfits.", true))
				continue
			}
			if err := emit(clean); err != nil {
				return err
			}
			cards++
			results = append(results, anthropic.NewBetaToolResultBlock(use.ID, "Shown to the user.", false))
		}
		if msg.StopReason != anthropic.BetaStopReasonToolUse || len(results) == 0 {
			return emit(done)
		}
		params.Messages = append(params.Messages, msg.ToParam(), anthropic.NewBetaUserMessage(results...))
	}
	return emit(done)
}

// streamRound streams one request, forwarding visible text as it arrives.
func (c *Claude) streamRound(ctx context.Context, params anthropic.BetaMessageNewParams, emit func(Event) error) (anthropic.BetaMessage, error) {
	stream := c.client.Beta.Messages.NewStreaming(ctx, params)
	defer stream.Close()
	var msg anthropic.BetaMessage
	for stream.Next() {
		ev := stream.Current()
		if err := msg.Accumulate(ev); err != nil {
			return msg, err
		}
		if delta, ok := ev.AsAny().(anthropic.BetaRawContentBlockDeltaEvent); ok {
			if text, ok := delta.Delta.AsAny().(anthropic.BetaTextDelta); ok && text.Text != "" {
				if err := emit(TextDelta{Text: text.Text}); err != nil {
					return msg, err
				}
			}
		}
	}
	if err := stream.Err(); err != nil {
		return msg, fmt.Errorf("claude: %w", err)
	}
	return msg, nil
}

// toParams maps the app's text history to API messages; the newest user turn carries the
// per-request context after the cached prefix.
func toParams(req Request) []anthropic.BetaMessageParam {
	out := make([]anthropic.BetaMessageParam, 0, len(req.Messages))
	for i, t := range req.Messages {
		text := t.Text
		if i == len(req.Messages)-1 {
			if ctx := contextLine(req); ctx != "" {
				text = ctx + "\n\nQuestion: " + text
			}
		}
		block := anthropic.NewBetaTextBlock(text)
		if t.Role == "assistant" {
			out = append(out, anthropic.BetaMessageParam{Role: anthropic.BetaMessageParamRoleAssistant, Content: []anthropic.BetaContentBlockParamUnion{block}})
		} else {
			out = append(out, anthropic.NewBetaUserMessage(block))
		}
	}
	return out
}

// decodeCard validates a tool input strictly: eager streaming means the API no longer
// validates it, so a truncated or malformed input must not become a card.
func decodeCard(input any) (OutfitCard, error) {
	raw, err := json.Marshal(input)
	if err != nil {
		return OutfitCard{}, err
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var card OutfitCard
	if err := dec.Decode(&card); err != nil {
		return OutfitCard{}, err
	}
	if card.ItemIDs == nil {
		return OutfitCard{}, fmt.Errorf("item_ids is required")
	}
	return card, nil
}
