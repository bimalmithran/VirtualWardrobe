package httpapi

import (
	"net/http"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/wardrobe"
)

type outfitHandler struct {
	outfits OutfitStore
	errs    errorWriter
}

type outfitRequest struct {
	UserID         string          `json:"user_id"`
	ClientOutfitID string          `json:"client_outfit_id"`
	Name           string          `json:"name"`
	Occasion       string          `json:"occasion"`
	ItemClientIDs  []string        `json:"item_client_ids"`
	Metadata       domain.Metadata `json:"metadata"`
}

func (h *outfitHandler) save(w http.ResponseWriter, r *http.Request) {
	var req outfitRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if string(req.Metadata) == "null" {
		req.Metadata = nil
	}
	outfit, created, err := h.outfits.SaveOutfit(r.Context(), wardrobe.SaveOutfitInput{
		UserID:         req.UserID,
		ClientOutfitID: req.ClientOutfitID,
		Name:           req.Name,
		Occasion:       req.Occasion,
		ItemIDs:        req.ItemClientIDs,
		Metadata:       req.Metadata,
	})
	if err != nil {
		h.errs.write(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, outfit)
}

// list: GET /api/outfits?user_id=<uuid>
func (h *outfitHandler) list(w http.ResponseWriter, r *http.Request) {
	outfits, err := h.outfits.ListOutfits(r.Context(), r.URL.Query().Get("user_id"))
	if err != nil {
		h.errs.write(w, err)
		return
	}
	if outfits == nil {
		outfits = []domain.Outfit{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"outfits": outfits})
}

// delete: DELETE /api/outfits/{client_outfit_id}?user_id=<uuid>
func (h *outfitHandler) delete(w http.ResponseWriter, r *http.Request) {
	if err := h.outfits.DeleteOutfit(r.Context(), r.URL.Query().Get("user_id"), r.PathValue("client_outfit_id")); err != nil {
		h.errs.write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
