package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/llmgateway"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/store"
)

type fakeStore struct {
	items      []store.NewItem
	lastSearch struct {
		userID string
		limit  int
	}
}

func (f *fakeStore) Ping(context.Context) error { return nil }

func (f *fakeStore) UpsertProfile(_ context.Context, p store.Profile) (store.Profile, error) {
	return p, nil
}

func (f *fakeStore) UpsertItem(_ context.Context, in store.NewItem) (store.Item, bool, error) {
	f.items = append(f.items, in)
	return store.Item{ID: "id-1", ClientItemID: in.ClientItemID, ImageURL: in.ImageURL, ColorHex: in.ColorHex, Metadata: in.Metadata}, true, nil
}

func (f *fakeStore) Search(_ context.Context, _ []float32, userID string, limit int) ([]store.Match, error) {
	f.lastSearch.userID, f.lastSearch.limit = userID, limit
	return nil, nil
}

const userID = "6f1c2a9e-3b4d-4c5e-8f70-112233445566"

func newTestServer(t *testing.T) (*fakeStore, http.Handler, string) {
	t.Helper()
	fs := &fakeStore{}
	gw, err := llmgateway.New(llmgateway.Config{CostCeilingUSD: 1}, llmgateway.DemoModels()...)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	return fs, New(fs, gw, Config{UploadDir: dir, PublicBaseURL: "http://phone-lan:8080"}, log).Handler(), dir
}

func post(h http.Handler, path string, body any) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b)))
	return rec
}

func vec(n int) []float32 {
	v := make([]float32, n)
	for i := range v {
		v[i] = float32(i%7) + 0.5
	}
	return v
}

func TestProfileValidation(t *testing.T) {
	_, h, _ := newTestServer(t)
	ok := map[string]any{"user_id": userID, "height_cm": 175, "body_shape": "rectangle", "skin_undertone": "warm"}
	if rec := post(h, "/api/users/profile", ok); rec.Code != http.StatusOK {
		t.Fatalf("valid profile: %d %s", rec.Code, rec.Body)
	}
	for name, mutate := range map[string]func(m map[string]any){
		"bad uuid":      func(m map[string]any) { m["user_id"] = "nope" },
		"short":         func(m map[string]any) { m["height_cm"] = 40 },
		"bad shape":     func(m map[string]any) { m["body_shape"] = "square" },
		"bad undertone": func(m map[string]any) { m["skin_undertone"] = "olive" },
		"unknown field": func(m map[string]any) { m["extra"] = 1 },
	} {
		m := map[string]any{}
		for k, v := range ok {
			m[k] = v
		}
		mutate(m)
		if rec := post(h, "/api/users/profile", m); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d, want 400", name, rec.Code)
		}
	}
}

func TestCreateItemStoresPNGAndNormalises(t *testing.T) {
	fs, h, dir := newTestServer(t)
	png := append([]byte("\x89PNG\r\n\x1a\n"), 1, 2, 3)
	rec := post(h, "/api/wardrobe/items", map[string]any{
		"user_id":        strings.ToUpper(userID),
		"client_item_id": "m1abc-x9y8z7",
		"image_base64":   "data:image/png;base64," + base64.StdEncoding.EncodeToString(png),
		"color_hex":      "#a1b2c3",
		"embedding":      vec(512),
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	got := fs.items[0]
	if got.ColorHex != "#A1B2C3" || got.UserID != userID || string(got.Metadata) != "{}" {
		t.Fatalf("not normalised: %+v", got)
	}
	wantURL := "http://phone-lan:8080/uploads/" + userID + "/m1abc-x9y8z7.png"
	if got.ImageURL != wantURL {
		t.Fatalf("image url = %s, want %s", got.ImageURL, wantURL)
	}
	onDisk, err := os.ReadFile(filepath.Join(dir, userID, "m1abc-x9y8z7.png"))
	if err != nil || !bytes.Equal(onDisk, png) {
		t.Fatalf("png not written correctly: %v", err)
	}

	// And it is served back.
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest(http.MethodGet, "/uploads/"+userID+"/m1abc-x9y8z7.png", nil))
	if r.Code != http.StatusOK || !bytes.Equal(r.Body.Bytes(), png) {
		t.Fatalf("GET upload: %d", r.Code)
	}
	r = httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest(http.MethodGet, "/uploads/"+userID+"/", nil))
	if r.Code != http.StatusNotFound {
		t.Fatalf("directory listing exposed: %d", r.Code)
	}
}

func TestCreateItemRejects(t *testing.T) {
	_, h, _ := newTestServer(t)
	base := func() map[string]any {
		return map[string]any{
			"user_id": userID, "client_item_id": "abc", "image_url": "https://cdn.example/a.png",
			"color_hex": "#112233", "embedding": vec(512),
		}
	}
	cases := map[string]func(m map[string]any){
		"wrong dims":     func(m map[string]any) { m["embedding"] = vec(511) },
		"zero vector":    func(m map[string]any) { m["embedding"] = make([]float32, 512) },
		"bad hex":        func(m map[string]any) { m["color_hex"] = "red" },
		"path traversal": func(m map[string]any) { m["client_item_id"] = "../../etc/passwd" },
		"two images":     func(m map[string]any) { m["image_base64"] = "AAAA" },
		"no image":       func(m map[string]any) { delete(m, "image_url") },
		"not png": func(m map[string]any) {
			delete(m, "image_url")
			m["image_base64"] = base64.StdEncoding.EncodeToString([]byte("GIF89a...."))
		},
		"array metadata": func(m map[string]any) { m["metadata"] = []int{1} },
	}
	for name, mutate := range cases {
		m := base()
		mutate(m)
		if rec := post(h, "/api/wardrobe/items", m); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d %s, want 400", name, rec.Code, rec.Body)
		}
	}
	if rec := post(h, "/api/wardrobe/items", base()); rec.Code != http.StatusCreated {
		t.Fatalf("valid image_url item: %d %s", rec.Code, rec.Body)
	}
}

func TestSearchDefaultsToTopFive(t *testing.T) {
	fs, h, _ := newTestServer(t)
	rec := post(h, "/api/wardrobe/search", map[string]any{"embedding": vec(512)})
	if rec.Code != http.StatusOK {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	if fs.lastSearch.limit != 5 || fs.lastSearch.userID != "" {
		t.Fatalf("search args = %+v", fs.lastSearch)
	}
	if !strings.Contains(rec.Body.String(), `"results":[]`) {
		t.Fatalf("empty result should be [], got %s", rec.Body)
	}
	post(h, "/api/wardrobe/search", map[string]any{"embedding": vec(512), "limit": 1000, "user_id": userID})
	if fs.lastSearch.limit != searchMax || fs.lastSearch.userID != userID {
		t.Fatalf("search args = %+v", fs.lastSearch)
	}
}

func TestLLMCostCeilingRejection(t *testing.T) {
	_, h, _ := newTestServer(t)
	rec := post(h, "/api/llm/complete", map[string]any{"prompt": "hi", "min_quality": 3, "max_output_tokens": 1000, "cost_ceiling_usd": 0.000001})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("got %d %s, want 422", rec.Code, rec.Body)
	}
}
