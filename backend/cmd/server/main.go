// Command server runs the VirtualWardrobe API. This file is the composition root: the
// only place that knows which concrete adapters implement which interfaces.
// Settings are documented in internal/config.
package main

import (
	"context"
	"crypto/rand"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/bimalmithran/virtualwardrobe/backend/internal/affiliate"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/billing"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/config"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/httpapi"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/imagestore"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/llmgateway"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/postgres"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/stylist"
	"github.com/bimalmithran/virtualwardrobe/backend/internal/vision"
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

	privacy := wardrobe.NewPrivacy(users, items, outfitRepo, images)
	cloudVision := wardrobe.NewCloudVision(privacy)
	if cfg.VisionEnabled && vision.Available {
		go loadVision(ctx, log, cfg, cloudVision)
	} else {
		log.Info("cloud vision disabled", "built_with_onnx", vision.Available, "VISION_ENABLED", cfg.VisionEnabled)
	}

	var streamer stylist.Streamer = stylist.Local{WordDelay: 25 * time.Millisecond}
	if cfg.AnthropicAPIKey != "" {
		streamer = stylist.NewClaude(cfg.AnthropicAPIKey, cfg.StylistModel)
		log.Info("stylist uses Claude", "model", cfg.StylistModel)
	} else {
		log.Info("stylist uses the built-in basic stylist; set ANTHROPIC_API_KEY for the AI stylist")
	}

	billingStore := postgres.NewBilling(pool)
	affiliateRepo := postgres.NewAffiliate(pool)
	secret := []byte(cfg.AffiliateSecret)
	if len(secret) == 0 {
		secret = make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			return err
		}
		log.Warn("AFFILIATE_SECRET not set: shopping links stop working after a restart")
	}
	if cfg.RevenueCatWebhookAuth == "" {
		log.Warn("REVENUECAT_WEBHOOK_AUTH not set: premium purchases can't be recorded")
	}
	var partners []string
	if cfg.AffiliatePartners != "" {
		partners = strings.Split(cfg.AffiliatePartners, ",")
	}

	srv := &http.Server{
		Addr: cfg.Addr,
		Handler: httpapi.NewRouter(httpapi.Deps{
			Health:       pool,
			Profiles:     wardrobe.NewProfiles(users),
			Privacy:      privacy,
			Vision:       cloudVision,
			Stylist:      wardrobe.NewStylist(streamer, privacy, billingStore),
			Entitlements: billingStore,
			RevenueCat:   billing.NewRevenueCat(billingStore, cfg.RevenueCatWebhookAuth),
			Affiliate: affiliate.New(affiliate.Config{
				Secret: secret, AmazonTag: cfg.AmazonAssociateTag, Wrapper: cfg.AffiliateWrapper, Partners: partners,
			}, affiliateRepo),
			Clicks:        affiliateRepo,
			Resale:        wardrobe.NewResale(postgres.NewListings(pool), images),
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

// loadVision downloads (first boot only) and loads the models without delaying startup;
// /api/vision answers 503 until it finishes.
func loadVision(ctx context.Context, log *slog.Logger, cfg config.Config, cv *wardrobe.CloudVision) {
	seg := vision.RMBG14
	if cfg.VisionSegmentation == "isnet" {
		seg = vision.ISNet
	} else {
		log.Warn("cloud vision uses RMBG-1.4, which is licensed for non-commercial use only; set VISION_SEGMENTATION=isnet for commercial deployments")
	}
	segPath, err := vision.Ensure(ctx, cfg.VisionModelsDir, seg)
	if err == nil {
		var embPath string
		if embPath, err = vision.Ensure(ctx, cfg.VisionModelsDir, vision.MobileCLIPS0); err == nil {
			var m *vision.ONNX
			if m, err = vision.NewONNX(cfg.ORTLibPath, segPath, embPath); err == nil {
				cv.SetModels(m)
				log.Info("cloud vision ready", "segmentation", seg.Name)
				return
			}
		}
	}
	log.Error("cloud vision unavailable", "err", err)
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
