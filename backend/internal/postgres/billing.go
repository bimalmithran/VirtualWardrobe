package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

// Billing stores entitlements and meters free-plan usage.
type Billing struct {
	pool *pgxpool.Pool
	now  func() time.Time
	// everyone grants premium to all users (PREMIUM_FOR_ALL), bypassing stored entitlements.
	everyone bool
}

func NewBilling(pool *pgxpool.Pool, premiumForAll bool) *Billing {
	return &Billing{pool: pool, now: time.Now, everyone: premiumForAll}
}

// Premium reports whether the user's premium entitlement is active now.
func (b *Billing) Premium(ctx context.Context, user domain.UserID) (bool, *time.Time, error) {
	if b.everyone {
		return true, nil, nil
	}
	var expires *time.Time
	err := b.pool.QueryRow(ctx,
		`SELECT expires_at FROM entitlements WHERE user_id = $1 AND entitlement = $2`,
		string(user), domain.PremiumEntitlement,
	).Scan(&expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	return expires == nil || expires.After(b.now()), expires, nil
}

// Take counts one use of feature today. Premium users are unmetered; free users are
// refused once they reach the feature's daily limit (the failed attempt isn't counted).
func (b *Billing) Take(ctx context.Context, user domain.UserID, feature string) error {
	limit, metered := domain.FreeLimits[feature]
	if !metered {
		return nil
	}
	premium, _, err := b.Premium(ctx, user)
	if err != nil || premium {
		return err
	}
	// The UPDATE ... WHERE count < limit is atomic, so concurrent requests can't overshoot.
	tag, err := b.pool.Exec(ctx, `
		INSERT INTO usage_counters (user_id, feature, day, count) VALUES ($1, $2, current_date, 1)
		ON CONFLICT (user_id, feature, day) DO UPDATE SET count = usage_counters.count + 1
		WHERE usage_counters.count < $3`,
		string(user), feature, limit)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrQuotaExceeded
	}
	return nil
}

// Entitlements summarises the plan and today's metered usage.
func (b *Billing) Entitlements(ctx context.Context, user domain.UserID) (domain.Entitlements, error) {
	premium, expires, err := b.Premium(ctx, user)
	if err != nil {
		return domain.Entitlements{}, err
	}
	out := domain.Entitlements{Premium: premium, ExpiresAt: expires, Usage: map[string]domain.UsageInfo{}}
	for feature, limit := range domain.FreeLimits {
		if premium {
			limit = 0
		}
		out.Usage[feature] = domain.UsageInfo{Limit: limit}
	}
	rows, err := b.pool.Query(ctx, `SELECT feature, count FROM usage_counters WHERE user_id = $1 AND day = current_date`, string(user))
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var f string
		var n int
		if err := rows.Scan(&f, &n); err != nil {
			return out, err
		}
		if u, ok := out.Usage[f]; ok {
			u.Used = n
			out.Usage[f] = u
		}
	}
	return out, rows.Err()
}

// ApplyEntitlement records an entitlement change from a store event, once per event id.
// A nil expiry is lifetime; an expiry in the past revokes.
func (b *Billing) ApplyEntitlement(ctx context.Context, eventID string, user domain.UserID, entitlement string, expires *time.Time, productID, store string) (applied bool, err error) {
	err = pgx.BeginFunc(ctx, b.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO webhook_events (id) VALUES ($1) ON CONFLICT DO NOTHING`, eventID)
		if err != nil || tag.RowsAffected() == 0 {
			return err // a redelivery: already applied
		}
		applied = true
		_, err = tx.Exec(ctx, `
			INSERT INTO entitlements (user_id, entitlement, expires_at, product_id, store) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (user_id, entitlement) DO UPDATE SET
				expires_at = EXCLUDED.expires_at, product_id = EXCLUDED.product_id, store = EXCLUDED.store, updated_at = now()`,
			string(user), entitlement, expires, productID, store)
		return err
	})
	return applied, err
}
