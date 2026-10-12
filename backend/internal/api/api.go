// Package api wires the HTTP handlers. Routing uses Go 1.22+ net/http method patterns.
package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/llmgateway"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/store"
)

// Store is the subset of *store.Store the handlers need; tests substitute a fake.
type Store interface {
	Ping(ctx context.Context) error
	UpsertProfile(ctx context.Context, p store.Profile) (store.Profile, error)
	UpsertItem(ctx context.Context, in store.NewItem) (store.Item, bool, error)
	Search(ctx context.Context, vec []float32, userID string, limit int) ([]store.Match, error)
}

type Config struct {
	UploadDir string
	// Base for image URLs returned to clients, e.g. http://192.168.1.20:8080. Empty means
	// derive it from the request's Host header.
	PublicBaseURL string
}

type Server struct {
	store   Store
	gateway *llmgateway.Gateway
	cfg     Config
	log     *slog.Logger
}

const (
	maxBodyBytes  = 12 << 20 // a 1024px RGBA PNG is ~1-3 MB; base64 adds a third
	maxImageBytes = 8 << 20
	searchDefault = 5
	searchMax     = 50
)

var (
	uuidRe     = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	clientIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`) // also used as a filename
	hexRe      = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
	pngMagic   = []byte("\x89PNG\r\n\x1a\n")

	bodyShapes = map[string]bool{"rectangle": true, "triangle": true, "inverted-triangle": true, "hourglass": true, "oval": true}
	undertones = map[string]bool{"warm": true, "cool": true, "neutral": true}
)

func New(s Store, gw *llmgateway.Gateway, cfg Config, log *slog.Logger) *Server {
	return &Server{store: s, gateway: gw, cfg: cfg, log: log}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("POST /api/users/profile", s.saveProfile)
	mux.HandleFunc("POST /api/wardrobe/items", s.createItem)
	mux.HandleFunc("POST /api/wardrobe/search", s.search)
	mux.HandleFunc("POST /api/llm/complete", s.llmComplete)
	mux.HandleFunc("GET /api/llm/models", s.llmModels)
	mux.Handle("GET /uploads/", http.StripPrefix("/uploads/", http.FileServer(noDirListing{http.Dir(s.cfg.UploadDir)})))
	return s.logRequests(mux)
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ping(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database unreachable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ---- POST /api/users/profile -------------------------------------------------

type profileRequest struct {
	UserID        string `json:"user_id"`
	HeightCm      int    `json:"height_cm"`
	BodyShape     string `json:"body_shape"`
	SkinUndertone string `json:"skin_undertone"`
}

func (s *Server) saveProfile(w http.ResponseWriter, r *http.Request) {
	var req profileRequest
	if !decode(w, r, &req) {
		return
	}
	switch {
	case !uuidRe.MatchString(req.UserID):
		writeError(w, http.StatusBadRequest, "user_id must be a UUID")
		return
	case req.HeightCm < 100 || req.HeightCm > 250:
		writeError(w, http.StatusBadRequest, "height_cm must be between 100 and 250")
		return
	case !bodyShapes[req.BodyShape]:
		writeError(w, http.StatusBadRequest, "body_shape must be one of rectangle, triangle, inverted-triangle, hourglass, oval")
		return
	case !undertones[req.SkinUndertone]:
		writeError(w, http.StatusBadRequest, "skin_undertone must be warm, cool or neutral")
		return
	}
	p, err := s.store.UpsertProfile(r.Context(), store.Profile{
		UserID: strings.ToLower(req.UserID), HeightCm: req.HeightCm, BodyShape: req.BodyShape, SkinUndertone: req.SkinUndertone,
	})
	if err != nil {
		s.storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// ---- POST /api/wardrobe/items ------------------------------------------------

type itemRequest struct {
	UserID       string `json:"user_id"`
	ClientItemID string `json:"client_item_id"`
	CategorySlug string `json:"category_slug"`
	// Exactly one of ImageBase64 (a PNG, optionally a data: URL) or ImageURL.
	ImageBase64 string          `json:"image_base64"`
	ImageURL    string          `json:"image_url"`
	ColorHex    string          `json:"color_hex"`
	Embedding   []float32       `json:"embedding"`
	Metadata    json.RawMessage `json:"metadata"`
}

func (s *Server) createItem(w http.ResponseWriter, r *http.Request) {
	var req itemRequest
	if !decode(w, r, &req) {
		return
	}
	if msg := validateItem(&req); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}

	imageURL := req.ImageURL
	if req.ImageBase64 != "" {
		png, err := decodePNG(req.ImageBase64)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if imageURL, err = s.saveImage(r, req.UserID, req.ClientItemID, png); err != nil {
			s.log.Error("save image", "err", err)
			writeError(w, http.StatusInternalServerError, "could not store image")
			return
		}
	}

	item, created, err := s.store.UpsertItem(r.Context(), store.NewItem{
		UserID:       req.UserID,
		ClientItemID: req.ClientItemID,
		CategorySlug: req.CategorySlug,
		ImageURL:     imageURL,
		ColorHex:     req.ColorHex,
		Metadata:     req.Metadata,
		Embedding:    req.Embedding,
	})
	if err != nil {
		s.storeError(w, err)
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, item)
}

// validateItem normalises req in place and returns a client-facing error, or "".
func validateItem(req *itemRequest) string {
	req.UserID = strings.ToLower(req.UserID)
	req.ColorHex = strings.ToUpper(req.ColorHex)
	if len(req.Metadata) == 0 || string(req.Metadata) == "null" {
		req.Metadata = json.RawMessage(`{}`)
	}
	switch {
	case !uuidRe.MatchString(req.UserID):
		return "user_id must be a UUID"
	case !clientIDRe.MatchString(req.ClientItemID):
		return "client_item_id must be 1-64 characters of [A-Za-z0-9_-]"
	case !hexRe.MatchString(req.ColorHex):
		return "color_hex must look like #A1B2C3"
	case (req.ImageBase64 == "") == (req.ImageURL == ""):
		return "provide exactly one of image_base64 or image_url"
	case req.ImageURL != "" && !strings.HasPrefix(req.ImageURL, "https://") && !strings.HasPrefix(req.ImageURL, "http://"):
		return "image_url must be an http(s) URL"
	case req.Metadata[0] != '{':
		return "metadata must be a JSON object"
	}
	return validateVector(req.Embedding, "embedding")
}

func validateVector(v []float32, field string) string {
	if len(v) != store.EmbeddingDim {
		return fmt.Sprintf("%s must have %d dimensions, got %d", field, store.EmbeddingDim, len(v))
	}
	var norm float64
	for _, x := range v {
		if math.IsNaN(float64(x)) || math.IsInf(float64(x), 0) {
			return field + " contains NaN or Inf"
		}
		norm += float64(x) * float64(x)
	}
	if norm == 0 {
		return field + " is all zeros; cosine distance is undefined"
	}
	return ""
}

func decodePNG(b64 string) ([]byte, error) {
	if i := strings.Index(b64, ";base64,"); strings.HasPrefix(b64, "data:") && i > 0 {
		b64 = b64[i+len(";base64,"):]
	}
	if base64.StdEncoding.DecodedLen(len(b64)) > maxImageBytes+3 {
		return nil, fmt.Errorf("image larger than %d MB", maxImageBytes>>20)
	}
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, errors.New("image_base64 is not valid base64")
	}
	if len(data) < len(pngMagic) || string(data[:len(pngMagic)]) != string(pngMagic) {
		return nil, errors.New("image_base64 must be a PNG")
	}
	return data, nil
}

// saveImage writes to UploadDir/<user>/<client_item_id>.png. Both path parts were
// validated against strict patterns, so they cannot escape the directory.
func (s *Server) saveImage(r *http.Request, userID, clientID string, png []byte) (string, error) {
	dir := filepath.Join(s.cfg.UploadDir, userID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	name := clientID + ".png"
	tmp, err := os.CreateTemp(dir, name+".*.tmp")
	if err != nil {
		return "", err
	}
	if _, err := tmp.Write(png); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return "", err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}
	if err := os.Rename(tmp.Name(), filepath.Join(dir, name)); err != nil {
		os.Remove(tmp.Name())
		return "", err
	}
	return s.baseURL(r) + "/uploads/" + userID + "/" + name, nil
}

func (s *Server) baseURL(r *http.Request) string {
	if s.cfg.PublicBaseURL != "" {
		return strings.TrimRight(s.cfg.PublicBaseURL, "/")
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

// ---- POST /api/wardrobe/search -----------------------------------------------

type searchRequest struct {
	Embedding []float32 `json:"embedding"`
	// Optional: restrict results to one user's closet.
	UserID string `json:"user_id"`
	Limit  int    `json:"limit"`
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	var req searchRequest
	if !decode(w, r, &req) {
		return
	}
	if msg := validateVector(req.Embedding, "embedding"); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if req.UserID != "" && !uuidRe.MatchString(req.UserID) {
		writeError(w, http.StatusBadRequest, "user_id must be a UUID")
		return
	}
	if req.Limit <= 0 {
		req.Limit = searchDefault
	}
	req.Limit = min(req.Limit, searchMax)

	matches, err := s.store.Search(r.Context(), req.Embedding, strings.ToLower(req.UserID), req.Limit)
	if err != nil {
		s.storeError(w, err)
		return
	}
	if matches == nil {
		matches = []store.Match{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": matches})
}

// ---- LLM gateway demo --------------------------------------------------------

type llmRequest struct {
	Prompt          string  `json:"prompt"`
	MaxOutputTokens int     `json:"max_output_tokens"`
	MinQuality      int     `json:"min_quality"`
	CostCeilingUSD  float64 `json:"cost_ceiling_usd"`
}

func (s *Server) llmComplete(w http.ResponseWriter, r *http.Request) {
	var req llmRequest
	if !decode(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Prompt) == "" {
		writeError(w, http.StatusBadRequest, "prompt is required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	resp, err := s.gateway.Complete(ctx, llmgateway.Request{
		Prompt: req.Prompt, MaxOutputTokens: req.MaxOutputTokens, MinQuality: req.MinQuality, CostCeilingUSD: req.CostCeilingUSD,
	})
	switch {
	case errors.Is(err, llmgateway.ErrNoEligibleModel):
		writeError(w, http.StatusUnprocessableEntity, err.Error())
	case err != nil:
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error(), "attempts": resp.Attempts})
	default:
		writeJSON(w, http.StatusOK, resp)
	}
}

func (s *Server) llmModels(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"cost_ceiling_usd": s.gateway.CostCeilingUSD(),
		"models":           s.gateway.Stats(),
	})
}

// ---- helpers -----------------------------------------------------------------

func decode(w http.ResponseWriter, r *http.Request, dst any) bool {
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

func (s *Server) storeError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrUserNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, store.ErrUnknownCategory), errors.Is(err, store.ErrConstraintFailed):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		s.log.Error("store", "err", err)
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v) //nolint:errcheck // client went away; nothing to do
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		s.log.Info("http", "method", r.Method, "path", r.URL.Path, "status", rec.status, "ms", time.Since(start).Milliseconds())
	})
}

// noDirListing makes /uploads/<user>/ return 404 instead of an index of that user's files.
type noDirListing struct{ fs http.FileSystem }

func (n noDirListing) Open(name string) (http.File, error) {
	f, err := n.fs.Open(name)
	if err != nil {
		return nil, err
	}
	if st, err := f.Stat(); err == nil && st.IsDir() {
		f.Close()
		return nil, os.ErrNotExist
	}
	return f, nil
}
