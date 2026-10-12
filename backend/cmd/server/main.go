// Command server runs the VirtualWardrobe API.
//
// Environment:
//
//	DATABASE_URL          postgres://user:pass@host:5432/db   (required)
//	ADDR                  listen address                       (default :8080)
//	UPLOAD_DIR            where garment PNGs are written       (default ./uploads)
//	PUBLIC_BASE_URL       base for returned image URLs         (default: request Host)
//	AUTO_MIGRATE          apply db/schema.sql at startup       (default true)
//	LLM_COST_CEILING_USD  per-request LLM cost ceiling         (default 0.01)
//	LLM_EMA_ALPHA         latency EMA smoothing factor         (default 0.3)
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/api"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/llmgateway"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/store"
)

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := connectWithRetry(ctx, log, dbURL, envBool("AUTO_MIGRATE", true))
	if err != nil {
		return err
	}
	defer st.Close()

	gw, err := llmgateway.New(llmgateway.Config{
		CostCeilingUSD: envFloat("LLM_COST_CEILING_USD", 0.01),
		Alpha:          envFloat("LLM_EMA_ALPHA", 0.3),
	}, llmgateway.DemoModels()...)
	if err != nil {
		return err
	}

	uploadDir := envOr("UPLOAD_DIR", "./uploads")
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		return err
	}

	srv := &http.Server{
		Addr: envOr("ADDR", ":8080"),
		Handler: api.New(st, gw, api.Config{
			UploadDir:     uploadDir,
			PublicBaseURL: os.Getenv("PUBLIC_BASE_URL"),
		}, log).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second, // phones on mobile data upload slowly
		WriteTimeout:      60 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", srv.Addr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

// connectWithRetry tolerates the database still starting (common under docker compose).
func connectWithRetry(ctx context.Context, log *slog.Logger, url string, migrate bool) (*store.Store, error) {
	var lastErr error
	for attempt := 1; attempt <= 15; attempt++ {
		attemptCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		st, err := store.Open(attemptCtx, url, migrate)
		cancel()
		if err == nil {
			return st, nil
		}
		lastErr = err
		log.Warn("database not ready", "attempt", attempt, "err", err)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	return nil, lastErr
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	if v, err := strconv.ParseBool(os.Getenv(key)); err == nil {
		return v
	}
	return def
}

func envFloat(key string, def float64) float64 {
	if v, err := strconv.ParseFloat(os.Getenv(key), 64); err == nil {
		return v
	}
	return def
}
