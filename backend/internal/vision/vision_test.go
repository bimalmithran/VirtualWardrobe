package vision

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
	"testing"
)

func TestToCHWNormalises(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	for i := range img.Pix {
		img.Pix[i] = 255
	}
	out := ToCHW(img, Spec{Size: 2, Mean: [3]float32{0.5, 0.5, 0.5}, Std: [3]float32{1, 1, 1}})
	if len(out) != 3*2*2 {
		t.Fatalf("len %d", len(out))
	}
	for _, v := range out {
		if math.Abs(float64(v-0.5)) > 1e-6 {
			t.Fatalf("white should map to 0.5, got %v", v)
		}
	}
}

func TestMaskFromSaliencyStretchesAndResizes(t *testing.T) {
	m := MaskFromSaliency([]float32{2, 4, 4, 2}, 2, 2, image.Rect(0, 0, 8, 8))
	if m.Bounds().Dx() != 8 || m.Bounds().Dy() != 8 {
		t.Fatalf("bounds %v", m.Bounds())
	}
	if m.GrayAt(7, 0).Y < 200 || m.GrayAt(0, 0).Y > 55 {
		t.Fatalf("min-max not applied: %v %v", m.GrayAt(0, 0), m.GrayAt(7, 0))
	}
}

func TestLetterboxKeepsAspect(t *testing.T) {
	tall := image.NewRGBA(image.Rect(0, 0, 10, 40))
	for i := 0; i < len(tall.Pix); i += 4 {
		tall.Pix[i], tall.Pix[i+3] = 200, 255
	}
	out := Letterbox(tall, 40)
	if c := out.RGBAAt(0, 20); c != (color.RGBA{255, 255, 255, 255}) {
		t.Fatalf("side padding should be white, got %v", c)
	}
	if c := out.RGBAAt(20, 0); c.R != 200 {
		t.Fatalf("garment should reach the top edge, got %v", c)
	}
}

func TestDecodeRejectsHugeAndJunk(t *testing.T) {
	if _, err := Decode([]byte("nope")); err == nil {
		t.Fatal("junk accepted")
	}
	var buf bytes.Buffer
	png.Encode(&buf, image.NewGray(image.Rect(0, 0, 4000, 10))) //nolint:errcheck
	if _, err := Decode(buf.Bytes()); err == nil {
		t.Fatal("oversized accepted")
	}
}

func TestNormalize(t *testing.T) {
	v := Normalize([]float32{3, 4})
	if math.Abs(float64(v[0])-0.6) > 1e-6 || math.Abs(float64(v[1])-0.8) > 1e-6 {
		t.Fatal(v)
	}
}
