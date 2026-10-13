package domain

import (
	"math"
	"testing"
)

const uid = UserID("6f1c2a9e-3b4d-4c5e-8f70-112233445566")

func vec(n int) Embedding {
	v := make(Embedding, n)
	for i := range v {
		v[i] = float32(i%7) + 0.5
	}
	return v
}

func TestProfileValidate(t *testing.T) {
	ok := Profile{UserID: uid, HeightCm: 175, BodyShape: Rectangle, SkinUndertone: Warm}
	if err := ok.Validate(); err != nil {
		t.Fatal(err)
	}
	for name, p := range map[string]Profile{
		"bad uuid":      {UserID: "nope", HeightCm: 175, BodyShape: Rectangle, SkinUndertone: Warm},
		"upper uuid":    {UserID: "6F1C2A9E-3B4D-4C5E-8F70-112233445566", HeightCm: 175, BodyShape: Rectangle, SkinUndertone: Warm},
		"too short":     {UserID: uid, HeightCm: 40, BodyShape: Rectangle, SkinUndertone: Warm},
		"bad shape":     {UserID: uid, HeightCm: 175, BodyShape: "square", SkinUndertone: Warm},
		"bad undertone": {UserID: uid, HeightCm: 175, BodyShape: Rectangle, SkinUndertone: "olive"},
	} {
		if err := p.Validate(); !IsValidation(err) {
			t.Errorf("%s: err = %v, want ValidationError", name, err)
		}
	}
	if NormalizeUserID(" 6F1C2A9E-3B4D-4C5E-8F70-112233445566 ") != uid {
		t.Error("NormalizeUserID should lower-case and trim")
	}
}

func TestEmbeddingValidate(t *testing.T) {
	nan := vec(512)
	nan[3] = float32(math.NaN())
	for name, e := range map[string]Embedding{"wrong dims": vec(511), "zeros": make(Embedding, 512), "nan": nan} {
		if err := e.Validate(); !IsValidation(err) {
			t.Errorf("%s: err = %v, want ValidationError", name, err)
		}
	}
	if err := vec(512).Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestNewItemValidate(t *testing.T) {
	base := func() NewItem {
		return NewItem{UserID: uid, ClientItemID: "m1abc-x9", ImageURL: "/uploads/a.png", ColorHex: "#A1B2C3", Embedding: vec(512)}
	}
	if err := base().Validate(); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(*NewItem){
		"traversal id":   func(n *NewItem) { n.ClientItemID = "../../etc" },
		"lower hex":      func(n *NewItem) { n.ColorHex = "#a1b2c3" },
		"array metadata": func(n *NewItem) { n.Metadata = Metadata("[1]") },
		"protocol-rel":   func(n *NewItem) { n.ImageURL = "//evil.example/a.png" },
		"ftp url":        func(n *NewItem) { n.ImageURL = "ftp://x/a.png" },
	}
	for name, mutate := range cases {
		n := base()
		mutate(&n)
		if err := n.Validate(); !IsValidation(err) {
			t.Errorf("%s: err = %v, want ValidationError", name, err)
		}
	}
	n := base()
	n.ImageURL = ""
	if err := n.ValidateAttributes(); err != nil {
		t.Fatalf("ValidateAttributes should ignore the image: %v", err)
	}
}

func TestProfileV2Validation(t *testing.T) {
	ok := Profile{UserID: "11111111-1111-4111-8111-111111111111", HeightCm: 170, BodyShape: Hourglass, SkinUndertone: Warm}
	if err := ok.Validate(); err != nil {
		t.Fatalf("v1 profile rejected: %v", err)
	}
	waist, tiny := 70, 10
	good := ok
	good.Season, good.Language, good.Proportions = "deep-winter", "ml", Proportions{WaistCm: &waist, Torso: "long"}
	if err := good.Validate(); err != nil {
		t.Fatalf("v2 profile rejected: %v", err)
	}
	for name, p := range map[string]Profile{
		"season":   func() Profile { p := ok; p.Season = "winter"; return p }(),
		"language": func() Profile { p := ok; p.Language = "fr"; return p }(),
		"torso":    func() Profile { p := ok; p.Proportions.Torso = "tall"; return p }(),
		"waist":    func() Profile { p := ok; p.Proportions.WaistCm = &tiny; return p }(),
	} {
		if err := p.Validate(); !IsValidation(err) {
			t.Errorf("%s: want validation error, got %v", name, err)
		}
	}
}

func TestConsentValidation(t *testing.T) {
	c := Consent{UserID: "11111111-1111-4111-8111-111111111111", NoticeVersion: "2026-10", Language: "hi",
		Purposes: map[Purpose]bool{PurposeCore: true, PurposeAnalytics: false}}
	if err := c.Validate(); err != nil {
		t.Fatal(err)
	}
	if !c.Allows(PurposeCore) || c.Allows(PurposeAnalytics) || c.Allows(PurposeAIStylist) {
		t.Fatal("Allows mismatch")
	}
	c.Purposes["marketing"] = true
	if err := c.Validate(); !IsValidation(err) {
		t.Fatalf("unknown purpose accepted: %v", err)
	}
}
