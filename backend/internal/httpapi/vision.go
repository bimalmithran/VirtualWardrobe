package httpapi

import (
	"context"
	"encoding/base64"
	"net/http"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/wardrobe"
)

type VisionService interface {
	Segment(ctx context.Context, userID, imageB64 string) (wardrobe.SegmentResult, error)
	Embed(ctx context.Context, userID, imageB64 string) ([]float32, error)
}

type visionHandler struct {
	vision VisionService
	errs   errorWriter
}

type visionRequest struct {
	UserID      string `json:"user_id"`
	ImageBase64 string `json:"image_base64"`
}

func (h *visionHandler) decode(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	var req visionRequest
	if !decodeJSON(w, r, &req) {
		return "", "", false
	}
	user, err := actingUser(r, req.UserID)
	if err != nil {
		h.errs.write(w, err)
		return "", "", false
	}
	return user, req.ImageBase64, true
}

// segment: POST /api/vision/segment {image_base64: JPEG/PNG/WebP} -> soft mask PNG.
func (h *visionHandler) segment(w http.ResponseWriter, r *http.Request) {
	user, img, ok := h.decode(w, r)
	if !ok {
		return
	}
	res, err := h.vision.Segment(r.Context(), user, img)
	if err != nil {
		h.errs.write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"mask_png_base64": base64.StdEncoding.EncodeToString(res.MaskPNG),
		"width":           res.Width,
		"height":          res.Height,
	})
}

// embed: POST /api/vision/embed {image_base64: RGBA cutout PNG} -> 512-d unit vector.
func (h *visionHandler) embed(w http.ResponseWriter, r *http.Request) {
	user, img, ok := h.decode(w, r)
	if !ok {
		return
	}
	vec, err := h.vision.Embed(r.Context(), user, img)
	if err != nil {
		h.errs.write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"embedding": vec})
}
