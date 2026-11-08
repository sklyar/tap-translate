package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/sklyar/tap-translate/backend/internal/translation"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// withRequiredFlags returns the required flags followed by args.
func withRequiredFlags(args ...string) []string {
	return append(
		[]string{"-base-url", "https://example.com/v1", "-model", "m", "-api-key-file", "key"},
		args...,
	)
}

func TestPercentile(t *testing.T) {
	t.Parallel()
	sorted := []int64{100, 200, 300, 400, 500, 600, 700, 800, 900, 1000}
	tests := []struct {
		giveP float64
		want  int64
	}{
		{giveP: 0, want: 100},
		{giveP: 50, want: 500},
		{giveP: 90, want: 900},
		{giveP: 95, want: 1000},
		{giveP: 100, want: 1000},
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("p%.0f", tt.giveP), func(t *testing.T) {
			t.Parallel()

			got := percentile(sorted, tt.giveP)

			assert.Equal(t, tt.want, got)
		})
	}
}

func TestPercentile_OneValue(t *testing.T) {
	t.Parallel()

	got := percentile([]int64{42}, 95)

	assert.Equal(t, int64(42), got)
}

func TestSummarize(t *testing.T) {
	t.Parallel()
	variant := Variant{ContextMode: translation.ContextModeSentence, Thinking: ThinkingOff}
	runs := []Run{
		{LatencyMs: 300, InputTokens: 1000, OutputTokens: 100, Result: &translation.Result{}},
		{LatencyMs: 100, InputTokens: 3000, OutputTokens: 300, Result: &translation.Result{}},
		// An invalid answer still has a latency and tokens.
		{LatencyMs: 200, InputTokens: 2000, OutputTokens: 200, Error: "explanation is empty"},
		// A fast HTTP error has no answer and no real latency.
		{LatencyMs: 50, RequestFailed: true, Error: "HTTP 429"},
		// A timeout has no answer, but its latency counts.
		{
			LatencyMs:     60000,
			RequestFailed: true,
			TimedOut:      true,
			Error:         "context deadline exceeded",
		},
	}

	got := summarize(variant, runs, 0.15, 0.47)

	assert.Equal(t, VariantSummary{
		Variant:          variant,
		Requests:         5,
		Valid:            2,
		Failed:           2,
		LatencyP50Ms:     200,
		LatencyP95Ms:     60000,
		LatencyMaxMs:     60000,
		MeanInputTokens:  2000,
		MeanOutputTokens: 200,
		CostPer1000:      got.CostPer1000, // checked below with a tolerance
	}, got)
	// 1,000 requests: 2M input tokens × $0.15 + 0.2M output tokens × $0.47.
	assert.InDelta(t, 0.394, got.CostPer1000, 1e-9)
}

func TestSummarize_WithoutAnswers(t *testing.T) {
	t.Parallel()

	got := summarize(Variant{}, []Run{{RequestFailed: true}}, 1, 1)

	assert.Equal(t, VariantSummary{Requests: 1, Failed: 1}, got)
}

func TestParseFlags(t *testing.T) {
	t.Parallel()

	cfg, err := parseFlags(
		withRequiredFlags("-context-modes", "sentence, full", "-thinking", "off"), io.Discard)

	require.NoError(t, err)
	assert.Equal(t,
		[]translation.ContextMode{translation.ContextModeSentence, translation.ContextModeFull},
		cfg.contextModes)
	assert.Equal(t, []ThinkingMode{ThinkingOff}, cfg.thinkingModes)
	assert.Equal(t, _defaultConcurrency, cfg.concurrency)
	assert.Equal(t, _defaultTimeout, cfg.timeout)
}

func TestParseFlags_RejectsInvalidArguments(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		give    []string
		wantErr string
	}{
		{
			name:    "no base URL",
			give:    []string{"-model", "m", "-api-key-file", "key"},
			wantErr: "-base-url is required",
		},
		{
			name:    "unknown context mode",
			give:    withRequiredFlags("-context-modes", "page"),
			wantErr: `unknown context mode "page"`,
		},
		{
			name:    "unknown thinking mode",
			give:    withRequiredFlags("-thinking", "auto"),
			wantErr: `unknown thinking mode "auto"`,
		},
		{
			name:    "no workers",
			give:    withRequiredFlags("-concurrency", "0"),
			wantErr: "-concurrency must be at least 1",
		},
		{
			name:    "negative price",
			give:    withRequiredFlags("-input-price", "-1"),
			wantErr: "prices must not be negative",
		},
		{
			// A space instead of a comma ends flag parsing at "block".
			name: "space in a list",
			give: withRequiredFlags(
				"-context-modes",
				"sentence",
				"block",
				"-input-price",
				"0.15",
			),
			wantErr: `unexpected argument "block"`,
		},
		{
			name:    "repeated context mode",
			give:    withRequiredFlags("-context-modes", "full,full"),
			wantErr: `-context-modes has "full" twice`,
		},
		{
			name:    "repeated thinking mode",
			give:    withRequiredFlags("-thinking", "off,on,off"),
			wantErr: `-thinking has "off" twice`,
		},
		{
			name:    "empty thinking list",
			give:    withRequiredFlags("-thinking", " , "),
			wantErr: "-thinking must not be empty",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			_, err := parseFlags(tt.give, io.Discard)

			assert.ErrorContains(t, err, tt.wantErr)
		})
	}
}

func TestParseFlags_Help(t *testing.T) {
	t.Parallel()

	_, parseErr := parseFlags([]string{"-h"}, io.Discard)
	runErr := run([]string{"-h"}, io.Discard, io.Discard)

	require.ErrorIs(t, parseErr, flag.ErrHelp)
	assert.NoError(t, runErr, "-h is not an error for the command")
}

func TestThinkingMode_EnableThinking(t *testing.T) {
	t.Parallel()
	tests := []struct {
		give ThinkingMode
		want *bool
	}{
		{give: ThinkingOff, want: new(false)},
		{give: ThinkingOn, want: new(true)},
		{give: ThinkingDefault, want: nil},
	}

	for _, tt := range tests {
		t.Run(string(tt.give), func(t *testing.T) {
			t.Parallel()

			got := tt.give.enableThinking()

			assert.Equal(t, tt.want, got)
		})
	}
}

func TestReport_Write(t *testing.T) {
	t.Parallel()
	directory, err := createRunDirectory(filepath.Join(t.TempDir(), "results"), "run")
	require.NoError(t, err)

	err = Report{Model: "m"}.write(directory)

	require.NoError(t, err)
	data, err := os.ReadFile(filepath.Join(directory, _resultsFileName))
	require.NoError(t, err)
	var results Report
	require.NoError(t, json.Unmarshal(data, &results))
	assert.Equal(t, "m", results.Model)
	for _, name := range []string{_resultsFileName, _reportFileName} {
		info, statErr := os.Stat(filepath.Join(directory, name))
		require.NoError(t, statErr)
		// The results contain page text, so only the owner can read them.
		assert.Equal(t, os.FileMode(0o600), info.Mode().Perm(), name)
	}
}

func TestCreateRunDirectory_DoesNotReuseADirectory(t *testing.T) {
	t.Parallel()
	outputDir := t.TempDir()
	_, err := createRunDirectory(outputDir, "run")
	require.NoError(t, err)

	_, err = createRunDirectory(outputDir, "run")

	assert.ErrorContains(t, err, "create run directory")
}

func TestVariant_DoesNotHideRunFields(t *testing.T) {
	t.Parallel()
	run := Run{
		SampleID:    "sample",
		ContextMode: translation.ContextModeFull,
		Thinking:    ThinkingOff,
		LatencyMs:   1234,
	}

	formatted := fmt.Sprintf("%+v", run)
	name := run.Name()

	assert.Contains(t, formatted, "1234")
	assert.Equal(t, "full, thinking off", name)
}
