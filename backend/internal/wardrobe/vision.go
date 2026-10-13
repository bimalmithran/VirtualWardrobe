package wardrobe

import (
	"context"
	"encoding/base64"
	"image"
	"strings"
	"sync/atomic"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/vision"
)

// ConsentChecker answers whether the user's consent in force covers a purpose.
type ConsentChecker interface {
	Allows(ctx context.Context, user domain.UserID, purpose domain.Purpose) (bool, error)
}

// VisionModels is what CloudVision runs; nil until the models finish loading.
type VisionModels interface {
	vision.Segmenter
	vision.Embedder
}

// CloudVision runs background removal and style vectors for phones that cannot. Photos
// are processed in memory and never stored, as the consent text promises.
type CloudVision struct {
	models  atomic.Pointer[VisionModels]
	consent ConsentChecker
}

func NewCloudVision(consent ConsentChecker) *CloudVision { return &CloudVision{consent: consent} }

// SetModels makes the service available; called once loading finishes.
func (v *CloudVision) SetModels(m VisionModels) { v.models.Store(&m) }

// Ready reports whether models are loaded.
func (v *CloudVision) Ready() bool { return v.models.Load() != nil }

// SegmentResult is a PNG soft mask at the uploaded image's size.
type SegmentResult struct {
	MaskPNG       []byte
	Width, Height int
}

func (v *CloudVision) Segment(ctx context.Context, userID, imageB64 string) (SegmentResult, error) {
	m, img, err := v.prepare(ctx, userID, imageB64)
	if err != nil {
		return SegmentResult{}, err
	}
	mask, err := m.Segment(ctx, img)
	if err != nil {
		return SegmentResult{}, err
	}
	data, err := vision.EncodeMask(mask)
	if err != nil {
		return SegmentResult{}, err
	}
	return SegmentResult{MaskPNG: data, Width: mask.Bounds().Dx(), Height: mask.Bounds().Dy()}, nil
}

func (v *CloudVision) Embed(ctx context.Context, userID, imageB64 string) ([]float32, error) {
	m, img, err := v.prepare(ctx, userID, imageB64)
	if err != nil {
		return nil, err
	}
	return m.Embed(ctx, img)
}

func (v *CloudVision) prepare(ctx context.Context, userID, imageB64 string) (VisionModels, image.Image, error) {
	user := domain.NormalizeUserID(userID)
	if !user.Valid() {
		return nil, nil, &domain.ValidationError{Field: "user_id", Reason: "must be a UUID"}
	}
	ok, err := v.consent.Allows(ctx, user, domain.PurposeCloudProcessing)
	if err != nil {
		return nil, nil, err
	}
	if !ok {
		return nil, nil, domain.ErrConsentRequired
	}
	m := v.models.Load()
	if m == nil {
		return nil, nil, vision.ErrUnavailable
	}
	if i := strings.Index(imageB64, ";base64,"); strings.HasPrefix(imageB64, "data:") && i > 0 {
		imageB64 = imageB64[i+len(";base64,"):]
	}
	data, err := base64.StdEncoding.DecodeString(imageB64)
	if err != nil {
		return nil, nil, &domain.ValidationError{Field: "image_base64", Reason: "is not valid base64"}
	}
	img, err := vision.Decode(data)
	if err != nil {
		return nil, nil, &domain.ValidationError{Field: "image_base64", Reason: err.Error()}
	}
	return *m, img, nil
}
