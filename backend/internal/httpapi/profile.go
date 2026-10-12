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
	UserID        string `json:"user_id"`
	HeightCm      int    `json:"height_cm"`
	BodyShape     string `json:"body_shape"`
	SkinUndertone string `json:"skin_undertone"`
}

func (h *profileHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req profileRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	p, err := h.profiles.SaveProfile(r.Context(), domain.Profile{
		UserID:        domain.UserID(req.UserID),
		HeightCm:      req.HeightCm,
		BodyShape:     domain.BodyShape(req.BodyShape),
		SkinUndertone: domain.Undertone(req.SkinUndertone),
	})
	if err != nil {
		h.errs.write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}
