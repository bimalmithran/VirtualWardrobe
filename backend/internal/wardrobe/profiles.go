package wardrobe

import (
	"context"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

// Profiles saves Digital Twins.
type Profiles struct {
	users UserRepository
}

func NewProfiles(users UserRepository) *Profiles { return &Profiles{users: users} }

func (s *Profiles) SaveProfile(ctx context.Context, p domain.Profile) (domain.Profile, error) {
	p.UserID = domain.NormalizeUserID(string(p.UserID))
	if err := p.Validate(); err != nil {
		return domain.Profile{}, err
	}
	return s.users.UpsertProfile(ctx, p)
}
