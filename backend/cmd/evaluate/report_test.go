package main

import (
	"math"
	"testing"

	"github.com/sklyar/tap-translate/backend/internal/translation"
)

func TestPercentile(t *testing.T) {
	sorted := []int64{100, 200, 300, 400, 500, 600, 700, 800, 900, 1000}
	tests := []struct {
		p    float64
		want int64
	}{
		{0, 100},
		{50, 500},
		{90, 900},
		{95, 1000},
		{100, 1000},
	}

	for _, test := range tests {
		if got := percentile(sorted, test.p); got != test.want {
			t.Errorf("percentile(p%.0f) = %d, want %d", test.p, got, test.want)
		}
	}

	if got := percentile([]int64{42}, 95); got != 42 {
		t.Errorf("percentile of one value = %d, want 42", got)
	}
}

func TestSummarize(t *testing.T) {
	variant := Variant{ContextMode: translation.ContextModeSentence, Thinking: ThinkingOff}
	runs := []Run{
		{LatencyMs: 300, InputTokens: 1000, OutputTokens: 100, Result: &translation.Result{}},
		{LatencyMs: 100, InputTokens: 3000, OutputTokens: 300, Result: &translation.Result{}},
		// An invalid answer still has a latency and tokens.
		{LatencyMs: 200, InputTokens: 2000, OutputTokens: 200, Error: "explanation is empty"},
		// A failed request has no answer, so it does not count for latency.
		{LatencyMs: 60000, RequestFailed: true, Error: "timeout"},
	}

	got := summarize(variant, runs, 0.15, 0.47)

	if got.Requests != 4 || got.Valid != 2 {
		t.Errorf("summarize() requests = %d, valid = %d", got.Requests, got.Valid)
	}
	if got.LatencyP50Ms != 200 || got.LatencyP95Ms != 300 || got.LatencyMaxMs != 300 {
		t.Errorf("summarize() latency = %d / %d / %d", got.LatencyP50Ms, got.LatencyP95Ms, got.LatencyMaxMs)
	}
	if got.MeanInputTokens != 2000 || got.MeanOutputTokens != 200 {
		t.Errorf("summarize() tokens = %.0f / %.0f", got.MeanInputTokens, got.MeanOutputTokens)
	}

	// 1,000 requests: 2M input tokens × $0.15 + 0.2M output tokens × $0.47.
	if want := 0.394; math.Abs(got.CostPer1000-want) > 1e-9 {
		t.Errorf("summarize() cost = %f, want %f", got.CostPer1000, want)
	}
}

func TestSummarizeWithoutAnswers(t *testing.T) {
	got := summarize(Variant{}, []Run{{RequestFailed: true}}, 1, 1)
	if got.Requests != 1 || got.Valid != 0 || got.LatencyMaxMs != 0 || got.CostPer1000 != 0 {
		t.Errorf("summarize() = %+v", got)
	}
}

func TestParseFlags(t *testing.T) {
	required := []string{"-base-url", "https://example.com/v1", "-model", "m", "-api-key-file", "key"}

	cfg, err := parseFlags(append(required, "-context-modes", "sentence, full", "-thinking", "off"))
	if err != nil {
		t.Fatalf("parseFlags() error = %v", err)
	}
	if len(cfg.contextModes) != 2 || cfg.contextModes[1] != translation.ContextModeFull {
		t.Errorf("contextModes = %v", cfg.contextModes)
	}
	if len(cfg.thinkingModes) != 1 || cfg.thinkingModes[0] != ThinkingOff {
		t.Errorf("thinkingModes = %v", cfg.thinkingModes)
	}

	invalid := [][]string{
		{"-model", "m", "-api-key-file", "key"},
		append(required, "-context-modes", "page"),
		append(required, "-thinking", "auto"),
		append(required, "-concurrency", "0"),
		append(required, "-input-price", "-1"),
	}
	for _, args := range invalid {
		if _, err := parseFlags(args); err == nil {
			t.Errorf("parseFlags(%q) returned no error", args)
		}
	}
}

func TestThinkingModeEnableThinking(t *testing.T) {
	if got := ThinkingOff.enableThinking(); got == nil || *got {
		t.Errorf("ThinkingOff.enableThinking() = %v, want false", got)
	}
	if got := ThinkingOn.enableThinking(); got == nil || !*got {
		t.Errorf("ThinkingOn.enableThinking() = %v, want true", got)
	}
	if got := ThinkingDefault.enableThinking(); got != nil {
		t.Errorf("ThinkingDefault.enableThinking() = %v, want nil", *got)
	}
}
