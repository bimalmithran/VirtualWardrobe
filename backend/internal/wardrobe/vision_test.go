package wardrobe

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"image"
	"image/png"
	"testing"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/vision"
)

type consentStub bool

func (c consentStub) Allows(context.Context, domain.UserID, domain.Purpose) (bool, error) {
	return bool(c), nil
}

type modelsStub struct{}

func (modelsStub) Segment(_ context.Context, img image.Image) (*image.Gray, error) {
	return image.NewGray(img.Bounds()), nil
}
func (modelsStub) Embed(context.Context, image.Image) ([]float32, error) {
	return make([]float32, 512), nil
}

func visionPNG(w, h int) string {
	var buf bytes.Buffer
	png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, h))) //nolint:errcheck
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestCloudVisionGates(t *testing.T) {
	ctx := context.Background()
	const u = "11111111-1111-4111-8111-111111111111"

	v := NewCloudVision(consentStub(false))
	v.SetModels(modelsStub{})
	if _, err := v.Segment(ctx, u, visionPNG(32, 32)); !errors.Is(err, domain.ErrConsentRequired) {
		t.Fatalf("no consent: %v", err)
	}

	v = NewCloudVision(consentStub(true))
	if _, err := v.Segment(ctx, u, visionPNG(32, 32)); !errors.Is(err, vision.ErrUnavailable) {
		t.Fatalf("not loaded: %v", err)
	}
	v.SetModels(modelsStub{})
	if _, err := v.Segment(ctx, u, "%%%"); !domain.IsValidation(err) {
		t.Fatalf("bad base64: %v", err)
	}
	res, err := v.Segment(ctx, u, "data:image/png;base64,"+visionPNG(40, 30))
	if err != nil || res.Width != 40 || res.Height != 30 || len(res.MaskPNG) == 0 {
		t.Fatalf("segment: %+v %v", res, err)
	}
	if vec, err := v.Embed(ctx, u, visionPNG(32, 32)); err != nil || len(vec) != 512 {
		t.Fatalf("embed: %d %v", len(vec), err)
	}
}
