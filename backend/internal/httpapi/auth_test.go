package httpapi

import (
	"context"
	"crypto/sha256"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

type fakeDevices struct{ bound map[domain.UserID][]byte }

func (f *fakeDevices) Enroll(_ context.Context, u domain.UserID, h []byte) error {
	if old, ok := f.bound[u]; ok && string(old) != string(h) {
		return domain.ErrForbidden
	}
	f.bound[u] = h
	return nil
}

func (f *fakeDevices) Verify(_ context.Context, u domain.UserID, h []byte) error {
	old, ok := f.bound[u]
	if !ok {
		return domain.ErrUnauthorized
	}
	if string(old) != string(h) {
		return domain.ErrForbidden
	}
	return nil
}

const (
	alice = "11111111-1111-4111-8111-111111111111"
	bob   = "22222222-2222-4222-8222-222222222222"
	tok   = "0123456789abcdef0123456789abcdef0123456789abcdef"
)

func authRouter(s *stubs, reg DeviceRegistry) http.Handler {
	return NewRouter(Deps{
		Health: s, Profiles: s, Items: s, Deleter: s, Search: s, Outfits: s, LLM: s, LLMStats: s, Privacy: s,
		Devices: reg, Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
}

func authed(h http.Handler, method, path, user, token, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if user != "" {
		req.Header.Set("X-User-ID", user)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	h.ServeHTTP(rec, req)
	return rec
}

func TestDeviceAuth(t *testing.T) {
	sum := sha256.Sum256([]byte(tok))
	reg := &fakeDevices{bound: map[domain.UserID][]byte{alice: sum[:]}}
	s := &stubs{}
	h := authRouter(s, reg)

	cases := []struct {
		name, method, path, user, token, body string
		want                                  int
	}{
		{"no credentials", "POST", "/api/wardrobe/search", "", "", `{}`, 401},
		{"short token", "POST", "/api/wardrobe/search", alice, "short", `{}`, 401},
		{"not enrolled", "POST", "/api/wardrobe/search", bob, tok, `{}`, 401},
		{"wrong token", "POST", "/api/wardrobe/search", alice, tok + "x", `{}`, 403},
		{"ok", "POST", "/api/wardrobe/search", alice, tok, `{}`, 200},
		{"acting for someone else", "POST", "/api/wardrobe/search", alice, tok, `{"user_id":"` + bob + `"}`, 403},
		{"acting for self", "POST", "/api/wardrobe/search", alice, tok, `{"user_id":"` + strings.ToUpper(alice) + `"}`, 200},
		{"query for someone else", "DELETE", "/api/wardrobe/items/x?user_id=" + bob, alice, tok, "", 403},
		{"healthz open", "GET", "/healthz", "", "", "", 200},
		{"enroll new", "POST", "/api/devices/enroll", bob, tok, "", 200},
		{"enroll taken", "POST", "/api/devices/enroll", alice, tok + "y", "", 403},
		{"enroll malformed", "POST", "/api/devices/enroll", "nope", tok, "", 400},
	}
	for _, c := range cases {
		if rec := authed(h, c.method, c.path, c.user, c.token, c.body); rec.Code != c.want {
			t.Errorf("%s: got %d (%s), want %d", c.name, rec.Code, rec.Body, c.want)
		}
	}

	// The handler sees the authenticated user even when the body names none.
	authed(h, "DELETE", "/api/wardrobe/items/xyz", alice, tok, "")
	if s.gotDelete != [2]string{alice, "xyz"} {
		t.Fatalf("delete acted for %v", s.gotDelete)
	}
	if rec := authed(h, "POST", "/api/wardrobe/search", bob, tok, `{}`); rec.Code != 200 {
		t.Fatalf("enrolled device rejected: %d", rec.Code)
	}
}
