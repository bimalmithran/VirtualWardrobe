// Package stylist answers styling questions about the user's own closet as a stream of
// events: text deltas and structured outfit cards that reference real closet items.
package stylist

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// Turn is one message of the conversation as the app shows it (text only; cards the
// assistant showed are summarised into its text by the app).
type Turn struct {
	Role string `json:"role"` // "user" or "assistant"
	Text string `json:"text"`
}

// ClosetItem is the text summary of a garment the app sends: no photos ever leave the phone
// for the stylist.
type ClosetItem struct {
	ID          string   `json:"id"`
	Category    string   `json:"category"`
	Subcategory string   `json:"subcategory,omitempty"`
	Colour      string   `json:"colour"`
	Hex         string   `json:"hex"`
	Pattern     string   `json:"pattern,omitempty"`
	Occasions   []string `json:"occasions,omitempty"`
	Weather     []string `json:"weather,omitempty"`
	WearCount   int      `json:"wear_count"`
	Favourite   bool     `json:"favourite,omitempty"`
}

// Candidate is a look the app's on-device generator already scored for the question's context.
type Candidate struct {
	ItemIDs []string `json:"item_ids"`
	Score   int      `json:"score"`
}

// Wearer is what the stylist may know about the user's colouring and shape.
type Wearer struct {
	Undertone string `json:"undertone,omitempty"`
	Season    string `json:"season,omitempty"` // 12-season type
	BodyShape string `json:"body_shape,omitempty"`
	HeightCm  int    `json:"height_cm,omitempty"`
}

// Request is one chat turn.
type Request struct {
	Messages   []Turn       `json:"messages"`
	Closet     []ClosetItem `json:"closet"`
	Candidates []Candidate  `json:"candidates"`
	Wearer     Wearer       `json:"wearer"`
	// Free-form context the app knows: local date and time, season, city weather if known.
	Context string `json:"context"`
}

const (
	maxTurns     = 30
	maxTurnChars = 2000
	maxCloset    = 400
	maxCards     = 3
)

// Validate bounds the request so a client can't send an unbounded prompt.
func (r *Request) Validate() error {
	switch {
	case len(r.Messages) == 0:
		return errors.New("messages is empty")
	case len(r.Messages) > maxTurns:
		return fmt.Errorf("at most %d messages", maxTurns)
	case len(r.Closet) > maxCloset:
		return fmt.Errorf("at most %d closet items", maxCloset)
	case r.Messages[len(r.Messages)-1].Role != "user":
		return errors.New("the last message must be from the user")
	}
	for i, t := range r.Messages {
		if t.Role != "user" && t.Role != "assistant" {
			return fmt.Errorf("messages[%d].role must be user or assistant", i)
		}
		if strings.TrimSpace(t.Text) == "" || len(t.Text) > maxTurnChars {
			return fmt.Errorf("messages[%d].text must be 1-%d characters", i, maxTurnChars)
		}
	}
	return nil
}

// Event is something to send to the app.
type Event interface{ eventName() string }

// TextDelta is a chunk of the stylist's reply.
type TextDelta struct {
	Text string `json:"text"`
}

// OutfitCard is a tappable outfit built only from items in the user's closet.
type OutfitCard struct {
	Title   string   `json:"title"`
	ItemIDs []string `json:"item_ids"`
	Reason  string   `json:"reason"`
}

// Done ends a successful stream.
type Done struct {
	Provider     string `json:"provider"`
	Model        string `json:"model,omitempty"`
	InputTokens  int64  `json:"input_tokens,omitempty"`
	OutputTokens int64  `json:"output_tokens,omitempty"`
	CacheRead    int64  `json:"cache_read_tokens,omitempty"`
}

func (TextDelta) eventName() string  { return "delta" }
func (OutfitCard) eventName() string { return "outfit" }
func (Done) eventName() string       { return "done" }

// Name is the SSE event name for e.
func Name(e Event) string { return e.eventName() }

// Streamer produces one reply. emit returning an error (client gone) stops the stream.
type Streamer interface {
	Stream(ctx context.Context, req Request, emit func(Event) error) error
}

// ErrRefused means the model declined the request; the app shows a gentle message.
var ErrRefused = errors.New("the stylist can't help with that request")

// sanitizeCard keeps only item ids that exist in the closet, de-duplicated, and trims text.
// It returns false when nothing valid is left.
func sanitizeCard(c OutfitCard, closet map[string]bool) (OutfitCard, bool) {
	seen := map[string]bool{}
	ids := c.ItemIDs[:0:0]
	for _, id := range c.ItemIDs {
		if closet[id] && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	c.ItemIDs = ids
	c.Title = clip(strings.TrimSpace(c.Title), 60)
	c.Reason = clip(strings.TrimSpace(c.Reason), 300)
	if c.Title == "" {
		c.Title = "Outfit"
	}
	return c, len(ids) > 0
}

func clip(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n-1]) + "…"
	}
	return s
}

func closetIndex(items []ClosetItem) map[string]bool {
	m := make(map[string]bool, len(items))
	for _, it := range items {
		m[it.ID] = true
	}
	return m
}
