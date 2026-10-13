package httpapi

import (
	"net/http"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/wardrobe"
)

type wardrobeHandler struct {
	items   ItemAdder
	deleter ItemDeleter
	search  SimilarSearcher
	urls    urlResolver
	errs    errorWriter
}

type itemRequest struct {
	UserID       string           `json:"user_id"`
	ClientItemID string           `json:"client_item_id"`
	CategorySlug string           `json:"category_slug"`
	ImageBase64  string           `json:"image_base64"`
	ImageURL     string           `json:"image_url"`
	ColorHex     string           `json:"color_hex"`
	Embedding    domain.Embedding `json:"embedding"`
	Metadata     domain.Metadata  `json:"metadata"`
}

func (h *wardrobeHandler) create(w http.ResponseWriter, r *http.Request) {
	var req itemRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if string(req.Metadata) == "null" {
		req.Metadata = nil
	}
	user, err := actingUser(r, req.UserID)
	if err != nil {
		h.errs.write(w, err)
		return
	}
	item, created, err := h.items.AddItem(r.Context(), wardrobe.AddItemInput{
		UserID:       user,
		ClientItemID: req.ClientItemID,
		CategorySlug: req.CategorySlug,
		ImageBase64:  req.ImageBase64,
		ImageURL:     req.ImageURL,
		ColorHex:     req.ColorHex,
		Metadata:     req.Metadata,
		Embedding:    req.Embedding,
	})
	if err != nil {
		h.errs.write(w, err)
		return
	}
	item.ImageURL = h.urls.absolute(r, item.ImageURL)
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, item)
}

type searchRequest struct {
	Embedding domain.Embedding `json:"embedding"`
	UserID    string           `json:"user_id"` // optional: restrict to one user's closet
	Limit     int              `json:"limit"`
}

func (h *wardrobeHandler) searchSimilar(w http.ResponseWriter, r *http.Request) {
	var req searchRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	// Authenticated searches are always scoped to the caller's own closet.
	user, err := actingUser(r, req.UserID)
	if err != nil {
		h.errs.write(w, err)
		return
	}
	matches, err := h.search.SearchSimilar(r.Context(), wardrobe.SearchQuery{
		Embedding: req.Embedding, UserID: domain.UserID(user), Limit: req.Limit,
	})
	if err != nil {
		h.errs.write(w, err)
		return
	}
	if matches == nil {
		matches = []domain.Match{}
	}
	for i := range matches {
		matches[i].ImageURL = h.urls.absolute(r, matches[i].ImageURL)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": matches})
}

// delete removes one garment: DELETE /api/wardrobe/items/{client_item_id}?user_id=<uuid>.
func (h *wardrobeHandler) delete(w http.ResponseWriter, r *http.Request) {
	user, err := actingUser(r, r.URL.Query().Get("user_id"))
	if err == nil {
		err = h.deleter.DeleteItem(r.Context(), user, r.PathValue("client_item_id"))
	}
	if err != nil {
		h.errs.write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
