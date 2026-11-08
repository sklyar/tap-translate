package translation_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/sklyar/tap-translate/backend/internal/translation"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseResult(t *testing.T) {
	t.Parallel()
	content := `{
		"expression": " make out ",
		"partOfSpeech": "phrasal verb",
		"translation": "понять, разобрать",
		"explanation": "Здесь — понять по имеющимся фактам."
	}`

	result, err := translation.ParseResult(content)

	require.NoError(t, err)
	assert.Equal(t, translation.Result{
		Expression:   "make out",
		PartOfSpeech: "phrasal verb",
		Translation:  "понять, разобрать",
		Explanation:  "Здесь — понять по имеющимся фактам.",
	}, result)
}

func TestParseResult_RejectsInvalidAnswers(t *testing.T) {
	t.Parallel()
	valid := `"expression": "bank", "partOfSpeech": "noun", "translation": "берег"`
	tests := []struct {
		name        string
		giveContent string
		wantErr     string
	}{
		{name: "not JSON", giveContent: `берег`, wantErr: "decode answer"},
		{
			name:        "unknown field",
			giveContent: `{` + valid + `, "explanation": "x", "note": "y"}`,
			wantErr:     `unknown field "note"`,
		},
		{
			name:        "trailing data",
			giveContent: `{` + valid + `, "explanation": "x"} {}`,
			wantErr:     "unexpected data",
		},
		{
			name:        "empty explanation",
			giveContent: `{` + valid + `, "explanation": "  "}`,
			wantErr:     "explanation is empty",
		},
		{
			name:        "missing explanation",
			giveContent: `{` + valid + `}`,
			wantErr:     "explanation is missing",
		},
		{
			name:        "extra closing brace",
			giveContent: `{` + valid + `, "explanation": "x"}}`,
			wantErr:     "unexpected data",
		},
		{
			name:        "extra closing bracket",
			giveContent: `{` + valid + `, "explanation": "x"}]`,
			wantErr:     "unexpected data",
		},
		{
			name:        "field name in another case",
			giveContent: `{` + valid + `, "Explanation": "x"}`,
			wantErr:     `unknown field "Explanation"`,
		},
		{
			name:        "not a string",
			giveContent: `{` + valid + `, "explanation": 42}`,
			wantErr:     "explanation is not a string",
		},
		{name: "null", giveContent: `null`, wantErr: "expression is missing"},
		{
			name: "unknown part of speech",
			giveContent: `{"expression": "bank", "partOfSpeech": "существительное", ` +
				`"translation": "берег", "explanation": "x"}`,
			wantErr: `partOfSpeech "существительное" is not an allowed value`,
		},
		{
			name:        "long explanation",
			giveContent: `{` + valid + `, "explanation": "` + strings.Repeat("я", 501) + `"}`,
			wantErr:     "explanation has 501 characters, the limit is 500",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			_, err := translation.ParseResult(tt.giveContent)

			assert.ErrorContains(t, err, tt.wantErr)
		})
	}
}

// The model writes the fields in the schema order, so the order of the
// properties is part of the contract: the explanation must be the last one.
func TestResultSchema(t *testing.T) {
	t.Parallel()
	want := `{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "expression",
    "partOfSpeech",
    "translation",
    "explanation"
  ],
  "properties": {
    "expression": {
      "type": "string"
    },
    "partOfSpeech": {
      "type": "string",
      "enum": [
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
        "abbreviation"
      ]
    },
    "translation": {
      "type": "string"
    },
    "explanation": {
      "type": "string"
    }
  }
}`

	data, err := json.MarshalIndent(translation.ResultSchema(), "", "  ")

	require.NoError(t, err)
	assert.Equal(t, want, string(data))
}
