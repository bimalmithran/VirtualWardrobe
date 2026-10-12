// Package store is the PostgreSQL + pgvector persistence layer.
package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pgvector/pgvector-go"
	pgxvec "github.com/pgvector/pgvector-go/pgx"

	"github.com/bimalmithran/virtualwardrobe/backend/db"
)

// EmbeddingDim must match VECTOR(512) in schema.sql and MobileCLIP-S0 on the phone.
const EmbeddingDim = 512

var (
	ErrUserNotFound     = errors.New("user not found; POST /api/users/profile first")
	ErrUnknownCategory  = errors.New("unknown category_slug")
	ErrConstraintFailed = errors.New("value rejected by database constraint")
)

type Profile struct {
	UserID        string    `json:"user_id"`
	HeightCm      int       `json:"height_cm"`
	BodyShape     string    `json:"body_shape"`
	SkinUndertone string    `json:"skin_undertone"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type NewItem struct {
	UserID       string
	ClientItemID string
	CategorySlug string // optional
	ImageURL     string
	ColorHex     string
	Metadata     json.RawMessage // a JSON object
	Embedding    []float32
}

type Item struct {
	ID           string          `json:"id"`
	ClientItemID string          `json:"client_item_id"`
	CategorySlug *string         `json:"category_slug"`
	ImageURL     string          `json:"image_url"`
	ColorHex     string          `json:"primary_color_hex"`
	Metadata     json.RawMessage `json:"metadata"`
	CreatedAt    time.Time       `json:"created_at"`
}

type Match struct {
	Item
	// Cosine similarity in [-1, 1]; 1 means identical direction.
	Similarity float64 `json:"similarity"`
}

type Store struct {
	pool *pgxpool.Pool
}

// Open optionally applies the embedded schema, then opens a pool with pgvector types
// registered on every connection. The schema must run first: RegisterTypes looks up
// the `vector` type's OID and fails if the extension is not installed yet.
func Open(ctx context.Context, url string, migrate bool) (*Store, error) {
	if migrate {
		if err := applySchema(ctx, url); err != nil {
			return nil, fmt.Errorf("apply schema: %w", err)
		}
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		return pgxvec.RegisterTypes(ctx, conn)
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{pool: pool}, nil
}

func applySchema(ctx context.Context, url string) error {
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	// No parameters, so pgx uses the simple protocol and runs every statement in the file.
	_, err = conn.Exec(ctx, db.Schema)
	return err
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

func (s *Store) UpsertProfile(ctx context.Context, p Profile) (Profile, error) {
	err := s.pool.QueryRow(ctx, `
		INSERT INTO users (id, height_cm, body_shape, skin_undertone)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (id) DO UPDATE SET
			height_cm = EXCLUDED.height_cm,
			body_shape = EXCLUDED.body_shape,
			skin_undertone = EXCLUDED.skin_undertone,
			updated_at = now()
		RETURNING updated_at`,
		p.UserID, p.HeightCm, p.BodyShape, p.SkinUndertone,
	).Scan(&p.UpdatedAt)
	return p, mapErr(err)
}

// UpsertItem is idempotent on (user_id, client_item_id), so the phone can retry an
// upload after a dropped connection without creating duplicates.
func (s *Store) UpsertItem(ctx context.Context, in NewItem) (item Item, created bool, err error) {
	if in.CategorySlug != "" {
		var exists bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM categories WHERE slug = $1)`, in.CategorySlug).Scan(&exists); err != nil {
			return Item{}, false, err
		}
		if !exists {
			return Item{}, false, ErrUnknownCategory
		}
	}
	err = s.pool.QueryRow(ctx, `
		INSERT INTO wardrobe_items (user_id, client_item_id, category_id, image_url, primary_color_hex, metadata, embedding)
		VALUES ($1, $2, (SELECT id FROM categories WHERE slug = NULLIF($3, '')), $4, $5, $6, $7)
		ON CONFLICT (user_id, client_item_id) DO UPDATE SET
			category_id = EXCLUDED.category_id,
			image_url = EXCLUDED.image_url,
			primary_color_hex = EXCLUDED.primary_color_hex,
			metadata = EXCLUDED.metadata,
			embedding = EXCLUDED.embedding
		RETURNING id, created_at, (xmax = 0) AS inserted`,
		in.UserID, in.ClientItemID, in.CategorySlug, in.ImageURL, in.ColorHex, in.Metadata, pgvector.NewVector(in.Embedding),
	).Scan(&item.ID, &item.CreatedAt, &created)
	if err != nil {
		return Item{}, false, mapErr(err)
	}
	item.ClientItemID = in.ClientItemID
	if in.CategorySlug != "" {
		item.CategorySlug = &in.CategorySlug
	}
	item.ImageURL = in.ImageURL
	item.ColorHex = in.ColorHex
	item.Metadata = in.Metadata
	return item, created, nil
}

// Search returns the `limit` nearest items by cosine distance, optionally scoped to one
// user. Ordering by the `<=>` expression lets the planner walk the HNSW index.
func (s *Store) Search(ctx context.Context, vec []float32, userID string, limit int) ([]Match, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // read-only; rollback after commit is a no-op

	// HNSW returns ef_search candidates and the WHERE clause filters them afterwards,
	// so a per-user filter on a big shared index could come back short. pgvector 0.8's
	// iterative scan keeps walking the graph until `limit` rows pass the filter.
	if _, err := tx.Exec(ctx, `SET LOCAL hnsw.iterative_scan = relaxed_order`); err != nil {
		return nil, fmt.Errorf("pgvector >= 0.8 required: %w", err)
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
		pgvector.NewVector(vec), nullIfEmpty(userID), limit,
	)
	if err != nil {
		return nil, mapErr(err)
	}
	matches, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Match, error) {
		var m Match
		err := row.Scan(&m.ID, &m.ClientItemID, &m.CategorySlug, &m.ImageURL, &m.ColorHex, &m.Metadata, &m.CreatedAt, &m.Similarity)
		return m, err
	})
	if err != nil {
		return nil, err
	}
	return matches, tx.Commit(ctx)
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// mapErr turns constraint violations into errors the API can report as 4xx.
func mapErr(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23503": // foreign_key_violation
		if pgErr.ConstraintName == "wardrobe_items_user_id_fkey" {
			return ErrUserNotFound
		}
	case "23514", "22P02": // check_violation, invalid_text_representation (e.g. bad uuid)
		return fmt.Errorf("%w: %s", ErrConstraintFailed, pgErr.Message)
	}
	return err
}
