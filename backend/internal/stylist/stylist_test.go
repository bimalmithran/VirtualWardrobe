package stylist

import (
	"context"
	"strings"
	"testing"
)

func TestValidate(t *testing.T) {
	ok := Request{Messages: []Turn{{Role: "user", Text: "hi"}}}
	if err := ok.Validate(); err != nil {
		t.Fatal(err)
	}
	for name, r := range map[string]Request{
		"empty":          {},
		"last assistant": {Messages: []Turn{{Role: "user", Text: "a"}, {Role: "assistant", Text: "b"}}},
		"bad role":       {Messages: []Turn{{Role: "system", Text: "a"}}},
		"blank":          {Messages: []Turn{{Role: "user", Text: "  "}}},
		"long":           {Messages: []Turn{{Role: "user", Text: strings.Repeat("x", maxTurnChars+1)}}},
	} {
		if r.Validate() == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestSanitizeAndDecodeCard(t *testing.T) {
	closet := map[string]bool{"a": true, "b": true}
	c, ok := sanitizeCard(OutfitCard{Title: " Look ", ItemIDs: []string{"a", "x", "a", "b"}}, closet)
	if !ok || strings.Join(c.ItemIDs, ",") != "a,b" || c.Title != "Look" {
		t.Fatalf("got %+v %v", c, ok)
	}
	if _, ok := sanitizeCard(OutfitCard{ItemIDs: []string{"x"}}, closet); ok {
		t.Fatal("card with no real items accepted")
	}
	if _, err := decodeCard(map[string]any{"title": "t", "item_ids": []any{"a"}, "reason": "r"}); err != nil {
		t.Fatal(err)
	}
	if _, err := decodeCard(map[string]any{"title": "t", "extra": 1, "item_ids": []any{"a"}}); err == nil {
		t.Fatal("unknown field accepted")
	}
	if _, err := decodeCard(map[string]any{"title": "t"}); err == nil {
		t.Fatal("truncated input accepted")
	}
}

func TestLocalStylistStreamsCardsThenText(t *testing.T) {
	req := Request{
		Messages: []Turn{{Role: "user", Text: "What should I wear to a rainy dinner tonight?"}},
		Closet: []ClosetItem{
			{ID: "s", Category: "tops", Subcategory: "shirts", Colour: "navy"},
			{ID: "t", Category: "bottoms", Subcategory: "trousers", Colour: "charcoal"},
		},
		Candidates: []Candidate{{ItemIDs: []string{"s", "t", "ghost"}, Score: 80}},
	}
	var names []string
	var text strings.Builder
	err := Local{}.Stream(context.Background(), req, func(e Event) error {
		names = append(names, Name(e))
		if d, ok := e.(TextDelta); ok {
			text.WriteString(d.Text)
		}
		if c, ok := e.(OutfitCard); ok && len(c.ItemIDs) != 2 {
			t.Errorf("ghost id kept: %v", c.ItemIDs)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if names[0] != "outfit" || names[len(names)-1] != "done" {
		t.Fatalf("order: %v", names)
	}
	if !strings.Contains(text.String(), "for dinner") || !strings.Contains(text.String(), "closed shoes") {
		t.Fatalf("reply ignored context: %q", text.String())
	}
}
