package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/stylist"
)

type StylistService interface {
	Begin(ctx context.Context, userID string, req *stylist.Request) error
	Stream(ctx context.Context, req stylist.Request, emit func(stylist.Event) error) error
}

type stylistHandler struct {
	stylist StylistService
	errs    errorWriter
	log     *slog.Logger
}

const (
	sseWriteTimeout = 30 * time.Second
	sseHeartbeat    = 15 * time.Second
	chatTimeout     = 3 * time.Minute
)

type chatRequest struct {
	UserID string `json:"user_id"`
	stylist.Request
}

// chat: POST /api/stylist/chat -> text/event-stream of `delta`, `outfit`, `done` or `error`
// events, each with a JSON data line.
func (h *stylistHandler) chat(w http.ResponseWriter, r *http.Request) {
	var req chatRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	user, err := actingUser(r, req.UserID)
	if err == nil {
		err = h.stylist.Begin(r.Context(), user, &req.Request)
	}
	if err != nil {
		h.errs.write(w, err)
		return
	}

	sse, err := newSSE(w)
	if err != nil {
		h.errs.write(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), chatTimeout)
	defer cancel()
	stop := sse.heartbeat(ctx)
	defer stop()

	err = h.stylist.Stream(ctx, req.Request, func(e stylist.Event) error { return sse.send(stylist.Name(e), e) })
	if err != nil && ctx.Err() == nil {
		code, msg := "stylist_failed", "The stylist is unavailable right now. Please try again."
		if errors.Is(err, stylist.ErrRefused) {
			code, msg = "refused", "I can only help with clothes and styling. Try asking about an outfit."
		}
		h.log.Warn("stylist stream failed", "err", err)
		sse.send("error", map[string]string{"code": code, "error": msg}) //nolint:errcheck // client may be gone
	}
}

// sseWriter serialises writes from the stream and the heartbeat.
type sseWriter struct {
	mu sync.Mutex
	w  http.ResponseWriter
	rc *http.ResponseController
}

func newSSE(w http.ResponseWriter) (*sseWriter, error) {
	rc := http.NewResponseController(w)
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no") // disable proxy buffering (nginx)
	w.WriteHeader(http.StatusOK)
	s := &sseWriter{w: w, rc: rc}
	if err := s.flush(); err != nil {
		return nil, fmt.Errorf("streaming unsupported: %w", err)
	}
	return s, nil
}

func (s *sseWriter) send(event string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// The server's WriteTimeout is shorter than a chat; extend the deadline per event.
	s.rc.SetWriteDeadline(time.Now().Add(sseWriteTimeout)) //nolint:errcheck // unsupported writers just keep the server default
	if _, err := fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", event, data); err != nil {
		return err
	}
	return s.flush()
}

func (s *sseWriter) flush() error {
	return s.rc.Flush()
}

// heartbeat keeps idle proxies and mobile networks from closing a quiet stream.
func (s *sseWriter) heartbeat(ctx context.Context) (stop func()) {
	ctx, cancel := context.WithCancel(ctx)
	go func() {
		t := time.NewTicker(sseHeartbeat)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.mu.Lock()
				s.rc.SetWriteDeadline(time.Now().Add(sseWriteTimeout)) //nolint:errcheck
				_, err := fmt.Fprint(s.w, ": ping\n\n")
				if err == nil {
					err = s.flush()
				}
				s.mu.Unlock()
				if err != nil {
					return
				}
			}
		}
	}()
	return cancel
}
