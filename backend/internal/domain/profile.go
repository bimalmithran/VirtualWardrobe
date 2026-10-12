package domain

import (
	"regexp"
	"strings"
	"time"
)

type BodyShape string

const (
	Rectangle        BodyShape = "rectangle"
	Triangle         BodyShape = "triangle"
	InvertedTriangle BodyShape = "inverted-triangle"
	Hourglass        BodyShape = "hourglass"
	Oval             BodyShape = "oval"
)

func (b BodyShape) Valid() bool {
	switch b {
	case Rectangle, Triangle, InvertedTriangle, Hourglass, Oval:
		return true
	}
	return false
}

type Undertone string

const (
	Warm    Undertone = "warm"
	Cool    Undertone = "cool"
	Neutral Undertone = "neutral"
)

func (u Undertone) Valid() bool {
	return u == Warm || u == Cool || u == Neutral
}

const (
	MinHeightCm = 100
	MaxHeightCm = 250
)

// Profile is the user's Digital Twin.
type Profile struct {
	UserID        UserID    `json:"user_id"`
	HeightCm      int       `json:"height_cm"`
	BodyShape     BodyShape `json:"body_shape"`
	SkinUndertone Undertone `json:"skin_undertone"`
	UpdatedAt     time.Time `json:"updated_at"`
}

func (p Profile) Validate() error {
	switch {
	case !p.UserID.Valid():
		return invalid("user_id", "must be a UUID")
	case p.HeightCm < MinHeightCm || p.HeightCm > MaxHeightCm:
		return invalid("height_cm", "must be between %d and %d", MinHeightCm, MaxHeightCm)
	case !p.BodyShape.Valid():
		return invalid("body_shape", "must be one of rectangle, triangle, inverted-triangle, hourglass, oval")
	case !p.SkinUndertone.Valid():
		return invalid("skin_undertone", "must be warm, cool or neutral")
	}
	return nil
}

// UserID is the UUID the phone generates once per install.
type UserID string

var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// NormalizeUserID lower-cases an id so that equal UUIDs compare equal.
func NormalizeUserID(s string) UserID { return UserID(strings.ToLower(strings.TrimSpace(s))) }

func (id UserID) Valid() bool { return uuidRe.MatchString(string(id)) }
