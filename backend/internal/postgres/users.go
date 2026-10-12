package postgres

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

// Users implements wardrobe.UserRepository.
type Users struct {
	pool *pgxpool.Pool
}

func NewUsers(pool *pgxpool.Pool) *Users { return &Users{pool: pool} }

func (r *Users) UpsertProfile(ctx context.Context, p domain.Profile) (domain.Profile, error) {
	err := r.pool.QueryRow(ctx, `
		INSERT INTO users (id, height_cm, body_shape, skin_undertone)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (id) DO UPDATE SET
			height_cm = EXCLUDED.height_cm,
			body_shape = EXCLUDED.body_shape,
			skin_undertone = EXCLUDED.skin_undertone,
			updated_at = now()
		RETURNING updated_at`,
		string(p.UserID), p.HeightCm, string(p.BodyShape), string(p.SkinUndertone),
	).Scan(&p.UpdatedAt)
	return p, mapErr(err)
}
