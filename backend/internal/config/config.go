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
