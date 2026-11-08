GO_MODULE = github.com/sklyar/tap-translate/backend
BIN_DIR = $(CURDIR)/bin

# Go tools versions. Change a version here, then run 'make install-deps'.
# Keep GOLANGCI_LINT_VERSION in sync with .github/workflows/backend.yml.
GOLANGCI_LINT_VERSION = v2.15.0
NILAWAY_VERSION = v0.0.0-20260918162853-acb8859b9031

GO_INSTALL = GOBIN=$(BIN_DIR) go install

# Tools are called by full path, so the Makefile never uses tools from your PATH.
# 'export PATH' is not enough: GNU Make 3.81 (macOS) ignores it for simple commands.
GOLANGCI_LINT = $(BIN_DIR)/golangci-lint
NILAWAY = $(BIN_DIR)/nilaway

LINT_TOOLS = golangci-lint
NILAWAY_TOOLS = nilaway
DEV_TOOLS = $(LINT_TOOLS) $(NILAWAY_TOOLS)

.DEFAULT_GOAL := help

define print-target
	@printf "Executing target: \033[36m$@\033[0m\n"
endef

define check-bin-tools
	@missing=""; \
	for tool in $(1); do \
		if [ ! -x "$(BIN_DIR)/$$tool" ]; then \
			missing="$$missing $$tool"; \
		fi; \
	done; \
	if [ -n "$$missing" ]; then \
		printf "Missing tools:%s\nRun 'make install-deps'.\n" "$$missing" >&2; \
		exit 1; \
	fi
endef

.PHONY: \
	help \
	build \
	install-deps \
	install-golangci-lint \
	install-nilaway \
	check-deps \
	fix-style \
	check-style \
	lint \
	nilaway \
	test \
	check

# Show all targets that have a '## ' description.
help: ## Show this help.
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

$(BIN_DIR):
	@mkdir -p $@

# ================================
# Build
# ================================
build: $(BIN_DIR) ## Build the binaries into bin/.
	$(call print-target)
	@go build -o $(BIN_DIR)/evaluate ./cmd/evaluate

# ================================
# Code Quality and Testing
# ================================
install-deps: install-golangci-lint install-nilaway ## Install pinned tools into bin/.

install-golangci-lint: $(BIN_DIR) ## Install the pinned golangci-lint into bin/.
	$(call print-target)
	@$(GO_INSTALL) github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_LINT_VERSION)

install-nilaway: $(BIN_DIR) ## Install the pinned nilaway into bin/.
	$(call print-target)
	@$(GO_INSTALL) go.uber.org/nilaway/cmd/nilaway@$(NILAWAY_VERSION)

check-deps: ## Check that all tools are in bin/.
	$(call print-target)
	$(call check-bin-tools,$(DEV_TOOLS))

fix-style: ## Format the code. This changes files.
	$(call print-target)
	$(call check-bin-tools,$(LINT_TOOLS))
	@$(GOLANGCI_LINT) fmt ./...

# Prints the diff and fails if some files are not formatted.
check-style: ## Check the format. Does not change files.
	$(call print-target)
	$(call check-bin-tools,$(LINT_TOOLS))
	@$(GOLANGCI_LINT) fmt --diff ./...

lint: ## Run golangci-lint.
	$(call print-target)
	$(call check-bin-tools,$(LINT_TOOLS))
	@$(GOLANGCI_LINT) run ./...

nilaway: ## Find possible nil panics.
	$(call print-target)
	$(call check-bin-tools,$(NILAWAY_TOOLS))
	@$(NILAWAY) -include-pkgs=$(GO_MODULE) ./...

test: ## Run the tests with the race detector.
	$(call print-target)
	@go test -race ./...

check: check-style lint nilaway test ## Run all checks: format, lint, nilaway, tests.
