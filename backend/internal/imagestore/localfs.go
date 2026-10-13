// Package imagestore implements wardrobe.ImageStore. LocalFS writes to a directory
// (a Docker volume in Compose); an S3/GCS store would implement the same interface.
package imagestore

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path"
	"path/filepath"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

type LocalFS struct {
	dir       string
	urlPrefix string // e.g. "/uploads"
}

func NewLocalFS(dir, urlPrefix string) (*LocalFS, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &LocalFS{dir: dir, urlPrefix: urlPrefix}, nil
}

// SavePNG writes <dir>/<user>/<item>.png atomically and returns its server-relative URL.
// Both path parts are validated domain ids, so they cannot escape dir.
func (s *LocalFS) SavePNG(_ context.Context, user domain.UserID, item domain.ClientItemID, png []byte) (string, error) {
	if !user.Valid() || !item.Valid() {
		return "", &domain.ValidationError{Field: "image", Reason: "has an invalid storage key"}
	}
	dir := filepath.Join(s.dir, string(user))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	name := string(item) + ".png"
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
	return path.Join(s.urlPrefix, string(user), name), nil
}

// RemovePNG deletes <dir>/<user>/<item>.png. A file that is already gone is fine.
func (s *LocalFS) RemovePNG(_ context.Context, user domain.UserID, item domain.ClientItemID) error {
	if !user.Valid() || !item.Valid() {
		return &domain.ValidationError{Field: "image", Reason: "has an invalid storage key"}
	}
	err := os.Remove(filepath.Join(s.dir, string(user), string(item)+".png"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// Handler serves stored images under urlPrefix, without directory listings.
func (s *LocalFS) Handler() http.Handler {
	return http.StripPrefix(s.urlPrefix+"/", http.FileServer(noDirListing{http.Dir(s.dir)}))
}

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
