package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/affiliate"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

// Affiliate implements affiliate.Feed and logs clicks.
type Affiliate struct{ pool *pgxpool.Pool }

func NewAffiliate(pool *pgxpool.Pool) *Affiliate { return &Affiliate{pool: pool} }

func (a *Affiliate) ByCategory(ctx context.Context, category string, limit int) ([]affiliate.FeedProduct, error) {
	rows, err := a.pool.Query(ctx, `
		SELECT partner, title, category, color_hex, COALESCE(price_inr, 0), image_url, url
		FROM affiliate_products WHERE active AND category = $1 LIMIT $2`, category, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (affiliate.FeedProduct, error) {
		var p affiliate.FeedProduct
		err := r.Scan(&p.Partner, &p.Title, &p.Category, &p.ColorHex, &p.PriceINR, &p.ImageURL, &p.URL)
		return p, err
	})
}

// LogClick records an outbound click by partner and category only (no user).
func (a *Affiliate) LogClick(ctx context.Context, partner, category string) error {
	_, err := a.pool.Exec(ctx, `INSERT INTO affiliate_clicks (partner, category) VALUES ($1, $2)`, partner, category)
	return err
}

// Listings implements wardrobe.ListingRepository.
type Listings struct{ pool *pgxpool.Pool }

func NewListings(pool *pgxpool.Pool) *Listings { return &Listings{pool: pool} }

const listingCols = `l.id, l.client_item_id, l.title, l.description, l.price_inr, l.condition, l.size_label, l.category,
	l.color_hex, l.city, l.image_url, l.status, l.created_at, l.user_id = $1,
	(SELECT COUNT(*) FROM listing_inquiries i WHERE i.listing_id = l.id)`

func scanListing(row pgx.CollectableRow) (domain.Listing, error) {
	var l domain.Listing
	err := row.Scan(&l.ID, &l.ClientItemID, &l.Title, &l.Description, &l.PriceINR, &l.Condition, &l.Size, &l.Category,
		&l.ColorHex, &l.City, &l.ImageURL, &l.Status, &l.CreatedAt, &l.Mine, &l.Inquiries)
	if !l.Mine {
		// Buyers don't see the seller's item id or inquiry count.
		l.ClientItemID, l.Inquiries = "", 0
	}
	return l, err
}

func (r *Listings) Create(ctx context.Context, n domain.NewListing) (domain.Listing, error) {
	var id string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO listings (user_id, client_item_id, title, description, price_inr, condition, size_label, category, color_hex, city, image_url)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
		string(n.UserID), string(n.ClientItemID), n.Title, n.Description, n.PriceINR, string(n.Condition), n.Size, n.Category,
		string(n.ColorHex), n.City, n.ImageURL).Scan(&id)
	if err != nil {
		var pg interface{ SQLState() string }
		if errors.As(err, &pg) && pg.SQLState() == "23505" {
			return domain.Listing{}, &domain.ValidationError{Field: "client_item_id", Reason: "already has an active listing"}
		}
		if errors.As(err, &pg) && pg.SQLState() == "23503" {
			return domain.Listing{}, domain.ErrUserNotFound
		}
		return domain.Listing{}, mapErr(err)
	}
	return r.Get(ctx, n.UserID, id)
}

func (r *Listings) Get(ctx context.Context, viewer domain.UserID, id string) (domain.Listing, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+listingCols+` FROM listings l WHERE l.id = $2`, viewerArg(viewer), id)
	if err != nil {
		return domain.Listing{}, mapErr(err)
	}
	l, err := pgx.CollectExactlyOneRow(rows, scanListing)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Listing{}, domain.ErrNotFound
	}
	return l, err
}

// Feed lists other sellers' active listings, newest first, optionally in one category.
func (r *Listings) Feed(ctx context.Context, viewer domain.UserID, category string, limit int) ([]domain.Listing, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+listingCols+` FROM listings l
		WHERE l.status = 'active' AND l.user_id <> $1 AND ($2 = '' OR l.category = $2)
		ORDER BY l.created_at DESC LIMIT $3`, viewerArg(viewer), category, limit)
	if err != nil {
		return nil, mapErr(err)
	}
	return pgx.CollectRows(rows, scanListing)
}

func (r *Listings) Mine(ctx context.Context, user domain.UserID) ([]domain.Listing, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+listingCols+` FROM listings l WHERE l.user_id = $1 ORDER BY l.created_at DESC`, string(user))
	if err != nil {
		return nil, mapErr(err)
	}
	return pgx.CollectRows(rows, scanListing)
}

// Update changes the seller's own listing; ErrNotFound for anyone else's.
func (r *Listings) Update(ctx context.Context, user domain.UserID, id string, status *domain.ListingStatus, price *int) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE listings SET status = COALESCE($3, status), price_inr = COALESCE($4, price_inr), updated_at = now()
		WHERE id = $1 AND user_id = $2`, id, string(user), (*string)(status), price)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

func (r *Listings) AddInquiry(ctx context.Context, buyer domain.UserID, listingID, message, contact string) error {
	tag, err := r.pool.Exec(ctx, `
		INSERT INTO listing_inquiries (listing_id, buyer_id, message, contact)
		SELECT id, $2, $3, $4 FROM listings WHERE id = $1 AND status = 'active' AND user_id <> $2`,
		listingID, string(buyer), message, contact)
	if err != nil {
		return mapErr(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.ErrNotFound
	}
	return nil
}

// Inquiries returns the inquiries on the seller's own listing.
func (r *Listings) Inquiries(ctx context.Context, seller domain.UserID, listingID string) ([]domain.Inquiry, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT i.id, i.message, i.contact, i.created_at FROM listing_inquiries i
		JOIN listings l ON l.id = i.listing_id WHERE l.id = $1 AND l.user_id = $2 ORDER BY i.created_at DESC`,
		listingID, string(seller))
	if err != nil {
		return nil, mapErr(err)
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[domain.Inquiry])
}

// viewerArg lets anonymous viewers (the public share page) match no seller.
func viewerArg(u domain.UserID) string {
	if u == "" {
		return "00000000-0000-0000-0000-000000000000"
	}
	return string(u)
}
