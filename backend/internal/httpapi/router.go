// Package httpapi is the HTTP transport. It decodes requests, calls use-case interfaces,
// and encodes responses; business rules live in the wardrobe and domain packages.
// Routing uses Go 1.22+ net/http method patterns.
package httpapi

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/llmgateway"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/wardrobe"
)

// Each handler depends only on the narrow interface it uses (interface segregation).

type HealthChecker interface {
	Ping(ctx context.Context) error
}

type ProfileSaver interface {
	SaveProfile(ctx context.Context, p domain.Profile) (domain.Profile, error)
}

type ItemAdder interface {
	AddItem(ctx context.Context, in wardrobe.AddItemInput) (domain.Item, bool, error)
}

type ItemDeleter interface {
	DeleteItem(ctx context.Context, userID, clientItemID string) error
}

type OutfitStore interface {
	SaveOutfit(ctx context.Context, in wardrobe.SaveOutfitInput) (domain.Outfit, bool, error)
	ListOutfits(ctx context.Context, userID string) ([]domain.Outfit, error)
	DeleteOutfit(ctx context.Context, userID, clientOutfitID string) error
}

type SimilarSearcher interface {
	SearchSimilar(ctx context.Context, q wardrobe.SearchQuery) ([]domain.Match, error)
}

type Completer interface {
	Complete(ctx context.Context, req llmgateway.Request) (llmgateway.Response, error)
}

type ModelStatsReporter interface {
	Stats() []llmgateway.ModelStats
}

type Deps struct {
	Health   HealthChecker
	Profiles ProfileSaver
	Items    ItemAdder
	Deleter  ItemDeleter
	Search   SimilarSearcher
	Outfits  OutfitStore
	LLM      Completer
	LLMStats ModelStatsReporter
	// Serves stored images; mounted at ImagesPrefix.
	Images       http.Handler
	ImagesPrefix string
	// Base for server-relative image URLs in responses, e.g. http://192.168.1.20:8080.
	// Empty means derive it from the request's Host header.
	PublicBaseURL string
	Log           *slog.Logger
}

func NewRouter(d Deps) http.Handler {
	urls := urlResolver{publicBase: d.PublicBaseURL}
	errs := errorWriter{log: d.Log}
	wardrobeH := &wardrobeHandler{items: d.Items, deleter: d.Deleter, search: d.Search, urls: urls, errs: errs}
	outfitH := &outfitHandler{outfits: d.Outfits, errs: errs}
	llmH := &llmHandler{llm: d.LLM, stats: d.LLMStats, errs: errs}

	mux := http.NewServeMux()
	mux.Handle("GET /healthz", healthHandler{d.Health})
	mux.Handle("POST /api/users/profile", &profileHandler{profiles: d.Profiles, errs: errs})
	mux.HandleFunc("POST /api/wardrobe/items", wardrobeH.create)
	mux.HandleFunc("DELETE /api/wardrobe/items/{client_item_id}", wardrobeH.delete)
	mux.HandleFunc("POST /api/wardrobe/search", wardrobeH.searchSimilar)
	mux.HandleFunc("POST /api/outfits", outfitH.save)
	mux.HandleFunc("GET /api/outfits", outfitH.list)
	mux.HandleFunc("DELETE /api/outfits/{client_outfit_id}", outfitH.delete)
	mux.HandleFunc("POST /api/llm/complete", llmH.complete)
	mux.HandleFunc("GET /api/llm/models", llmH.models)
	if d.Images != nil {
		mux.Handle("GET "+d.ImagesPrefix+"/", d.Images)
	}
	return logRequests(d.Log, mux)
}
