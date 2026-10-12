package llmgateway

import (
	"sync"
	"time"
)

// Health is a point-in-time view of one model's observed behaviour.
type Health struct {
	EMALatency       time.Duration
	Samples          int // successful calls measured
	ConsecutiveFails int
	BenchedUntil     time.Time // zero when not benched
}

func (h Health) Benched(now time.Time) bool { return now.Before(h.BenchedUntil) }

// HealthTracker records call outcomes and reports per-model health.
type HealthTracker interface {
	Record(model string, latency time.Duration, err error)
	Health(model string) Health
}

// EMATracker keeps an exponential moving average of latency:
//
//	ema = alpha*observed + (1-alpha)*ema
//
// A high alpha reacts quickly when a provider slows down; a low alpha smooths jitter.
// After FailureThreshold consecutive errors a model is benched for Cooldown.
type EMATracker struct {
	alpha     float64
	threshold int
	cooldown  time.Duration
	now       func() time.Time

	mu     sync.Mutex
	health map[string]Health
}

type EMAConfig struct {
	Alpha            float64       // in (0, 1]; default 0.3
	FailureThreshold int           // default 3
	Cooldown         time.Duration // default 30s
	Now              func() time.Time
}

func NewEMATracker(cfg EMAConfig) *EMATracker {
	if cfg.Alpha <= 0 || cfg.Alpha > 1 {
		cfg.Alpha = 0.3
	}
	if cfg.FailureThreshold <= 0 {
		cfg.FailureThreshold = 3
	}
	if cfg.Cooldown <= 0 {
		cfg.Cooldown = 30 * time.Second
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &EMATracker{alpha: cfg.Alpha, threshold: cfg.FailureThreshold, cooldown: cfg.Cooldown, now: cfg.Now, health: map[string]Health{}}
}

func (t *EMATracker) Record(model string, latency time.Duration, err error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	h := t.health[model]
	if err != nil {
		h.ConsecutiveFails++
		if h.ConsecutiveFails >= t.threshold {
			h.BenchedUntil = t.now().Add(t.cooldown)
			h.ConsecutiveFails = 0
		}
		t.health[model] = h
		return
	}
	h.ConsecutiveFails = 0
	if h.Samples == 0 {
		h.EMALatency = latency // seed with the first observation instead of decaying from zero
	} else {
		h.EMALatency = time.Duration(t.alpha*float64(latency) + (1-t.alpha)*float64(h.EMALatency))
	}
	h.Samples++
	t.health[model] = h
}

func (t *EMATracker) Health(model string) Health {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.health[model]
}
