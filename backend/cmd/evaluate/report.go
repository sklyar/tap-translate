package main

import (
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
	resultsFileName = "results.json"
	reportFileName  = "report.html"
)

//go:embed report.html.tmpl
var reportTemplateText string

var reportTemplate = template.Must(template.New("report").Funcs(template.FuncMap{
	"usd": func(value float64) string { return fmt.Sprintf("$%.4f", value) },
	"one": func(value float64) string { return fmt.Sprintf("%.0f", value) },
}).Parse(reportTemplateText))

type Report struct {
	Model        string           `json:"model"`
	StartedAt    time.Time        `json:"startedAt"`
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
	Name             string  `json:"name"`
	Requests         int     `json:"requests"`
	Valid            int     `json:"valid"`
	LatencyP50Ms     int64   `json:"latencyP50Ms"`
	LatencyP95Ms     int64   `json:"latencyP95Ms"`
	LatencyMaxMs     int64   `json:"latencyMaxMs"`
	MeanInputTokens  float64 `json:"meanInputTokens"`
	MeanOutputTokens float64 `json:"meanOutputTokens"`
	// CostPer1000 is the estimated cost of 1,000 requests in USD. It is zero
	// when no prices are given.
	CostPer1000 float64 `json:"costPer1000"`
}

func newReport(cfg config, startedAt time.Time, duration time.Duration, samples []Sample, variants []Variant, runs []Run) Report {
	report := Report{
		Model:        cfg.model,
		StartedAt:    startedAt,
		DurationMs:   duration.Milliseconds(),
		InputPrice:   cfg.inputPrice,
		OutputPrice:  cfg.outputPrice,
		SystemPrompt: translation.SystemPrompt,
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
		report.Summaries = append(report.Summaries, summarize(variant, variantRuns, cfg.inputPrice, cfg.outputPrice))
	}

	return report
}

func summarize(variant Variant, runs []Run, inputPrice, outputPrice float64) VariantSummary {
	summary := VariantSummary{Variant: variant, Name: variant.String(), Requests: len(runs)}

	var latencies []int64
	var inputTokens, outputTokens int
	for _, run := range runs {
		if run.Result != nil {
			summary.Valid++
		}
		if run.RequestFailed {
			continue
		}
		latencies = append(latencies, run.LatencyMs)
		inputTokens += run.InputTokens
		outputTokens += run.OutputTokens
	}

	if len(latencies) == 0 {
		return summary
	}

	slices.Sort(latencies)
	summary.LatencyP50Ms = percentile(latencies, 50)
	summary.LatencyP95Ms = percentile(latencies, 95)
	summary.LatencyMaxMs = latencies[len(latencies)-1]
	summary.MeanInputTokens = float64(inputTokens) / float64(len(latencies))
	summary.MeanOutputTokens = float64(outputTokens) / float64(len(latencies))
	summary.CostPer1000 = 1000 * (summary.MeanInputTokens*inputPrice + summary.MeanOutputTokens*outputPrice) / 1_000_000

	return summary
}

// percentile uses the nearest-rank method. sorted must be in ascending order
// and not empty.
func percentile(sorted []int64, p float64) int64 {
	rank := int(math.Ceil(p / 100 * float64(len(sorted))))
	return sorted[min(max(rank, 1), len(sorted))-1]
}

func (r Report) write(directory string) error {
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}

	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return fmt.Errorf("encode results: %w", err)
	}
	if err := os.WriteFile(filepath.Join(directory, resultsFileName), append(data, '\n'), 0o644); err != nil {
		return fmt.Errorf("write results: %w", err)
	}

	file, err := os.Create(filepath.Join(directory, reportFileName))
	if err != nil {
		return fmt.Errorf("create report: %w", err)
	}
	defer file.Close()

	if err := reportTemplate.Execute(file, r.view()); err != nil {
		return fmt.Errorf("render report: %w", err)
	}
	return file.Close()
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

func printSummary(output io.Writer, r Report) {
	writer := tabwriter.NewWriter(output, 0, 0, 2, ' ', tabwriter.AlignRight)
	fmt.Fprintln(writer, "variant\tvalid\tp50 ms\tp95 ms\tmax ms\tin tokens\tout tokens\t$ / 1000\t")
	for _, s := range r.Summaries {
		fmt.Fprintf(writer, "%s\t%d/%d\t%d\t%d\t%d\t%.0f\t%.0f\t%.4f\t\n",
			s.Name, s.Valid, s.Requests, s.LatencyP50Ms, s.LatencyP95Ms, s.LatencyMaxMs,
			s.MeanInputTokens, s.MeanOutputTokens, s.CostPer1000)
	}
	writer.Flush()
}
