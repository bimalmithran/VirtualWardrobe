package vision

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// ModelFile is a published ONNX export and its exact size, used to reject truncated downloads.
type ModelFile struct {
	Name  string
	URL   string
	Bytes int64
}

// The same exports the app downloads (frontend/src/config/models.ts).
var (
	RMBG14       = ModelFile{"rmbg-1.4-quantized.onnx", "https://huggingface.co/briaai/RMBG-1.4/resolve/main/onnx/model_quantized.onnx", 44403226}
	ISNet        = ModelFile{"isnet-quantized.onnx", "https://huggingface.co/onnx-community/ISNet-ONNX/resolve/main/onnx/model_quantized.onnx", 44348381}
	MobileCLIPS0 = ModelFile{"mobileclip-s0-vision-quantized.onnx",
		"https://huggingface.co/Xenova/mobileclip_s0/resolve/main/onnx/vision_model_quantized.onnx", 11846843}
)

// Ensure returns the local path of m in dir, downloading it first if absent or truncated.
func Ensure(ctx context.Context, dir string, m ModelFile) (string, error) {
	path := filepath.Join(dir, m.Name)
	if st, err := os.Stat(path); err == nil && st.Size() == m.Bytes {
		return path, nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.URL, nil)
	if err != nil {
		return "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("download %s: %w", m.Name, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download %s: HTTP %d", m.Name, resp.StatusCode)
	}
	tmp, err := os.CreateTemp(dir, m.Name+".*.part")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name()) //nolint:errcheck // no-op after the rename
	n, err := io.Copy(tmp, resp.Body)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return "", fmt.Errorf("download %s: %w", m.Name, err)
	}
	if n != m.Bytes {
		return "", fmt.Errorf("download %s: got %d bytes, want %d", m.Name, n, m.Bytes)
	}
	return path, os.Rename(tmp.Name(), path)
}
