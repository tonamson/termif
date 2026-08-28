<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.

<!-- termif project status -->
## Project status: READ THIS FIRST

This project is being built from a written spec and a set of implementation
plans. Before answering anything about what to build, what is done, or what
comes next, **read `docs/superpowers/README.md`**. It is the index: it tracks
which plans exist, which one is next, what is still owed, and the decisions
already settled.

Then read the plan you are working in. The plans are test-first and
step-by-step; follow them rather than improvising an approach.

- Spec: `docs/superpowers/specs/2026-08-28-termif-crossplatform-ssh-design.md`
- Plans and status: `docs/superpowers/README.md`

Progress lives in the files, not in conversation history:

- Each plan step is a `- [ ]` checkbox. Tick it and commit the plan file with
  the code it covers.
- `grep -c '^- \[ \]' docs/superpowers/plans/*.md` counts what remains.
- A green test suite is what actually marks a task done, not a ticked box.

When a plan finishes, update its `Status` row in `docs/superpowers/README.md`.
