package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sklyar/tap-translate/backend/internal/llm"
	"github.com/sklyar/tap-translate/backend/internal/translation"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/goleak"
)

const _validAnswer = `{"expression": "bank", "partOfSpeech": "noun", ` +
	`"translation": "берег", "explanation": "Берег реки."}`

func TestMain(m *testing.M) {
	goleak.VerifyTestMain(m)
}

func testSample() Sample {
	return Sample{
		ID:   "bank",
		Word: "bank",
		Context: translation.DetectionContext{
			FocusBlock: translation.FocusBlock{
				ContextBlock: translation.ContextBlock{Text: "We sat on the bank of the river."},
				Word:         translation.TextSpan{Start: 14, End: 18},
				Sentence:     translation.TextSpan{Start: 0, End: 32},
			},
		},
	}
}

func testConfig() config {
	return config{model: "m", concurrency: 1, timeout: time.Second}
}

func offVariant() Variant {
	return Variant{ContextMode: translation.ContextModeSentence, Thinking: ThinkingOff}
}

func writeChatResponse(t *testing.T, w http.ResponseWriter, content string) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	body := map[string]any{
		"choices": []any{map[string]any{
			"message":       map[string]any{"content": content},
			"finish_reason": "stop",
		}},
		"usage": map[string]any{"prompt_tokens": 100, "completion_tokens": 20},
	}
	assert.NoError(t, json.NewEncoder(w).Encode(body))
}

// waitForClose blocks until the client closes the request. An HTTP/1.1 server
// notices a closed connection only after the request body is read.
func waitForClose(r *http.Request) {
	_, _ = io.Copy(io.Discard, r.Body)
	<-r.Context().Done()
}

func newTestClient(t *testing.T, handler http.HandlerFunc) *llm.Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return llm.NewClient(server.URL, "key", server.Client())
}

func TestRunOne(t *testing.T) {
	t.Parallel()
	client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		writeChatResponse(t, w, _validAnswer)
	})

	run, finished := runOne(t.Context(), client, testConfig(), testSample(), offVariant())

	assert.True(t, finished)
	assert.False(t, run.RequestFailed)
	require.NotNil(t, run.Result)
	assert.Equal(t, "берег", run.Result.Translation)
	assert.Equal(t, 100, run.InputTokens)
	assert.Equal(t, 20, run.OutputTokens)
	assert.Equal(t, "stop", run.FinishReason)
}

func TestRunOne_Temperature(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name            string
		giveTemperature *float64
	}{
		{name: "model default", giveTemperature: nil},
		{name: "zero", giveTemperature: new(0.0)},
		{name: "set", giveTemperature: new(0.3)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var got llm.ChatRequest
			client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
				assert.NoError(t, json.NewDecoder(r.Body).Decode(&got))
				writeChatResponse(t, w, _validAnswer)
			})
			cfg := testConfig()
			cfg.temperature = tt.giveTemperature

			_, finished := runOne(t.Context(), client, cfg, testSample(), offVariant())

			assert.True(t, finished)
			assert.Equal(t, tt.giveTemperature, got.Temperature)
		})
	}
}

func TestRunOne_KeepsAnInvalidAnswer(t *testing.T) {
	t.Parallel()
	client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		writeChatResponse(t, w, `{"expression": "bank"}`)
	})

	run, finished := runOne(t.Context(), client, testConfig(), testSample(), offVariant())

	assert.True(t, finished)
	assert.False(t, run.RequestFailed)
	assert.Nil(t, run.Result)
	assert.JSONEq(t, `{"expression": "bank"}`, run.Content)
	assert.Equal(t, "partOfSpeech is missing", run.Error)
}

func TestRunOne_HTTPError(t *testing.T) {
	t.Parallel()
	client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
	})

	run, finished := runOne(t.Context(), client, testConfig(), testSample(), offVariant())

	assert.True(t, finished)
	assert.True(t, run.RequestFailed)
	assert.False(t, run.TimedOut)
	assert.Contains(t, run.Error, "HTTP 429")
}

func TestRunOne_Timeout(t *testing.T) {
	t.Parallel()
	client := newTestClient(t, func(_ http.ResponseWriter, r *http.Request) {
		waitForClose(r)
	})
	cfg := testConfig()
	cfg.timeout = 50 * time.Millisecond

	run, finished := runOne(t.Context(), client, cfg, testSample(), offVariant())

	assert.True(t, finished)
	assert.True(t, run.RequestFailed)
	assert.True(t, run.TimedOut)
	assert.GreaterOrEqual(t, run.LatencyMs, int64(50))
}

func TestRunOne_Interrupted(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(t.Context())
	client := newTestClient(t, func(_ http.ResponseWriter, r *http.Request) {
		cancel()
		waitForClose(r)
	})

	_, finished := runOne(ctx, client, testConfig(), testSample(), offVariant())

	assert.False(t, finished)
}

func TestRunAll_KeepsFinishedRunsOnInterrupt(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(t.Context())
	var requests atomic.Int64
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) <= 2 {
			writeChatResponse(t, w, _validAnswer)
			return
		}
		cancel()
		waitForClose(r)
	})
	samples := []Sample{testSample(), testSample(), testSample(), testSample()}

	runs := runAll(ctx, client, testConfig(), samples, []Variant{offVariant()}, io.Discard)

	require.Len(t, runs, 2, "runAll must return only the finished runs")
	for _, run := range runs {
		assert.NotNil(t, run.Result)
	}
}

func TestWarmUp(t *testing.T) {
	t.Parallel()
	var got llm.ChatRequest
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&got))
		writeChatResponse(t, w, "OK")
	})

	err := warmUp(t.Context(), client, testConfig(), ThinkingOff)

	require.NoError(t, err)
	// The warm-up prompt is not a sample prompt.
	assert.Equal(t, []llm.Message{{Role: "user", Content: "Reply with OK."}}, got.Messages)
	assert.Equal(t, new(false), got.EnableThinking)
}

func TestWarmUp_BadKey(t *testing.T) {
	t.Parallel()
	client := newTestClient(t, func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "bad key", http.StatusUnauthorized)
	})

	err := warmUp(t.Context(), client, testConfig(), ThinkingOff)

	assert.ErrorContains(t, err, "warm-up request: chat completions returned HTTP 401")
}

func TestLoadSamples_RejectsAMissingContext(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "contexts.json")
	require.NoError(t, os.WriteFile(path, []byte(`[{"id": "empty", "word": ""}]`), 0o600))

	_, err := loadSamples(path)

	assert.ErrorContains(t, err, "sample empty: word span")
}
