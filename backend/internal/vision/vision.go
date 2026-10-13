// Package vision runs the phone's garment models on the server, for devices too weak to
// run them (the app's "hybrid" and "cloud" execution plans). It mirrors the app's
// preprocessing exactly, so a cloud cutout or vector matches what the phone would produce.
package vision

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	_ "image/jpeg" // decoders registered for image.Decode
	"image/png"
	"math"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// ErrUnavailable means this server was built or configured without the vision models.
var ErrUnavailable = errors.New("cloud vision is not enabled on this server")

// MaxImageBytes bounds uploads; the app sends a ≤1024 px JPEG (~150-400 KB).
const MaxImageBytes = 6 << 20

// MaxSide is the largest side accepted, so a hostile upload can't make us allocate a huge canvas.
const MaxSide = 2048

// Segmenter predicts a foreground (garment) mask.
type Segmenter interface {
	// Segment returns a soft mask (0 = background, 255 = garment) at the image's size.
	Segment(ctx context.Context, img image.Image) (*image.Gray, error)
}

// Embedder computes a unit-length 512-d style vector for a background-removed garment.
type Embedder interface {
	Embed(ctx context.Context, cutout image.Image) ([]float32, error)
}

// Spec is a model's input contract: pixel = (v/255 - mean) / std, per channel.
type Spec struct {
	Size int
	Mean [3]float32
	Std  [3]float32
}

// Segmentation is RMBG-1.4 / ISNet at 1024².
var Segmentation = Spec{Size: 1024, Mean: [3]float32{0.5, 0.5, 0.5}, Std: [3]float32{1, 1, 1}}

// Embedding is MobileCLIP-S0's vision tower at 256² with no normalisation.
var Embedding = Spec{Size: 256, Mean: [3]float32{0, 0, 0}, Std: [3]float32{1, 1, 1}}

// Decode reads a JPEG, PNG or WebP and rejects oversized images before decoding pixels.
func Decode(data []byte) (image.Image, error) {
	if len(data) > MaxImageBytes {
		return nil, fmt.Errorf("image is larger than %d MB", MaxImageBytes>>20)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("not a JPEG, PNG or WebP image: %w", err)
	}
	if cfg.Width < 16 || cfg.Height < 16 || cfg.Width > MaxSide || cfg.Height > MaxSide {
		return nil, fmt.Errorf("image must be 16-%d px per side, got %dx%d", MaxSide, cfg.Width, cfg.Height)
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	return img, err
}

// ToCHW stretches img to spec.Size² (as the app does) and lays it out as 1x3xSxS floats.
func ToCHW(img image.Image, spec Spec) []float32 {
	s := spec.Size
	dst := image.NewRGBA(image.Rect(0, 0, s, s))
	draw.BiLinear.Scale(dst, dst.Bounds(), img, img.Bounds(), draw.Src, nil)
	out := make([]float32, 3*s*s)
	plane := s * s
	for i := 0; i < plane; i++ {
		p := dst.Pix[i*4 : i*4+3]
		for c := 0; c < 3; c++ {
			out[c*plane+i] = (float32(p[c])/255 - spec.Mean[c]) / spec.Std[c]
		}
	}
	return out
}

// MaskFromSaliency min-max normalises a model's w×h saliency map and resamples it to the
// image's size, matching the app's post-processing.
func MaskFromSaliency(sal []float32, w, h int, bounds image.Rectangle) *image.Gray {
	lo, hi := float32(math.Inf(1)), float32(math.Inf(-1))
	for _, v := range sal {
		lo, hi = min(lo, v), max(hi, v)
	}
	rng := hi - lo
	if rng == 0 {
		rng = 1
	}
	small := image.NewGray(image.Rect(0, 0, w, h))
	for i, v := range sal {
		small.Pix[i] = uint8(math.Round(float64((v - lo) / rng * 255)))
	}
	mask := image.NewGray(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.BiLinear.Scale(mask, mask.Bounds(), small, small.Bounds(), draw.Src, nil)
	return mask
}

// Letterbox flattens a cutout onto white and fits it, aspect kept, inside a size² square:
// a tall kurta must not lose its hem to a centre crop.
func Letterbox(cutout image.Image, size int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	b := cutout.Bounds()
	scale := float64(size) / float64(max(b.Dx(), b.Dy()))
	w, h := int(math.Round(float64(b.Dx())*scale)), int(math.Round(float64(b.Dy())*scale))
	x, y := (size-w)/2, (size-h)/2
	draw.BiLinear.Scale(dst, image.Rect(x, y, x+w, y+h), cutout, b, draw.Over, nil)
	return dst
}

// Normalize scales v to unit length in place; cosine similarity is then a dot product.
func Normalize(v []float32) []float32 {
	var n float64
	for _, x := range v {
		n += float64(x) * float64(x)
	}
	if n == 0 {
		return v
	}
	inv := float32(1 / math.Sqrt(n))
	for i := range v {
		v[i] *= inv
	}
	return v
}

// EncodeMask PNG-encodes a mask (8-bit grey compresses to a few tens of KB).
func EncodeMask(m *image.Gray) ([]byte, error) {
	var buf bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(&buf, m); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
