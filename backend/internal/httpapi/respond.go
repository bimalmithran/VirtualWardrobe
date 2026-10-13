package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/llmgateway"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/vision"
)

const maxBodyBytes = 12 << 20 // 8 MB image + base64 overhead + 512 floats

// decodeJSON reads a size-limited body with unknown fields rejected. On failure it has
// already written the response.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			writeError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("body exceeds %d MB", maxBodyBytes>>20))
		} else {
			writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		}
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck // client went away; nothing to do
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// writeErrorCode adds a stable machine-readable code the app can branch on.
func writeErrorCode(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]string{"error": msg, "code": code})
}

// errorWriter maps domain and gateway errors to HTTP statuses in one place.
type errorWriter struct {
	log *slog.Logger
}

func (e errorWriter) write(w http.ResponseWriter, err error) {
	switch {
	case domain.IsValidation(err), errors.Is(err, domain.ErrUnknownCategory):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, domain.ErrUserNotFound), errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, domain.ErrUnknownItems):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, domain.ErrUnauthorized):
		writeErrorCode(w, http.StatusUnauthorized, "unauthorized", err.Error())
	case errors.Is(err, domain.ErrForbidden):
		writeErrorCode(w, http.StatusForbidden, "forbidden", err.Error())
	case errors.Is(err, domain.ErrConsentRequired):
		writeErrorCode(w, http.StatusForbidden, "consent_required", err.Error())
	case errors.Is(err, domain.ErrQuotaExceeded):
		writeErrorCode(w, http.StatusPaymentRequired, "quota_exceeded", err.Error())
	case errors.Is(err, vision.ErrUnavailable):
		writeErrorCode(w, http.StatusServiceUnavailable, "vision_unavailable", err.Error())
	case errors.Is(err, llmgateway.ErrNoEligibleModel):
		writeError(w, http.StatusUnprocessableEntity, err.Error())
	default:
		e.log.Error("request failed", "err", err)
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}

// urlResolver turns server-relative image paths into absolute URLs for clients, so the
// database never stores a host name.
type urlResolver struct {
	publicBase string
}

func (u urlResolver) absolute(r *http.Request, url string) string {
	if !strings.HasPrefix(url, "/") {
		return url
	}
	if u.publicBase != "" {
		return strings.TrimRight(u.publicBase, "/") + url
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host + url
}
