//go:build !onnx

package vision

import (
	"context"
	"image"
)

// Available reports whether this binary was built with ONNX Runtime support (-tags onnx).
const Available = false

// ONNX is a stand-in so callers compile without cgo; NewONNX always fails.
type ONNX struct{}

func NewONNX(string, string, string) (*ONNX, error) { return nil, ErrUnavailable }

func (*ONNX) Segment(context.Context, image.Image) (*image.Gray, error) { return nil, ErrUnavailable }
func (*ONNX) Embed(context.Context, image.Image) ([]float32, error)     { return nil, ErrUnavailable }
func (*ONNX) Close()                                                    {}
