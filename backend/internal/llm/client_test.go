package llm

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientComplete(t *testing.T) {
	var gotBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Errorf("Authorization = %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Errorf("decode request: %v", err)
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"choices": [{"message": {"role": "assistant", "content": "{}", "reasoning_content": "..."}, "finish_reason": "stop"}],
			"usage": {"prompt_tokens": 10, "completion_tokens": 30, "completion_tokens_details": {"reasoning_tokens": 20}}
		}`))
	}))
	defer server.Close()

	thinking := false
	client := NewClient(server.URL+"/v1/", "secret", server.Client())
	response, err := client.Complete(context.Background(), ChatRequest{
		Model:          "test-model",
		Messages:       []Message{{Role: "user", Content: "hi"}},
		ResponseFormat: &ResponseFormat{Type: "json_object"},
		EnableThinking: &thinking,
	})
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}

	if response.Content != "{}" || response.FinishReason != "stop" {
		t.Errorf("Complete() = %+v", response)
	}
	if response.Usage.PromptTokens != 10 || response.Usage.CompletionTokens != 30 || response.Usage.ReasoningTokens() != 20 {
		t.Errorf("Complete().Usage = %+v", response.Usage)
	}

	if gotBody["model"] != "test-model" || gotBody["enable_thinking"] != false {
		t.Errorf("request body = %v", gotBody)
	}
	if _, ok := gotBody["max_tokens"]; ok {
		t.Errorf("request body has max_tokens although it is not set: %v", gotBody)
	}
}

func TestClientCompleteOmitsUnsetThinking(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if _, ok := body["enable_thinking"]; ok {
			t.Errorf("request body has enable_thinking: %v", body)
		}
		_, _ = w.Write([]byte(`{"choices": [{"message": {"content": "ok"}}]}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "secret", server.Client())
	if _, err := client.Complete(context.Background(), ChatRequest{Model: "m"}); err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
}

func TestClientCompleteReturnsStatusError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(strings.Repeat("x", 3*maxErrorBodyBytes)))
	}))
	defer server.Close()

	client := NewClient(server.URL, "secret", server.Client())
	_, err := client.Complete(context.Background(), ChatRequest{Model: "m"})

	var statusErr *StatusError
	if !errors.As(err, &statusErr) {
		t.Fatalf("Complete() error = %v, want *StatusError", err)
	}
	if statusErr.StatusCode != http.StatusTooManyRequests || len(statusErr.Body) != maxErrorBodyBytes {
		t.Errorf("StatusError = %d with %d body bytes", statusErr.StatusCode, len(statusErr.Body))
	}
}

func TestClientCompleteRejectsEmptyChoices(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"choices": []}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "secret", server.Client())
	if _, err := client.Complete(context.Background(), ChatRequest{Model: "m"}); err == nil {
		t.Error("Complete() with no choices returned no error")
	}
}
