package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/llmgateway"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/wardrobe"
)

// The transport is tested against stub use cases: no database, no filesystem.

type stubs struct {
	profileErr error
	itemErr    error
	created    bool
	llmErr     error
	llmResp    llmgateway.Response
	gotItem    wardrobe.AddItemInput
	deleteErr  error
	outfitErr  error
	gotDelete  [2]string
}

func (s *stubs) DeleteItem(_ context.Context, user, item string) error {
	s.gotDelete = [2]string{user, item}
	return s.deleteErr
}
func (s *stubs) SaveOutfit(_ context.Context, in wardrobe.SaveOutfitInput) (domain.Outfit, bool, error) {
	return domain.Outfit{ClientOutfitID: domain.ClientOutfitID(in.ClientOutfitID)}, s.created, s.outfitErr
}
func (s *stubs) ListOutfits(context.Context, string) ([]domain.Outfit, error) {
	return nil, s.outfitErr
}
func (s *stubs) DeleteOutfit(context.Context, string, string) error { return s.outfitErr }

func (s *stubs) Ping(context.Context) error { return nil }
func (s *stubs) SaveProfile(_ context.Context, p domain.Profile) (domain.Profile, error) {
	return p, s.profileErr
}
func (s *stubs) AddItem(_ context.Context, in wardrobe.AddItemInput) (domain.Item, bool, error) {
	s.gotItem = in
	return domain.Item{ID: "1", ImageURL: "/uploads/u/a.png"}, s.created, s.itemErr
}
func (s *stubs) SearchSimilar(context.Context, wardrobe.SearchQuery) ([]domain.Match, error) {
	return []domain.Match{{Item: domain.Item{ImageURL: "/uploads/u/b.png"}, Similarity: 0.9}, {Item: domain.Item{ImageURL: "https://cdn.example/c.png"}}}, nil
}
func (s *stubs) Complete(context.Context, llmgateway.Request) (llmgateway.Response, error) {
	return s.llmResp, s.llmErr
}
func (s *stubs) Stats() []llmgateway.ModelStats { return nil }

func router(s *stubs, publicBase string) http.Handler {
	return NewRouter(Deps{
		Health: s, Profiles: s, Items: s, Deleter: s, Search: s, Outfits: s, LLM: s, LLMStats: s,
		PublicBaseURL: publicBase, Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	})
}

func do(h http.Handler, path, body string) *httptest.ResponseRecorder {
	return doMethod(h, http.MethodPost, path, body)
}

func doMethod(h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Host = "192.168.1.20:8080"
	h.ServeHTTP(rec, req)
	return rec
}

func TestErrorMapping(t *testing.T) {
	cases := []struct {
		name string
		s    *stubs
		path string
		body string
		want int
	}{
		{"validation", &stubs{profileErr: &domain.ValidationError{Field: "x", Reason: "bad"}}, "/api/users/profile", `{}`, 400},
		{"unknown field", &stubs{}, "/api/users/profile", `{"nope":1}`, 400},
		{"malformed", &stubs{}, "/api/users/profile", `{`, 400},
		{"user missing", &stubs{itemErr: domain.ErrUserNotFound}, "/api/wardrobe/items", `{}`, 404},
		{"category", &stubs{itemErr: domain.ErrUnknownCategory}, "/api/wardrobe/items", `{}`, 400},
		{"internal", &stubs{itemErr: errors.New("db down")}, "/api/wardrobe/items", `{}`, 500},
		{"created", &stubs{created: true}, "/api/wardrobe/items", `{}`, 201},
		{"updated", &stubs{}, "/api/wardrobe/items", `{}`, 200},
		{"no model", &stubs{llmErr: llmgateway.ErrNoEligibleModel}, "/api/llm/complete", `{"prompt":"x"}`, 422},
		{"upstreams down", &stubs{llmErr: errors.New("all failed"), llmResp: llmgateway.Response{Attempts: []llmgateway.Attempt{{Model: "a"}}}}, "/api/llm/complete", `{"prompt":"x"}`, 502},
		{"empty prompt", &stubs{}, "/api/llm/complete", `{}`, 400},
	}
	for _, c := range cases {
		if rec := do(router(c.s, ""), c.path, c.body); rec.Code != c.want {
			t.Errorf("%s: got %d (%s), want %d", c.name, rec.Code, rec.Body, c.want)
		}
	}
}

func TestBodyLimit(t *testing.T) {
	big := `{"image_base64":"` + strings.Repeat("A", maxBodyBytes) + `"}`
	if rec := do(router(&stubs{}, ""), "/api/wardrobe/items", big); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("got %d, want 413", rec.Code)
	}
}

func TestImageURLsResolvedAgainstHost(t *testing.T) {
	rec := do(router(&stubs{}, ""), "/api/wardrobe/search", `{}`)
	var body struct {
		Results []domain.Match `json:"results"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if got := body.Results[0].ImageURL; got != "http://192.168.1.20:8080/uploads/u/b.png" {
		t.Errorf("relative url resolved to %s", got)
	}
	if got := body.Results[1].ImageURL; got != "https://cdn.example/c.png" {
		t.Errorf("absolute url changed to %s", got)
	}

	rec = do(router(&stubs{created: true}, "https://api.example/"), "/api/wardrobe/items", `{"metadata":{"a":1}}`)
	if !bytes.Contains(rec.Body.Bytes(), []byte(`"image_url":"https://api.example/uploads/u/a.png"`)) {
		t.Errorf("PUBLIC_BASE_URL not applied: %s", rec.Body)
	}
}

func TestMetadataPassedThroughRaw(t *testing.T) {
	s := &stubs{}
	do(router(s, ""), "/api/wardrobe/items", `{"metadata":{"palette":[{"hex":"#FFFFFF"}]}}`)
	if string(s.gotItem.Metadata) != `{"palette":[{"hex":"#FFFFFF"}]}` {
		t.Fatalf("metadata = %s", s.gotItem.Metadata)
	}
}

func TestDeleteAndOutfitRoutes(t *testing.T) {
	cases := []struct {
		name, method, path, body string
		s                        *stubs
		want                     int
	}{
		{"delete item", http.MethodDelete, "/api/wardrobe/items/abc?user_id=u", "", &stubs{}, 204},
		{"delete missing", http.MethodDelete, "/api/wardrobe/items/abc?user_id=u", "", &stubs{deleteErr: domain.ErrNotFound}, 404},
		{"outfit created", http.MethodPost, "/api/outfits", `{"client_outfit_id":"o","item_client_ids":["a"]}`, &stubs{created: true}, 201},
		{"outfit updated", http.MethodPost, "/api/outfits", `{}`, &stubs{}, 200},
		{"outfit items pending", http.MethodPost, "/api/outfits", `{}`, &stubs{outfitErr: domain.ErrUnknownItems}, 409},
		{"outfit list", http.MethodGet, "/api/outfits?user_id=u", "", &stubs{}, 200},
		{"outfit delete", http.MethodDelete, "/api/outfits/o?user_id=u", "", &stubs{}, 204},
		{"outfit delete missing", http.MethodDelete, "/api/outfits/o?user_id=u", "", &stubs{outfitErr: domain.ErrNotFound}, 404},
	}
	for _, c := range cases {
		if rec := doMethod(router(c.s, ""), c.method, c.path, c.body); rec.Code != c.want {
			t.Errorf("%s: got %d (%s), want %d", c.name, rec.Code, rec.Body, c.want)
		}
	}

	s := &stubs{}
	doMethod(router(s, ""), http.MethodDelete, "/api/wardrobe/items/xyz?user_id=abc", "")
	if s.gotDelete != [2]string{"abc", "xyz"} {
		t.Fatalf("path/query not passed through: %v", s.gotDelete)
	}
	rec := doMethod(router(&stubs{}, ""), http.MethodGet, "/api/outfits?user_id=u", "")
	if !strings.Contains(rec.Body.String(), `"outfits":[]`) {
		t.Fatalf("empty list should encode as []: %s", rec.Body)
	}
}
