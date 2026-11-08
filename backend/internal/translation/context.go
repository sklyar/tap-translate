// Package translation builds contextual translation prompts and validates the
// model answers. The types mirror the extension contract in
// extension/src/translation.ts and extension/src/context-extraction.ts.
package translation

import (
	"encoding/json"
	"errors"
	"fmt"
	"unicode/utf16"
)

// TextSpan is a half-open range of UTF-16 code units, as JavaScript string
// offsets are.
type TextSpan struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

type ContextBlock struct {
	Text            string `json:"text"`
	TruncatedBefore bool   `json:"truncatedBefore"`
	TruncatedAfter  bool   `json:"truncatedAfter"`
}

type FocusBlock struct {
	ContextBlock
	Word     TextSpan `json:"word"`
	Sentence TextSpan `json:"sentence"`
}

// DetectionContext is the context of one tap. Word, SentenceParts, and
// BlockParts need valid spans. UnmarshalJSON rejects invalid spans, but a
// missing JSON field is not decoded and keeps the zero value, which is not
// valid. Call Validate when the value can be empty or was built in code.
type DetectionContext struct {
	BeforeBlocks []ContextBlock `json:"beforeBlocks"`
	FocusBlock   FocusBlock     `json:"focusBlock"`
	AfterBlocks  []ContextBlock `json:"afterBlocks"`
}

// UnmarshalJSON decodes the context and rejects invalid spans.
func (c *DetectionContext) UnmarshalJSON(data []byte) error {
	// plain has the same fields without methods, so Unmarshal does not call
	// this method again.
	type plain DetectionContext
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}

	context := DetectionContext(decoded)
	if err := context.Validate(); err != nil {
		return fmt.Errorf("invalid detection context: %w", err)
	}

	*c = context
	return nil
}

// FocusParts splits the focus block text around the tapped word.
type FocusParts struct {
	BeforeWord string
	Word       string
	AfterWord  string
}

// Validate checks that the word and sentence spans fit the focus block text
// and that the sentence contains the word.
func (c DetectionContext) Validate() error {
	length := len(utf16.Encode([]rune(c.FocusBlock.Text)))
	word := c.FocusBlock.Word
	sentence := c.FocusBlock.Sentence

	switch {
	case word.Start < 0 || word.Start >= word.End || word.End > length:
		return fmt.Errorf("word span [%d, %d) is outside the focus block of length %d", word.Start, word.End, length)
	case sentence.Start < 0 || sentence.Start >= sentence.End || sentence.End > length:
		return fmt.Errorf("sentence span [%d, %d) is outside the focus block of length %d", sentence.Start, sentence.End, length)
	case word.Start < sentence.Start || word.End > sentence.End:
		return errors.New("the sentence span does not contain the word span")
	}

	return nil
}

// Word returns the tapped word.
func (c DetectionContext) Word() string {
	return sliceUTF16(c.FocusBlock.Text, c.FocusBlock.Word)
}

// SentenceParts splits the sentence around the tapped word.
func (c DetectionContext) SentenceParts() FocusParts {
	units := utf16.Encode([]rune(c.FocusBlock.Text))
	sentence := c.FocusBlock.Sentence
	word := c.FocusBlock.Word

	return FocusParts{
		BeforeWord: decode(units[sentence.Start:word.Start]),
		Word:       decode(units[word.Start:word.End]),
		AfterWord:  decode(units[word.End:sentence.End]),
	}
}

// BlockParts splits the whole focus block around the tapped word.
func (c DetectionContext) BlockParts() FocusParts {
	units := utf16.Encode([]rune(c.FocusBlock.Text))
	word := c.FocusBlock.Word

	return FocusParts{
		BeforeWord: decode(units[:word.Start]),
		Word:       decode(units[word.Start:word.End]),
		AfterWord:  decode(units[word.End:]),
	}
}

func sliceUTF16(text string, span TextSpan) string {
	return decode(utf16.Encode([]rune(text))[span.Start:span.End])
}

func decode(units []uint16) string {
	return string(utf16.Decode(units))
}
