package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

// Outfits implements wardrobe.OutfitRepository.
type Outfits struct {
	pool *pgxpool.Pool
}

func NewOutfits(pool *pgxpool.Pool) *Outfits { return &Outfits{pool: pool} }

// UpsertOutfit writes the outfit row and replaces its garment list in one transaction, so
// a partially-synced closet never leaves a half-written outfit behind.
func (r *Outfits) UpsertOutfit(ctx context.Context, in domain.NewOutfit) (domain.Outfit, bool, error) {
	metadata := []byte(in.Metadata)
	if len(metadata) == 0 {
		metadata = []byte("{}")
	}
	out := domain.Outfit{ClientOutfitID: in.ClientOutfitID, Name: in.Name, ItemIDs: in.ItemIDs, Metadata: domain.Metadata(metadata)}
	if in.Occasion != "" {
		out.Occasion = &in.Occasion
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return domain.Outfit{}, false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after commit

	ids := make([]string, len(in.ItemIDs))
	for i, id := range in.ItemIDs {
		ids[i] = string(id)
	}
	var found int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM wardrobe_items WHERE user_id = $1 AND client_item_id = ANY($2)`,
		string(in.UserID), ids,
	).Scan(&found); err != nil {
		return domain.Outfit{}, false, mapErr(err)
	}
	if found != len(ids) {
		return domain.Outfit{}, false, domain.ErrUnknownItems
	}

	var created bool
	err = tx.QueryRow(ctx, `
		INSERT INTO outfits (user_id, client_outfit_id, name, occasion, metadata)
		VALUES ($1, $2, $3, NULLIF($4, ''), $5)
		ON CONFLICT (user_id, client_outfit_id) DO UPDATE SET
			name = EXCLUDED.name,
			occasion = EXCLUDED.occasion,
			metadata = EXCLUDED.metadata
		RETURNING id, created_at, (xmax = 0) AS inserted`,
		string(in.UserID), string(in.ClientOutfitID), in.Name, in.Occasion, metadata,
	).Scan(&out.ID, &out.CreatedAt, &created)
	if err != nil {
		return domain.Outfit{}, false, mapErr(err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM outfit_items WHERE outfit_id = $1`, out.ID); err != nil {
		return domain.Outfit{}, false, err
	}
	// WITH ORDINALITY keeps the phone's display order in outfit_items.position.
	if _, err := tx.Exec(ctx, `
		INSERT INTO outfit_items (outfit_id, item_id, position)
		SELECT $1, w.id, (t.ord - 1)::smallint
		FROM unnest($3::text[]) WITH ORDINALITY AS t (client_item_id, ord)
		JOIN wardrobe_items w ON w.user_id = $2 AND w.client_item_id = t.client_item_id`,
		out.ID, string(in.UserID), ids,
	); err != nil {
		return domain.Outfit{}, false, err
	}
	return out, created, tx.Commit(ctx)
}

func (r *Outfits) ListOutfits(ctx context.Context, user domain.UserID) ([]domain.Outfit, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT o.id, o.client_outfit_id, o.name, o.occasion, o.metadata, o.created_at,
		       COALESCE(array_agg(w.client_item_id ORDER BY oi.position) FILTER (WHERE w.id IS NOT NULL), '{}')
		FROM outfits o
		LEFT JOIN outfit_items oi ON oi.outfit_id = o.id
		LEFT JOIN wardrobe_items w ON w.id = oi.item_id
		WHERE o.user_id = $1 AND o.client_outfit_id IS NOT NULL
		GROUP BY o.id
		ORDER BY o.created_at DESC`, string(user))
	if err != nil {
		return nil, mapErr(err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Outfit, error) {
		var (
			o        domain.Outfit
			clientID string
			metadata []byte
			items    []string
		)
		err := row.Scan(&o.ID, &clientID, &o.Name, &o.Occasion, &metadata, &o.CreatedAt, &items)
		o.ClientOutfitID, o.Metadata = domain.ClientOutfitID(clientID), domain.Metadata(metadata)
		o.ItemIDs = make([]domain.ClientItemID, len(items))
		for i, id := range items {
			o.ItemIDs[i] = domain.ClientItemID(id)
		}
		return o, err
	})
}

func (r *Outfits) DeleteOutfit(ctx context.Context, user domain.UserID, outfit domain.ClientOutfitID) error {
	tag, err := r.pool.Exec(ctx, `DELETE FROM outfits WHERE user_id = $1 AND client_outfit_id = $2`, string(user), string(outfit))
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}
