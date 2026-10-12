package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pgvector/pgvector-go"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/wardrobe"
)

// Items implements wardrobe.ItemRepository.
type Items struct {
	pool *pgxpool.Pool
}

func NewItems(pool *pgxpool.Pool) *Items { return &Items{pool: pool} }

func (r *Items) UpsertItem(ctx context.Context, in domain.NewItem) (domain.Item, bool, error) {
	if in.CategorySlug != "" {
		var exists bool
		if err := r.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM categories WHERE slug = $1)`, in.CategorySlug).Scan(&exists); err != nil {
			return domain.Item{}, false, err
		}
		if !exists {
			return domain.Item{}, false, domain.ErrUnknownCategory
		}
	}

	metadata := []byte(in.Metadata)
	if len(metadata) == 0 {
		metadata = []byte("{}")
	}
	item := domain.Item{ClientItemID: in.ClientItemID, ImageURL: in.ImageURL, ColorHex: in.ColorHex, Metadata: domain.Metadata(metadata)}
	if in.CategorySlug != "" {
		item.CategorySlug = &in.CategorySlug
	}

	var created bool
	err := r.pool.QueryRow(ctx, `
		INSERT INTO wardrobe_items (user_id, client_item_id, category_id, image_url, primary_color_hex, metadata, embedding)
		VALUES ($1, $2, (SELECT id FROM categories WHERE slug = NULLIF($3, '')), $4, $5, $6, $7)
		ON CONFLICT (user_id, client_item_id) DO UPDATE SET
			category_id = EXCLUDED.category_id,
			image_url = EXCLUDED.image_url,
			primary_color_hex = EXCLUDED.primary_color_hex,
			metadata = EXCLUDED.metadata,
			embedding = EXCLUDED.embedding
		RETURNING id, created_at, (xmax = 0) AS inserted`,
		string(in.UserID), string(in.ClientItemID), in.CategorySlug, in.ImageURL, string(in.ColorHex),
		metadata, pgvector.NewVector(in.Embedding),
	).Scan(&item.ID, &item.CreatedAt, &created)
	if err != nil {
		return domain.Item{}, false, mapErr(err)
	}
	return item, created, nil
}

// SearchSimilar orders by the `<=>` (cosine distance) expression so the planner can walk
// the HNSW index.
func (r *Items) SearchSimilar(ctx context.Context, q wardrobe.SearchQuery) ([]domain.Match, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // read-only; rollback after commit is a no-op

	// HNSW returns ef_search candidates and the WHERE clause filters them afterwards, so a
	// per-user filter on a big shared index could come back short. pgvector 0.8's
	// iterative scan keeps walking the graph until `limit` rows pass the filter.
	if _, err := tx.Exec(ctx, `SET LOCAL hnsw.iterative_scan = relaxed_order`); err != nil {
		return nil, fmt.Errorf("pgvector >= 0.8 required: %w", err)
	}

	var userID *string
	if q.UserID != "" {
		s := string(q.UserID)
		userID = &s
	}
	// relaxed_order may return candidates slightly out of order; the outer ORDER BY fixes that.
	rows, err := tx.Query(ctx, `
		WITH nearest AS MATERIALIZED (
			SELECT w.id, w.client_item_id, c.slug AS category_slug, w.image_url,
			       w.primary_color_hex, w.metadata, w.created_at,
			       w.embedding <=> $1 AS distance
			FROM wardrobe_items w
			LEFT JOIN categories c ON c.id = w.category_id
			WHERE $2::uuid IS NULL OR w.user_id = $2::uuid
			ORDER BY w.embedding <=> $1
			LIMIT $3
		)
		SELECT id, client_item_id, category_slug, image_url, primary_color_hex, metadata, created_at, 1 - distance
		FROM nearest
		ORDER BY distance`,
		pgvector.NewVector(q.Embedding), userID, q.Limit,
	)
	if err != nil {
		return nil, mapErr(err)
	}
	matches, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Match, error) {
		var (
			m               domain.Match
			clientID, color string
			metadata        []byte
		)
		err := row.Scan(&m.ID, &clientID, &m.CategorySlug, &m.ImageURL, &color, &metadata, &m.CreatedAt, &m.Similarity)
		m.ClientItemID, m.ColorHex, m.Metadata = domain.ClientItemID(clientID), domain.ColorHex(color), domain.Metadata(metadata)
		return m, err
	})
	if err != nil {
		return nil, err
	}
	return matches, tx.Commit(ctx)
}
