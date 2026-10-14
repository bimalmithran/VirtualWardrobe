package wardrobe

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

// ListingRepository persists resale listings and buyer inquiries.
type ListingRepository interface {
	Create(ctx context.Context, n domain.NewListing) (domain.Listing, error)
	Get(ctx context.Context, viewer domain.UserID, id string) (domain.Listing, error)
	Feed(ctx context.Context, viewer domain.UserID, category string, limit int) ([]domain.Listing, error)
	Mine(ctx context.Context, user domain.UserID) ([]domain.Listing, error)
	Update(ctx context.Context, user domain.UserID, id string, status *domain.ListingStatus, price *int) error
	AddInquiry(ctx context.Context, buyer domain.UserID, listingID, message, contact string) error
	Inquiries(ctx context.Context, seller domain.UserID, listingID string) ([]domain.Inquiry, error)
}

// Resale is peer-to-peer selling from the closet: the listing reuses the garment's cutout
// and tags. Payment and delivery happen between buyer and seller; the app relays inquiries
// so neither side's contact details are public.
type Resale struct {
	listings ListingRepository
	images   ImageStore
}

func NewResale(listings ListingRepository, images ImageStore) *Resale {
	return &Resale{listings: listings, images: images}
}

// CreateListingInput is the seller's form plus the listing photo.
type CreateListingInput struct {
	domain.NewListing
	ImageBase64 string
}

var uuidLike = regexp.MustCompile(`^[0-9a-f-]{36}$`)

func (s *Resale) Create(ctx context.Context, in CreateListingInput) (domain.Listing, error) {
	n := in.NewListing
	n.UserID = domain.NormalizeUserID(string(n.UserID))
	n.Normalize()
	if err := n.Validate(); err != nil {
		return domain.Listing{}, err
	}
	data, err := DecodeImage(in.ImageBase64)
	if err != nil {
		return domain.Listing{}, err
	}
	// Stored beside the closet image but under its own key, so withdrawing from cloud backup
	// doesn't take a live listing's photo with it.
	key := "sale-" + string(n.ClientItemID)
	if len(key) > 64 {
		key = key[:64]
	}
	if n.ImageURL, err = s.images.SaveImage(ctx, n.UserID, domain.ClientItemID(key), data); err != nil {
		return domain.Listing{}, fmt.Errorf("store image: %w", err)
	}
	return s.listings.Create(ctx, n)
}

func (s *Resale) Get(ctx context.Context, viewer, id string) (domain.Listing, error) {
	if !uuidLike.MatchString(id) {
		return domain.Listing{}, domain.ErrNotFound
	}
	return s.listings.Get(ctx, domain.NormalizeUserID(viewer), id)
}

func (s *Resale) Feed(ctx context.Context, viewer, category string, limit int) ([]domain.Listing, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.listings.Feed(ctx, domain.NormalizeUserID(viewer), strings.TrimSpace(category), limit)
}

func (s *Resale) Mine(ctx context.Context, user string) ([]domain.Listing, error) {
	return s.listings.Mine(ctx, domain.NormalizeUserID(user))
}

func (s *Resale) Update(ctx context.Context, user, id string, status *domain.ListingStatus, price *int) error {
	if status != nil && !status.Valid() {
		return &domain.ValidationError{Field: "status", Reason: "must be active, sold or withdrawn"}
	}
	if price != nil && (*price < 1 || *price > 1_000_000) {
		return &domain.ValidationError{Field: "price_inr", Reason: "must be between 1 and 1000000"}
	}
	if !uuidLike.MatchString(id) {
		return domain.ErrNotFound
	}
	return s.listings.Update(ctx, domain.NormalizeUserID(user), id, status, price)
}

func (s *Resale) Inquire(ctx context.Context, buyer, id, message, contact string) error {
	if err := domain.ValidateInquiry(message, contact); err != nil {
		return err
	}
	if !uuidLike.MatchString(id) {
		return domain.ErrNotFound
	}
	return s.listings.AddInquiry(ctx, domain.NormalizeUserID(buyer), id, strings.TrimSpace(message), strings.TrimSpace(contact))
}

func (s *Resale) Inquiries(ctx context.Context, seller, id string) ([]domain.Inquiry, error) {
	if !uuidLike.MatchString(id) {
		return nil, domain.ErrNotFound
	}
	out, err := s.listings.Inquiries(ctx, domain.NormalizeUserID(seller), id)
	if out == nil {
		out = []domain.Inquiry{}
	}
	return out, err
}
