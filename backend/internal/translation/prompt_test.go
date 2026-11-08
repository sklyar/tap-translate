package translation

import (
	"strings"
	"testing"
)

func TestBuildPrompt(t *testing.T) {
	tests := []struct {
		mode ContextMode
		want string
	}{
		{
			mode: ContextModeSentence,
			want: "Tapped word: bank\n\nText:\nWe sat on the ⟦bank⟧ of the river.",
		},
		{
			mode: ContextModeBlock,
			want: "Tapped word: bank\n\nText:\n“Hi.” 😀 We sat on the ⟦bank⟧ of the river. Then we left.…",
		},
		{
			mode: ContextModeFull,
			want: "Tapped word: bank\n\n" +
				"Text before:\n…Chapter one\n\n" +
				"Text with the tapped word:\n“Hi.” 😀 We sat on the ⟦bank⟧ of the river. Then we left.…\n\n" +
				"Text after:\nThe end.",
		},
	}

	for _, test := range tests {
		t.Run(string(test.mode), func(t *testing.T) {
			prompt, err := BuildPrompt(newContext(), test.mode)
			if err != nil {
				t.Fatalf("BuildPrompt() error = %v", err)
			}
			if prompt.User != test.want {
				t.Errorf("BuildPrompt().User =\n%s\nwant\n%s", prompt.User, test.want)
			}
			if prompt.System != SystemPrompt {
				t.Error("BuildPrompt().System is not SystemPrompt")
			}
		})
	}
}

func TestBuildPromptFullModeOmitsMissingNeighbors(t *testing.T) {
	c := newContext()
	c.BeforeBlocks = nil
	c.AfterBlocks = nil

	prompt, err := BuildPrompt(c, ContextModeFull)
	if err != nil {
		t.Fatalf("BuildPrompt() error = %v", err)
	}
	if strings.Contains(prompt.User, "Text before") || strings.Contains(prompt.User, "Text after") {
		t.Errorf("BuildPrompt().User has an empty neighbor section:\n%s", prompt.User)
	}
}

func TestBuildPromptRejectsInvalidInput(t *testing.T) {
	c := newContext()
	c.FocusBlock.Word = TextSpan{Start: 50, End: 60}
	if _, err := BuildPrompt(c, ContextModeSentence); err == nil {
		t.Error("BuildPrompt() with a bad word span returned no error")
	}

	if _, err := BuildPrompt(newContext(), ContextMode("page")); err == nil {
		t.Error("BuildPrompt() with an unknown mode returned no error")
	}
}

func TestParseContextMode(t *testing.T) {
	for _, value := range []string{"sentence", "block", "full"} {
		if mode, err := ParseContextMode(value); err != nil || string(mode) != value {
			t.Errorf("ParseContextMode(%q) = %q, %v", value, mode, err)
		}
	}
	if _, err := ParseContextMode("page"); err == nil {
		t.Error(`ParseContextMode("page") returned no error`)
	}
}

func TestSystemPromptListsPartsOfSpeech(t *testing.T) {
	for _, part := range PartsOfSpeech {
		if !strings.Contains(SystemPrompt, part) {
			t.Errorf("SystemPrompt does not mention %q", part)
		}
	}
}
