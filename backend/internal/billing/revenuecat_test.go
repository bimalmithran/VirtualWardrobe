package billing

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

type applied struct {
	id      string
	user    domain.UserID
	ent     string
	expires *time.Time
}

type memStore struct{ calls []applied }

func (m *memStore) ApplyEntitlement(_ context.Context, id string, u domain.UserID, ent string, exp *time.Time, _, _ string) (bool, error) {
	m.calls = append(m.calls, applied{id, u, ent, exp})
	return true, nil
}

const u = "11111111-1111-4111-8111-111111111111"

func TestRevenueCatEvents(t *testing.T) {
	store := &memStore{}
	now := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	rc := NewRevenueCat(store, "Bearer s3cret")
	rc.now = func() time.Time { return now }
	ctx := context.Background()

	if err := rc.Handle(ctx, "Bearer wrong", []byte(`{}`)); !errors.Is(err, ErrBadSignature) {
		t.Fatalf("bad secret: %v", err)
	}
	purchase := `{"event":{"id":"e1","type":"INITIAL_PURCHASE","app_user_id":"` + u + `","entitlement_ids":["premium"],"expiration_at_ms":1798761600000,"product_id":"premium_monthly","store":"PLAY_STORE"}}`
	if err := rc.Handle(ctx, "Bearer s3cret", []byte(purchase)); err != nil {
		t.Fatal(err)
	}
	if len(store.calls) != 1 || store.calls[0].expires.UnixMilli() != 1798761600000 || store.calls[0].ent != "premium" {
		t.Fatalf("purchase: %+v", store.calls)
	}
	rc.Handle(ctx, "Bearer s3cret", []byte(`{"event":{"id":"e2","type":"CANCELLATION","app_user_id":"`+u+`"}}`)) //nolint:errcheck
	if len(store.calls) != 1 {
		t.Fatal("cancellation must not revoke before the period ends")
	}
	rc.Handle(ctx, "Bearer s3cret", []byte(`{"event":{"id":"e3","type":"EXPIRATION","app_user_id":"`+u+`"}}`)) //nolint:errcheck
	if got := store.calls[1].expires; got == nil || !got.Equal(now) {
		t.Fatalf("expiration should end access now: %v", got)
	}
	// Anonymous RevenueCat ids are acknowledged and ignored.
	if err := rc.Handle(ctx, "Bearer s3cret", []byte(`{"event":{"id":"e4","type":"RENEWAL","app_user_id":"$RCAnonymousID:abc"}}`)); err != nil || len(store.calls) != 2 {
		t.Fatalf("anonymous: %v %d", err, len(store.calls))
	}
}
