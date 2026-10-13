package postgres

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

// Users implements wardrobe.UserRepository.
type Users struct {
	pool *pgxpool.Pool
}

func NewUsers(pool *pgxpool.Pool) *Users { return &Users{pool: pool} }

func (r *Users) UpsertProfile(ctx context.Context, p domain.Profile) (domain.Profile, error) {
	lang := p.Language
	if lang == "" {
		lang = "en"
	}
	err := r.pool.QueryRow(ctx, `
		INSERT INTO users (id, height_cm, body_shape, skin_undertone, shoulder_cm, bust_cm, waist_cm, hip_cm, torso, season, language)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, ''), NULLIF($10, ''), $11)
		ON CONFLICT (id) DO UPDATE SET
			height_cm = EXCLUDED.height_cm,
			body_shape = EXCLUDED.body_shape,
			skin_undertone = EXCLUDED.skin_undertone,
			shoulder_cm = EXCLUDED.shoulder_cm,
			bust_cm = EXCLUDED.bust_cm,
			waist_cm = EXCLUDED.waist_cm,
			hip_cm = EXCLUDED.hip_cm,
			torso = EXCLUDED.torso,
			season = EXCLUDED.season,
			language = EXCLUDED.language,
			updated_at = now()
		RETURNING updated_at`,
		string(p.UserID), p.HeightCm, string(p.BodyShape), string(p.SkinUndertone),
		p.Proportions.ShoulderCm, p.Proportions.BustCm, p.Proportions.WaistCm, p.Proportions.HipCm,
		string(p.Proportions.Torso), string(p.Season), string(lang),
	).Scan(&p.UpdatedAt)
	p.Language = lang
	return p, mapErr(err)
}

func (r *Users) GetProfile(ctx context.Context, id domain.UserID) (domain.Profile, error) {
	p := domain.Profile{UserID: id}
	var torso, season *string
	err := r.pool.QueryRow(ctx, `
		SELECT height_cm, body_shape, skin_undertone, shoulder_cm, bust_cm, waist_cm, hip_cm, torso, season, language, updated_at
		FROM users WHERE id = $1`, string(id),
	).Scan(&p.HeightCm, &p.BodyShape, &p.SkinUndertone, &p.Proportions.ShoulderCm, &p.Proportions.BustCm,
		&p.Proportions.WaistCm, &p.Proportions.HipCm, &torso, &season, &p.Language, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Profile{}, domain.ErrUserNotFound
	}
	if torso != nil {
		p.Proportions.Torso = domain.Torso(*torso)
	}
	if season != nil {
		p.Season = domain.Season(*season)
	}
	return p, err
}

func (r *Users) RecordConsent(ctx context.Context, c domain.Consent) (domain.Consent, error) {
	purposes, err := json.Marshal(c.Purposes)
	if err != nil {
		return domain.Consent{}, err
	}
	err = r.pool.QueryRow(ctx, `
		INSERT INTO consents (user_id, notice_version, language, purposes) VALUES ($1, $2, $3, $4)
		RETURNING recorded_at`,
		string(c.UserID), c.NoticeVersion, string(c.Language), purposes,
	).Scan(&c.RecordedAt)
	return c, mapErr(err)
}

func (r *Users) ConsentHistory(ctx context.Context, id domain.UserID) ([]domain.Consent, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT notice_version, language, purposes, recorded_at FROM consents
		WHERE user_id = $1 ORDER BY recorded_at DESC, id DESC`, string(id))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (domain.Consent, error) {
		c := domain.Consent{UserID: id}
		var purposes []byte
		if err := row.Scan(&c.NoticeVersion, &c.Language, &purposes, &c.RecordedAt); err != nil {
			return c, err
		}
		return c, json.Unmarshal(purposes, &c.Purposes)
	})
}

// LatestConsent returns the consent in force; a user who never answered has consented to nothing.
func (r *Users) LatestConsent(ctx context.Context, id domain.UserID) (domain.Consent, error) {
	c := domain.Consent{UserID: id, Purposes: map[domain.Purpose]bool{}}
	var purposes []byte
	err := r.pool.QueryRow(ctx, `
		SELECT notice_version, language, purposes, recorded_at FROM consents
		WHERE user_id = $1 ORDER BY recorded_at DESC, id DESC LIMIT 1`, string(id),
	).Scan(&c.NoticeVersion, &c.Language, &purposes, &c.RecordedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, nil
	}
	if err != nil {
		return c, err
	}
	return c, json.Unmarshal(purposes, &c.Purposes)
}

// DeleteUser erases the user and everything keyed to them. Garments, outfits and their
// memberships cascade from users; consents and the device binding are deleted explicitly.
// The consent ledger goes too: the DPDP Act lets a Data Fiduciary keep it only as long as
// needed, and after erasure there is nothing left it could be evidence for.
func (r *Users) DeleteUser(ctx context.Context, id domain.UserID) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		for _, q := range []string{
			`DELETE FROM users WHERE id = $1`,
			`DELETE FROM consents WHERE user_id = $1`,
			`DELETE FROM devices WHERE user_id = $1`,
		} {
			if _, err := tx.Exec(ctx, q, string(id)); err != nil {
				return err
			}
		}
		return nil
	})
}

// Devices implements httpapi.DeviceRegistry on the devices table.
type Devices struct {
	pool *pgxpool.Pool
}

func NewDevices(pool *pgxpool.Pool) *Devices { return &Devices{pool: pool} }

// Enroll binds a token hash to a user id the first time it is seen. Re-enrolling with the
// same hash is a no-op; a different hash for an enrolled user is ErrForbidden.
func (d *Devices) Enroll(ctx context.Context, user domain.UserID, hash []byte) error {
	tag, err := d.pool.Exec(ctx, `
		INSERT INTO devices (user_id, token_hash) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET last_seen_at = now() WHERE devices.token_hash = EXCLUDED.token_hash`,
		string(user), hash)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrForbidden
	}
	return nil
}

// Verify reports ErrUnauthorized for an unknown user and ErrForbidden for a wrong token.
func (d *Devices) Verify(ctx context.Context, user domain.UserID, hash []byte) error {
	var stored []byte
	err := d.pool.QueryRow(ctx, `SELECT token_hash FROM devices WHERE user_id = $1`, string(user)).Scan(&stored)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ErrUnauthorized
	}
	if err != nil {
		return err
	}
	if !constantTimeEqual(stored, hash) {
		return domain.ErrForbidden
	}
	return nil
}
