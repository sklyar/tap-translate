package translation

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseResult(t *testing.T) {
	content := `{
		"expression": " make out ",
		"partOfSpeech": "phrasal verb",
		"translation": "понять, разобрать",
		"explanation": "Здесь — понять по имеющимся фактам."
	}`

	result, err := ParseResult(content)
	if err != nil {
		t.Fatalf("ParseResult() error = %v", err)
	}

	want := Result{
		Expression:   "make out",
		PartOfSpeech: "phrasal verb",
		Translation:  "понять, разобрать",
		Explanation:  "Здесь — понять по имеющимся фактам.",
	}
	if result != want {
		t.Errorf("ParseResult() = %+v, want %+v", result, want)
	}
}

func TestParseResultRejectsInvalidAnswers(t *testing.T) {
	valid := `"expression": "bank", "partOfSpeech": "noun", "translation": "берег"`
	tests := []struct {
		name    string
		content string
		want    string
	}{
		{"not JSON", `берег`, "decode answer"},
		{"unknown field", `{` + valid + `, "explanation": "x", "note": "y"}`, "unknown field"},
		{"trailing data", `{` + valid + `, "explanation": "x"} {}`, "unexpected data"},
		{"empty explanation", `{` + valid + `, "explanation": "  "}`, "explanation is empty"},
		{"missing explanation", `{` + valid + `}`, "explanation is missing"},
		{"extra closing brace", `{` + valid + `, "explanation": "x"}}`, "unexpected data"},
		{"extra closing bracket", `{` + valid + `, "explanation": "x"}]`, "unexpected data"},
		{"field name in another case", `{` + valid + `, "Explanation": "x"}`, "unknown field"},
		{"not a string", `{` + valid + `, "explanation": 42}`, "explanation is not a string"},
		{"null", `null`, "expression is missing"},
		{
			"unknown part of speech",
			`{"expression": "bank", "partOfSpeech": "существительное", "translation": "берег", "explanation": "x"}`,
			"partOfSpeech",
		},
		{
			"long explanation",
			`{` + valid + `, "explanation": "` + strings.Repeat("я", maxExplanationLength+1) + `"}`,
			"the limit is",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ParseResult(test.content)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Errorf("ParseResult() error = %v, want an error with %q", err, test.want)
			}
		})
	}
}

func TestResultSchema(t *testing.T) {
	data := ResultSchema()

	var schema struct {
		Required   []string                   `json:"required"`
		Properties map[string]json.RawMessage `json:"properties"`
	}
	if err := json.Unmarshal(data, &schema); err != nil {
		t.Fatalf("ResultSchema() is not valid JSON: %v", err)
	}
	if strings.Join(schema.Required, ",") != "expression,partOfSpeech,translation,explanation" {
		t.Errorf("ResultSchema() required = %v", schema.Required)
	}
	if len(schema.Properties) != 4 {
		t.Errorf("ResultSchema() has %d properties, want 4", len(schema.Properties))
	}
	if !strings.Contains(string(schema.Properties["partOfSpeech"]), `"phrasal verb"`) {
		t.Errorf("ResultSchema() partOfSpeech = %s, want the allowed values", schema.Properties["partOfSpeech"])
	}

	// The model writes the fields in schema order, so the explanation must be
	// the last property.
	properties := string(data[strings.Index(string(data), `"properties"`):])
	previous := -1
	for _, name := range resultFields {
		index := strings.Index(properties, `"`+name+`"`)
		if index <= previous {
			t.Fatalf("ResultSchema() properties are not in the order %v: %s", resultFields, properties)
		}
		previous = index
	}
}
