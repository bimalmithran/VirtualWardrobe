-- VirtualWardrobe schema. PostgreSQL 15+ with pgvector >= 0.8.
-- Idempotent: safe to re-run against an existing database.
--   psql "$DATABASE_URL" -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- users: the Digital Twin. The id is generated on the phone, so the app works
-- offline first and syncs later without a login flow.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id             UUID PRIMARY KEY,
    height_cm      SMALLINT    NOT NULL CHECK (height_cm BETWEEN 100 AND 250),
    body_shape     TEXT        NOT NULL CHECK (body_shape IN
                       ('rectangle', 'triangle', 'inverted-triangle', 'hourglass', 'oval')),
    skin_undertone TEXT        NOT NULL CHECK (skin_undertone IN ('warm', 'cool', 'neutral')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- categories: adjacency-list hierarchy (Tops > Shirts > ...).
-- Fetch a subtree with a recursive CTE on parent_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id        SERIAL PRIMARY KEY,
    parent_id INTEGER REFERENCES categories (id) ON DELETE CASCADE,
    slug      TEXT NOT NULL UNIQUE,
    name      TEXT NOT NULL,
    CHECK (parent_id IS DISTINCT FROM id)
);
CREATE INDEX IF NOT EXISTS categories_parent_idx ON categories (parent_id);

INSERT INTO categories (slug, name) VALUES
    ('tops', 'Tops'), ('bottoms', 'Bottoms'), ('outerwear', 'Outerwear'),
    ('footwear', 'Footwear'), ('accessories', 'Accessories')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (parent_id, slug, name)
SELECT p.id, c.slug, c.name
FROM (VALUES
    ('tops', 'shirts', 'Shirts'), ('tops', 't-shirts', 'T-Shirts'), ('tops', 'knitwear', 'Knitwear'),
    ('bottoms', 'trousers', 'Trousers'), ('bottoms', 'jeans', 'Jeans'), ('bottoms', 'skirts', 'Skirts'),
    ('outerwear', 'jackets', 'Jackets'), ('outerwear', 'coats', 'Coats'),
    ('footwear', 'sneakers', 'Sneakers'), ('footwear', 'formal-shoes', 'Formal shoes')
) AS c (parent_slug, slug, name)
JOIN categories p ON p.slug = c.parent_slug
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- wardrobe_items: one processed garment. The heavy lifting (cutout, colour,
-- embedding) already happened on the phone; the server only stores and indexes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wardrobe_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    client_item_id    TEXT        NOT NULL, -- the phone's SQLite id; makes uploads idempotent
    category_id       INTEGER     REFERENCES categories (id) ON DELETE SET NULL,
    image_url         TEXT        NOT NULL,
    primary_color_hex CHAR(7)     NOT NULL CHECK (primary_color_hex ~ '^#[0-9A-F]{6}$'),
    -- Free-form garment facts: palette, fabric, brand, season, model versions...
    metadata          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    embedding         VECTOR(512) NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, client_item_id)
);

CREATE INDEX IF NOT EXISTS wardrobe_items_user_idx ON wardrobe_items (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wardrobe_items_metadata_idx ON wardrobe_items USING GIN (metadata jsonb_path_ops);

-- Approximate nearest-neighbour search on cosine distance (the `<=>` operator).
-- m / ef_construction are pgvector's defaults, spelled out so they are easy to tune.
CREATE INDEX IF NOT EXISTS wardrobe_items_embedding_hnsw
    ON wardrobe_items USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ---------------------------------------------------------------------------
-- outfits / outfit_items: many-to-many between outfits and garments.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outfits (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name       TEXT        NOT NULL,
    occasion   TEXT,
    metadata   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outfits_user_idx ON outfits (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS outfit_items (
    outfit_id UUID     NOT NULL REFERENCES outfits (id) ON DELETE CASCADE,
    item_id   UUID     NOT NULL REFERENCES wardrobe_items (id) ON DELETE CASCADE,
    slot      TEXT     NOT NULL DEFAULT 'other', -- top / bottom / shoes / layer / accessory
    position  SMALLINT NOT NULL DEFAULT 0,       -- display order within the outfit
    PRIMARY KEY (outfit_id, item_id)
);
CREATE INDEX IF NOT EXISTS outfit_items_item_idx ON outfit_items (item_id);

-- Outfits built on the phone carry the phone's id, so uploads are idempotent like garments.
ALTER TABLE outfits ADD COLUMN IF NOT EXISTS client_outfit_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS outfits_user_client_idx ON outfits (user_id, client_outfit_id);

-- ---------------------------------------------------------------------------
-- Indian ethnic wear is its own top-level category: it is worn as a complete
-- look (a saree or a kurta set) rather than as a top plus a bottom.
-- ---------------------------------------------------------------------------
INSERT INTO categories (slug, name) VALUES ('ethnic', 'Indian Ethnic Wear')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (parent_id, slug, name)
SELECT p.id, c.slug, c.name
FROM (VALUES
    ('ethnic', 'kurtas', 'Kurtas'), ('ethnic', 'sarees', 'Sarees'), ('ethnic', 'lehengas', 'Lehengas'),
    ('ethnic', 'salwar-sets', 'Salwar sets'), ('ethnic', 'sherwanis', 'Sherwanis'), ('ethnic', 'mundu-dhoti', 'Mundu & dhoti')
) AS c (parent_slug, slug, name)
JOIN categories p ON p.slug = c.parent_slug
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Digital Twin v2: optional proportions, a 12-season palette and UI language.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS shoulder_cm SMALLINT CHECK (shoulder_cm BETWEEN 25 AND 80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bust_cm     SMALLINT CHECK (bust_cm BETWEEN 50 AND 200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS waist_cm    SMALLINT CHECK (waist_cm BETWEEN 40 AND 200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS hip_cm      SMALLINT CHECK (hip_cm BETWEEN 50 AND 200);
ALTER TABLE users ADD COLUMN IF NOT EXISTS torso       TEXT CHECK (torso IN ('short', 'balanced', 'long'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS season      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS language    TEXT NOT NULL DEFAULT 'en';

-- ---------------------------------------------------------------------------
-- devices: one secret per install. The phone generates 32 random bytes, keeps
-- them in the platform keystore and sends them as a bearer token; only the
-- SHA-256 is stored. Not keyed to users, because a device enrols before it has
-- saved a Digital Twin (consent is recorded first).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
    user_id      UUID PRIMARY KEY,
    token_hash   BYTEA       NOT NULL CHECK (length(token_hash) = 32),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- consents: append-only ledger of the user's consent decisions (DPDP Act 2023
-- s.6). The newest row per user is in force; older rows are the audit trail.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consents (
    id             BIGSERIAL PRIMARY KEY,
    user_id        UUID        NOT NULL,
    notice_version TEXT        NOT NULL,
    language       TEXT        NOT NULL DEFAULT 'en',
    purposes       JSONB       NOT NULL,
    recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consents_user_idx ON consents (user_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Monetisation.
-- entitlements: premium status, written by the RevenueCat webhook (the store
-- receipt is validated by RevenueCat). usage_counters: per-day metering of
-- costly cloud features for the free plan.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entitlements (
    user_id     UUID        NOT NULL,
    entitlement TEXT        NOT NULL,
    expires_at  TIMESTAMPTZ,            -- NULL = lifetime
    product_id  TEXT        NOT NULL DEFAULT '',
    store       TEXT        NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, entitlement)
);

CREATE TABLE IF NOT EXISTS usage_counters (
    user_id UUID    NOT NULL,
    feature TEXT    NOT NULL,
    day     DATE    NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, feature, day)
);

-- Webhook deliveries already applied, so RevenueCat retries are idempotent.
CREATE TABLE IF NOT EXISTS webhook_events (
    id          TEXT PRIMARY KEY,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Affiliate "complete the look": an optional partner product feed, and a log
-- of outbound clicks (for commission reconciliation). Clicks are not tied to
-- users: only an hourly bucket and the partner are kept.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate_products (
    id         BIGSERIAL PRIMARY KEY,
    partner    TEXT    NOT NULL,
    title      TEXT    NOT NULL,
    category   TEXT    NOT NULL,
    color_hex  CHAR(7) NOT NULL CHECK (color_hex ~ '^#[0-9A-F]{6}$'),
    price_inr  INTEGER,
    image_url  TEXT    NOT NULL,
    url        TEXT    NOT NULL,
    active     BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS affiliate_products_category_idx ON affiliate_products (category) WHERE active;

CREATE TABLE IF NOT EXISTS affiliate_clicks (
    id         BIGSERIAL PRIMARY KEY,
    partner    TEXT        NOT NULL,
    category   TEXT        NOT NULL DEFAULT '',
    clicked_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('hour', now())
);

-- ---------------------------------------------------------------------------
-- Peer-to-peer resale. Listings are public (anyone with the link can view);
-- buyers reach sellers through inquiries, never by seeing their contact details.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listings (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    client_item_id TEXT        NOT NULL,
    title          TEXT        NOT NULL CHECK (length(title) BETWEEN 3 AND 80),
    description    TEXT        NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
    price_inr      INTEGER     NOT NULL CHECK (price_inr BETWEEN 1 AND 1000000),
    condition      TEXT        NOT NULL CHECK (condition IN ('new', 'like-new', 'good', 'fair')),
    size_label     TEXT        NOT NULL DEFAULT '',
    category       TEXT        NOT NULL DEFAULT '',
    color_hex      CHAR(7)     NOT NULL CHECK (color_hex ~ '^#[0-9A-F]{6}$'),
    city           TEXT        NOT NULL DEFAULT '',
    image_url      TEXT        NOT NULL,
    status         TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'withdrawn')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS listings_one_active_per_item ON listings (user_id, client_item_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS listings_feed_idx ON listings (created_at DESC) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS listing_inquiries (
    id         BIGSERIAL PRIMARY KEY,
    listing_id UUID        NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
    buyer_id   UUID        NOT NULL,
    message    TEXT        NOT NULL CHECK (length(message) BETWEEN 1 AND 500),
    contact    TEXT        NOT NULL CHECK (length(contact) BETWEEN 3 AND 120),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listing_inquiries_listing_idx ON listing_inquiries (listing_id, created_at DESC);
