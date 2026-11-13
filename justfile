# Seme monorepo task runner. `just` lists every recipe.
# Run from the repo root. Recipes are thin wrappers over the pnpm scripts in AGENTS.md.

set shell := ["bash", "-euo", "pipefail", "-c"]

api_dir := "apps/api"
web_dir := "apps/web"
store := env_var_or_default("SEME_STORAGE_DIR", env_var("HOME") + "/.hominem")

# List recipes
default:
    @just --list

# ---------- setup ----------

# Install all workspace dependencies
install:
    pnpm install

# ---------- dev servers ----------

# API on https://api.seme.lvh.me (run in its own terminal)
api:
    cd {{api_dir}} && pnpm exec portless api.seme pnpm run dev

# Web dashboard on https://web.seme.lvh.me (run in its own terminal)
web:
    cd {{web_dir}} && pnpm exec portless web.seme pnpm run dev

# Both servers at once. Ctrl-C stops both.
dev:
    just api & just web & wait

# Print the URLs portless gives this worktree
urls:
    @echo "api: $(cd {{api_dir}} && pnpm exec portless get api.seme)"
    @echo "web: $(cd {{web_dir}} && pnpm exec portless get web.seme)"

# Hit the API health endpoint
health:
    @curl -fsS "$(cd {{api_dir}} && pnpm exec portless get api.seme)/health" && echo

# Smoke-test the main read endpoints the dashboard uses
smoke:
    #!/usr/bin/env bash
    set -uo pipefail
    api="$(cd {{api_dir}} && pnpm exec portless get api.seme)"
    fail=0
    for path in /health /memories /entities /tasks /wiki /graph/snapshot /identity /health-metrics; do
        code=$(curl -s -o /dev/null -w '%{http_code}' "$api$path")
        printf '%-20s %s\n' "$path" "$code"
        [[ "$code" == 2* ]] || fail=1
    done
    exit $fail

# Open the dashboard in the default browser
open:
    open "$(cd {{web_dir}} && pnpm exec portless get web.seme)"

# ---------- build and checks ----------

# Build API and web
build:
    pnpm run build

# Build only the API (tsc)
build-api:
    cd {{api_dir}} && pnpm run build

# Build only the web app
build-web:
    cd {{web_dir}} && pnpm run build

# Typecheck both apps (api tsc, web tsc --noEmit)
typecheck:
    cd {{api_dir}} && pnpm exec tsc
    cd {{web_dir}} && pnpm run typecheck

# Lint the repo with oxlint
lint:
    pnpm run lint

# Format everything with oxfmt
fmt:
    pnpm run format

# Check formatting without writing
fmt-check:
    pnpm run format:check

# Everything that must pass before calling work done
check: typecheck lint fmt-check test

# ---------- tests and evals ----------

# API unit tests (node:test, skills router)
test:
    cd {{api_dir}} && pnpm test

# Run the extraction eval suite, e.g. `just eval --suite people --repeats 2`.
# Runs against temp stores. Pass --judge explicitly to spend on the LLM judge.
eval *args:
    cd {{api_dir}} && pnpm run build && pnpm run eval {{args}}

# Routing eval for the skills router (no LLM calls, Ollama only)
eval-routing:
    cd {{api_dir}} && pnpm run build && node dist/evals/suite/run.js --routing

# Benchmark script from apps/api
bench:
    cd {{api_dir}} && pnpm run bench

# MCP protocol test (python)
test-mcp:
    cd {{api_dir}} && pnpm run test:mcp

# ---------- store safety ----------

# Back up the real store before any write to it (AGENTS.md rule)
backup-store dest="":
    #!/usr/bin/env bash
    set -euo pipefail
    dest="{{dest}}"
    [[ -n "$dest" ]] || dest="{{store}}/backups/memory-$(date +%Y%m%d-%H%M%S).db"
    mkdir -p "$(dirname "$dest")"
    sqlite3 "{{store}}/memory.db" ".backup '$dest'"
    echo "backed up to $dest"

# Show what's in the store (paths and sizes only, no contents)
store-info:
    @echo "store: {{store}}"
    @ls -lh "{{store}}" 2>/dev/null | head -30

# ---------- maintenance ----------

# Remove build output
clean:
    rm -rf {{api_dir}}/dist {{web_dir}}/dist {{web_dir}}/.output

# Show the current branch, dirty files and the store each checkout uses
status:
    @git status --short --branch
    @echo "store: {{store}}"
