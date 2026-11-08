package main

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"math"
	"os"
	"path/filepath"
	"slices"
	"text/tabwriter"
	"time"

	"github.com/sklyar/tap-translate/backend/internal/translation"
)

const (
	_resultsFileName = "results.json"
	_reportFileName  = "report.html"

	// The summary gives the median and the 95th percentile of the latency.
	_p50 = 50
	_p95 = 95

	// The cost estimate is for _costRequests requests. Prices are per
	// _pricedTokens tokens.
	_costRequests = 1000
	_pricedTokens = 1_000_000

	_summaryColumnPadding = 2
)

//go:embed report.html.tmpl
var _reportTemplateText string

type Report struct {
	Model     string    `json:"model"`
	StartedAt time.Time `json:"startedAt"`
	// Interrupted is true when the run was stopped before all requests.
	Interrupted  bool             `json:"interrupted,omitempty"`
	DurationMs   int64            `json:"durationMs"`
	InputPrice   float64          `json:"inputPricePerMillion"`
	OutputPrice  float64          `json:"outputPricePerMillion"`
	SystemPrompt string           `json:"systemPrompt"`
	Summaries    []VariantSummary `json:"summaries"`
	Samples      []Sample         `json:"samples"`
	Runs         []Run            `json:"runs"`
}

type VariantSummary struct {
	Variant

	Requests int `json:"requests"`
	Valid    int `json:"valid"`
	// Failed counts requests without a model answer: HTTP and network errors
	// and timeouts. They are not model quality failures.
	Failed           int     `json:"failed"`
	LatencyP50Ms     int64   `json:"latencyP50Ms"`
	LatencyP95Ms     int64   `json:"latencyP95Ms"`
	LatencyMaxMs     int64   `json:"latencyMaxMs"`
	MeanInputTokens  float64 `json:"meanInputTokens"`
	MeanOutputTokens float64 `json:"meanOutputTokens"`
	// CostPer1000 is the estimated cost of 1,000 requests in USD. It is zero
	// when no prices are given.
	CostPer1000 float64 `json:"costPer1000"`
}

type reportView struct {
	Report

	HasPrices bool
	Started   string
	Duration  string
	Samples   []sampleView
}

type sampleView struct {
	Sample

	Sentence translation.FocusParts
	Runs     []Run
}

func newReport(
	cfg config,
	startedAt time.Time,
	duration time.Duration,
	samples []Sample,
	variants []Variant,
	runs []Run,
) Report {
	report := Report{
		Model:        cfg.model,
		StartedAt:    startedAt,
		DurationMs:   duration.Milliseconds(),
		InputPrice:   cfg.inputPrice,
		OutputPrice:  cfg.outputPrice,
		SystemPrompt: translation.SystemPrompt(),
		Samples:      samples,
		Runs:         runs,
	}

	for _, variant := range variants {
		var variantRuns []Run
		for _, run := range runs {
			if run.Variant == variant {
				variantRuns = append(variantRuns, run)
			}
		}
		report.Summaries = append(
			report.Summaries,
			summarize(variant, variantRuns, cfg.inputPrice, cfg.outputPrice),
		)
	}

	return report
}

// write writes the results and the report into an existing run directory.
func (r Report) write(directory string) error {
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return fmt.Errorf("encode results: %w", err)
	}
	err = writeRunFile(directory, _resultsFileName, append(data, '\n'))
	if err != nil {
		return err
	}

	reportTemplate, err := newReportTemplate()
	if err != nil {
		return err
	}
	var page bytes.Buffer
	err = reportTemplate.Execute(&page, r.view())
	if err != nil {
		return fmt.Errorf("render report: %w", err)
	}
	return writeRunFile(directory, _reportFileName, page.Bytes())
}

func (r Report) view() reportView {
	view := reportView{
		Report:    r,
		HasPrices: r.InputPrice > 0 || r.OutputPrice > 0,
		Started:   r.StartedAt.Format("2006-01-02 15:04 UTC"),
		Duration:  (time.Duration(r.DurationMs) * time.Millisecond).Round(time.Second).String(),
	}

	runsBySample := make(map[string][]Run)
	for _, run := range r.Runs {
		runsBySample[run.SampleID] = append(runsBySample[run.SampleID], run)
	}

	for _, sample := range r.Samples {
		view.Samples = append(view.Samples, sampleView{
			Sample:   sample,
			Sentence: sample.Context.SentenceParts(),
			Runs:     runsBySample[sample.ID],
		})
	}

	return view
}

func summarize(variant Variant, runs []Run, inputPrice, outputPrice float64) VariantSummary {
	summary := VariantSummary{Variant: variant, Requests: len(runs)}

	var latencies []int64
	var answered, inputTokens, outputTokens int
	for _, run := range runs {
		if run.Result != nil {
			summary.Valid++
		}
		if run.RequestFailed {
			summary.Failed++
		}
		// A timeout is a real latency. A fast HTTP or network error is not.
		if !run.RequestFailed || run.TimedOut {
			latencies = append(latencies, run.LatencyMs)
		}
		if !run.RequestFailed {
			answered++
			inputTokens += run.InputTokens
			outputTokens += run.OutputTokens
		}
	}

	if len(latencies) > 0 {
		slices.Sort(latencies)
		summary.LatencyP50Ms = percentile(latencies, _p50)
		summary.LatencyP95Ms = percentile(latencies, _p95)
		summary.LatencyMaxMs = latencies[len(latencies)-1]
	}

	if answered > 0 {
		summary.MeanInputTokens = float64(inputTokens) / float64(answered)
		summary.MeanOutputTokens = float64(outputTokens) / float64(answered)
		tokenCost := summary.MeanInputTokens*inputPrice + summary.MeanOutputTokens*outputPrice
		summary.CostPer1000 = _costRequests * tokenCost / _pricedTokens
	}

	return summary
}

// percentile uses the nearest-rank method. sorted must be in ascending order
// and not empty.
func percentile(sorted []int64, p float64) int64 {
	rank := int(math.Ceil(p / 100 * float64(len(sorted))))
	return sorted[min(max(rank, 1), len(sorted))-1]
}

func printSummary(output io.Writer, r Report) error {
	writer := tabwriter.NewWriter(output, 0, 0, _summaryColumnPadding, ' ', tabwriter.AlignRight)
	fmt.Fprintln(
		writer,
		"variant\tvalid\tfailed\tp50 ms\tp95 ms\tmax ms\tin tokens\tout tokens\t$ / 1000\t",
	)
	for _, s := range r.Summaries {
		fmt.Fprintf(
			writer,
			"%s\t%d/%d\t%d\t%d\t%d\t%d\t%.0f\t%.0f\t%.4f\t\n",
			s.Name(),
			s.Valid,
			s.Requests,
			s.Failed,
			s.LatencyP50Ms,
			s.LatencyP95Ms,
			s.LatencyMaxMs,
			s.MeanInputTokens,
			s.MeanOutputTokens,
			s.CostPer1000,
		)
	}
	err := writer.Flush()
	if err != nil {
		return fmt.Errorf("print summary: %w", err)
	}
	if r.Interrupted {
		fmt.Fprintln(
			output,
			"The run was interrupted; the numbers cover only the finished requests.",
		)
	}
	return nil
}

func newReportTemplate() (*template.Template, error) {
	reportTemplate, err := template.New("report").Funcs(template.FuncMap{
		"usd": func(value float64) string { return fmt.Sprintf("$%.4f", value) },
		"one": func(value float64) string { return fmt.Sprintf("%.0f", value) },
	}).Parse(_reportTemplateText)
	if err != nil {
		return nil, fmt.Errorf("parse report template: %w", err)
	}
	return reportTemplate, nil
}

// writeRunFile writes one file into the run directory. Only the owner can
// read it: the results contain the page text of the samples.
func writeRunFile(directory, name string, data []byte) error {
	path := filepath.Join(directory, name)
	err := os.WriteFile(path, data, 0o600)
	if err != nil {
		return fmt.Errorf("write %s: %w", name, err)
	}
	return nil
}
