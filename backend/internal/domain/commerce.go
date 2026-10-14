package domain

import (
	"strings"
	"time"
)

// PremiumEntitlement is the RevenueCat entitlement identifier the app sells.
const PremiumEntitlement = "premium"

// Entitlements is what a user's plan allows today.
type Entitlements struct {
	Premium   bool                 `json:"premium"`
	ExpiresAt *time.Time           `json:"expires_at,omitempty"`
	Usage     map[string]UsageInfo `json:"usage"`
}

// UsageInfo is today's use of a metered feature. Limit 0 means unlimited.
type UsageInfo struct {
	Used  int `json:"used"`
	Limit int `json:"limit"`
}

// FreeLimits are the free plan's daily allowances for features that cost us per use.
var FreeLimits = map[string]int{
	"stylist_chat": 10,
	"cloud_vision": 30,
}

// ListingCondition grades a second-hand garment.
type ListingCondition string

func (c ListingCondition) Valid() bool {
	switch c {
	case "new", "like-new", "good", "fair":
		return true
	}
	return false
}

// ListingStatus is where a listing is in its life.
type ListingStatus string

const (
	ListingActive    ListingStatus = "active"
	ListingSold      ListingStatus = "sold"
	ListingWithdrawn ListingStatus = "withdrawn"
)

func (s ListingStatus) Valid() bool {
	return s == ListingActive || s == ListingSold || s == ListingWithdrawn
}

// NewListing is a garment the user puts up for sale, built from the closet's own data.
type NewListing struct {
	UserID       UserID
	ClientItemID ClientItemID
	Title        string
	Description  string
	PriceINR     int
	Condition    ListingCondition
	Size         string
	Category     string
	ColorHex     ColorHex
	City         string
	ImageURL     string // set once the image is stored
}

func (l *NewListing) Normalize() {
	l.Title = strings.TrimSpace(l.Title)
	l.Description = strings.TrimSpace(l.Description)
	l.Size = strings.TrimSpace(l.Size)
	l.City = strings.TrimSpace(l.City)
	l.ColorHex = NormalizeColorHex(string(l.ColorHex))
}

func (l NewListing) Validate() error {
	switch {
	case !l.UserID.Valid():
		return invalid("user_id", "must be a UUID")
	case !l.ClientItemID.Valid():
		return invalid("client_item_id", "must be 1-64 characters of [A-Za-z0-9_-]")
	case len([]rune(l.Title)) < 3 || len([]rune(l.Title)) > 80:
		return invalid("title", "must be 3-80 characters")
	case len([]rune(l.Description)) > 1000:
		return invalid("description", "must be at most 1000 characters")
	case l.PriceINR < 1 || l.PriceINR > 1_000_000:
		return invalid("price_inr", "must be between 1 and 1000000")
	case !l.Condition.Valid():
		return invalid("condition", "must be new, like-new, good or fair")
	case len(l.Size) > 20 || len(l.City) > 60:
		return invalid("size/city", "is too long")
	case !l.ColorHex.Valid():
		return invalid("color_hex", "must look like #A1B2C3")
	}
	return nil
}

// Listing is a published resale listing. Seller identity is never exposed to buyers.
type Listing struct {
	ID           string           `json:"id"`
	ClientItemID string           `json:"client_item_id,omitempty"`
	Title        string           `json:"title"`
	Description  string           `json:"description"`
	PriceINR     int              `json:"price_inr"`
	Condition    ListingCondition `json:"condition"`
	Size         string           `json:"size"`
	Category     string           `json:"category"`
	ColorHex     string           `json:"color_hex"`
	City         string           `json:"city"`
	ImageURL     string           `json:"image_url"`
	Status       ListingStatus    `json:"status"`
	Mine         bool             `json:"mine"`
	Inquiries    int              `json:"inquiries,omitempty"`
	CreatedAt    time.Time        `json:"created_at"`
}

// Inquiry is a buyer's message to a seller, relayed by the app.
type Inquiry struct {
	ID        int64     `json:"id"`
	Message   string    `json:"message"`
	Contact   string    `json:"contact"`
	CreatedAt time.Time `json:"created_at"`
}

func ValidateInquiry(message, contact string) error {
	m, c := len([]rune(strings.TrimSpace(message))), len([]rune(strings.TrimSpace(contact)))
	switch {
	case m < 1 || m > 500:
		return invalid("message", "must be 1-500 characters")
	case c < 3 || c > 120:
		return invalid("contact", "must be 3-120 characters (a phone number or email)")
	}
	return nil
}
