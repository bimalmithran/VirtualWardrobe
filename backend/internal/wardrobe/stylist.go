package wardrobe

import (
	"context"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/stylist"
)

// Quota meters a costly feature per user (the free plan's daily limits).
type Quota interface {
	// Take consumes one use, or returns domain.ErrQuotaExceeded.
	Take(ctx context.Context, user domain.UserID, feature string) error
}

// Stylist gates the chat: the user must have consented to the AI stylist purpose (their
// closet summary goes to an LLM provider), and free users are metered.
type Stylist struct {
	streamer stylist.Streamer
	consent  ConsentChecker
	quota    Quota // nil = unmetered
}

func NewStylist(s stylist.Streamer, consent ConsentChecker, quota Quota) *Stylist {
	return &Stylist{streamer: s, consent: consent, quota: quota}
}

// Begin runs every check that can fail before the stream starts, so those failures are
// ordinary HTTP errors rather than events inside an open stream.
func (s *Stylist) Begin(ctx context.Context, userID string, req *stylist.Request) error {
	user := domain.NormalizeUserID(userID)
	if !user.Valid() {
		return &domain.ValidationError{Field: "user_id", Reason: "must be a UUID"}
	}
	if err := req.Validate(); err != nil {
		return &domain.ValidationError{Field: "request", Reason: err.Error()}
	}
	ok, err := s.consent.Allows(ctx, user, domain.PurposeAIStylist)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrConsentRequired
	}
	if s.quota != nil {
		return s.quota.Take(ctx, user, "stylist_chat")
	}
	return nil
}

func (s *Stylist) Stream(ctx context.Context, req stylist.Request, emit func(stylist.Event) error) error {
	return s.streamer.Stream(ctx, req, emit)
}
