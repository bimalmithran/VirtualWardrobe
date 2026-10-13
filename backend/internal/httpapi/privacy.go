package httpapi

import (
	"context"
	"net/http"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/wardrobe"
)

type PrivacyService interface {
	RecordConsent(ctx context.Context, c domain.Consent) (domain.Consent, error)
	Export(ctx context.Context, user domain.UserID) (wardrobe.Export, error)
	Erase(ctx context.Context, user domain.UserID) error
}

type privacyHandler struct {
	privacy PrivacyService
	errs    errorWriter
}

type consentRequest struct {
	UserID        string                  `json:"user_id"`
	NoticeVersion string                  `json:"notice_version"`
	Language      string                  `json:"language"`
	Purposes      map[domain.Purpose]bool `json:"purposes"`
}

// consent: POST /api/users/consent. Each call appends a record; the newest is in force,
// so withdrawing is the same call with the purpose set to false.
func (h *privacyHandler) consent(w http.ResponseWriter, r *http.Request) {
	var req consentRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	user, err := actingUser(r, req.UserID)
	if err != nil {
		h.errs.write(w, err)
		return
	}
	c, err := h.privacy.RecordConsent(r.Context(), domain.Consent{
		UserID: domain.UserID(user), NoticeVersion: req.NoticeVersion, Language: domain.Language(req.Language), Purposes: req.Purposes,
	})
	if err != nil {
		h.errs.write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

// export: GET /api/users/me/export
func (h *privacyHandler) export(w http.ResponseWriter, r *http.Request) {
	user, err := actingUser(r, r.URL.Query().Get("user_id"))
	if err != nil {
		h.errs.write(w, err)
		return
	}
	out, err := h.privacy.Export(r.Context(), domain.UserID(user))
	if err != nil {
		h.errs.write(w, err)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="virtualwardrobe-export.json"`)
	writeJSON(w, http.StatusOK, out)
}

// erase: DELETE /api/users/me. Deletes the profile, garments, images, outfits, consent
// records and the device binding. The app then forgets its token and starts fresh.
func (h *privacyHandler) erase(w http.ResponseWriter, r *http.Request) {
	user, err := actingUser(r, r.URL.Query().Get("user_id"))
	if err != nil {
		h.errs.write(w, err)
		return
	}
	if err := h.privacy.Erase(r.Context(), domain.UserID(user)); err != nil {
		h.errs.write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
