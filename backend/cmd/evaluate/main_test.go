package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sklyar/tap-translate/backend/internal/llm"
	"github.com/sklyar/tap-translate/backend/internal/translation"
)

const validAnswer = `{"expression": "bank", "partOfSpeech": "noun", "translation": "берег", "explanation": "Берег реки."}`

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

func chatResponse(w http.ResponseWriter, content string) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"choices": []any{map[string]any{"message": map[string]any{"content": content}, "finish_reason": "stop"}},
		"usage":   map[string]any{"prompt_tokens": 100, "completion_tokens": 20},
	})
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

var offVariant = Variant{ContextMode: translation.ContextModeSentence, Thinking: ThinkingOff}

func TestRunOne(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		chatResponse(w, validAnswer)
	})

	run, finished := runOne(context.Background(), client, testConfig(), testSample(), offVariant)

	if !finished || run.RequestFailed || run.Result == nil || run.Result.Translation != "берег" {
		t.Errorf("runOne() = %+v, %v", run, finished)
	}
	if run.InputTokens != 100 || run.OutputTokens != 20 || run.FinishReason != "stop" {
		t.Errorf("runOne() usage = %+v", run)
	}
}

func TestRunOneKeepsAnInvalidAnswer(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		chatResponse(w, `{"expression": "bank"}`)
	})

	run, finished := runOne(context.Background(), client, testConfig(), testSample(), offVariant)

	if !finished || run.RequestFailed || run.Result != nil || run.Content == "" || run.Error == "" {
		t.Errorf("runOne() = %+v, %v", run, finished)
	}
}

func TestRunOneHTTPError(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
	})

	run, finished := runOne(context.Background(), client, testConfig(), testSample(), offVariant)

	if !finished || !run.RequestFailed || run.TimedOut || !strings.Contains(run.Error, "429") {
		t.Errorf("runOne() = %+v, %v", run, finished)
	}
}

func TestRunOneTimeout(t *testing.T) {
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		waitForClose(r)
	})
	cfg := testConfig()
	cfg.timeout = 50 * time.Millisecond

	run, finished := runOne(context.Background(), client, cfg, testSample(), offVariant)

	if !finished || !run.RequestFailed || !run.TimedOut || run.LatencyMs < 50 {
		t.Errorf("runOne() = %+v, %v", run, finished)
	}
}

func TestRunOneInterrupted(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		cancel()
		waitForClose(r)
	})

	if run, finished := runOne(ctx, client, testConfig(), testSample(), offVariant); finished {
		t.Errorf("runOne() after an interrupt = %+v, finished", run)
	}
}

func TestRunAllKeepsFinishedRunsOnInterrupt(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	var requests atomic.Int64
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if requests.Add(1) <= 2 {
			chatResponse(w, validAnswer)
			return
		}
		cancel()
		waitForClose(r)
	})
	samples := []Sample{testSample(), testSample(), testSample(), testSample()}

	runs := runAll(ctx, client, testConfig(), samples, []Variant{offVariant})

	if len(runs) != 2 {
		t.Fatalf("runAll() returned %d runs, want the 2 finished ones", len(runs))
	}
	for _, run := range runs {
		if run.Result == nil {
			t.Errorf("runAll() run = %+v, want a valid answer", run)
		}
	}
}

func TestWarmUp(t *testing.T) {
	var body map[string]any
	client := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		chatResponse(w, "OK")
	})

	if err := warmUp(context.Background(), client, testConfig(), ThinkingOff); err != nil {
		t.Fatalf("warmUp() error = %v", err)
	}
	if strings.Contains(body["messages"].([]any)[0].(map[string]any)["content"].(string), "bank") {
		t.Errorf("warmUp() sent a sample prompt: %v", body)
	}
	if body["enable_thinking"] != false {
		t.Errorf("warmUp() enable_thinking = %v, want false", body["enable_thinking"])
	}

	failing := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "bad key", http.StatusUnauthorized)
	})
	if err := warmUp(context.Background(), failing, testConfig(), ThinkingOff); err == nil || !strings.Contains(err.Error(), "401") {
		t.Errorf("warmUp() with a bad key error = %v", err)
	}
}

func TestLoadSamplesRejectsAMissingContext(t *testing.T) {
	path := filepath.Join(t.TempDir(), "contexts.json")
	if err := os.WriteFile(path, []byte(`[{"id": "empty", "word": ""}]`), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := loadSamples(path); err == nil || !strings.Contains(err.Error(), "sample empty") {
		t.Errorf("loadSamples() error = %v, want an error for the sample", err)
	}
}
