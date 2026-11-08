package translation_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/sklyar/tap-translate/backend/internal/translation"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newContext returns a valid context. The text has characters outside ASCII
// before the word. The span offsets are UTF-16 code units, as in JavaScript:
// "“" is one unit and "😀" is two.
func newContext() translation.DetectionContext {
	text := "“Hi.” 😀 We sat on the bank of the river. Then we left."
	return translation.DetectionContext{
		BeforeBlocks: []translation.ContextBlock{{Text: "Chapter one", TruncatedBefore: true}},
		FocusBlock: translation.FocusBlock{
			ContextBlock: translation.ContextBlock{Text: text, TruncatedAfter: true},
			Word:         translation.TextSpan{Start: 23, End: 27},
			Sentence:     translation.TextSpan{Start: 9, End: 41},
		},
		AfterBlocks: []translation.ContextBlock{{Text: "The end."}},
	}
}

func TestDetectionContext_UTF16Offsets(t *testing.T) {
	t.Parallel()
	c := newContext()

	err := c.Validate()
	word := c.Word()
	sentence := c.SentenceParts()
	block := c.BlockParts()

	require.NoError(t, err)
	assert.Equal(t, "bank", word)
	assert.Equal(t, translation.FocusParts{
		BeforeWord: "We sat on the ",
		Word:       "bank",
		AfterWord:  " of the river.",
	}, sentence)
	assert.Equal(t, translation.FocusParts{
		BeforeWord: "“Hi.” 😀 We sat on the ",
		Word:       "bank",
		AfterWord:  " of the river. Then we left.",
	}, block)
}

func TestDetectionContext_ValidateRejectsBadSpans(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name         string
		giveWord     translation.TextSpan
		giveSentence translation.TextSpan
		wantErr      string
	}{
		{
			name:         "empty word",
			giveWord:     translation.TextSpan{Start: 23, End: 23},
			giveSentence: translation.TextSpan{Start: 9, End: 41},
			wantErr:      "word span [23, 23)",
		},
		{
			name:         "word after the text",
			giveWord:     translation.TextSpan{Start: 23, End: 100},
			giveSentence: translation.TextSpan{Start: 9, End: 41},
			wantErr:      "word span [23, 100)",
		},
		{
			name:         "negative sentence start",
			giveWord:     translation.TextSpan{Start: 23, End: 27},
			giveSentence: translation.TextSpan{Start: -1, End: 41},
			wantErr:      "sentence span [-1, 41)",
		},
		{
			name:         "word outside the sentence",
			giveWord:     translation.TextSpan{Start: 23, End: 27},
			giveSentence: translation.TextSpan{Start: 30, End: 41},
			wantErr:      "the sentence span does not contain the word span",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			c := newContext()
			c.FocusBlock.Word = tt.giveWord
			c.FocusBlock.Sentence = tt.giveSentence

			err := c.Validate()

			assert.ErrorContains(t, err, tt.wantErr)
		})
	}
}

func TestDetectionContext_UnmarshalJSONValidates(t *testing.T) {
	t.Parallel()
	data, err := json.Marshal(newContext())
	require.NoError(t, err)
	invalid := strings.Replace(
		string(data), `"word":{"start":23,"end":27}`, `"word":{"start":50,"end":60}`, 1)
	require.NotEqual(t, string(data), invalid, "the test did not change the word span")

	var decoded, rejected translation.DetectionContext
	decodeErr := json.Unmarshal(data, &decoded)
	rejectErr := json.Unmarshal([]byte(invalid), &rejected)

	require.NoError(t, decodeErr)
	assert.Equal(t, newContext(), decoded)
	assert.ErrorContains(t, rejectErr, "invalid detection context: word span [50, 60)")
}
