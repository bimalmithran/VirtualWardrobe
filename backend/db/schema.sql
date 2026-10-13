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
