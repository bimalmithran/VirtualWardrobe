// Package postgres implements the wardrobe repositories on PostgreSQL + pgvector (pgx/v5).
package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	pgxvec "github.com/pgvector/pgvector-go/pgx"

	"github.com/bimalmithran/virtualwardrobe/backend/db"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

// Open optionally applies the embedded schema, then opens a pool with pgvector types
// registered on every connection. The schema must go first: RegisterTypes looks up the
// `vector` type's OID and fails if the extension isn't installed yet.
func Open(ctx context.Context, url string, migrate bool) (*pgxpool.Pool, error) {
	if migrate {
		if err := Migrate(ctx, url); err != nil {
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
	return pool, nil
}

// Migrate runs db/schema.sql, which is idempotent.
func Migrate(ctx context.Context, url string) error {
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	// No parameters, so pgx uses the simple protocol and runs every statement in the file.
	_, err = conn.Exec(ctx, db.Schema)
	return err
}

// mapErr translates constraint violations into domain errors.
func mapErr(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23503": // foreign_key_violation
		if pgErr.ConstraintName == "wardrobe_items_user_id_fkey" {
			return domain.ErrUserNotFound
		}
	case "23514", "22P02": // check_violation, invalid_text_representation
		return &domain.ValidationError{Field: pgErr.ColumnName, Reason: "rejected by database: " + pgErr.Message}
	}
	return err
}
