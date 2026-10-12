package config

import "testing"

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestDefaults(t *testing.T) {
	c, err := FromEnv(env(map[string]string{"DATABASE_URL": "postgres://x"}))
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != ":8080" || c.UploadDir != "./uploads" || !c.AutoMigrate || c.LLMCeilingUSD != 0.01 || c.LLMEMAAlpha != 0.3 {
		t.Fatalf("unexpected defaults: %+v", c)
	}
}

func TestOverridesAndErrors(t *testing.T) {
	c, err := FromEnv(env(map[string]string{"DATABASE_URL": "postgres://x", "AUTO_MIGRATE": "false", "LLM_COST_CEILING_USD": "0.5"}))
	if err != nil || c.AutoMigrate || c.LLMCeilingUSD != 0.5 {
		t.Fatalf("%+v, %v", c, err)
	}
	if _, err := FromEnv(env(nil)); err == nil {
		t.Fatal("missing DATABASE_URL accepted")
	}
	if _, err := FromEnv(env(map[string]string{"DATABASE_URL": "x", "LLM_COST_CEILING_USD": "-1"})); err == nil {
		t.Fatal("negative ceiling accepted")
	}
}
