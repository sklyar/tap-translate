// Package llm calls an OpenAI-compatible chat completions API.
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// maxErrorBodyBytes limits how much of an error response goes into the
// returned error.
const maxErrorBodyBytes = 2048

type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// NewClient creates a client. baseURL is the API root, for example
// "https://api.example.com/v1"; the client appends "/chat/completions".
func NewClient(baseURL, apiKey string, httpClient *http.Client) *Client {
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		apiKey:     apiKey,
		httpClient: httpClient,
	}
}

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type JSONSchemaFormat struct {
	Name   string         `json:"name"`
	Strict bool           `json:"strict"`
	Schema map[string]any `json:"schema"`
}

type ResponseFormat struct {
	Type       string            `json:"type"`
	JSONSchema *JSONSchemaFormat `json:"json_schema,omitempty"`
}

type ChatRequest struct {
	Model          string          `json:"model"`
	Messages       []Message       `json:"messages"`
	ResponseFormat *ResponseFormat `json:"response_format,omitempty"`
	MaxTokens      int             `json:"max_tokens,omitempty"`
	// EnableThinking is an extension of Alibaba Cloud Model Studio for hybrid
	// thinking models such as Qwen3.x. Nil leaves the model default.
	EnableThinking *bool `json:"enable_thinking,omitempty"`
}

type Usage struct {
	PromptTokens            int `json:"prompt_tokens"`
	CompletionTokens        int `json:"completion_tokens"`
	CompletionTokensDetails *struct {
		ReasoningTokens int `json:"reasoning_tokens"`
	} `json:"completion_tokens_details,omitempty"`
}

// ReasoningTokens returns the number of thinking tokens, which are part of
// CompletionTokens.
func (u Usage) ReasoningTokens() int {
	if u.CompletionTokensDetails == nil {
		return 0
	}
	return u.CompletionTokensDetails.ReasoningTokens
}

type ChatResponse struct {
	Content      string
	FinishReason string
	Usage        Usage
}

type chatResponseBody struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage Usage `json:"usage"`
}

// StatusError is returned for a non-2xx response.
type StatusError struct {
	StatusCode int
	Body       string
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("chat completions returned HTTP %d: %s", e.StatusCode, e.Body)
}

// Complete sends one chat completion request and waits for the full answer.
func (c *Client) Complete(ctx context.Context, request ChatRequest) (ChatResponse, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("encode request: %w", err)
	}

	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return ChatResponse{}, fmt.Errorf("create request: %w", err)
	}
	httpRequest.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpRequest.Header.Set("Content-Type", "application/json")

	response, err := c.httpClient.Do(httpRequest)
	if err != nil {
		return ChatResponse{}, fmt.Errorf("send request: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode > 299 {
		errorBody, _ := io.ReadAll(io.LimitReader(response.Body, maxErrorBodyBytes))
		return ChatResponse{}, &StatusError{
			StatusCode: response.StatusCode,
			Body:       strings.TrimSpace(string(errorBody)),
		}
	}

	var decoded chatResponseBody
	if err := json.NewDecoder(response.Body).Decode(&decoded); err != nil {
		return ChatResponse{}, fmt.Errorf("decode response: %w", err)
	}
	if len(decoded.Choices) == 0 {
		return ChatResponse{}, errors.New("response has no choices")
	}

	return ChatResponse{
		Content:      decoded.Choices[0].Message.Content,
		FinishReason: decoded.Choices[0].FinishReason,
		Usage:        decoded.Usage,
	}, nil
}
