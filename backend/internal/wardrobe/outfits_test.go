package wardrobe

import (
	"context"
	"testing"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

type fakeOutfits struct{ saved []domain.NewOutfit }

func (f *fakeOutfits) UpsertOutfit(_ context.Context, in domain.NewOutfit) (domain.Outfit, bool, error) {
	f.saved = append(f.saved, in)
	return domain.Outfit{ClientOutfitID: in.ClientOutfitID, Name: in.Name, ItemIDs: in.ItemIDs}, true, nil
}
func (f *fakeOutfits) ListOutfits(context.Context, domain.UserID) ([]domain.Outfit, error) {
	return nil, nil
}
func (f *fakeOutfits) DeleteOutfit(context.Context, domain.UserID, domain.ClientOutfitID) error {
	return nil
}

func TestSaveOutfitNormalisesAndValidates(t *testing.T) {
	repo := &fakeOutfits{}
	svc := NewOutfits(repo)
	_, _, err := svc.SaveOutfit(context.Background(), SaveOutfitInput{
		UserID: uid, ClientOutfitID: "o1", Name: "  Friday  ", ItemIDs: []string{"a", "b"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := repo.saved[0]; got.Name != "Friday" || got.UserID != "6f1c2a9e-3b4d-4c5e-8f70-112233445566" || len(got.ItemIDs) != 2 {
		t.Fatalf("not normalised: %+v", got)
	}

	bad := map[string]SaveOutfitInput{
		"no items":   {UserID: uid, ClientOutfitID: "o", Name: "x"},
		"duplicate":  {UserID: uid, ClientOutfitID: "o", Name: "x", ItemIDs: []string{"a", "a"}},
		"blank name": {UserID: uid, ClientOutfitID: "o", Name: "  ", ItemIDs: []string{"a"}},
		"bad id":     {UserID: uid, ClientOutfitID: "../o", Name: "x", ItemIDs: []string{"a"}},
		"bad item":   {UserID: uid, ClientOutfitID: "o", Name: "x", ItemIDs: []string{"a/b"}},
		"bad user":   {UserID: "me", ClientOutfitID: "o", Name: "x", ItemIDs: []string{"a"}},
		"metadata":   {UserID: uid, ClientOutfitID: "o", Name: "x", ItemIDs: []string{"a"}, Metadata: domain.Metadata(`[1]`)},
	}
	for name, in := range bad {
		if _, _, err := svc.SaveOutfit(context.Background(), in); !domain.IsValidation(err) {
			t.Errorf("%s: err = %v, want ValidationError", name, err)
		}
	}
	if len(repo.saved) != 1 {
		t.Fatalf("invalid outfits reached the repository: %d", len(repo.saved))
	}
}
