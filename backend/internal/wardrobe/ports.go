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
	// SaveImage stores a PNG, WebP or JPEG (already checked by DecodeImage) and returns its URL.
	SaveImage(ctx context.Context, user domain.UserID, item domain.ClientItemID, data []byte) (url string, err error)
	// RemoveImage deletes a stored image in any format; a missing file is not an error.
	RemoveImage(ctx context.Context, user domain.UserID, item domain.ClientItemID) error
}

// AccountRepository holds what the DPDP rights need: consent records, the profile to
// export, and erasure of everything keyed to a user.
type AccountRepository interface {
	GetProfile(ctx context.Context, user domain.UserID) (domain.Profile, error)
	RecordConsent(ctx context.Context, c domain.Consent) (domain.Consent, error)
	ConsentHistory(ctx context.Context, user domain.UserID) ([]domain.Consent, error)
	LatestConsent(ctx context.Context, user domain.UserID) (domain.Consent, error)
	DeleteUser(ctx context.Context, user domain.UserID) error
}

// ItemLister lists a user's garments for export.
type ItemLister interface {
	ListItems(ctx context.Context, user domain.UserID) ([]domain.Item, error)
}

// ImagePurger removes every image stored for a user.
type ImagePurger interface {
	RemoveAll(ctx context.Context, user domain.UserID) error
}
