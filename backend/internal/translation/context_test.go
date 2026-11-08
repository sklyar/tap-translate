package translation

import (
	"strings"
	"testing"
)

// The text has characters outside ASCII before the word. The span offsets
// are UTF-16 code units, as in JavaScript: "“" is one unit and "😀" is two.
func newContext() DetectionContext {
	text := "“Hi.” 😀 We sat on the bank of the river. Then we left."
	return DetectionContext{
		BeforeBlocks: []ContextBlock{{Text: "Chapter one", TruncatedBefore: true}},
		FocusBlock: FocusBlock{
			ContextBlock: ContextBlock{Text: text, TruncatedAfter: true},
			Word:         TextSpan{Start: 23, End: 27},
			Sentence:     TextSpan{Start: 9, End: 41},
		},
		AfterBlocks: []ContextBlock{{Text: "The end."}},
	}
}

func TestDetectionContextUsesUTF16Offsets(t *testing.T) {
	c := newContext()

	if err := c.Validate(); err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	if got := c.Word(); got != "bank" {
		t.Errorf("Word() = %q, want %q", got, "bank")
	}

	sentence := c.SentenceParts()
	if sentence.BeforeWord != "We sat on the " || sentence.Word != "bank" || sentence.AfterWord != " of the river." {
		t.Errorf("SentenceParts() = %+v", sentence)
	}

	block := c.BlockParts()
	if block.BeforeWord != "“Hi.” 😀 We sat on the " || block.AfterWord != " of the river. Then we left." {
		t.Errorf("BlockParts() = %+v", block)
	}
}

func TestDetectionContextValidateRejectsBadSpans(t *testing.T) {
	tests := []struct {
		name     string
		word     TextSpan
		sentence TextSpan
		want     string
	}{
		{"empty word", TextSpan{23, 23}, TextSpan{9, 41}, "word span"},
		{"word after the text", TextSpan{23, 100}, TextSpan{9, 41}, "word span"},
		{"negative sentence start", TextSpan{23, 27}, TextSpan{-1, 41}, "sentence span"},
		{"word outside the sentence", TextSpan{23, 27}, TextSpan{30, 41}, "does not contain"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			c := newContext()
			c.FocusBlock.Word = test.word
			c.FocusBlock.Sentence = test.sentence

			err := c.Validate()
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Errorf("Validate() error = %v, want an error with %q", err, test.want)
			}
		})
	}
}
