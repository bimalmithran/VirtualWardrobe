package domain

import (
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"time"
)

// EmbeddingDim must match VECTOR(512) in schema.sql and MobileCLIP-S0 on the phone.
const EmbeddingDim = 512

// Embedding is a MobileCLIP image vector.
type Embedding []float32

func (e Embedding) Validate() error {
	if len(e) != EmbeddingDim {
		return invalid("embedding", "must have %d dimensions, got %d", EmbeddingDim, len(e))
	}
	var norm float64
	for _, x := range e {
		if math.IsNaN(float64(x)) || math.IsInf(float64(x), 0) {
			return invalid("embedding", "contains NaN or Inf")
		}
		norm += float64(x) * float64(x)
	}
	if norm == 0 {
		return invalid("embedding", "is all zeros; cosine distance is undefined")
	}
	return nil
}

// ClientItemID is the phone's SQLite id for a garment. It is also used as a file name,
// so the pattern deliberately excludes path separators and dots.
type ClientItemID string

var clientIDRe = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func (id ClientItemID) Valid() bool { return clientIDRe.MatchString(string(id)) }

// ColorHex is an upper-case #RRGGBB colour.
type ColorHex string

var hexRe = regexp.MustCompile(`^#[0-9A-F]{6}$`)

func NormalizeColorHex(s string) ColorHex { return ColorHex(strings.ToUpper(strings.TrimSpace(s))) }

func (c ColorHex) Valid() bool { return hexRe.MatchString(string(c)) }

// Metadata is free-form garment data (palette, fabric, brand, ...). Must be a JSON object.
type Metadata json.RawMessage

func (m Metadata) MarshalJSON() ([]byte, error) {
	if len(m) == 0 {
		return []byte("{}"), nil
	}
	return m, nil
}

// UnmarshalJSON keeps the raw bytes (json.RawMessage semantics for a named type).
func (m *Metadata) UnmarshalJSON(b []byte) error {
	*m = append((*m)[:0], b...)
	return nil
}

// NewItem is a garment ready to be persisted: its image is already stored somewhere
// and ImageURL points at it.
type NewItem struct {
	UserID       UserID
	ClientItemID ClientItemID
	CategorySlug string // optional
	ImageURL     string // absolute http(s) URL, or a server-relative path like /uploads/...
	ColorHex     ColorHex
	Metadata     Metadata
	Embedding    Embedding
}

// Validate checks every invariant, including that the image has been stored.
func (n NewItem) Validate() error {
	if err := n.ValidateAttributes(); err != nil {
		return err
	}
	if !IsAbsoluteURL(n.ImageURL) && !isServerPath(n.ImageURL) {
		return invalid("image_url", "must be an http(s) URL")
	}
	return nil
}

// ValidateAttributes checks everything except the image location, so callers can reject
// bad input before spending I/O on storing the image.
func (n NewItem) ValidateAttributes() error {
	switch {
	case !n.UserID.Valid():
		return invalid("user_id", "must be a UUID")
	case !n.ClientItemID.Valid():
		return invalid("client_item_id", "must be 1-64 characters of [A-Za-z0-9_-]")
	case !n.ColorHex.Valid():
		return invalid("color_hex", "must look like #A1B2C3")
	case len(n.Metadata) > 0 && n.Metadata[0] != '{':
		return invalid("metadata", "must be a JSON object")
	}
	return n.Embedding.Validate()
}

func IsAbsoluteURL(s string) bool {
	return strings.HasPrefix(s, "https://") || strings.HasPrefix(s, "http://")
}

func isServerPath(s string) bool {
	return strings.HasPrefix(s, "/") && !strings.HasPrefix(s, "//")
}

type Item struct {
	ID           string       `json:"id"`
	ClientItemID ClientItemID `json:"client_item_id"`
	CategorySlug *string      `json:"category_slug"`
	ImageURL     string       `json:"image_url"`
	ColorHex     ColorHex     `json:"primary_color_hex"`
	Metadata     Metadata     `json:"metadata"`
	CreatedAt    time.Time    `json:"created_at"`
}

// Match is an Item ranked against a query embedding.
type Match struct {
	Item
	// Cosine similarity in [-1, 1]; 1 means the same direction.
	Similarity float64 `json:"similarity"`
}
