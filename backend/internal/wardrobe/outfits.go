package wardrobe

import (
	"context"
	"strings"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

// SaveOutfitInput is what a client sends; garments are referenced by their client ids.
type SaveOutfitInput struct {
	UserID         string
	ClientOutfitID string
	Name           string
	Occasion       string
	ItemIDs        []string
	Metadata       domain.Metadata
}

// Outfits manages saved outfits.
type Outfits struct {
	outfits OutfitRepository
}

func NewOutfits(outfits OutfitRepository) *Outfits { return &Outfits{outfits: outfits} }

func (s *Outfits) SaveOutfit(ctx context.Context, in SaveOutfitInput) (domain.Outfit, bool, error) {
	o := domain.NewOutfit{
		UserID:         domain.NormalizeUserID(in.UserID),
		ClientOutfitID: domain.ClientOutfitID(in.ClientOutfitID),
		Name:           strings.TrimSpace(in.Name),
		Occasion:       strings.TrimSpace(in.Occasion),
		Metadata:       in.Metadata,
	}
	for _, id := range in.ItemIDs {
		o.ItemIDs = append(o.ItemIDs, domain.ClientItemID(id))
	}
	if err := o.Validate(); err != nil {
		return domain.Outfit{}, false, err
	}
	return s.outfits.UpsertOutfit(ctx, o)
}

func (s *Outfits) ListOutfits(ctx context.Context, userID string) ([]domain.Outfit, error) {
	user := domain.NormalizeUserID(userID)
	if !user.Valid() {
		return nil, &domain.ValidationError{Field: "user_id", Reason: "must be a UUID"}
	}
	return s.outfits.ListOutfits(ctx, user)
}

func (s *Outfits) DeleteOutfit(ctx context.Context, userID, clientOutfitID string) error {
	user, id := domain.NormalizeUserID(userID), domain.ClientOutfitID(clientOutfitID)
	if !user.Valid() {
		return &domain.ValidationError{Field: "user_id", Reason: "must be a UUID"}
	}
	if !id.Valid() {
		return &domain.ValidationError{Field: "client_outfit_id", Reason: "must be 1-64 characters of [A-Za-z0-9_-]"}
	}
	return s.outfits.DeleteOutfit(ctx, user, id)
}
