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

// Season is a 12-season colour-analysis type, e.g. "deep-winter" or "warm-autumn".
type Season string

var seasons = map[Season]bool{
	"light-spring": true, "warm-spring": true, "clear-spring": true,
	"light-summer": true, "cool-summer": true, "soft-summer": true,
	"soft-autumn": true, "warm-autumn": true, "deep-autumn": true,
	"deep-winter": true, "cool-winter": true, "clear-winter": true,
}

// Valid accepts the empty season (not chosen yet) and the twelve named ones.
func (s Season) Valid() bool { return s == "" || seasons[s] }

// Torso is the torso-to-leg balance, which decides where a hem or waistline should sit.
type Torso string

func (t Torso) Valid() bool { return t == "" || t == "short" || t == "balanced" || t == "long" }

// Proportions are optional body measurements in centimetres. Nil means not given.
type Proportions struct {
	ShoulderCm *int  `json:"shoulder_cm"`
	BustCm     *int  `json:"bust_cm"`
	WaistCm    *int  `json:"waist_cm"`
	HipCm      *int  `json:"hip_cm"`
	Torso      Torso `json:"torso"`
}

func (p Proportions) Validate() error {
	for _, m := range []struct {
		name     string
		v        *int
		min, max int
	}{
		{"shoulder_cm", p.ShoulderCm, 25, 80},
		{"bust_cm", p.BustCm, 50, 200},
		{"waist_cm", p.WaistCm, 40, 200},
		{"hip_cm", p.HipCm, 50, 200},
	} {
		if m.v != nil && (*m.v < m.min || *m.v > m.max) {
			return invalid("proportions."+m.name, "must be between %d and %d", m.min, m.max)
		}
	}
	if !p.Torso.Valid() {
		return invalid("proportions.torso", "must be short, balanced or long")
	}
	return nil
}

// Language is a BCP-47 primary tag the app supports for notices and UI.
type Language string

func (l Language) Valid() bool { return l == "" || l == "en" || l == "hi" || l == "ml" }

// Profile is the user's Digital Twin.
type Profile struct {
	UserID        UserID      `json:"user_id"`
	HeightCm      int         `json:"height_cm"`
	BodyShape     BodyShape   `json:"body_shape"`
	SkinUndertone Undertone   `json:"skin_undertone"`
	Proportions   Proportions `json:"proportions"`
	Season        Season      `json:"season"`
	Language      Language    `json:"language"`
	UpdatedAt     time.Time   `json:"updated_at"`
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
	case !p.Season.Valid():
		return invalid("season", "must be a 12-season type such as deep-winter")
	case !p.Language.Valid():
		return invalid("language", "must be en, hi or ml")
	}
	return p.Proportions.Validate()
}

// UserID is the UUID the phone generates once per install.
type UserID string

var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// NormalizeUserID lower-cases an id so that equal UUIDs compare equal.
func NormalizeUserID(s string) UserID { return UserID(strings.ToLower(strings.TrimSpace(s))) }

func (id UserID) Valid() bool { return uuidRe.MatchString(string(id)) }
