package translation

import (
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
		{"missing explanation", `{` + valid + `}`, "explanation is empty"},
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

func TestResultSchemaRequiresAllFields(t *testing.T) {
	schema := ResultSchema()
	required, ok := schema["required"].([]string)
	if !ok || len(required) != 4 {
		t.Fatalf("ResultSchema() required = %v", schema["required"])
	}

	properties, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("ResultSchema() properties = %v", schema["properties"])
	}
	for _, name := range required {
		if _, ok := properties[name]; !ok {
			t.Errorf("ResultSchema() has no property %q", name)
		}
	}
}
