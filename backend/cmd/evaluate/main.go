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
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/sklyar/tap-translate/backend/internal/llm"
	"github.com/sklyar/tap-translate/backend/internal/translation"
)

const (
	// _maxAnswerTokens limits the answer length. Qwen does not count thinking
	// tokens against this limit.
	_maxAnswerTokens = 500
	// _warmUpMaxTokens limits the answer to the warm-up request.
	_warmUpMaxTokens = 5

	_defaultConcurrency = 4
	_defaultTimeout     = time.Minute
)

var _unsafeNameCharacters = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

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
	case ThinkingDefault:
		return nil
	}
	return nil
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
	Variant

	SampleID        string              `json:"sampleId"`
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

type job struct {
	index   int
	sample  Sample
	variant Variant
}

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "evaluate:", err)
		os.Exit(1)
	}
}

func run(args []string, stdout, stderr io.Writer) error {
	cfg, err := parseFlags(args, stderr)
	if errors.Is(err, flag.ErrHelp) {
		return nil
	}
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

	variants := make([]Variant, 0, len(cfg.contextModes)*len(cfg.thinkingModes))
	for _, mode := range cfg.contextModes {
		for _, thinking := range cfg.thinkingModes {
			variants = append(variants, Variant{ContextMode: mode, Thinking: thinking})
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	// Create the run directory before any paid request, so that a bad -out
	// path stops the run at once.
	directoryName := time.Now().UTC().Format("20060102-150405") + "-" + safeName(cfg.model)
	directory, err := createRunDirectory(cfg.outputDir, directoryName)
	if err != nil {
		return err
	}
	written := false
	defer func() {
		if !written {
			// Remove removes only an empty directory.
			_ = os.Remove(directory)
		}
	}()

	client := llm.NewClient(cfg.baseURL, apiKey, &http.Client{})
	err = warmUp(ctx, client, cfg, variants[0].Thinking)
	if err != nil {
		return err
	}

	startedAt := time.Now().UTC()
	runs := runAll(ctx, client, cfg, samples, variants, stderr)
	interrupted := ctx.Err() != nil

	report := newReport(cfg, startedAt, time.Since(startedAt), samples, variants, runs)
	report.Interrupted = interrupted
	err = report.write(directory)
	if err != nil {
		return err
	}
	written = true

	err = printSummary(stdout, report)
	if err != nil {
		return err
	}
	fmt.Fprintf(stdout, "\nReport: %s\n", filepath.Join(directory, _reportFileName))
	if interrupted {
		return fmt.Errorf("interrupted after %d requests; the report has only them", len(runs))
	}
	return nil
}

func parseFlags(args []string, output io.Writer) (config, error) {
	flags := flag.NewFlagSet("evaluate", flag.ContinueOnError)
	flags.SetOutput(output)
	cfg := config{}
	var contextModes, thinkingModes string

	flags.StringVar(&cfg.contextsPath, "contexts", "../eval/contexts.json", "captured samples")
	flags.StringVar(&cfg.outputDir, "out", "../eval/results", "directory for run results")
	flags.StringVar(
		&cfg.baseURL,
		"base-url",
		"",
		"OpenAI-compatible API root, for example https://host/compatible-mode/v1 (required)",
	)
	flags.StringVar(&cfg.model, "model", "", "model name (required)")
	flags.StringVar(
		&cfg.apiKeyFile,
		"api-key-file",
		"",
		"file that contains the API key (required)",
	)
	flags.StringVar(
		&contextModes,
		"context-modes",
		"sentence,block,full",
		"comma-separated context modes: sentence, block, full",
	)
	flags.StringVar(
		&thinkingModes,
		"thinking",
		"off",
		"comma-separated thinking modes: off, on, default "+
			"(off and on send enable_thinking; default omits it)",
	)
	flags.IntVar(
		&cfg.concurrency,
		"concurrency",
		_defaultConcurrency,
		"number of parallel requests",
	)
	flags.DurationVar(&cfg.timeout, "timeout", _defaultTimeout, "timeout for one request")
	flags.IntVar(&cfg.limit, "limit", 0, "use only the first N samples (0 means all)")
	flags.Float64Var(
		&cfg.inputPrice,
		"input-price",
		0,
		"USD per 1M input tokens, for the cost estimate",
	)
	flags.Float64Var(
		&cfg.outputPrice,
		"output-price",
		0,
		"USD per 1M output tokens, including thinking tokens",
	)

	if err := flags.Parse(args); err != nil {
		return config{}, fmt.Errorf("parse flags: %w", err)
	}
	// The flag package stops at the first argument that is not a flag, so a
	// stray argument would silently drop all flags after it.
	if flags.NArg() > 0 {
		return config{}, fmt.Errorf(
			"unexpected argument %q: separate list values with commas, without spaces",
			flags.Arg(0),
		)
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

	var err error
	cfg.contextModes, err = parseContextModes(contextModes)
	if err != nil {
		return config{}, err
	}
	cfg.thinkingModes, err = parseThinkingModes(thinkingModes)
	if err != nil {
		return config{}, err
	}

	return cfg, nil
}

func parseContextModes(value string) ([]translation.ContextMode, error) {
	items := splitList(value)
	modes := make([]translation.ContextMode, 0, len(items))
	for _, item := range items {
		mode, err := translation.ParseContextMode(item)
		if err != nil {
			return nil, err
		}
		if slices.Contains(modes, mode) {
			return nil, fmt.Errorf("-context-modes has %q twice", item)
		}
		modes = append(modes, mode)
	}
	if len(modes) == 0 {
		return nil, errors.New("-context-modes must not be empty")
	}
	return modes, nil
}

func parseThinkingModes(value string) ([]ThinkingMode, error) {
	items := splitList(value)
	modes := make([]ThinkingMode, 0, len(items))
	for _, item := range items {
		mode := ThinkingMode(item)
		switch mode {
		case ThinkingDefault, ThinkingOff, ThinkingOn:
		default:
			return nil, fmt.Errorf("unknown thinking mode %q: use off, on, or default", item)
		}
		if slices.Contains(modes, mode) {
			return nil, fmt.Errorf("-thinking has %q twice", item)
		}
		modes = append(modes, mode)
	}
	if len(modes) == 0 {
		return nil, errors.New("-thinking must not be empty")
	}
	return modes, nil
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
	err = json.Unmarshal(data, &samples)
	if err != nil {
		return nil, fmt.Errorf("decode samples: %w", err)
	}
	if len(samples) == 0 {
		return nil, fmt.Errorf("%s has no samples", path)
	}

	for _, sample := range samples {
		// Decoding validates each context, but a missing "context" field is
		// not decoded and stays empty.
		err = sample.Context.Validate()
		if err != nil {
			return nil, fmt.Errorf("sample %s: %w", sample.ID, err)
		}
		if word := sample.Context.Word(); word != sample.Word {
			return nil, fmt.Errorf(
				"sample %s: the context word is %q, not %q",
				sample.ID,
				word,
				sample.Word,
			)
		}
	}

	return samples, nil
}

// warmUp sends one short request. It opens the connection, so the first
// measured requests do not pay for the TLS handshake, and it stops the run
// early when the URL, the model, or the key is wrong. Its prompt is not a
// sample prompt, so it cannot warm a provider prompt cache for a measured
// request.
func warmUp(ctx context.Context, client *llm.Client, cfg config, thinking ThinkingMode) error {
	requestCtx, cancel := context.WithTimeout(ctx, cfg.timeout)
	defer cancel()

	_, err := client.Complete(requestCtx, llm.ChatRequest{
		Model:          cfg.model,
		Messages:       []llm.Message{{Role: "user", Content: "Reply with OK."}},
		MaxTokens:      _warmUpMaxTokens,
		EnableThinking: thinking.enableThinking(),
	})
	if err != nil {
		return fmt.Errorf("warm-up request: %w", err)
	}
	return nil
}

// createRunDirectory creates a new directory for one run. It fails when the
// directory exists, so a run never overwrites another.
func createRunDirectory(outputDir, name string) (string, error) {
	err := os.MkdirAll(outputDir, 0o750)
	if err != nil {
		return "", fmt.Errorf("create output directory: %w", err)
	}
	directory := filepath.Join(outputDir, name)
	err = os.Mkdir(directory, 0o750)
	if err != nil {
		return "", fmt.Errorf("create run directory: %w", err)
	}
	return directory, nil
}

// runAll runs every sample with every variant and writes the progress to
// progress. After an interrupt it returns only the finished runs.
func runAll(
	ctx context.Context,
	client *llm.Client,
	cfg config,
	samples []Sample,
	variants []Variant,
	progress io.Writer,
) []Run {
	jobs := make(chan job)
	runs := make([]Run, len(samples)*len(variants))
	finished := make([]bool, len(runs))
	var done atomic.Int64
	var wg sync.WaitGroup

	for range cfg.concurrency {
		wg.Go(func() {
			for next := range jobs {
				runs[next.index], finished[next.index] = runOne(
					ctx,
					client,
					cfg,
					next.sample,
					next.variant,
				)
				fmt.Fprintf(progress, "\r%d/%d requests", done.Add(1), len(runs))
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
	fmt.Fprintln(progress)

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
func runOne(
	ctx context.Context,
	client *llm.Client,
	cfg config,
	sample Sample,
	variant Variant,
) (Run, bool) {
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
		MaxTokens:      _maxAnswerTokens,
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

func safeName(value string) string {
	return _unsafeNameCharacters.ReplaceAllString(value, "-")
}
