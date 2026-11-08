package translation_test

import (
	"testing"

	"github.com/sklyar/tap-translate/backend/internal/translation"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildPrompt(t *testing.T) {
	t.Parallel()
	tests := []struct {
		giveMode translation.ContextMode
		wantUser string
	}{
		{
			giveMode: translation.ContextModeSentence,
			wantUser: "Tapped word: bank\n\nText:\nWe sat on the ⟦bank⟧ of the river.",
		},
		{
			giveMode: translation.ContextModeBlock,
			wantUser: "Tapped word: bank\n\n" +
				"Text:\n“Hi.” 😀 We sat on the ⟦bank⟧ of the river. Then we left.…",
		},
		{
			giveMode: translation.ContextModeFull,
			wantUser: "Tapped word: bank\n\n" +
				"Text before:\n…Chapter one\n\n" +
				"Text with the tapped word:\n" +
				"“Hi.” 😀 We sat on the ⟦bank⟧ of the river. Then we left.…\n\n" +
				"Text after:\nThe end.",
		},
	}

	for _, tt := range tests {
		t.Run(string(tt.giveMode), func(t *testing.T) {
			t.Parallel()

			prompt, err := translation.BuildPrompt(newContext(), tt.giveMode)

			require.NoError(t, err)
			assert.Equal(t, tt.wantUser, prompt.User)
			assert.Equal(t, translation.SystemPrompt(), prompt.System)
		})
	}
}

func TestBuildPrompt_FullModeOmitsMissingNeighbors(t *testing.T) {
	t.Parallel()
	c := newContext()
	c.BeforeBlocks = nil
	c.AfterBlocks = nil

	prompt, err := translation.BuildPrompt(c, translation.ContextModeFull)

	require.NoError(t, err)
	assert.Equal(t,
		"Tapped word: bank\n\n"+
			"Text with the tapped word:\n"+
			"“Hi.” 😀 We sat on the ⟦bank⟧ of the river. Then we left.…",
		prompt.User)
}

func TestBuildPrompt_RejectsInvalidInput(t *testing.T) {
	t.Parallel()
	badSpan := newContext()
	badSpan.FocusBlock.Word = translation.TextSpan{Start: 50, End: 60}

	_, spanErr := translation.BuildPrompt(badSpan, translation.ContextModeSentence)
	_, modeErr := translation.BuildPrompt(newContext(), translation.ContextMode("page"))

	require.ErrorContains(t, spanErr, "word span [50, 60)")
	assert.ErrorContains(t, modeErr, `unknown context mode "page"`)
}

func TestParseContextMode(t *testing.T) {
	t.Parallel()
	tests := []struct {
		give string
		want translation.ContextMode
	}{
		{give: "sentence", want: translation.ContextModeSentence},
		{give: "block", want: translation.ContextModeBlock},
		{give: "full", want: translation.ContextModeFull},
	}

	for _, tt := range tests {
		t.Run(tt.give, func(t *testing.T) {
			t.Parallel()

			mode, err := translation.ParseContextMode(tt.give)

			require.NoError(t, err)
			assert.Equal(t, tt.want, mode)
		})
	}
}

func TestParseContextMode_Unknown(t *testing.T) {
	t.Parallel()

	_, err := translation.ParseContextMode("page")

	assert.ErrorContains(t, err, `unknown context mode "page"`)
}

func TestSystemPrompt_ListsPartsOfSpeech(t *testing.T) {
	t.Parallel()

	prompt := translation.SystemPrompt()

	for _, part := range translation.PartsOfSpeech() {
		assert.Contains(t, prompt, part)
	}
}
