package imagestore

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

const user = domain.UserID("6f1c2a9e-3b4d-4c5e-8f70-112233445566")

func TestSaveAndServe(t *testing.T) {
	dir := t.TempDir()
	s, err := NewLocalFS(dir, "/uploads")
	if err != nil {
		t.Fatal(err)
	}
	png := []byte("\x89PNG\r\n\x1a\nbody")
	url, err := s.SaveImage(context.Background(), user, "m1abc", png)
	if err != nil {
		t.Fatal(err)
	}
	if want := "/uploads/" + string(user) + "/m1abc.png"; url != want {
		t.Fatalf("url = %s, want %s", url, want)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, string(user), "m1abc.png")); !bytes.Equal(got, png) {
		t.Fatal("file content mismatch")
	}

	mux := http.NewServeMux()
	mux.Handle("GET /uploads/", s.Handler())
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
	if rec.Code != http.StatusOK || !bytes.Equal(rec.Body.Bytes(), png) {
		t.Fatalf("GET %s = %d", url, rec.Code)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/uploads/"+string(user)+"/", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("directory listing exposed: %d", rec.Code)
	}
}

func TestRejectsTraversalKeys(t *testing.T) {
	s, _ := NewLocalFS(t.TempDir(), "/uploads")
	if _, err := s.SaveImage(context.Background(), user, "../../etc/passwd", []byte("x")); !domain.IsValidation(err) {
		t.Fatalf("err = %v, want validation error", err)
	}
}
