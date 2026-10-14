package affiliate

import (
	"context"
	"strings"
	"testing"
	"time"
)

type feedStub []FeedProduct

func (f feedStub) ByCategory(context.Context, string, int) ([]FeedProduct, error) { return f, nil }

func TestRecommendSignsAndResolves(t *testing.T) {
	s := New(Config{Secret: []byte("k"), AmazonTag: "vw-21", Wrapper: "https://net.example/?url={url}"}, feedStub{
		{Partner: "myntra", Title: "Navy Chinos", Category: "bottoms", ColorHex: "#1C2B4B", URL: "https://www.myntra.com/p/1"},
		{Partner: "myntra", Title: "Red Chinos", Category: "bottoms", ColorHex: "#C8102E", URL: "https://www.myntra.com/p/2"},
	})
	ps, err := s.Recommend(context.Background(), []Need{{Category: "bottoms", Subcategory: "trousers", Colour: "Navy", Hex: "#1B2A4A"}}, "https://api.example")
	if err != nil {
		t.Fatal(err)
	}
	if ps[0].Title != "Navy Chinos" || len(ps) != 5 { // close feed product + 4 partner searches; red is too far
		t.Fatalf("got %d: %+v", len(ps), ps)
	}
	if ps[1].Title != "Navy Trousers" {
		t.Fatalf("search title %q", ps[1].Title)
	}
	for _, p := range ps {
		tok := strings.TrimPrefix(p.URL, "https://api.example/go/")
		partner, cat, target, err := s.Resolve(tok)
		if err != nil || partner != p.Partner || cat != "bottoms" {
			t.Fatalf("resolve %s: %v", p.Partner, err)
		}
		switch partner {
		case "amazon":
			if target != "https://www.amazon.in/s?k=navy+trousers&tag=vw-21" {
				t.Fatalf("amazon %s", target)
			}
		default:
			if !strings.HasPrefix(target, "https://net.example/?url=https%3A%2F%2F") {
				t.Fatalf("wrapper not applied: %s", target)
			}
		}
	}
	// Tampering and expiry are rejected.
	tok := strings.TrimPrefix(ps[1].URL, "https://api.example/go/")
	if _, _, _, err := s.Resolve("x" + tok); err == nil {
		t.Fatal("tampered token accepted")
	}
	s.now = func() time.Time { return time.Now().Add(31 * 24 * time.Hour) }
	if _, _, _, err := s.Resolve(tok); err == nil {
		t.Fatal("expired token accepted")
	}
}

func TestQueryAndUnknownCategory(t *testing.T) {
	if q := Query(Need{Category: "ethnic", Subcategory: "kurtas", Colour: "Mustard"}); q != "mustard kurta" {
		t.Fatal(q)
	}
	if _, err := New(Config{}, nil).Recommend(context.Background(), []Need{{Category: "spaceships"}}, ""); err == nil {
		t.Fatal("unknown category accepted")
	}
}
