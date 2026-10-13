package httpapi

import (
	"net/http"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

type profileHandler struct {
	profiles ProfileSaver
	errs     errorWriter
}

type profileRequest struct {
	UserID        string             `json:"user_id"`
	HeightCm      int                `json:"height_cm"`
	BodyShape     string             `json:"body_shape"`
	SkinUndertone string             `json:"skin_undertone"`
	Proportions   domain.Proportions `json:"proportions"`
	Season        string             `json:"season"`
	Language      string             `json:"language"`
}

func (h *profileHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req profileRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	user, err := actingUser(r, req.UserID)
	if err != nil {
		h.errs.write(w, err)
		return
	}
	p, err := h.profiles.SaveProfile(r.Context(), domain.Profile{
		UserID:        domain.UserID(user),
		HeightCm:      req.HeightCm,
		BodyShape:     domain.BodyShape(req.BodyShape),
		SkinUndertone: domain.Undertone(req.SkinUndertone),
		Proportions:   req.Proportions,
		Season:        domain.Season(req.Season),
		Language:      domain.Language(req.Language),
	})
	if err != nil {
		h.errs.write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}
