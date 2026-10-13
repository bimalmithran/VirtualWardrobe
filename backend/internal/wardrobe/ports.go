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
	// DeleteItem removes a garment (and its outfit memberships) and returns its image URL.
	// It returns domain.ErrNotFound when the user has no such garment.
	DeleteItem(ctx context.Context, user domain.UserID, item domain.ClientItemID) (imageURL string, err error)
}

// OutfitRepository persists outfits. UpsertOutfit is idempotent on (UserID, ClientOutfitID)
// and replaces the outfit's garment list; it returns domain.ErrUnknownItems when a garment
// has not been uploaded.
type OutfitRepository interface {
	UpsertOutfit(ctx context.Context, in domain.NewOutfit) (outfit domain.Outfit, created bool, err error)
	ListOutfits(ctx context.Context, user domain.UserID) ([]domain.Outfit, error)
	DeleteOutfit(ctx context.Context, user domain.UserID, outfit domain.ClientOutfitID) error
}

// ImageStore keeps garment cutouts and returns the URL (absolute or server-relative)
// under which the image can be fetched.
type ImageStore interface {
	SavePNG(ctx context.Context, user domain.UserID, item domain.ClientItemID, png []byte) (url string, err error)
	// RemovePNG deletes a stored cutout; a missing file is not an error.
	RemovePNG(ctx context.Context, user domain.UserID, item domain.ClientItemID) error
}
