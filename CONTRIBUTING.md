# Contributing to Gullbert

## Run locally

Install Node.js 22+. Desktop development also needs Rust 1.90+ and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm ci
npm run preview  # Browser playground at http://127.0.0.1:4173
npm run dev      # Desktop app
```

Quit any running Gullbert before testing a new desktop build; a second launch talks to the existing instance.

## Making changes

- Keep each pull request focused on one change. Explain the problem it solves and any intentional behavior changes.
- Follow the existing formatter and lint rules; avoid unrelated refactors.
- For bug fixes, include reproduction steps and a regression test where practical. Update documentation when usage or setup changes.
- Commit source files, not generated builds or temporary files. Only contribute code and artwork you have permission to share, and declare artwork licenses.

## Code quality beyond lint

- Prefer the simplest solution that meets the current need (KISS). Do not build speculative features, extension points, or generic frameworks (YAGNI).
- Prefer guard clauses and early returns over nested conditionals. Keep every boolean condition to at most three atomic checks, including nested groups and named predicates. Split validation into meaningful steps; do not hide a large expression in a helper.
- Keep branching shallow. Use `switch`/`match` for alternatives on one value and lookup tables for simple mappings. Preserve evaluation order and side effects when refactoring.
- Name things for their purpose and include units where useful, such as `elapsedMs`. Comments should explain decisions or constraints, rather than restate the code.
- Keep related steps together and separate meaningful stages with blank lines. Extract helpers for meaningful rules or reusable operations; a cohesive longer function is better than a chain of trivial helpers.
- Apply SOLID pragmatically: give components focused responsibilities, keep interfaces small, preserve behavioral contracts, and separate domain rules from external dependencies. Introduce abstractions where they solve a concrete problem, not merely to satisfy a principle.
- Use objects to own related state, behavior, and lifecycle. Prefer composition over inheritance; use plain functions for stateless operations. Do not create classes or interfaces for every operation.
- Share domain operations before introducing configurable controllers or frameworks. Similar-looking code can stay separate when it has different reasons to change; share lifecycle machinery when its rules genuinely match.
- Extract a module when it can own related state and its complete lifecycle. File length alone is not a reason, especially if extraction just passes application state through callbacks.
- Improve the whole affected function and directly involved helpers when changing behavior. Review the changed control flow yourself; passing tests and lint does not establish readability. If a refactor reveals a bug, fix and regression-test it before continuing the refactor.

## Focused tests

Choose a concrete failure the test should catch: a lost preference, an interrupted action that
still produces effects, an expired native request affecting a new interaction, or a routine
that never finishes. Name the scenario and assert the outcome that distinguishes it from the bug.

- Test behavior through the smallest useful public boundary. Use the simulation for behavior,
  adapters for delivery and races, and DOM tests for controls the user interacts with.
- Keep each case independent, with its own state and bounded simulation waits. A test should pass
  when run by itself.
- Assert relevant results and side effects. Avoid private object shape, freezing mechanisms,
  RNG draw order, exact DOM structure, incidental dialogue, or every intermediate animation phase.
  Check timing, geometry, ordering, and text when they are the behavior under test.
- Keep representative success, failure, and boundary cases. Use a table when its rows describe
  distinct risks; avoid multiplying every action by every phase, interruption, and random seed.
- Put shared rendering and domain rules in one suite. Adapter tests should prove delivery through
  that adapter without repeating the full domain suite. Test count and coverage are not goals.

Run a focused case after building the frontend:

```sh
npm run build:web
node --test --test-name-pattern="failed preference saves" tests/controls-native.test.mjs
```

## Before submitting

```sh
npm test
npm run check
npm run lint
npm run format:check
npx playwright install chromium  # Once, and after Playwright upgrades
npm run test:browser
```

The browser smoke suite starts its own preview server on port 4188 and runs the real
playground, iframe application, and renderer in Chromium. It checks startup, sprite loading,
actions, targeting, cleanup, and hide/show, and fails on uncaught errors or failed requests.
On Linux, use `npx playwright install --with-deps chromium` to install system dependencies too.
Failed runs save screenshots and traces under `test-results/`.

For native or action-routing changes, also run:

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run test:routing
```

Use `npm run format` to apply formatting, or `npm run lint:fix` for JavaScript/TypeScript layout only. Review readability yourself; passing checks is not enough.

Describe how you tested the change. For desktop changes, name the OS and test the affected interactions in the desktop app; browser tests cannot verify native input. Include a screenshot or clip for visual changes.

## Releases

Supported targets are **Apple Silicon macOS and Windows x64**. Paid platform signing and Apple notarization are deferred; keep the README's installation caveats accurate. Cryptographic updater signatures are still required. Back up `TAURI_SIGNING_PRIVATE_KEY` securely.

The signing key belongs in a GitHub environment named `release`. Limit that environment's deployment branches and tags to `main` and `v*`. Generate the key with a password and store it as `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` in the same environment. Workflow actions are pinned by commit; when upgrading one, update the SHA together with its version comment.

Push a version tag such as `v1.0.0` or `v1.0.0-rc.1` after merging the intended changes. The [build workflow](.github/workflows/build.yml) sets embedded versions from the tag, tests both platforms, and creates a draft release. No version-bump commit is needed.

Before publishing, test the downloaded installers and an in-app upgrade with saved settings and memories on both platforms. Check sleep/wake, available display setups, and offline/interrupted updates. Record tested OS versions, write release notes and known limitations, then publish the draft.

Application fixes need a new tag. To retry a tooling failure, run **Build Gullbert** on `main` with the existing `release_tag`; replacing assets on a published release makes them public immediately. GitHub Pages updates separately on pushes to `main`.
