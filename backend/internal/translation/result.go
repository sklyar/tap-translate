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

// resultFields are the JSON names of the Result fields.
var resultFields = []string{"expression", "partOfSpeech", "translation", "explanation"}

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

	for name := range fields {
		if !slices.Contains(resultFields, name) {
			return Result{}, fmt.Errorf("decode answer: unknown field %q", name)
		}
	}

	values := make(map[string]string, len(resultFields))
	for _, name := range resultFields {
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

type schemaProperty struct {
	Type string   `json:"type"`
	Enum []string `json:"enum,omitempty"`
}

// resultSchema is a struct, not a map, because the order of the properties
// matters: the model writes the fields in this order. A map would sort them
// by name and put the explanation first, before the model has chosen the
// expression. With that order the model often left the explanation empty.
type resultSchema struct {
	Type                 string   `json:"type"`
	AdditionalProperties bool     `json:"additionalProperties"`
	Required             []string `json:"required"`
	Properties           struct {
		Expression   schemaProperty `json:"expression"`
		PartOfSpeech schemaProperty `json:"partOfSpeech"`
		Translation  schemaProperty `json:"translation"`
		Explanation  schemaProperty `json:"explanation"`
	} `json:"properties"`
}

// ResultSchema returns the JSON Schema for a structured output request. It
// has no length limits: Qwen ignores minLength, and strict mode of other
// providers can reject it. ParseResult checks the lengths.
func ResultSchema() json.RawMessage {
	schema := resultSchema{Type: "object", Required: resultFields}
	schema.Properties.Expression = schemaProperty{Type: "string"}
	schema.Properties.PartOfSpeech = schemaProperty{Type: "string", Enum: PartsOfSpeech}
	schema.Properties.Translation = schemaProperty{Type: "string"}
	schema.Properties.Explanation = schemaProperty{Type: "string"}

	data, err := json.Marshal(schema)
	if err != nil {
		panic(fmt.Sprintf("encode result schema: %v", err))
	}
	return data
}
