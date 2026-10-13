package stylist

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// Local answers without an LLM, from the looks the app's on-device generator already
// scored. It keeps the chat usable when no API key is configured (development, or an
// operator who doesn't want an LLM provider), and is honest that it is the basic stylist.
type Local struct {
	// Delay between streamed words, so the app's streaming path is exercised.
	WordDelay time.Duration
}

func (l Local) Stream(ctx context.Context, req Request, emit func(Event) error) error {
	byID := map[string]ClosetItem{}
	for _, it := range req.Closet {
		byID[it.ID] = it
	}
	closet := closetIndex(req.Closet)
	question := strings.ToLower(req.Messages[len(req.Messages)-1].Text)
	occasion := detect(question, map[string]string{
		"wedding": "a wedding", "shaadi": "a wedding", "festive": "a festive day", "diwali": "Diwali", "onam": "Onam",
		"office": "work", "work": "work", "meeting": "work", "interview": "an interview", "dinner": "dinner",
		"party": "a party", "date": "a date", "gym": "the gym", "brunch": "brunch",
	})
	weather := detect(question, map[string]string{"rain": "rain", "monsoon": "rain", "cold": "the cold", "winter": "the cold", "hot": "the heat", "summer": "the heat"})

	var shown []OutfitCard
	for i, c := range req.Candidates {
		if len(shown) == 2 {
			break
		}
		card, ok := sanitizeCard(OutfitCard{Title: fmt.Sprintf("Option %d", i+1), ItemIDs: c.ItemIDs, Reason: describe(c.ItemIDs, byID)}, closet)
		if !ok {
			continue
		}
		if err := emit(card); err != nil {
			return err
		}
		shown = append(shown, card)
	}

	var reply string
	switch {
	case len(req.Closet) == 0:
		reply = "Your closet is empty so far. Add a few tops, bottoms and a pair of shoes and I can put outfits together for you."
	case len(shown) == 0:
		reply = "I couldn't put together a complete outfit for that from your closet. Tag your pieces with a category (and occasions) so I can match them, or add a versatile bottom in a neutral colour."
	default:
		reply = "Here " + map[bool]string{true: "is a look", false: "are two looks"}[len(shown) == 1] + " from your closet"
		if occasion != "" {
			reply += " for " + occasion
		}
		reply += ". " + shown[0].Reason + "."
		if weather == "rain" {
			reply += " With rain about, pick closed shoes and keep pale bottoms for a drier day."
		} else if weather == "the cold" {
			reply += " Add a layer on top if it's chilly."
		} else if weather == "the heat" {
			reply += " Keep it breathable: cotton and linen are your friends."
		}
		reply += " (Basic stylist: the AI stylist isn't configured on this server.)"
	}
	for i, w := range strings.Fields(reply) {
		if i > 0 {
			w = " " + w
		}
		if err := emit(TextDelta{Text: w}); err != nil {
			return err
		}
		if l.WordDelay > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(l.WordDelay):
			}
		}
	}
	return emit(Done{Provider: "local"})
}

func detect(q string, words map[string]string) string {
	best := ""
	bestAt := len(q) + 1
	for w, label := range words {
		if i := strings.Index(q, w); i >= 0 && i < bestAt {
			best, bestAt = label, i
		}
	}
	return best
}

func describe(ids []string, byID map[string]ClosetItem) string {
	var parts []string
	for _, id := range ids {
		if it, ok := byID[id]; ok {
			name := it.Subcategory
			if name == "" {
				name = it.Category
			}
			parts = append(parts, it.Colour+" "+strings.ReplaceAll(name, "-", " "))
		}
	}
	if len(parts) == 0 {
		return "A balanced look"
	}
	return "Your " + strings.Join(parts, ", ")
}
