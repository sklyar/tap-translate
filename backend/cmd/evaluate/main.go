// Command evaluate runs the contextual translation prompt on captured
// DetectionContext samples and writes a results file and an HTML report.
// See eval/README.md.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/sklyar/tap-translate/backend/internal/llm"
	"github.com/sklyar/tap-translate/backend/internal/translation"
)

// maxAnswerTokens limits the answer length. Qwen does not count thinking
// tokens against this limit.
const maxAnswerTokens = 500

type config struct {
	contextsPath  string
	outputDir     string
	baseURL       string
	model         string
	apiKeyFile    string
	contextModes  []translation.ContextMode
	thinkingModes []ThinkingMode
	concurrency   int
	timeout       time.Duration
	limit         int
	inputPrice    float64
	outputPrice   float64
}

// Sample is one entry of eval/contexts.json.
type Sample struct {
	ID       string                       `json:"id"`
	URL      string                       `json:"url"`
	License  string                       `json:"license"`
	Kind     string                       `json:"kind"`
	Case     string                       `json:"case"`
	Word     string                       `json:"word"`
	Expected string                       `json:"expected"`
	Context  translation.DetectionContext `json:"context"`
}

// ThinkingMode controls the enable_thinking request field. It is an extension
// of Alibaba Cloud Model Studio for hybrid thinking models such as Qwen3.x.
// Other providers can reject the field, so ThinkingDefault omits it.
type ThinkingMode string

const (
	ThinkingDefault ThinkingMode = "default"
	ThinkingOff     ThinkingMode = "off"
	ThinkingOn      ThinkingMode = "on"
)

func (m ThinkingMode) enableThinking() *bool {
	switch m {
	case ThinkingOff:
		return new(false)
	case ThinkingOn:
		return new(true)
	default:
		return nil
	}
}

type Variant struct {
	ContextMode translation.ContextMode `json:"contextMode"`
	Thinking    ThinkingMode            `json:"thinking"`
}

// Name is not String on purpose: Run and VariantSummary embed Variant, and a
// promoted String method would hide their other fields in %v output.
func (v Variant) Name() string {
	return fmt.Sprintf("%s, thinking %s", v.ContextMode, v.Thinking)
}

// Run is one request for one sample and one variant.
type Run struct {
	SampleID string `json:"sampleId"`
	Variant
	LatencyMs       int64               `json:"latencyMs"`
	InputTokens     int                 `json:"inputTokens"`
	OutputTokens    int                 `json:"outputTokens"`
	ReasoningTokens int                 `json:"reasoningTokens"`
	FinishReason    string              `json:"finishReason,omitempty"`
	Result          *translation.Result `json:"result,omitempty"`
	// RequestFailed is true when there is no model answer at all.
	RequestFailed bool `json:"requestFailed,omitempty"`
	// TimedOut is true when the request hit -timeout. Its latency is the
	// timeout, so it still counts in the latency statistics.
	TimedOut bool   `json:"timedOut,omitempty"`
	Error    string `json:"error,omitempty"`
	// Content keeps the raw answer when it is not a valid result.
	Content string `json:"content,omitempty"`
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "evaluate:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	cfg, err := parseFlags(args)
	if err != nil {
		return err
	}

	apiKey, err := readAPIKey(cfg.apiKeyFile)
	if err != nil {
		return err
	}

	samples, err := loadSamples(cfg.contextsPath)
	if err != nil {
		return err
	}
	if cfg.limit > 0 && cfg.limit < len(samples) {
		samples = samples[:cfg.limit]
	}

	var variants []Variant
	for _, mode := range cfg.contextModes {
		for _, thinking := range cfg.thinkingModes {
			variants = append(variants, Variant{ContextMode: mode, Thinking: thinking})
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	client := llm.NewClient(cfg.baseURL, apiKey, &http.Client{})

	// The warm-up request opens the connection, so the first measured requests
	// do not pay for the TLS handshake. It also stops the run early when the
	// URL, the model, or the key is wrong.
	warmUp, finished := runOne(ctx, client, cfg, samples[0], variants[0])
	if !finished {
		return errors.New("interrupted during the warm-up request")
	}
	if warmUp.RequestFailed {
		return fmt.Errorf("warm-up request failed: %s", warmUp.Error)
	}

	startedAt := time.Now().UTC()
	runs := runAll(ctx, client, cfg, samples, variants)
	interrupted := ctx.Err() != nil

	report := newReport(cfg, startedAt, time.Since(startedAt), samples, variants, runs)
	report.Interrupted = interrupted
	directory := filepath.Join(cfg.outputDir, startedAt.Format("20060102-150405")+"-"+safeName(cfg.model))
	if err := report.write(directory); err != nil {
		return err
	}

	printSummary(os.Stdout, report)
	fmt.Printf("\nReport: %s\n", filepath.Join(directory, reportFileName))
	if interrupted {
		return fmt.Errorf("interrupted after %d requests; the report has only them", len(runs))
	}
	return nil
}

func parseFlags(args []string) (config, error) {
	flags := flag.NewFlagSet("evaluate", flag.ContinueOnError)
	cfg := config{}
	var contextModes, thinkingModes string

	flags.StringVar(&cfg.contextsPath, "contexts", "../eval/contexts.json", "captured samples")
	flags.StringVar(&cfg.outputDir, "out", "../eval/results", "directory for run results")
	flags.StringVar(&cfg.baseURL, "base-url", "", "OpenAI-compatible API root, for example https://host/compatible-mode/v1 (required)")
	flags.StringVar(&cfg.model, "model", "", "model name (required)")
	flags.StringVar(&cfg.apiKeyFile, "api-key-file", "", "file that contains the API key (required)")
	flags.StringVar(&contextModes, "context-modes", "sentence,block,full", "comma-separated context modes: sentence, block, full")
	flags.StringVar(&thinkingModes, "thinking", "off", "comma-separated thinking modes: off, on, default (off and on send enable_thinking; default omits it)")
	flags.IntVar(&cfg.concurrency, "concurrency", 4, "number of parallel requests")
	flags.DurationVar(&cfg.timeout, "timeout", 60*time.Second, "timeout for one request")
	flags.IntVar(&cfg.limit, "limit", 0, "use only the first N samples (0 means all)")
	flags.Float64Var(&cfg.inputPrice, "input-price", 0, "USD per 1M input tokens, for the cost estimate")
	flags.Float64Var(&cfg.outputPrice, "output-price", 0, "USD per 1M output tokens, including thinking tokens")

	if err := flags.Parse(args); err != nil {
		return config{}, err
	}
	// The flag package stops at the first argument that is not a flag, so a
	// stray argument would silently drop all flags after it.
	if flags.NArg() > 0 {
		return config{}, fmt.Errorf("unexpected argument %q: separate list values with commas, without spaces", flags.Arg(0))
	}

	switch {
	case cfg.baseURL == "":
		return config{}, errors.New("-base-url is required")
	case cfg.model == "":
		return config{}, errors.New("-model is required")
	case cfg.apiKeyFile == "":
		return config{}, errors.New("-api-key-file is required")
	case cfg.concurrency < 1:
		return config{}, errors.New("-concurrency must be at least 1")
	case cfg.timeout <= 0:
		return config{}, errors.New("-timeout must be positive")
	case cfg.inputPrice < 0 || cfg.outputPrice < 0:
		return config{}, errors.New("prices must not be negative")
	}

	for _, value := range splitList(contextModes) {
		mode, err := translation.ParseContextMode(value)
		if err != nil {
			return config{}, err
		}
		cfg.contextModes = append(cfg.contextModes, mode)
	}

	for _, value := range splitList(thinkingModes) {
		switch mode := ThinkingMode(value); mode {
		case ThinkingDefault, ThinkingOff, ThinkingOn:
			cfg.thinkingModes = append(cfg.thinkingModes, mode)
		default:
			return config{}, fmt.Errorf("unknown thinking mode %q: use off, on, or default", value)
		}
	}

	if len(cfg.contextModes) == 0 || len(cfg.thinkingModes) == 0 {
		return config{}, errors.New("-context-modes and -thinking must not be empty")
	}

	return cfg, nil
}

func splitList(value string) []string {
	var items []string
	for item := range strings.SplitSeq(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			items = append(items, item)
		}
	}
	return items
}

func readAPIKey(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read API key: %w", err)
	}
	key := strings.TrimSpace(string(data))
	if key == "" {
		return "", fmt.Errorf("API key file %s is empty", path)
	}
	return key, nil
}

func loadSamples(path string) ([]Sample, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read samples: %w", err)
	}

	var samples []Sample
	if err := json.Unmarshal(data, &samples); err != nil {
		return nil, fmt.Errorf("decode samples: %w", err)
	}
	if len(samples) == 0 {
		return nil, fmt.Errorf("%s has no samples", path)
	}

	// Decoding has already validated each DetectionContext.
	for _, sample := range samples {
		if word := sample.Context.Word(); word != sample.Word {
			return nil, fmt.Errorf("sample %s: the context word is %q, not %q", sample.ID, word, sample.Word)
		}
	}

	return samples, nil
}

type job struct {
	index   int
	sample  Sample
	variant Variant
}

func runAll(ctx context.Context, client *llm.Client, cfg config, samples []Sample, variants []Variant) []Run {
	jobs := make(chan job)
	runs := make([]Run, len(samples)*len(variants))
	finished := make([]bool, len(runs))
	var done atomic.Int64
	var wg sync.WaitGroup

	for range cfg.concurrency {
		wg.Go(func() {
			for next := range jobs {
				runs[next.index], finished[next.index] = runOne(ctx, client, cfg, next.sample, next.variant)
				fmt.Fprintf(os.Stderr, "\r%d/%d requests", done.Add(1), len(runs))
			}
		})
	}

	index := 0
send:
	for _, sample := range samples {
		for _, variant := range variants {
			select {
			case jobs <- job{index: index, sample: sample, variant: variant}:
				index++
			case <-ctx.Done():
				break send
			}
		}
	}
	close(jobs)
	wg.Wait()
	fmt.Fprintln(os.Stderr)

	completed := make([]Run, 0, index)
	for i := range index {
		if finished[i] {
			completed = append(completed, runs[i])
		}
	}
	return completed
}

// runOne sends one request. It returns false when the run was interrupted, so
// the result says nothing about the model.
func runOne(ctx context.Context, client *llm.Client, cfg config, sample Sample, variant Variant) (Run, bool) {
	result := Run{SampleID: sample.ID, Variant: variant}

	prompt, err := translation.BuildPrompt(sample.Context, variant.ContextMode)
	if err != nil {
		result.RequestFailed = true
		result.Error = err.Error()
		return result, true
	}

	request := llm.ChatRequest{
		Model: cfg.model,
		Messages: []llm.Message{
			{Role: "system", Content: prompt.System},
			{Role: "user", Content: prompt.User},
		},
		ResponseFormat: &llm.ResponseFormat{
			Type: "json_schema",
			JSONSchema: &llm.JSONSchemaFormat{
				Name:   "translation",
				Strict: true,
				Schema: translation.ResultSchema(),
			},
		},
		MaxTokens:      maxAnswerTokens,
		EnableThinking: variant.Thinking.enableThinking(),
	}

	requestCtx, cancel := context.WithTimeout(ctx, cfg.timeout)
	defer cancel()

	start := time.Now()
	response, err := client.Complete(requestCtx, request)
	result.LatencyMs = time.Since(start).Milliseconds()
	if err != nil {
		if ctx.Err() != nil {
			return result, false
		}
		result.RequestFailed = true
		result.TimedOut = errors.Is(err, context.DeadlineExceeded)
		result.Error = err.Error()
		return result, true
	}

	result.InputTokens = response.Usage.PromptTokens
	result.OutputTokens = response.Usage.CompletionTokens
	result.ReasoningTokens = response.Usage.ReasoningTokens()
	result.FinishReason = response.FinishReason

	parsed, err := translation.ParseResult(response.Content)
	if err != nil {
		result.Error = err.Error()
		result.Content = response.Content
		return result, true
	}
	result.Result = &parsed
	return result, true
}

var unsafeNameCharacters = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func safeName(value string) string {
	return unsafeNameCharacters.ReplaceAllString(value, "-")
}
