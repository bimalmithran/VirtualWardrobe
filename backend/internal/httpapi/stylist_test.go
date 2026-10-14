package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/domain"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/stylist"
)

type stylistStub struct {
	beginErr  error
	streamErr error
}

func (s stylistStub) Begin(context.Context, string, *stylist.Request) error { return s.beginErr }
func (s stylistStub) Stream(_ context.Context, _ stylist.Request, emit func(stylist.Event) error) error {
	emit(stylist.OutfitCard{Title: "Rainy dinner", ItemIDs: []string{"a", "b"}, Reason: "dark and dry"}) //nolint:errcheck
	emit(stylist.TextDelta{Text: "Wear "})                                                               //nolint:errcheck
	if s.streamErr != nil {
		return s.streamErr
	}
	return emit(stylist.Done{Provider: "test"})
}

func chatRouter(s StylistService) *httptest.Server {
	return httptest.NewServer(NewRouter(Deps{Stylist: s, Log: slog.New(slog.NewTextHandler(io.Discard, nil))}))
}

func TestStylistStreamsSSE(t *testing.T) {
	srv := chatRouter(stylistStub{})
	defer srv.Close()
	resp, err := srv.Client().Post(srv.URL+"/api/stylist/chat", "application/json", strings.NewReader(`{"messages":[{"role":"user","text":"hi"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type %q", ct)
	}
	body, _ := io.ReadAll(resp.Body)
	want := "event: outfit\ndata: {\"title\":\"Rainy dinner\",\"item_ids\":[\"a\",\"b\"],\"reason\":\"dark and dry\"}\n\n" +
		"event: delta\ndata: {\"text\":\"Wear \"}\n\n" +
		"event: done\ndata: {\"provider\":\"test\"}\n\n"
	if string(body) != want {
		t.Fatalf("body:\n%s", body)
	}
}

func TestStylistErrorsBeforeAndDuringStream(t *testing.T) {
	srv := chatRouter(stylistStub{beginErr: domain.ErrConsentRequired})
	resp, _ := srv.Client().Post(srv.URL+"/api/stylist/chat", "application/json", strings.NewReader(`{"messages":[]}`))
	body, _ := io.ReadAll(resp.Body)
	srv.Close()
	if resp.StatusCode != 403 || !strings.Contains(string(body), "consent_required") {
		t.Fatalf("consent: %d %s", resp.StatusCode, body)
	}

	srv = chatRouter(stylistStub{streamErr: stylist.ErrRefused})
	defer srv.Close()
	resp, _ = srv.Client().Post(srv.URL+"/api/stylist/chat", "application/json", strings.NewReader(`{"messages":[]}`))
	body, _ = io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "event: error\ndata: {\"code\":\"refused\"") {
		t.Fatalf("mid-stream error not sent as an event: %s", body)
	}
}
