// Package billing turns store events into entitlements. RevenueCat validates receipts with
// Google Play and the App Store and posts lifecycle events to our webhook.
package billing

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

// EntitlementStore records entitlement changes idempotently by event id.
type EntitlementStore interface {
	ApplyEntitlement(ctx context.Context, eventID string, user domain.UserID, entitlement string, expires *time.Time, productID, store string) (bool, error)
}

// ErrBadSignature means the webhook's Authorization header did not match.
var ErrBadSignature = errors.New("webhook authorization does not match")

// RevenueCat handles RevenueCat webhook deliveries. The app logs in to RevenueCat with
// its install's user id, so app_user_id is our users.id.
type RevenueCat struct {
	store  EntitlementStore
	secret string // the Authorization header value configured in the RevenueCat dashboard
	now    func() time.Time
}

func NewRevenueCat(store EntitlementStore, secret string) *RevenueCat {
	return &RevenueCat{store: store, secret: secret, now: time.Now}
}

type rcEvent struct {
	Event struct {
		ID             string   `json:"id"`
		Type           string   `json:"type"`
		AppUserID      string   `json:"app_user_id"`
		Aliases        []string `json:"aliases"`
		ProductID      string   `json:"product_id"`
		EntitlementIDs []string `json:"entitlement_ids"`
		ExpirationAtMs *int64   `json:"expiration_at_ms"`
		Store          string   `json:"store"`
	} `json:"event"`
}

// Handle applies one delivery. Unknown event types and non-UUID user ids (anonymous
// RevenueCat ids) are accepted and ignored, so RevenueCat doesn't retry them forever.
func (r *RevenueCat) Handle(ctx context.Context, authorization string, body []byte) error {
	if r.secret == "" || subtle.ConstantTimeCompare([]byte(authorization), []byte(r.secret)) != 1 {
		return ErrBadSignature
	}
	var ev rcEvent
	if err := json.Unmarshal(body, &ev); err != nil {
		return &domain.ValidationError{Field: "body", Reason: "is not a RevenueCat event: " + err.Error()}
	}
	e := ev.Event
	if e.ID == "" {
		return &domain.ValidationError{Field: "event.id", Reason: "is required"}
	}
	user := domain.NormalizeUserID(e.AppUserID)
	if !user.Valid() {
		for _, a := range e.Aliases {
			if u := domain.NormalizeUserID(a); u.Valid() {
				user = u
				break
			}
		}
	}
	if !user.Valid() {
		return nil
	}

	var expires *time.Time
	switch e.Type {
	case "INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "UNCANCELLATION", "NON_RENEWING_PURCHASE", "SUBSCRIPTION_EXTENDED", "TEMPORARY_ENTITLEMENT_GRANT":
		if e.ExpirationAtMs != nil {
			t := time.UnixMilli(*e.ExpirationAtMs).UTC()
			expires = &t
		}
	case "EXPIRATION", "REFUND":
		t := r.now().UTC()
		expires = &t
	case "CANCELLATION", "BILLING_ISSUE":
		// Access continues until the period ends; EXPIRATION will follow.
		return nil
	default:
		return nil
	}

	entitlements := e.EntitlementIDs
	if len(entitlements) == 0 {
		entitlements = []string{domain.PremiumEntitlement}
	}
	for i, ent := range entitlements {
		id := e.ID
		if i > 0 {
			id = fmt.Sprintf("%s#%s", e.ID, ent)
		}
		if _, err := r.store.ApplyEntitlement(ctx, id, user, ent, expires, e.ProductID, e.Store); err != nil {
			return err
		}
	}
	return nil
}
