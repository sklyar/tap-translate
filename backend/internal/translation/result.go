package translation

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"
)

// Result mirrors TranslationResult in extension/src/translation.ts.
type Result struct {
	Expression   string `json:"expression"`
	Translation  string `json:"translation"`
	PartOfSpeech string `json:"partOfSpeech"`
	Explanation  string `json:"explanation"`
}

// PartsOfSpeech lists the allowed partOfSpeech values.
var PartsOfSpeech = []string{
	"noun",
	"verb",
	"adjective",
	"adverb",
	"pronoun",
	"preposition",
	"conjunction",
	"interjection",
	"numeral",
	"phrasal verb",
	"idiom",
	"phrase",
	"proper noun",
	"abbreviation",
}

// Length limits in characters. They keep a broken answer out of the sheet.
const (
	maxExpressionLength  = 100
	maxTranslationLength = 100
	maxExplanationLength = 500
)

// ParseResult decodes and validates the model answer.
func ParseResult(content string) (Result, error) {
	decoder := json.NewDecoder(bytes.NewReader([]byte(content)))
	decoder.DisallowUnknownFields()

	var result Result
	if err := decoder.Decode(&result); err != nil {
		return Result{}, fmt.Errorf("decode answer: %w", err)
	}
	if decoder.More() {
		return Result{}, errors.New("decode answer: unexpected data after the JSON object")
	}

	result.Expression = strings.TrimSpace(result.Expression)
	result.Translation = strings.TrimSpace(result.Translation)
	result.PartOfSpeech = strings.TrimSpace(result.PartOfSpeech)
	result.Explanation = strings.TrimSpace(result.Explanation)

	if err := checkField("expression", result.Expression, maxExpressionLength); err != nil {
		return Result{}, err
	}
	if err := checkField("translation", result.Translation, maxTranslationLength); err != nil {
		return Result{}, err
	}
	if err := checkField("explanation", result.Explanation, maxExplanationLength); err != nil {
		return Result{}, err
	}
	if !slices.Contains(PartsOfSpeech, result.PartOfSpeech) {
		return Result{}, fmt.Errorf("partOfSpeech %q is not an allowed value", result.PartOfSpeech)
	}

	return result, nil
}

func checkField(name, value string, maxLength int) error {
	if value == "" {
		return fmt.Errorf("%s is empty", name)
	}
	if length := utf8.RuneCountInString(value); length > maxLength {
		return fmt.Errorf("%s has %d characters, the limit is %d", name, length, maxLength)
	}
	return nil
}

// ResultSchema returns the JSON Schema for a structured output request.
func ResultSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []string{"expression", "partOfSpeech", "translation", "explanation"},
		"properties": map[string]any{
			"expression":   map[string]any{"type": "string", "minLength": 1},
			"partOfSpeech": map[string]any{"type": "string", "enum": PartsOfSpeech},
			"translation":  map[string]any{"type": "string", "minLength": 1},
			"explanation":  map[string]any{"type": "string", "minLength": 1},
		},
	}
}
