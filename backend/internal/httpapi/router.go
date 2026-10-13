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
	Privacy  PrivacyService
	// Devices authenticates /api requests. Nil disables auth (AUTH_REQUIRED=false).
	Devices DeviceRegistry
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

	privacyH := &privacyHandler{privacy: d.Privacy, errs: errs}
	deviceH := &deviceHandler{reg: d.Devices, errs: errs}

	// Routes that act for a user go through device authentication.
	api := http.NewServeMux()
	api.Handle("POST /api/users/profile", &profileHandler{profiles: d.Profiles, errs: errs})
	api.HandleFunc("POST /api/users/consent", privacyH.consent)
	api.HandleFunc("GET /api/users/me/export", privacyH.export)
	api.HandleFunc("DELETE /api/users/me", privacyH.erase)
	api.HandleFunc("POST /api/wardrobe/items", wardrobeH.create)
	api.HandleFunc("DELETE /api/wardrobe/items/{client_item_id}", wardrobeH.delete)
	api.HandleFunc("POST /api/wardrobe/search", wardrobeH.searchSimilar)
	api.HandleFunc("POST /api/outfits", outfitH.save)
	api.HandleFunc("GET /api/outfits", outfitH.list)
	api.HandleFunc("DELETE /api/outfits/{client_outfit_id}", outfitH.delete)
	api.HandleFunc("POST /api/llm/complete", llmH.complete)
	api.HandleFunc("GET /api/llm/models", llmH.models)

	mux := http.NewServeMux()
	mux.Handle("GET /healthz", healthHandler{d.Health})
	mux.HandleFunc("POST /api/devices/enroll", deviceH.enroll)
	mux.Handle("/api/", authenticate(d.Devices, errs, api))
	if d.Images != nil {
		mux.Handle("GET "+d.ImagesPrefix+"/", d.Images)
	}
	return logRequests(d.Log, mux)
}
