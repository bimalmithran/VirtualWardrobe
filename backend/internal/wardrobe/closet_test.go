package wardrobe

import (
	"context"
	"encoding/base64"
	"testing"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

type fakeItems struct {
	saved []domain.NewItem
	query SearchQuery
}

func (f *fakeItems) UpsertItem(_ context.Context, in domain.NewItem) (domain.Item, bool, error) {
	f.saved = append(f.saved, in)
	return domain.Item{ID: "id", ClientItemID: in.ClientItemID, ImageURL: in.ImageURL, ColorHex: in.ColorHex}, true, nil
}

func (f *fakeItems) SearchSimilar(_ context.Context, q SearchQuery) ([]domain.Match, error) {
	f.query = q
	return nil, nil
}

type fakeImages struct{ saved int }

func (f *fakeImages) SavePNG(_ context.Context, u domain.UserID, i domain.ClientItemID, _ []byte) (string, error) {
	f.saved++
	return "/uploads/" + string(u) + "/" + string(i) + ".png", nil
}

type fakeUsers struct{ got domain.Profile }

func (f *fakeUsers) UpsertProfile(_ context.Context, p domain.Profile) (domain.Profile, error) {
	f.got = p
	return p, nil
}

const uid = "6F1C2A9E-3B4D-4C5E-8F70-112233445566"

func vec() domain.Embedding {
	v := make(domain.Embedding, domain.EmbeddingDim)
	for i := range v {
		v[i] = float32(i%5) + 1
	}
	return v
}

var pngB64 = base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nxyz"))

func TestAddItemStoresImageAndNormalises(t *testing.T) {
	items, images := &fakeItems{}, &fakeImages{}
	svc := NewCloset(items, images)
	_, created, err := svc.AddItem(context.Background(), AddItemInput{
		UserID: uid, ClientItemID: "abc", ImageBase64: "data:image/png;base64," + pngB64, ColorHex: "#a1b2c3", Embedding: vec(),
	})
	if err != nil || !created {
		t.Fatalf("created=%v err=%v", created, err)
	}
	got := items.saved[0]
	if got.UserID != "6f1c2a9e-3b4d-4c5e-8f70-112233445566" || got.ColorHex != "#A1B2C3" {
		t.Fatalf("not normalised: %+v", got)
	}
	if got.ImageURL != "/uploads/6f1c2a9e-3b4d-4c5e-8f70-112233445566/abc.png" {
		t.Fatalf("image url = %s", got.ImageURL)
	}
}

func TestAddItemRejectsBeforeStoringImage(t *testing.T) {
	cases := map[string]AddItemInput{
		"bad hex":       {UserID: uid, ClientItemID: "a", ImageBase64: pngB64, ColorHex: "red", Embedding: vec()},
		"wrong dims":    {UserID: uid, ClientItemID: "a", ImageBase64: pngB64, ColorHex: "#112233", Embedding: vec()[:10]},
		"both images":   {UserID: uid, ClientItemID: "a", ImageBase64: pngB64, ImageURL: "https://x/a.png", ColorHex: "#112233", Embedding: vec()},
		"no image":      {UserID: uid, ClientItemID: "a", ColorHex: "#112233", Embedding: vec()},
		"relative url":  {UserID: uid, ClientItemID: "a", ImageURL: "/uploads/other-user/a.png", ColorHex: "#112233", Embedding: vec()},
		"not png":       {UserID: uid, ClientItemID: "a", ImageBase64: base64.StdEncoding.EncodeToString([]byte("GIF89a")), ColorHex: "#112233", Embedding: vec()},
		"invalid b64":   {UserID: uid, ClientItemID: "a", ImageBase64: "%%%", ColorHex: "#112233", Embedding: vec()},
		"traversal key": {UserID: uid, ClientItemID: "../x", ImageBase64: pngB64, ColorHex: "#112233", Embedding: vec()},
	}
	for name, in := range cases {
		images := &fakeImages{}
		_, _, err := NewCloset(&fakeItems{}, images).AddItem(context.Background(), in)
		if !domain.IsValidation(err) {
			t.Errorf("%s: err = %v, want ValidationError", name, err)
		}
		if images.saved != 0 {
			t.Errorf("%s: image stored despite invalid input", name)
		}
	}
}

func TestSearchDefaultsAndClamps(t *testing.T) {
	items := &fakeItems{}
	svc := NewCloset(items, &fakeImages{})
	if _, err := svc.SearchSimilar(context.Background(), SearchQuery{Embedding: vec()}); err != nil {
		t.Fatal(err)
	}
	if items.query.Limit != DefaultSearchLimit || items.query.UserID != "" {
		t.Fatalf("query = %+v", items.query)
	}
	if _, err := svc.SearchSimilar(context.Background(), SearchQuery{Embedding: vec(), Limit: 1000, UserID: uid}); err != nil {
		t.Fatal(err)
	}
	if items.query.Limit != MaxSearchLimit || items.query.UserID != "6f1c2a9e-3b4d-4c5e-8f70-112233445566" {
		t.Fatalf("query = %+v", items.query)
	}
	if _, err := svc.SearchSimilar(context.Background(), SearchQuery{Embedding: vec(), UserID: "nope"}); !domain.IsValidation(err) {
		t.Fatalf("err = %v, want ValidationError", err)
	}
}

func TestSaveProfileNormalisesAndValidates(t *testing.T) {
	users := &fakeUsers{}
	svc := NewProfiles(users)
	if _, err := svc.SaveProfile(context.Background(), domain.Profile{UserID: uid, HeightCm: 170, BodyShape: domain.Oval, SkinUndertone: domain.Cool}); err != nil {
		t.Fatal(err)
	}
	if users.got.UserID != "6f1c2a9e-3b4d-4c5e-8f70-112233445566" {
		t.Fatalf("user id not normalised: %s", users.got.UserID)
	}
	if _, err := svc.SaveProfile(context.Background(), domain.Profile{UserID: uid, HeightCm: 20}); !domain.IsValidation(err) {
		t.Fatalf("err = %v, want ValidationError", err)
	}
}
