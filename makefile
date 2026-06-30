GLOBAL_DIR := $(HOME)/.pi/agent

.PHONY: install install-agents install-skills install-extensions install-prompts uninstall help

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: install-agents install-skills install-extensions install-prompts ## Install all pi resources to ~/.pi/agent

install-agents: ## Sync agents to ~/.pi/agent/agents/
	@mkdir -p $(GLOBAL_DIR)/agents
	@cp agents/*.md $(GLOBAL_DIR)/agents/
	@echo "✓ Agents installed to $(GLOBAL_DIR)/agents/"

install-skills: ## Sync skills to ~/.pi/agent/skills/
	@mkdir -p $(GLOBAL_DIR)/skills
	@rsync -a --delete skills/ $(GLOBAL_DIR)/skills/
	@echo "✓ Skills installed to $(GLOBAL_DIR)/skills/"

install-extensions: ## Sync extensions to ~/.pi/agent/extensions/
	@mkdir -p $(GLOBAL_DIR)/extensions
	@rsync -a --delete extensions/ $(GLOBAL_DIR)/extensions/
	@echo "✓ Extensions installed to $(GLOBAL_DIR)/extensions/"

install-prompts: ## Sync prompts to ~/.pi/agent/prompts/
	@mkdir -p $(GLOBAL_DIR)/prompts
	@cp prompts/*.md $(GLOBAL_DIR)/prompts/
	@echo "✓ Prompts installed to $(GLOBAL_DIR)/prompts/"

uninstall: ## Remove all pi-tools resources from ~/.pi/agent
	@rm -rf $(GLOBAL_DIR)/agents/explore.md $(GLOBAL_DIR)/agents/planner.md $(GLOBAL_DIR)/agents/reviewer.md $(GLOBAL_DIR)/agents/scout.md $(GLOBAL_DIR)/agents/worker.md
	@echo "✓ Agents removed"