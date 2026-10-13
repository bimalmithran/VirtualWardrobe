package wardrobe

import (
	"context"
	"errors"
	"testing"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
)

type fakeAccounts struct {
	consents []domain.Consent
	deleted  domain.UserID
	failDel  bool
}

func (f *fakeAccounts) GetProfile(context.Context, domain.UserID) (domain.Profile, error) {
	return domain.Profile{}, domain.ErrUserNotFound
}
func (f *fakeAccounts) RecordConsent(_ context.Context, c domain.Consent) (domain.Consent, error) {
	f.consents = append(f.consents, c)
	return c, nil
}
func (f *fakeAccounts) ConsentHistory(context.Context, domain.UserID) ([]domain.Consent, error) {
	return f.consents, nil
}
func (f *fakeAccounts) LatestConsent(context.Context, domain.UserID) (domain.Consent, error) {
	if len(f.consents) == 0 {
		return domain.Consent{}, nil
	}
	return f.consents[len(f.consents)-1], nil
}
func (f *fakeAccounts) DeleteUser(_ context.Context, u domain.UserID) error {
	if f.failDel {
		return errors.New("db down")
	}
	f.deleted = u
	return nil
}

type fakeLister struct{}

func (fakeLister) ListItems(context.Context, domain.UserID) ([]domain.Item, error) { return nil, nil }

type fakeOutfitRepo struct{ OutfitRepository }

func (fakeOutfitRepo) ListOutfits(context.Context, domain.UserID) ([]domain.Outfit, error) {
	return nil, nil
}

type fakePurger struct{ purged domain.UserID }

func (f *fakePurger) RemoveAll(_ context.Context, u domain.UserID) error { f.purged = u; return nil }

const privUID = "11111111-1111-4111-8111-111111111111"

func TestConsentLatestWins(t *testing.T) {
	acc := &fakeAccounts{}
	p := NewPrivacy(acc, fakeLister{}, fakeOutfitRepo{}, &fakePurger{})
	ctx := context.Background()
	if _, err := p.RecordConsent(ctx, domain.Consent{UserID: "11111111-1111-4111-8111-111111111111", NoticeVersion: "v1",
		Purposes: map[domain.Purpose]bool{domain.PurposeCore: true, domain.PurposeAIStylist: true}}); err != nil {
		t.Fatal(err)
	}
	if ok, _ := p.Allows(ctx, privUID, domain.PurposeAIStylist); !ok {
		t.Fatal("granted purpose not allowed")
	}
	p.RecordConsent(ctx, domain.Consent{UserID: privUID, NoticeVersion: "v1", Purposes: map[domain.Purpose]bool{domain.PurposeCore: true}}) //nolint:errcheck
	if ok, _ := p.Allows(ctx, privUID, domain.PurposeAIStylist); ok {
		t.Fatal("withdrawn purpose still allowed")
	}
	if acc.consents[0].Language != "en" {
		t.Fatalf("language not defaulted: %q", acc.consents[0].Language)
	}
}

func TestExportAndErase(t *testing.T) {
	acc := &fakeAccounts{}
	purger := &fakePurger{}
	p := NewPrivacy(acc, fakeLister{}, fakeOutfitRepo{}, purger)
	out, err := p.Export(context.Background(), domain.UserID(privUID))
	if err != nil {
		t.Fatal(err)
	}
	if out.Profile != nil || out.Items == nil || out.Outfits == nil || out.Consents == nil {
		t.Fatalf("export should have empty lists and no profile: %+v", out)
	}
	if err := p.Erase(context.Background(), "11111111-1111-4111-8111-111111111111"); err != nil {
		t.Fatal(err)
	}
	if acc.deleted != privUID || purger.purged != privUID {
		t.Fatal("erase did not reach rows and images")
	}
	acc.failDel, purger.purged = true, ""
	if err := p.Erase(context.Background(), privUID); err == nil || purger.purged != "" {
		t.Fatal("images must survive a failed row delete")
	}
}
