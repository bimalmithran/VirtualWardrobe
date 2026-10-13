//go:build onnx

package vision

import (
	"context"
	"fmt"
	"image"
	"runtime"
	"sync"

	ort "github.com/yalue/onnxruntime_go"
)

// Available reports whether this binary was built with ONNX Runtime support.
const Available = true

var initOnce sync.Once
var initErr error

type model struct {
	session *ort.DynamicAdvancedSession
	spec    Spec
	output  string
}

// ONNX runs both models with ONNX Runtime (CPU). One inference per model at a time keeps
// peak memory bounded; ORT already uses every core within a run.
type ONNX struct {
	seg, emb model
	segMu    sync.Mutex
	embMu    sync.Mutex
}

// NewONNX loads the shared library at libPath and the two model files.
func NewONNX(libPath, segPath, embPath string) (*ONNX, error) {
	initOnce.Do(func() {
		ort.SetSharedLibraryPath(libPath)
		initErr = ort.InitializeEnvironment()
	})
	if initErr != nil {
		return nil, fmt.Errorf("onnxruntime: %w", initErr)
	}
	seg, err := load(segPath, Segmentation, "")
	if err != nil {
		return nil, err
	}
	emb, err := load(embPath, Embedding, "image_embeds")
	if err != nil {
		seg.session.Destroy() //nolint:errcheck
		return nil, err
	}
	return &ONNX{seg: seg, emb: emb}, nil
}

func load(path string, spec Spec, preferOutput string) (model, error) {
	ins, outs, err := ort.GetInputOutputInfo(path)
	if err != nil {
		return model{}, fmt.Errorf("inspect %s: %w", path, err)
	}
	output := outs[0].Name
	for _, o := range outs {
		if o.Name == preferOutput {
			output = o.Name
		}
	}
	opts, err := ort.NewSessionOptions()
	if err != nil {
		return model{}, err
	}
	defer opts.Destroy() //nolint:errcheck
	if err := opts.SetIntraOpNumThreads(runtime.NumCPU()); err != nil {
		return model{}, err
	}
	s, err := ort.NewDynamicAdvancedSession(path, []string{ins[0].Name}, []string{output}, opts)
	if err != nil {
		return model{}, fmt.Errorf("load %s: %w", path, err)
	}
	return model{session: s, spec: spec, output: output}, nil
}

func (m model) run(ctx context.Context, input []float32) ([]float32, ort.Shape, error) {
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	s := int64(m.spec.Size)
	in, err := ort.NewTensor(ort.NewShape(1, 3, s, s), input)
	if err != nil {
		return nil, nil, err
	}
	defer in.Destroy() //nolint:errcheck
	outs := []ort.Value{nil}
	if err := m.session.Run([]ort.Value{in}, outs); err != nil {
		return nil, nil, err
	}
	defer outs[0].Destroy() //nolint:errcheck
	t, ok := outs[0].(*ort.Tensor[float32])
	if !ok {
		return nil, nil, fmt.Errorf("unexpected output type %T", outs[0])
	}
	return append([]float32(nil), t.GetData()...), t.GetShape(), nil
}

func (o *ONNX) Segment(ctx context.Context, img image.Image) (*image.Gray, error) {
	o.segMu.Lock()
	defer o.segMu.Unlock()
	sal, shape, err := o.seg.run(ctx, ToCHW(img, o.seg.spec))
	if err != nil {
		return nil, err
	}
	h, w := int(shape[len(shape)-2]), int(shape[len(shape)-1])
	return MaskFromSaliency(sal, w, h, img.Bounds()), nil
}

func (o *ONNX) Embed(ctx context.Context, cutout image.Image) ([]float32, error) {
	o.embMu.Lock()
	defer o.embMu.Unlock()
	v, _, err := o.emb.run(ctx, ToCHW(Letterbox(cutout, o.emb.spec.Size), o.emb.spec))
	if err != nil {
		return nil, err
	}
	if len(v) != 512 {
		return nil, fmt.Errorf("expected a 512-d embedding, got %d", len(v))
	}
	return Normalize(v), nil
}

func (o *ONNX) Close() {
	o.seg.session.Destroy() //nolint:errcheck
	o.emb.session.Destroy() //nolint:errcheck
}
