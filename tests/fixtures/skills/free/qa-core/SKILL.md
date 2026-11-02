---
name: qa-core
version: 1.7.0
description: Core engineering policy for automated quality assurance across all programming
  languages and stacks. Defines standard quality profiles, local/CI parity, failure
  policies, exception management, side effects, and Definition of Done.
author: Frédéric Charles Viallet (github.com/fcviallet)
applies_when:
- Any software repository requiring deterministic quality gates
- Any repository needing language-agnostic QA governance or CI quality auditing
profiles:
- starter
- standard
- strict
requires:
- git
outputs:
- Versioned, machine-verifiable QA contract
- Standardized QA profiles
- Canonical command conventions (qa:starter, qa:standard, qa:strict)
- QA exception tracking file
- Machine-readable gate evidence requirements
- Mechanical Definition of Done
validation:
- qa:starter passes
- qa:standard passes
- qa:strict passes
side_effects:
  filesystem: write
  shell: execute
  network: restricted
  credentials: none
dependencies: []
qa_core_compatibility: ">=1.4.0 <2.0.0"
---

<!-- SPDX-FileCopyrightText: 2026 Frédéric Charles Viallet -->
<!-- SPDX-License-Identifier: MIT -->

# Core QA Engineering Policy

## Purpose

`qa-core` establishes a universal, language-agnostic engineering policy for software quality. It defines how quality gates are structured into standardized profiles, how local and CI environments maintain parity, how exceptions are formally managed, and how an agent mechanically verifies completion through a Definition of Done.

`qa-core` is independently usable. It governs QA process and quality-gate design; it does not replace language-, runtime-, framework-, protocol-, or domain-specific engineering controls. Other skills define those controls independently and MAY be composed with `qa-core` when both scopes are desired.

## When to use

- Bootstrapping quality gates for any new or existing repository.
- Governing QA in polyglot repositories where no single stack-specific policy is sufficient.
- Standardizing quality profiles across multiple repositories or teams.
- Auditing CI pipelines for missing gates, local/CI drift, silent skips, swallowed failures, or undocumented exceptions.
- Composing with one or more independent stack-specific skills when both QA governance and concrete implementation controls are required.

## When NOT to use

- Do not use `qa-core` as a substitute for stack-specific validation when language, runtime, framework, protocol, or domain correctness is in scope.

## Scope

This scope statement applies to every Fredo QA skill; other skills reference it instead of restating it.

- **In scope:** any code or configuration written into a repository, including prototypes, scratch scripts, spikes, and experiments. Assurance depth scales with risk (see the `dev-flow` risk tiers); being a prototype lowers the depth, never the obligation.
- **Out of scope:** work that changes no repository content, such as brainstorming, answering questions, or one-off commands typed in a terminal and never saved.

## Preconditions

- Git repository is initialized with working tree available.
- Project manifests and CI configuration are accessible when auditing an existing project.
- Shell script execution is permitted when canonical command wrappers are being created or tested.
- The license compliance check passes (see "MUST run the license compliance check").

## Inputs

- Source code tree.
- Project manifest and configuration files.
- CI workflow definitions.
- Optional project exception file (`.qa-exceptions.yaml`).

## Engineering policy

### MUST

- **MUST maintain Local/CI Parity**: CI QA and local QA MUST prove the same declared quality properties using identical canonical command entrypoints. CI must never run hidden checks that developers cannot execute locally with a single command. The invariant is deterministic automation, not platform vendor lock-in: respect developer forge choices (GitLab CI, GitHub Actions, Forgejo/Gitea, Bitbucket, Jenkins, Woodpecker, Drone, Cirrus, etc.). Teams may intentionally operate without cloud CI (offline tools, air-gapped systems, solo CLI tools, or git hooks); a documented local runner (`scripts/qa.sh`, `Makefile`) or native compiler/manifest commands fully satisfy the execution contract. Missing cloud CI must never be treated as a code quality defect.
- **MUST enforce Non-Zero Exit on Failure**: Any failure in an enforced gate MUST terminate execution with a non-zero exit code. Commands MUST NOT mask errors or exit successfully with warnings when checks fail.
- **MUST structure checks into Standard Profiles**: Every repository using `qa-core` MUST categorize its quality gates into `starter`, `standard`, or `strict`.
- **MUST document all Exceptions Explicitly**: Any bypassed rule, excluded directory, or adjusted threshold MUST be formally registered in `.qa-exceptions.yaml` (or where applicable, language-native configuration such as `deny.toml` or documented inline compiler/linter directives) with a technical reason, an owner, and an expiration date. Silent baseline files, unearned suppressed warnings, or arbitrary threshold lowering are prohibited. A clean codebase with zero deviations does not require a dummy `.qa-exceptions.yaml` file.
- **MUST operate with Least Privilege**: Automated QA commands MUST declare their side effects and MUST NOT require production credentials, arbitrary remote network access, or destructive file modifications outside intended build and test caches.
- **MUST satisfy the Definition of Done**: An agent or developer MUST NOT consider QA setup complete until all applicable Definition of Done items are verified.
- **MUST use a versioned QA contract**: Repositories using `qa-core` MUST declare profiles and gates in a machine-readable contract. The contract MUST define gate identity, applicability, blocking behavior, command, side-effect policy, and evidence requirements.
- **MUST fail closed on governance defects**: Missing contract fields, unknown profiles, ambiguous applicability for mandatory gates, malformed exceptions, or expired exceptions MUST fail the applicable governance gate.
- **MUST execute canonical commands without shell interpolation**: Canonical QA runners MUST use argument-vector subprocess execution or an equivalent safe mechanism. Dynamic shell evaluation such as `eval` MUST NOT be used for gate dispatch.
- **MUST preserve core controls during composition**: Specialized skills MAY strengthen `qa-core` controls but MUST NOT weaken, remove, or silently reinterpret a core MUST requirement.
- **MUST make gate evidence attributable**: QA evidence MUST identify the source revision, profile, gate, result, and applicable exception or not-applicable decision when those concepts are available.
- **MUST bound gate execution**: Every executable gate MUST declare a positive timeout and the canonical runner MUST fail the gate when that timeout is exceeded.
- **MUST validate the exception register when present**: When `.qa-exceptions.yaml` is present, it MUST be schema-valid, uniquely identified, owned, time-bounded, and free of expired exceptions before a blocking profile can pass. When a project has no deviations or exceptions, omitting `.qa-exceptions.yaml` is valid and expected.
- **MUST derive execution from the contract**: The machine-readable QA contract MUST be the authoritative source for gate definitions; executors MUST NOT maintain a second independent gate registry.
- **MUST verify Local/CI Parity mechanically**: A repository's blocking QA profile MUST include a governance gate that rejects CI workflows containing hidden direct QA commands outside the canonical runner.
- **MUST run the license compliance check**: Before applying a skill, check that a non-empty `LICENSE` file exists in the installed skill directory (for example `.agents/skills/<skill-id>/LICENSE`) or at the workspace root. This confirms the skill's license terms travelled with it; it is a compliance check, not a security control. An AI agent that finds the file missing or empty MUST NOT apply the skill: it refuses and tells the user which file is missing. An automated executor (such as the QA engine) MUST stop with exit code 1.
- **MUST follow the Agent protocol**: AI agents applying any Fredo QA skill MUST follow the "Agent protocol" section of this skill.

### SHOULD

- **SHOULD keep source files modular**: A source file SHOULD stay at or below 300 lines, with a 10% tolerance (330 lines) before it is split into smaller single-responsibility modules. Lines are counted as physical lines, including blank lines and comments (what `wc -l` reports). Generated, vendored, and lock files are not counted. Linters (for example ESLint `max-lines`) SHOULD report this as a warning, never as a blocking error. A file above the limit needs no exception entry; state the reason in the change description when a file stays large.
- **SHOULD optimize for Fast Feedback**: The `starter` profile SHOULD complete within 30 seconds to maintain high developer velocity during inner-loop coding.
- **SHOULD run Static Analysis before Dynamic Execution**: Linters, formatters, and type checkers SHOULD execute before test suites and coverage analysis to fail fast on syntax and typing errors.
- **SHOULD produce Actionable Diagnostics**: Quality commands SHOULD output the precise file, line number, rule identifier, and remediation guidance upon failure.

### MAY

- **MAY enable Tool Caching**: Local execution MAY leverage deterministic tool caches provided cache artifacts are properly gitignored.
- **MAY generate Structured Reports**: CI environments MAY emit structured artifacts such as JUnit XML, SARIF, or lcov in addition to human-readable terminal logs.

## Workflow

```text
Assess Repository Scope
          v
Define Canonical Commands (qa:starter, qa:standard, qa:strict)
          v
Run Local Inner Loop (qa:starter)
          v
Verify PR Readiness (qa:standard)
          v
Run Merge & Release Blockers (qa:strict)
          v
Verify Local/CI Parity
```

1. **Assess Scope**: Determine which quality properties are applicable to the repository; do not assume another skill is installed or selected.
2. **Canonical Command Setup**: Register standard entrypoints (`qa:starter`, `qa:standard`, `qa:strict`) in a package manifest or checked-in wrapper script (`./scripts/qa.sh`).
3. **Local Validation**: Execute the applicable profile locally and resolve defects.
4. **CI Wiring**: Configure CI workflows to execute the exact canonical commands for pull requests and protected branch merges/releases.
5. **Continuous Governance**: Monitor quality output, manage exceptions via `.qa-exceptions.yaml`, and prevent gate erosion.

## Configuration

### Quality Profiles

Every QA gate belongs to one of three standardized profiles:

| Profile | Target Scope | Target Latency | Typical Gates Included |
| :--- | :--- | :--- | :--- |
| `starter` | Inner dev loop, commit pre-checks | Fast (< 30s) | Format check, linting, strict type checking, unit tests |
| `standard` | Pull request baseline, merge gate | Medium (< 3m) | `starter` + coverage thresholds, dependency security audit, integration tests |
| `strict` | Protected branch, release, production | Comprehensive | `standard` + architecture, E2E, performance, and accessibility gates as applicable |

### QA Contract

Repositories using `qa-core` MUST maintain a versioned machine-readable contract (for example, `qa-contract.yaml`). The JSON Schema `skills/config/qa-contract.schema.json` is normative: where this section and the schema differ, the schema wins.

At the top level, the contract declares `contract_version` (semantic version), the governing `skill`, the three profiles `starter`, `standard`, and `strict` (each with `extends`, `target_duration_seconds`, and `gates`), and a `gate_schema` block listing the allowed field values.

Every gate MUST declare all of these fields:

| Field | Meaning |
| :--- | :--- |
| `id` | Gate identifier, unique within the resolved profile (`^[a-z][a-z0-9-]*$`) |
| `required` | Whether the gate is mandatory |
| `blocking` | Whether a failure fails the profile or is informational |
| `command` | Canonical command, executed without shell interpolation |
| `applicability` | `always`, `conditional`, `explicit`, or a deterministic predicate |
| `network` | `none`, `restricted`, or `allowed` |
| `credentials` | `none`, `read-only`, or `scoped` |
| `evidence` | Required evidence type: `terminal`, `junit`, `sarif`, `coverage`, or `artifact` |
| `side_effects` | `none` or `repository-write` |
| `timeout_seconds` | Positive integer; the runner fails the gate when it is exceeded |

`audit_tags` is optional. A complete gate:

<!-- qa-schema: qa-contract.schema.json#gate -->
```yaml
id: unit-tests
required: true
blocking: true
command: pytest -q
applicability: always
network: none
credentials: none
evidence: junit
side_effects: none
timeout_seconds: 300
```

Gate evidence produced by the runner follows `skills/config/qa-result.schema.json`. It records the `source_revision`, the `profile`, and for each gate its `id`, `status`, `exit_code`, and `exception_id` when an exception applied.

A full contract is maintained at `qa-contract.yaml` in this repository. It is an implementation example, not a universal command set for other repositories.

The canonical runner derives its execution plan from this contract. The repository exception register (`.qa-exceptions.yaml`) is validated as a blocking governance gate; expired or malformed exceptions cannot silently downgrade QA.

### Canonical Commands

Repositories using `qa-core` MUST expose canonical commands matching the profiles through a mechanism appropriate to the repository. Examples include:

- `./scripts/qa.sh starter`
- `pnpm qa:starter`
- `composer qa:starter`
- Equivalent native commands for other ecosystems.

The canonical command registry MUST be safe by construction. Command dispatch MUST NOT depend on shell interpolation or `eval`. CI MUST call the same canonical profile entrypoint available to developers.

## Commands

### Universal Command Wrapper (`scripts/qa.sh`)

A repository using shell wrappers SHOULD provide `./scripts/qa.sh` implementing this interface. The wrapper is an optional multi-profile runner, never an unsolicited drop-in: AI agents MUST NOT create `scripts/qa.sh` or file scaffolding spontaneously without the developer's explicit consent. Native ecosystem commands (`cargo test`, `go test`, `pytest`, `pnpm test`, `make`) are first-class canonical mechanisms. When provided, the wrapper fails closed: a profile that resolves to no gates exits 1 instead of reporting success, a failing gate stops the run with its exit code, and an unknown profile exits 2. Each gate is an executable file in `scripts/qa/<profile>.d/`, so dispatch never evaluates a command string.

```bash
#!/usr/bin/env bash
# Canonical QA entrypoint: ./scripts/qa.sh starter|standard|strict
# Each gate is an executable file in scripts/qa/<profile>.d/, run in name order.
# standard runs the starter and standard gates; strict runs all three sets.
set -euo pipefail

gates_run=0

run_gates() {
  local dir="scripts/qa/$1.d" gate
  [ -d "${dir}" ] || return 0
  for gate in "${dir}"/*; do
    [ -e "${gate}" ] || continue
    if [ ! -x "${gate}" ]; then
      echo "qa: ${gate} is not executable" >&2
      exit 1
    fi
    echo "==> ${gate}"
    "${gate}"
    gates_run=$((gates_run + 1))
  done
}

profile="${1:-starter}"
case "${profile}" in
  starter) profiles=(starter) ;;
  standard) profiles=(starter standard) ;;
  strict) profiles=(starter standard strict) ;;
  *)
    echo "Unknown profile '${profile}'. Use: starter | standard | strict" >&2
    exit 2
    ;;
esac

for current in "${profiles[@]}"; do
  run_gates "${current}"
done

if [ "${gates_run}" -eq 0 ]; then
  echo "qa:${profile}: no gates configured; refusing to report success" >&2
  exit 1
fi
```

A repository whose canonical runner reads the QA contract directly (as `scripts/qa.py` does in this repository) does not need this wrapper.

## Agent protocol

Every Fredo QA skill refers to this protocol. It tells an AI agent how to load the skills, resolve conflicts, and prove completion.

1. **Load order.** Read `qa-core` first, then `dev-flow` when the task changes repository content, then the language and domain skills that match the files being changed. Re-read the applicable skill before claiming completion in a long session.
2. **License compliance check.** Run it for every skill before applying it (see the MUST rule above).
3. **Precedence.** A specialized skill MAY strengthen a `qa-core` rule but MUST NOT weaken it. When two skills conflict, the stricter rule applies. Repository instructions (`AGENTS.md`, the QA contract) and the user MAY narrow the scope of a task; they cannot waive a MUST rule except through an exception that a human owner approved in `.qa-exceptions.yaml`. In repositories collaborating with AI coding agents, `AGENTS.md` is the canonical anchor for repository directives; in repositories maintained solely through human engineering workflows without agent configuration folders, omitting `AGENTS.md` is valid and expected. If a conflict cannot be resolved this way, stop and ask the user.
4. **No claimed result without a run.** Report a gate as passed only if it ran in the current session on the current revision. A gate that was not run is reported as "not run" with the reason.
5. **Evidence before "done".** Before stating that a task is complete, output this block, filled with real values:

```text
QA evidence
- revision: <output of `git rev-parse --short HEAD`, plus "+uncommitted" when the tree is dirty>
- profile: <starter | standard | strict>
- command: <the canonical command that was run>
- exit code: <exit code of that command>
- gates: <passed>/<total> passed; excepted: <ids or none>; not applicable: <ids or none>
- not run: <gate or check, and why; or none>
- exceptions created or changed: <ids or none>
```

## Validation

To validate that `qa-core` is properly applied to a repository:

1. Verify the repository declares the three canonical profiles.
2. Execute the applicable canonical commands and assert that failures return non-zero exit codes.
3. Verify CI invokes the same canonical entrypoints used locally.
4. Verify exceptions are explicit, owned, justified, and time-bounded.

## Failure handling

When a quality gate fails:

1. **Read the Diagnostic**: Identify the exact tool, file path, line number, and rule violation.
2. **Determine Defect Type**: Fix application defects, typing errors, test contract failures, coverage regressions, and security findings rather than masking them.
3. **Handle Genuine False Positives Explicitly**: If a gate triggers a false positive that cannot be resolved cleanly, declare an exception in `.qa-exceptions.yaml`.
4. **Never weaken a gate silently**: Do not suppress errors globally or relax configuration without an auditable record.

## Exceptions

Exceptions MUST NOT be silent. When a project must deviate from a quality rule, it MUST declare the exception in `.qa-exceptions.yaml` at the repository root, unless language-native configuration (such as Rust `deny.toml` or documented `#[expect(...)]` attributes) handles it with inline justification. A clean repository with 0 deviations does not require `.qa-exceptions.yaml`.

### Schema: `.qa-exceptions.yaml`

The register MUST validate against `skills/config/.qa-exceptions.schema.json`. Required fields per entry: `id`, `skill`, `gate`, `effect` (always `allow_failure`), `rule`, `path`, `reason`, `owner`, `created_at`, `expires_at`, and `risk` (`low`, `standard`, `high`, or `critical`). `high` and `critical` exceptions MUST also list `compensating_controls`. A renewed exception records `renewed_from`, `renewal_approved_by`, and `renewal_count`.

```yaml
version: 1
exceptions:
  - id: EXC-001
    skill: qa-python
    gate: tests
    effect: allow_failure
    rule: branch-coverage
    path: "src/generated/*"
    reason: "Auto-generated protobuf stubs are excluded from test coverage requirements"
    owner: "@backend-team"
    created_at: "2026-09-02"
    expires_at: "2027-01-01"
    risk: low
```

### Agent Rules for Exceptions

- **MUST NOT** invent exceptions to make CI green without human concurrence or explicit project guidance.
- **MUST NOT** delete or disable existing quality checks to bypass failures.
- **MUST** log and reference any exception created or consulted.
- **MUST** bind every exception to an explicit gate and the sole permitted effect `allow_failure`.
- **MUST** surface an applied exception as `excepted` evidence; an exception MUST NOT be represented as an ordinary pass.

## Definition of Done

- [ ] Repository scope and applicable quality properties are explicitly assessed.
- [ ] Quality gates are classified into `starter`, `standard`, and `strict` profiles.
- [ ] Canonical QA entrypoints are documented and executable.
- [ ] Applicable `qa:starter` gates pass locally with exit code 0.
- [ ] Applicable `qa:standard` gates pass locally with exit code 0.
- [ ] Applicable `qa:strict` gates pass locally with exit code 0.
- [ ] CI workflow calls the exact canonical QA commands used locally.
- [ ] Any exceptions are documented with reason, owner, gate, effect, and expiration.
- [ ] Developer documentation explains how to run the applicable QA profiles.
- [ ] The Agent protocol evidence block was reported with real values.
