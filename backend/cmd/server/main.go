// Command server runs the VirtualWardrobe API. This file is the composition root: the
// only place that knows which concrete adapters implement which interfaces.
// Settings are documented in internal/config.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/config"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/httpapi"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/imagestore"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/llmgateway"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/postgres"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/wardrobe"
)

const imagesPrefix = "/uploads"

func main() {
	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := connectWithRetry(ctx, log, cfg)
	if err != nil {
		return err
	}
	defer pool.Close()

	images, err := imagestore.NewLocalFS(cfg.UploadDir, imagesPrefix)
	if err != nil {
		return err
	}
	items := postgres.NewItems(pool)
	closet := wardrobe.NewCloset(items, images)
	users := postgres.NewUsers(pool)
	outfitRepo := postgres.NewOutfits(pool)
	var devices httpapi.DeviceRegistry
	if cfg.AuthRequired {
		devices = postgres.NewDevices(pool)
	} else {
		log.Warn("AUTH_REQUIRED=false: any client can act as any user id")
	}

	gateway, err := llmgateway.New(llmgateway.DemoModels(), llmgateway.Options{
		Policy: llmgateway.CheapestFastestUnderCeiling{CeilingUSD: cfg.LLMCeilingUSD},
		Health: llmgateway.NewEMATracker(llmgateway.EMAConfig{Alpha: cfg.LLMEMAAlpha}),
	})
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr: cfg.Addr,
		Handler: httpapi.NewRouter(httpapi.Deps{
			Health:        pool,
			Profiles:      wardrobe.NewProfiles(users),
			Privacy:       wardrobe.NewPrivacy(users, items, outfitRepo, images),
			Devices:       devices,
			Items:         closet,
			Deleter:       closet,
			Search:        closet,
			Outfits:       wardrobe.NewOutfits(outfitRepo),
			LLM:           gateway,
			LLMStats:      gateway,
			Images:        images.Handler(),
			ImagesPrefix:  imagesPrefix,
			PublicBaseURL: cfg.PublicBaseURL,
			Log:           log,
		}),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second, // phones on mobile data upload slowly
		WriteTimeout:      60 * time.Second,
	}
	return serve(ctx, log, srv)
}

func serve(ctx context.Context, log *slog.Logger, srv *http.Server) error {
	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", srv.Addr)
		errCh <- srv.ListenAndServe()
	}()
	select {
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

// connectWithRetry tolerates the database still starting (common under docker compose).
func connectWithRetry(ctx context.Context, log *slog.Logger, cfg config.Config) (*pgxpool.Pool, error) {
	var lastErr error
	for attempt := 1; attempt <= 15; attempt++ {
		attemptCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		pool, err := postgres.Open(attemptCtx, cfg.DatabaseURL, cfg.AutoMigrate)
		cancel()
		if err == nil {
			return pool, nil
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
