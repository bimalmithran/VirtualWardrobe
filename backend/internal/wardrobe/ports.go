// Package wardrobe contains the application use cases. It depends on the domain and on
// the small ports below. Postgres, the filesystem and HTTP plug in from outside.
package wardrobe

import (
	"context"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

// UserRepository persists Digital Twins.
type UserRepository interface {
	UpsertProfile(ctx context.Context, p domain.Profile) (domain.Profile, error)
}

// ItemRepository persists garments and answers vector-similarity queries.
type ItemRepository interface {
	// UpsertItem is idempotent on (UserID, ClientItemID); created is false on update.
	UpsertItem(ctx context.Context, in domain.NewItem) (item domain.Item, created bool, err error)
	SearchSimilar(ctx context.Context, q SearchQuery) ([]domain.Match, error)
}

// ImageStore keeps garment cutouts and returns the URL (absolute or server-relative)
// under which the image can be fetched.
type ImageStore interface {
	SavePNG(ctx context.Context, user domain.UserID, item domain.ClientItemID, png []byte) (url string, err error)
}
