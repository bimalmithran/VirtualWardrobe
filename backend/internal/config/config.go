// Package config reads server settings from the environment.
package config

import (
	"errors"
	"os"
	"strconv"
)

type Config struct {
	DatabaseURL   string  // DATABASE_URL (required)
	Addr          string  // ADDR, default :8080
	UploadDir     string  // UPLOAD_DIR, default ./uploads
	PublicBaseURL string  // PUBLIC_BASE_URL, default: derive from request Host
	AutoMigrate   bool    // AUTO_MIGRATE, default true
	LLMCeilingUSD float64 // LLM_COST_CEILING_USD, default 0.01
	LLMEMAAlpha   float64 // LLM_EMA_ALPHA, default 0.3
	// AuthRequired turns on per-install device tokens for /api. Only switch it off for
	// local experiments: without it any client can act as any user id.
	AuthRequired bool // AUTH_REQUIRED, default true
	// Cloud vision for low-end phones. Needs a binary built with -tags onnx (the Docker
	// image is) and the ONNX Runtime shared library.
	VisionEnabled   bool   // VISION_ENABLED, default true
	VisionModelsDir string // VISION_MODELS_DIR, default ./models
	ORTLibPath      string // ORT_LIB_PATH, default /usr/local/lib/libonnxruntime.so
	// VisionSegmentation picks the cutout model: "rmbg-1.4" (non-commercial licence, matches
	// the app's default) or "isnet" (Apache-2.0).
	VisionSegmentation string // VISION_SEGMENTATION, default rmbg-1.4
	// The AI stylist uses Claude when an API key is set, else the built-in basic stylist.
	AnthropicAPIKey string // ANTHROPIC_API_KEY
	StylistModel    string // STYLIST_MODEL, default claude-opus-5-5
}

// FromEnv reads Config using getenv (os.Getenv in production, a map in tests).
func FromEnv(getenv func(string) string) (Config, error) {
	c := Config{
		DatabaseURL:   getenv("DATABASE_URL"),
		Addr:          or(getenv("ADDR"), ":8080"),
		UploadDir:     or(getenv("UPLOAD_DIR"), "./uploads"),
		PublicBaseURL: getenv("PUBLIC_BASE_URL"),
		AutoMigrate:   boolOr(getenv("AUTO_MIGRATE"), true),
		LLMCeilingUSD: floatOr(getenv("LLM_COST_CEILING_USD"), 0.01),
		LLMEMAAlpha:   floatOr(getenv("LLM_EMA_ALPHA"), 0.3),
		AuthRequired:  boolOr(getenv("AUTH_REQUIRED"), true),

		VisionEnabled:      boolOr(getenv("VISION_ENABLED"), true),
		VisionModelsDir:    or(getenv("VISION_MODELS_DIR"), "./models"),
		ORTLibPath:         or(getenv("ORT_LIB_PATH"), "/usr/local/lib/libonnxruntime.so"),
		VisionSegmentation: or(getenv("VISION_SEGMENTATION"), "rmbg-1.4"),
		AnthropicAPIKey:    getenv("ANTHROPIC_API_KEY"),
		StylistModel:       or(getenv("STYLIST_MODEL"), "claude-opus-5-5"),
	}
	if c.VisionSegmentation != "rmbg-1.4" && c.VisionSegmentation != "isnet" {
		return Config{}, errors.New("VISION_SEGMENTATION must be rmbg-1.4 or isnet")
	}
	if c.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if c.LLMCeilingUSD <= 0 {
		return Config{}, errors.New("LLM_COST_CEILING_USD must be positive")
	}
	return c, nil
}

// Load reads Config from the process environment.
func Load() (Config, error) { return FromEnv(os.Getenv) }

func or(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

func boolOr(v string, def bool) bool {
	if b, err := strconv.ParseBool(v); err == nil {
		return b
	}
	return def
}

func floatOr(v string, def float64) float64 {
	if f, err := strconv.ParseFloat(v, 64); err == nil {
		return f
	}
	return def
}
