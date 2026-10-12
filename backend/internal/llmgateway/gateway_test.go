package llmgateway

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// fakeClock is advanced by fakeProvider calls, so latencies are exact and tests never sleep.
type fakeClock struct{ t time.Time }

func (c *fakeClock) Now() time.Time { return c.t }

type fakeProvider struct {
	clock   *fakeClock
	latency time.Duration
	err     error
	calls   int
}

func (p *fakeProvider) Complete(context.Context, Request) (string, error) {
	p.calls++
	p.clock.t = p.clock.t.Add(p.latency)
	return "ok", p.err
}

func newTestGateway(t *testing.T, clock *fakeClock, ceiling float64, models ...Model) *Gateway {
	t.Helper()
	g, err := New(models, Options{
		Policy: CheapestFastestUnderCeiling{CeilingUSD: ceiling},
		Health: NewEMATracker(EMAConfig{Alpha: 0.5, FailureThreshold: 2, Cooldown: time.Minute, Now: clock.Now}),
		Now:    clock.Now,
	})
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestRoutesToLowestEMALatencyAfterExploring(t *testing.T) {
	clock := &fakeClock{t: time.Unix(0, 0)}
	slow := &fakeProvider{clock: clock, latency: 800 * time.Millisecond}
	fast := &fakeProvider{clock: clock, latency: 200 * time.Millisecond}
	g := newTestGateway(t, clock, 1,
		Model{Name: "slow", Provider: slow, InputPricePerMTok: 1, OutputPricePerMTok: 1, Quality: 1},
		Model{Name: "fast", Provider: fast, InputPricePerMTok: 2, OutputPricePerMTok: 2, Quality: 1},
	)
	ctx := context.Background()

	// Exploration: unmeasured models go first, cheapest first.
	if r, _ := g.Complete(ctx, Request{Prompt: "hi"}); r.Model != "slow" {
		t.Fatalf("first call = %s, want slow (cheapest unmeasured)", r.Model)
	}
	if r, _ := g.Complete(ctx, Request{Prompt: "hi"}); r.Model != "fast" {
		t.Fatalf("second call = %s, want fast (still unmeasured)", r.Model)
	}
	// Exploitation: both measured, lower EMA wins.
	for range 3 {
		if r, _ := g.Complete(ctx, Request{Prompt: "hi"}); r.Model != "fast" {
			t.Fatalf("got %s, want fast", r.Model)
		}
	}
}

func TestEMAUpdate(t *testing.T) {
	clock := &fakeClock{t: time.Unix(0, 0)}
	p := &fakeProvider{clock: clock, latency: 100 * time.Millisecond}
	g := newTestGateway(t, clock, 1, Model{Name: "m", Provider: p, Quality: 1})

	g.Complete(context.Background(), Request{Prompt: "x"}) // seeds EMA at 100ms
	p.latency = 300 * time.Millisecond
	g.Complete(context.Background(), Request{Prompt: "x"}) // 0.5*300 + 0.5*100 = 200ms

	if got := g.Stats()[0].EMALatencyMs; got != 200 {
		t.Fatalf("EMA = %vms, want 200ms", got)
	}
}

func TestEMAShiftsTrafficWhenAProviderSlowsDown(t *testing.T) {
	clock := &fakeClock{t: time.Unix(0, 0)}
	a := &fakeProvider{clock: clock, latency: 100 * time.Millisecond}
	b := &fakeProvider{clock: clock, latency: 300 * time.Millisecond}
	g := newTestGateway(t, clock, 1,
		Model{Name: "a", Provider: a, Quality: 1},
		Model{Name: "b", Provider: b, Quality: 1},
	)
	ctx := context.Background()
	g.Complete(ctx, Request{Prompt: "x"})
	g.Complete(ctx, Request{Prompt: "x"})

	a.latency = 2 * time.Second           // provider a degrades
	g.Complete(ctx, Request{Prompt: "x"}) // a: 0.5*2000 + 0.5*100 = 1050ms > b's 300ms
	if r, _ := g.Complete(ctx, Request{Prompt: "x"}); r.Model != "b" {
		t.Fatalf("got %s, want b after a slowed down", r.Model)
	}
}

func TestCostCeilingExcludesExpensiveModels(t *testing.T) {
	clock := &fakeClock{t: time.Unix(0, 0)}
	cheap := &fakeProvider{clock: clock, latency: time.Second}
	pricey := &fakeProvider{clock: clock, latency: time.Millisecond}
	// 1000 output tokens: cheap = $0.001, pricey = $0.05
	g := newTestGateway(t, clock, 0.01,
		Model{Name: "cheap", Provider: cheap, OutputPricePerMTok: 1, Quality: 1},
		Model{Name: "pricey", Provider: pricey, OutputPricePerMTok: 50, Quality: 3},
	)
	for range 3 {
		r, err := g.Complete(context.Background(), Request{Prompt: "x", MaxOutputTokens: 1000})
		if err != nil || r.Model != "cheap" {
			t.Fatalf("got %q, %v; want cheap", r.Model, err)
		}
	}
	if pricey.calls != 0 {
		t.Fatalf("pricey called %d times despite exceeding the ceiling", pricey.calls)
	}

	_, err := g.Complete(context.Background(), Request{Prompt: "x", MaxOutputTokens: 1000, MinQuality: 3})
	if !errors.Is(err, ErrNoEligibleModel) {
		t.Fatalf("err = %v, want ErrNoEligibleModel (only quality-3 model is over budget)", err)
	}

	// A per-request ceiling can only tighten the global one.
	_, err = g.Complete(context.Background(), Request{Prompt: "x", MaxOutputTokens: 1000, CostCeilingUSD: 0.0001})
	if !errors.Is(err, ErrNoEligibleModel) {
		t.Fatalf("err = %v, want ErrNoEligibleModel under a tighter per-request ceiling", err)
	}
}

func TestFailoverAndCooldown(t *testing.T) {
	clock := &fakeClock{t: time.Unix(0, 0)}
	flaky := &fakeProvider{clock: clock, latency: time.Millisecond, err: errors.New("503")}
	backup := &fakeProvider{clock: clock, latency: time.Second}
	g := newTestGateway(t, clock, 1,
		Model{Name: "flaky", Provider: flaky, Quality: 1},
		Model{Name: "backup", Provider: backup, InputPricePerMTok: 1, Quality: 1},
	)
	ctx := context.Background()

	r, err := g.Complete(ctx, Request{Prompt: "x"})
	if err != nil || r.Model != "backup" || len(r.Attempts) != 1 || r.Attempts[0].Model != "flaky" {
		t.Fatalf("got %+v, %v; want failover to backup after one failed attempt", r, err)
	}
	g.Complete(ctx, Request{Prompt: "x"}) // flaky fails a 2nd time -> benched (threshold 2)
	callsBefore := flaky.calls
	g.Complete(ctx, Request{Prompt: "x"})
	if flaky.calls != callsBefore {
		t.Fatal("benched model was called during cooldown")
	}

	clock.t = clock.t.Add(2 * time.Minute) // cooldown expires
	g.Complete(ctx, Request{Prompt: "x"})
	if flaky.calls != callsBefore+1 {
		t.Fatal("model was not retried after cooldown")
	}
}

func TestAllModelsFailing(t *testing.T) {
	clock := &fakeClock{t: time.Unix(0, 0)}
	g := newTestGateway(t, clock, 1,
		Model{Name: "a", Provider: &fakeProvider{clock: clock, err: errors.New("boom")}, Quality: 1},
	)
	_, err := g.Complete(context.Background(), Request{Prompt: "x"})
	if err == nil || !strings.Contains(err.Error(), "a: boom") {
		t.Fatalf("err = %v, want aggregated provider errors", err)
	}
}

// A custom policy plugs in without changing the gateway (open/closed).
type alwaysLast struct{}

func (alwaysLast) Plan(_ Request, c []Candidate, _ time.Time) ([]Candidate, error) {
	return c[len(c)-1:], nil
}

func TestCustomPolicy(t *testing.T) {
	clock := &fakeClock{t: time.Unix(0, 0)}
	g, err := New([]Model{
		{Name: "a", Provider: &fakeProvider{clock: clock}},
		{Name: "b", Provider: &fakeProvider{clock: clock}},
	}, Options{Policy: alwaysLast{}, Now: clock.Now})
	if err != nil {
		t.Fatal(err)
	}
	if r, _ := g.Complete(context.Background(), Request{Prompt: "x"}); r.Model != "b" {
		t.Fatalf("got %s, want b", r.Model)
	}
}
