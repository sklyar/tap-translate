package llm_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sklyar/tap-translate/backend/internal/llm"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return server
}

func TestClient_Complete(t *testing.T) {
	t.Parallel()
	var gotPath, gotAuthorization string
	var gotBody []byte
	server := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuthorization = r.Header.Get("Authorization")
		body, err := io.ReadAll(r.Body)
		assert.NoError(t, err)
		gotBody = body

		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{
			"choices": [{
				"message": {"role": "assistant", "content": "{}", "reasoning_content": "..."},
				"finish_reason": "stop"
			}],
			"usage": {
				"prompt_tokens": 10,
				"completion_tokens": 30,
				"completion_tokens_details": {"reasoning_tokens": 20}
			}
		}`)
	})
	client := llm.NewClient(server.URL+"/v1/", "secret", server.Client())

	response, err := client.Complete(t.Context(), llm.ChatRequest{
		Model:          "test-model",
		Messages:       []llm.Message{{Role: "user", Content: "hi"}},
		ResponseFormat: &llm.ResponseFormat{Type: "json_object"},
		EnableThinking: new(false),
	})

	require.NoError(t, err)
	assert.Equal(t, "{}", response.Content)
	assert.Equal(t, "stop", response.FinishReason)
	assert.Equal(t, 10, response.Usage.PromptTokens)
	assert.Equal(t, 30, response.Usage.CompletionTokens)
	assert.Equal(t, 20, response.Usage.ReasoningTokens())
	assert.Equal(t, "/v1/chat/completions", gotPath)
	assert.Equal(t, "Bearer secret", gotAuthorization)
	// max_tokens is not set, so it is not sent.
	assert.JSONEq(t, `{
		"model": "test-model",
		"messages": [{"role": "user", "content": "hi"}],
		"response_format": {"type": "json_object"},
		"enable_thinking": false
	}`, string(gotBody))
}

func TestClient_Complete_OmitsUnsetThinking(t *testing.T) {
	t.Parallel()
	var gotBody []byte
	server := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		assert.NoError(t, err)
		gotBody = body
		_, _ = io.WriteString(w, `{"choices": [{"message": {"content": "ok"}}]}`)
	})
	client := llm.NewClient(server.URL, "secret", server.Client())

	_, err := client.Complete(t.Context(), llm.ChatRequest{Model: "m"})

	require.NoError(t, err)
	assert.JSONEq(t, `{"model": "m", "messages": null}`, string(gotBody))
}

func TestClient_Complete_ReturnsStatusError(t *testing.T) {
	t.Parallel()
	server := newTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = io.WriteString(w, strings.Repeat("x", 3*2048))
	})
	client := llm.NewClient(server.URL, "secret", server.Client())

	_, err := client.Complete(t.Context(), llm.ChatRequest{Model: "m"})

	var statusErr *llm.StatusError
	require.ErrorAs(t, err, &statusErr)
	require.NotNil(t, statusErr) // nilaway does not know that ErrorAs sets it
	assert.Equal(t, http.StatusTooManyRequests, statusErr.StatusCode)
	// The error keeps only the first 2,048 bytes of the body.
	assert.Len(t, statusErr.Body, 2048)
}

func TestClient_Complete_RejectsEmptyChoices(t *testing.T) {
	t.Parallel()
	server := newTestServer(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"choices": []}`)
	})
	client := llm.NewClient(server.URL, "secret", server.Client())

	_, err := client.Complete(t.Context(), llm.ChatRequest{Model: "m"})

	assert.EqualError(t, err, "response has no choices")
}
