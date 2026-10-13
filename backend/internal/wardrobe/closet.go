package wardrobe

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

const (
	MaxImageBytes      = 8 << 20 // a 1024px RGBA PNG is ~1-3 MB
	DefaultSearchLimit = 5
	MaxSearchLimit     = 50
)

var pngMagic = []byte("\x89PNG\r\n\x1a\n")

// AddItemInput is what a client sends: exactly one of ImageBase64 (a PNG, optionally
// a data: URL) or ImageURL.
type AddItemInput struct {
	UserID       string
	ClientItemID string
	CategorySlug string
	ImageBase64  string
	ImageURL     string
	ColorHex     string
	Metadata     domain.Metadata
	Embedding    domain.Embedding
}

type SearchQuery struct {
	Embedding domain.Embedding
	UserID    domain.UserID // empty searches every user's items
	Limit     int
}

// Closet ingests garments and runs similarity search.
type Closet struct {
	items  ItemRepository
	images ImageStore
}

func NewCloset(items ItemRepository, images ImageStore) *Closet {
	return &Closet{items: items, images: images}
}

func (s *Closet) AddItem(ctx context.Context, in AddItemInput) (domain.Item, bool, error) {
	item := domain.NewItem{
		UserID:       domain.NormalizeUserID(in.UserID),
		ClientItemID: domain.ClientItemID(in.ClientItemID),
		CategorySlug: in.CategorySlug,
		ImageURL:     in.ImageURL,
		ColorHex:     domain.NormalizeColorHex(in.ColorHex),
		Metadata:     in.Metadata,
		Embedding:    in.Embedding,
	}
	switch {
	case (in.ImageBase64 == "") == (in.ImageURL == ""):
		return domain.Item{}, false, &domain.ValidationError{Field: "image", Reason: "provide exactly one of image_base64 or image_url"}
	case in.ImageURL != "" && !domain.IsAbsoluteURL(in.ImageURL):
		return domain.Item{}, false, &domain.ValidationError{Field: "image_url", Reason: "must be an http(s) URL"}
	}
	if err := item.ValidateAttributes(); err != nil {
		return domain.Item{}, false, err
	}

	if in.ImageBase64 != "" {
		png, err := DecodePNG(in.ImageBase64)
		if err != nil {
			return domain.Item{}, false, err
		}
		if item.ImageURL, err = s.images.SavePNG(ctx, item.UserID, item.ClientItemID, png); err != nil {
			return domain.Item{}, false, fmt.Errorf("store image: %w", err)
		}
	}
	if err := item.Validate(); err != nil {
		return domain.Item{}, false, err
	}
	return s.items.UpsertItem(ctx, item)
}

func (s *Closet) SearchSimilar(ctx context.Context, q SearchQuery) ([]domain.Match, error) {
	if err := q.Embedding.Validate(); err != nil {
		return nil, err
	}
	if q.UserID != "" {
		q.UserID = domain.NormalizeUserID(string(q.UserID))
		if !q.UserID.Valid() {
			return nil, &domain.ValidationError{Field: "user_id", Reason: "must be a UUID"}
		}
	}
	if q.Limit <= 0 {
		q.Limit = DefaultSearchLimit
	}
	q.Limit = min(q.Limit, MaxSearchLimit)
	return s.items.SearchSimilar(ctx, q)
}

// DeleteItem removes a garment and its stored cutout. Deleting twice reports ErrNotFound,
// which clients retrying a delete can treat as success.
func (s *Closet) DeleteItem(ctx context.Context, userID string, clientItemID string) error {
	user, item := domain.NormalizeUserID(userID), domain.ClientItemID(clientItemID)
	if !user.Valid() {
		return &domain.ValidationError{Field: "user_id", Reason: "must be a UUID"}
	}
	if !item.Valid() {
		return &domain.ValidationError{Field: "client_item_id", Reason: "must be 1-64 characters of [A-Za-z0-9_-]"}
	}
	url, err := s.items.DeleteItem(ctx, user, item)
	if err != nil {
		return err
	}
	// Only cutouts this server stored are ours to delete; image_url uploads point elsewhere.
	if !domain.IsAbsoluteURL(url) {
		if err := s.images.RemovePNG(ctx, user, item); err != nil {
			return fmt.Errorf("remove image: %w", err)
		}
	}
	return nil
}

// DecodePNG accepts plain base64 or a data: URL and checks the PNG signature.
func DecodePNG(b64 string) ([]byte, error) {
	if i := strings.Index(b64, ";base64,"); strings.HasPrefix(b64, "data:") && i > 0 {
		b64 = b64[i+len(";base64,"):]
	}
	if base64.StdEncoding.DecodedLen(len(b64)) > MaxImageBytes+3 {
		return nil, &domain.ValidationError{Field: "image_base64", Reason: fmt.Sprintf("is larger than %d MB", MaxImageBytes>>20)}
	}
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, &domain.ValidationError{Field: "image_base64", Reason: "is not valid base64"}
	}
	if len(data) < len(pngMagic) || string(data[:len(pngMagic)]) != string(pngMagic) {
		return nil, &domain.ValidationError{Field: "image_base64", Reason: "must be a PNG"}
	}
	return data, nil
}
