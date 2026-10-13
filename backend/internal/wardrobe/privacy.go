package wardrobe

import (
	"context"
	"fmt"
	"time"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

// Privacy implements the Data Principal's rights under the DPDP Act 2023: recording and
// withdrawing consent (s.6), a summary of the personal data held (s.11) and erasure (s.12).
type Privacy struct {
	accounts AccountRepository
	items    ItemLister
	outfits  OutfitRepository
	images   ImagePurger
	now      func() time.Time
}

func NewPrivacy(accounts AccountRepository, items ItemLister, outfits OutfitRepository, images ImagePurger) *Privacy {
	return &Privacy{accounts: accounts, items: items, outfits: outfits, images: images, now: time.Now}
}

func (p *Privacy) RecordConsent(ctx context.Context, c domain.Consent) (domain.Consent, error) {
	c.UserID = domain.NormalizeUserID(string(c.UserID))
	if c.Language == "" {
		c.Language = "en"
	}
	if err := c.Validate(); err != nil {
		return domain.Consent{}, err
	}
	return p.accounts.RecordConsent(ctx, c)
}

// Allows reports whether the user's consent in force covers purpose.
func (p *Privacy) Allows(ctx context.Context, user domain.UserID, purpose domain.Purpose) (bool, error) {
	c, err := p.accounts.LatestConsent(ctx, user)
	if err != nil {
		return false, err
	}
	return c.Allows(purpose), nil
}

// Export is everything the server holds about one user, in a portable form.
type Export struct {
	GeneratedAt time.Time         `json:"generated_at"`
	Profile     *domain.Profile   `json:"profile"`
	Items       []domain.Item     `json:"items"`
	Outfits     []domain.Outfit   `json:"outfits"`
	Consents    []domain.Consent  `json:"consents"`
	Notes       map[string]string `json:"notes"`
}

func (p *Privacy) Export(ctx context.Context, user domain.UserID) (Export, error) {
	user = domain.NormalizeUserID(string(user))
	if !user.Valid() {
		return Export{}, &domain.ValidationError{Field: "user_id", Reason: "must be a UUID"}
	}
	out := Export{GeneratedAt: p.now().UTC(), Notes: map[string]string{
		"embeddings":  "512-number style vectors are stored with each item and omitted here; they describe the garment, not you.",
		"self_photos": "Photos of you and your colour analysis never leave your phone, so the server has none.",
	}}
	profile, err := p.accounts.GetProfile(ctx, user)
	switch {
	case err == nil:
		out.Profile = &profile
	case err != domain.ErrUserNotFound:
		return Export{}, err
	}
	if out.Items, err = p.items.ListItems(ctx, user); err != nil {
		return Export{}, err
	}
	if out.Outfits, err = p.outfits.ListOutfits(ctx, user); err != nil {
		return Export{}, err
	}
	if out.Consents, err = p.accounts.ConsentHistory(ctx, user); err != nil {
		return Export{}, err
	}
	if out.Items == nil {
		out.Items = []domain.Item{}
	}
	if out.Outfits == nil {
		out.Outfits = []domain.Outfit{}
	}
	if out.Consents == nil {
		out.Consents = []domain.Consent{}
	}
	return out, nil
}

// Erase deletes the user's rows and images. Images go last: a failed row delete must not
// leave a profile whose garments have lost their pictures.
func (p *Privacy) Erase(ctx context.Context, user domain.UserID) error {
	user = domain.NormalizeUserID(string(user))
	if !user.Valid() {
		return &domain.ValidationError{Field: "user_id", Reason: "must be a UUID"}
	}
	if err := p.accounts.DeleteUser(ctx, user); err != nil {
		return err
	}
	if err := p.images.RemoveAll(ctx, user); err != nil {
		return fmt.Errorf("remove images: %w", err)
	}
	return nil
}
