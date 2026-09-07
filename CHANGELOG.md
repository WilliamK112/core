# Changelog

All notable changes to **@flaught/core** are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/). For 0.x releases, a backwards-compatible
feature bumps the minor version and a fix bumps the patch.

## [0.10.0] - 2026-09-07

Four backwards-compatible features, one fix, and a new human-readable architecture
reference, all since `0.9.0`. Two of the new features ship **on by default** and
change default review behavior — see the ⚠️ notes under Added.

### Added

- **`flaught init --paranoid` preset** (#52) — writes an explicit `.advreview.yml`
  that turns on every deterministic tool, test inversion, scope-creep detection,
  a high-severity gate, and dismissals, each with a link to the config reference.
  Also exposed as `initConfig(dir, { paranoid: true })` in the library API. Plain
  `flaught init` is unchanged.

- **Built-in test-weakening detection** (#65) — a new deterministic check that flags
  removed assertions, newly added skip markers, loosened Jest matchers, deleted
  test files, and test bodies replaced by comments. Findings are
  `source_type: "deterministic"`, severity `high` (skip markers `medium`).
  ⚠️ **On by default** (`tools.test_weakening.enabled`, default `true`), so reviews
  of PRs that touch test files now produce these findings. Set `enabled: false` to
  disable.

- **Configurable LLM confidence floor** (#64) — `llm.min_confidence` (default `0`,
  range 0–1) drops LLM findings below the floor after parsing and before the
  skeptic/noise-budget stages. Deterministic findings are exempt. The artifact
  records `dropped_below_min_confidence`. Default `0` means no behavior change
  unless you opt in.

- **Built-in dependency-sanity check** (#53) — a new deterministic check for packages
  *added* in `package.json` that queries the npm registry for existence, age,
  weekly downloads, and typosquat (Levenshtein) similarity to a curated popular-
  package list. Severity: typosquat/nonexistent `high`, too-new `medium`,
  low-downloads `low`.
  ⚠️ **On by default** (`tools.dependency_sanity.enabled`, default `true`) and
  makes **outbound calls to `registry.npmjs.org` / `api.npmjs.org`** during reviews
  of JS repos that add dependencies. Local/workspace/git specs are not looked up.
  Set `enabled: false` to keep reviews fully offline.

- **Human-readable architecture reference** (`docs/architecture.md`, #66) — the
  pipeline (with the real branching), a component map, and a single-run sequence,
  each with a mermaid diagram and an ASCII fallback. The component map now also
  covers `prompt/templates`, `dashboard/*`, and `util/glob`.

### Changed

- **`runReview()` can now *resolve* with exit code `2`** (#53) — previously exit `2`
  only happened when `runReview()` *threw* a config/API/LLM fault (caught by the
  CLI). Now `computeExitCode()` also returns `2` when a deterministic tool could not
  complete reliably (e.g. a full npm registry outage during dependency-sanity),
  so `result.exitCode === 2` is a possible resolved value, not only a thrown one.
  Exit `2` remains a tool fault, not a code verdict — CI should warn, not block.
  `docs/api.md` documents the updated contract. Note: `severity_gate.fail_on: "none"`
  no longer guarantees exit `0`; a tool fault still yields `2`.

- The `flaught init` commented template, the `--paranoid` preset, and
  `docs/configuration.md` now list `test_weakening` and `dependency_sanity`
  alongside semgrep/linter/vuln_scanner, so the "explicit settings for all
  deterministic tools" framing stays accurate.

### Fixed

- **Test-weakening cross-file false positives** — the `commented-test-body` and
  loosened-matcher rules correlated removed and added lines *across the whole
  diff* with no same-file check, so a removed `it()` in one file plus an added `//`
  comment (or `.toBeTruthy()`) in an *unrelated* file fired a HIGH finding pointing
  at the wrong file. Both rules now group changed lines by file and only fire
  within a single file. Same-file cases (the intended signal) still fire;
  cross-file cases no longer do. Regression tests added.