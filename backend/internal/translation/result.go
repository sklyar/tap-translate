package translation

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
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

// Length limits in characters. They keep a broken answer out of the sheet.
const (
	_maxExpressionLength  = 100
	_maxTranslationLength = 100
	_maxExplanationLength = 500
)

const _jsonTypeString = "string"

// PartsOfSpeech returns the allowed partOfSpeech values.
func PartsOfSpeech() []string {
	return []string{
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
}

// ParseResult decodes and validates the model answer. The answer must be one
// JSON object with exactly the Result fields. encoding/json matches field
// names without case and accepts some trailing data, so the object is
// decoded into a map first.
func ParseResult(content string) (Result, error) {
	decoder := json.NewDecoder(strings.NewReader(content))

	var fields map[string]json.RawMessage
	if err := decoder.Decode(&fields); err != nil {
		return Result{}, fmt.Errorf("decode answer: %w", err)
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return Result{}, errors.New("decode answer: unexpected data after the JSON object")
	}

	names := resultFields()
	for name := range fields {
		if !slices.Contains(names, name) {
			return Result{}, fmt.Errorf("decode answer: unknown field %q", name)
		}
	}

	values := make(map[string]string, len(names))
	for _, name := range names {
		raw, ok := fields[name]
		if !ok {
			return Result{}, fmt.Errorf("%s is missing", name)
		}
		var value string
		if err := json.Unmarshal(raw, &value); err != nil {
			return Result{}, fmt.Errorf("%s is not a string", name)
		}
		values[name] = strings.TrimSpace(value)
	}

	result := Result{
		Expression:   values["expression"],
		Translation:  values["translation"],
		PartOfSpeech: values["partOfSpeech"],
		Explanation:  values["explanation"],
	}

	if err := checkField("expression", result.Expression, _maxExpressionLength); err != nil {
		return Result{}, err
	}
	if err := checkField("translation", result.Translation, _maxTranslationLength); err != nil {
		return Result{}, err
	}
	if err := checkField("explanation", result.Explanation, _maxExplanationLength); err != nil {
		return Result{}, err
	}
	if !slices.Contains(PartsOfSpeech(), result.PartOfSpeech) {
		return Result{}, fmt.Errorf("partOfSpeech %q is not an allowed value", result.PartOfSpeech)
	}

	return result, nil
}

// Schema is a JSON Schema of an object. It is a struct, not a map, because
// the order of the properties matters: the model writes the fields in this
// order. A map would sort them by name and put the explanation first, before
// the model has chosen the expression. With that order the model often left
// the explanation empty.
type Schema struct {
	Type                 string           `json:"type"`
	AdditionalProperties bool             `json:"additionalProperties"`
	Required             []string         `json:"required"`
	Properties           ResultProperties `json:"properties"`
}

// ResultProperties are the properties of the Result schema, in the order in
// which the model writes them.
type ResultProperties struct {
	Expression   SchemaProperty `json:"expression"`
	PartOfSpeech SchemaProperty `json:"partOfSpeech"`
	Translation  SchemaProperty `json:"translation"`
	Explanation  SchemaProperty `json:"explanation"`
}

// SchemaProperty is the JSON Schema of one property.
type SchemaProperty struct {
	Type string   `json:"type"`
	Enum []string `json:"enum,omitempty"`
}

// ResultSchema returns the JSON Schema for a structured output request. It
// has no length limits: Qwen ignores minLength, and strict mode of other
// providers can reject it. ParseResult checks the lengths.
func ResultSchema() Schema {
	return Schema{
		Type:     "object",
		Required: resultFields(),
		Properties: ResultProperties{
			Expression:   SchemaProperty{Type: _jsonTypeString},
			PartOfSpeech: SchemaProperty{Type: _jsonTypeString, Enum: PartsOfSpeech()},
			Translation:  SchemaProperty{Type: _jsonTypeString},
			Explanation:  SchemaProperty{Type: _jsonTypeString},
		},
	}
}

// resultFields returns the JSON names of the Result fields in the schema
// order.
func resultFields() []string {
	return []string{"expression", "partOfSpeech", "translation", "explanation"}
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
