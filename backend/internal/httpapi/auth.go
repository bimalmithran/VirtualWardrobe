package httpapi

import (
	"context"
	"crypto/sha256"
	"net/http"
	"strings"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

// DeviceRegistry binds install tokens to user ids. Only token hashes are ever stored.
type DeviceRegistry interface {
	// Enroll binds hash to user on first use; ErrForbidden if user is bound to another hash.
	Enroll(ctx context.Context, user domain.UserID, hash []byte) error
	// Verify returns ErrUnauthorized for an unknown user, ErrForbidden for a wrong hash.
	Verify(ctx context.Context, user domain.UserID, hash []byte) error
}

const (
	userHeader     = "X-User-ID"
	minTokenLength = 32
	maxTokenLength = 256
)

type ctxKey struct{}

// credentials reads X-User-ID and the bearer token. ok is false when either is missing.
func credentials(r *http.Request) (domain.UserID, []byte, bool) {
	user := domain.NormalizeUserID(r.Header.Get(userHeader))
	token, found := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	token = strings.TrimSpace(token)
	if !found || !user.Valid() || len(token) < minTokenLength || len(token) > maxTokenLength {
		return "", nil, false
	}
	sum := sha256.Sum256([]byte(token))
	return user, sum[:], true
}

// authenticate puts the verified user in the request context. With a nil registry
// (AUTH_REQUIRED=false, and transport tests) requests pass through unauthenticated and
// handlers trust the user_id they carry.
func authenticate(reg DeviceRegistry, errs errorWriter, next http.Handler) http.Handler {
	if reg == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, hash, ok := credentials(r)
		if !ok {
			errs.write(w, domain.ErrUnauthorized)
			return
		}
		if err := reg.Verify(r.Context(), user, hash); err != nil {
			errs.write(w, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, user)))
	})
}

// actingUser returns the user a request acts for. Authenticated, that is the device's
// user, and naming anyone else in the body or query is ErrForbidden. Unauthenticated
// (auth disabled), it is whatever the client claimed.
func actingUser(r *http.Request, claimed string) (string, error) {
	user, ok := r.Context().Value(ctxKey{}).(domain.UserID)
	if !ok {
		return claimed, nil
	}
	if claimed != "" && domain.NormalizeUserID(claimed) != user {
		return "", domain.ErrForbidden
	}
	return string(user), nil
}

type deviceHandler struct {
	reg  DeviceRegistry
	errs errorWriter
}

// enroll: POST /api/devices/enroll with X-User-ID and a bearer token. Idempotent.
func (h *deviceHandler) enroll(w http.ResponseWriter, r *http.Request) {
	user, hash, ok := credentials(r)
	if !ok {
		writeErrorCode(w, http.StatusBadRequest, "bad_credentials",
			"send X-User-ID (a UUID) and Authorization: Bearer <32-256 character token>")
		return
	}
	if h.reg == nil {
		writeJSON(w, http.StatusOK, map[string]any{"user_id": user, "auth": "disabled"})
		return
	}
	if err := h.reg.Enroll(r.Context(), user, hash); err != nil {
		h.errs.write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user_id": user, "auth": "enrolled"})
}
