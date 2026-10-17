# Contributing to Gullbert

Small, funny, local. Start with `npm ci` and `npm run preview` to work in the browser playground. For the desktop app, follow the [source setup below](#run-from-source) and run `npm run dev`.

## Before submitting

```sh
npm test
npm run check
npm run lint
npm run format:check
cargo test --manifest-path src-tauri/Cargo.toml --locked
npm run test:routing
```

Use `npm run format` to format assets and documentation with Prettier, then fix code layout with ESLint. Use `npm run lint:fix` for code alone, or `npx eslint path/to/file.ts --fix` for a focused change.

ESLint owns TypeScript and JavaScript layout; Prettier ignores those files to preserve wrapped calls and chains. Lint enforces a strict 100-character limit, braces, block spacing, and simple ternaries.

Cyclomatic complexity above 10 per function produces a warning. Complexity warnings are advisory and do not fail local lint or CI; style errors still fail both. Lint checks never rewrite files unless explicitly run with `--fix`.

CI runs `npm run lint` and rejects style violations. Naming, meaningful statement groups, the three-check condition limit, and module ownership still require review. `npm run check` remains the TypeScript correctness check; Babel parses TypeScript syntax for linting without depending on the compiler version.

For native changes, also run `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, test the desktop overlay, and state which operating system you used. Check click-through, dragging, targeting, Escape, hiding, and shortcuts; browser mocks cannot verify OS input delivery. Include a screenshot or short clip for a new gag.

Keep autonomous actions infrequent and bounded. Commands take priority, hidden time does not accumulate events, and remembered belongings survive cleanup. Keep the core offline, without telemetry, cloud AI services, auto-start, or background network calls. Do not capture the screen, inspect text in other applications, or request Accessibility access. The explicit App updates flow may contact GitHub to discover and download signed releases. Discuss larger changes before adding dependencies.

Code contributions use MIT; artwork must declare its license. Do not submit third-party character packs without permission.

## Project map

| Path                        | Responsibility                                                   |
| --------------------------- | ---------------------------------------------------------------- |
| `src/simulation/`           | Engine, state, movement, persistence normalization, and catalogs |
| `src/simulation/behaviors/` | Finite routines, snacks, interaction, and theatre                |
| `src/ui/controls/`          | Control-room logic and styles                                    |
| `src/ui/pet/`               | Overlay wiring, rendering, and styles                            |
| `src/platform/`             | Native bridge, pointer tracking, storage, and audio              |
| `src/assets/`               | Runtime sprite sheets and editable SVG props                     |
| `src-tauri/src/`            | Native windows, tray, shortcuts, storage, and input leases       |
| `scripts/`                  | Frontend build and browser preview                               |
| `tests/`                    | Behaviour and persistence tests                                  |
| `art/`                      | Current editable artwork and source assets                       |

The desktop control room uses `src/index.html`, the public browser playground uses `src/playground.html`, and both load `src/pet.html` for the bird. The Pages build publishes the playground as its root `index.html` without changing the desktop entry point. Keep CSS beside its UI. CSS asset URLs are relative to the stylesheet; image URLs assigned to DOM nodes are relative to the page.

## Implementation boundaries

Keep TypeScript strict checking enabled and use `.js` extensions in local imports, matching emitted modules. `npm test` builds the frontend and runs Node tests against `web-dist/`. Do not edit or commit build output. Use `.scratch/` for disposable captures and experiments; it is ignored.

The simulation owns state and contains no browser or native dependencies. `Gullbert` coordinates command priority, interruption, and activity transitions. Its composed owners keep body movement, props, belongings, food policy, speech, moods, and interaction history private. Request meaningful operations instead of assigning state. Normal completion, interruption, and hide/resume have distinct outcomes; preserve these distinctions in each routine lifecycle.

Keep DOM, native calls, storage, audio, and wall-clock scheduling outside the simulation. `PetApplication` owns startup, shutdown, timers, subscriptions, persistence, and outstanding native work through explicitly supplied dependencies. `pet.ts` only assembles those dependencies. Renderers consume detached, read-only `PetPresentation` snapshots; they must not inspect the runtime or import behavior implementations. Use `inspect()` for diagnostic observations and behavioral assertions, never as a mutation interface.

Durable memory has one simulation writer and a local in-memory cache. Native persistence uses `memory.sqlite3`: a transaction saves learned state and the latest 200 structured experiences together. `memory_store.rs` imports the legacy `roommate.json` once without deleting it. Normalize new fields through `src/simulation/memory.ts`; record completed experiences with the injected wall clock and original display geometry, never moods, in-flight rewards, screen text, or scene clocks. Failed native initialization must not overwrite unread memory. The browser playground keeps the same snapshot in local storage.

Public action identity, explicit launcher aliases, visibility, and Targeting preparation live in `src/actions/catalog.json`. Controls submit action names; preview and desktop routing own effect ordering. Keep labels and menu layout in presentation code, and keep private simulation commands and additional routines outside this catalog. TypeScript reads its action names directly; Cargo validates and generates Rust routing in `OUT_DIR` without a frontend build.

Targeting notices carry the native lease generation (or a preview identity). Successful placement releases capture before selection delivery; abandonment cancels a pending reward, normal tidy completion finishes tidying, and replacement only closes the old view. Desktop Escape goes through the native input owner. Frontend expiry remains a fallback when native terminal delivery fails.

`npm run test:routing` builds the frontend, obtains event traces through the real Rust action router and native input lifecycle with recorded OS effects, and delivers them to `PetApplication` with real `Gullbert`. It requires the same native build prerequisites as Cargo tests. Plain `npm test` runs preview and application regressions without native build tools; the native trace cases are skipped there. Neither test mode verifies OS input delivery.

### Readability and module depth

Use explicit blocks for every `if`, `else`, and loop in the TypeScript runtime. Express value and action choices with `if` blocks instead of ternary expressions. Use function declarations for named functions, and explicit bodies for callbacks. Keep one variable declaration per statement. Optional property access and nullish defaults are useful for reading optional data; avoid hiding state transitions in expressions.

Use comments for constraints, ownership, platform quirks, and decisions that the code cannot explain on its own. Remove comments that repeat a name or narrate a straightforward statement. Keep user-facing behaviour in the README and implementation guidance here.

Use classes when a module owns a lifecycle: private state, a few public operations, and named private methods for transitions. Built-in routines share `Routine` for start, update, completion, interruption, visibility, and presentation. Keep phase transitions inside their owner. Prefer composition and focused capability interfaces; routine code must not receive the engine, native input, storage, or wall-clock scheduling. Use ordinary functions for stateless geometry and calculations. Do not add plugin discovery, loading, or distribution to the routine seam.

Additional routines can be supplied as `routines` factories in the fourth `Gullbert` constructor argument. Each factory receives the limited `RoutineCapabilities` interface in `src/simulation/routine.ts`; built-in owners use the same lifecycle with focused internal domain operations. Core commands retain priority. Return `"complete"` from `update()` for normal completion; use `interrupt()` for cancellation cleanup and `visibility()` for hide/resume behavior. The runtime cleans up scoped props and disables effect capabilities when the routine ends. This is an in-process extension seam, not a plugin system.

Keep modules deep: callers should request an operation without managing its timers, pending native replies, or stale-reply checks. The engine's private stepping phases preserve routine priority behind `step(delta)`. Keep hit-region geometry in `src/simulation/interaction.ts` so rendering and native capture use the same rectangles. Test behavior through these interfaces and preserve interruption, random-choice ordering, and lease ownership during refactors.

Cleanup selection runs before generic command resets so removing loose mess cannot cancel a flight. The renderer and native bridge share object geometry and stacking order. Scene-owned props and remembered belongings are protected from direct cleanup.

Native input capture must expire independently of frontend updates. Ordinary placement has a 12-second deadline; focused tidying has a fixed 30-second deadline. Direct interaction uses short leases in `src-tauri/src/native_input/interaction.rs`, with a native exit check that restores click-through on departure or a stalled frontend. Explicit targeting takes precedence.

`src-tauri/src/native_input/` owns targeting, pickup, cursor authorization, Escape, click-through, and failure recovery. Its lease state and effects seam are private. `desktop.rs` supplies Tauri effects and queues commands, shortcuts, tray actions, and deadline callbacks on the main thread; reentrant callbacks wait until the current operation finishes, and no state lock is held across OS calls. Keep new native input entry points on that dispatch path. Monitor selection and overlay positioning live in `windows.rs`.

The Rust desktop shell uses responsibility-based modules within one binary crate:

| Module                           | Responsibility                                                        |
| -------------------------------- | --------------------------------------------------------------------- |
| `main.rs`                        | Startup, plugin and command registration, window lifecycle            |
| `actions.rs`                     | Shared action routing, action messages, and launcher flags            |
| `windows.rs`                     | Window lookup, monitor selection, and cursor coordinate conversion    |
| `state.rs`                       | Application state, preference persistence, and control-room snapshots |
| `roommate.rs`, `memory_store.rs` | Local SQLite memory, legacy migration, and roommate status messages   |
| `tray.rs`                        | Tray menus, labels, and menu events                                   |
| `shortcuts.rs`                   | Global shortcut registration and event routing                        |
| `native_input/`                  | Input ownership, deadlines, OS effects, and serialized dispatch       |

Keep commands beside the responsibility they expose, and register their qualified paths in `main.rs`; frontend command names stay unchanged. Keep implementation helpers private and use `pub(crate)` only where another module needs access. Group related types and behavior together rather than creating one file per type. Unit tests stay with their owning module; the larger input lifecycle suite remains in `native_input/tests.rs`.

This follows [Rust's module organization](https://doc.rust-lang.org/book/ch07-05-separating-modules-into-different-files.html) and [Tauri's support for commands in separate modules](https://v2.tauri.app/develop/calling-rust/#defining-commands-in-a-separate-module). The desktop-only app does not currently need a separate library crate or workspace.

Lifecycle tests use a recording adapter and a controlled clock through the same input module as the app. Run them locally with the Cargo command above. The build workflow runs native tests on Apple Silicon Mac, Intel Mac, and Windows runners for main-branch pushes, `v*` tags, and manual builds. Pull requests run frontend checks; use a manual build with no release tag to validate native changes before merging. Native tests run in parallel with packaging, and a draft release requires both to pass on every platform. Main builds refresh the release and test caches using the workflow's pinned Rust version. Each package is built and tested on its native architecture. CI checks do not replace hands-on desktop interaction testing.

Pickup timing uses elapsed wall time for its rolling history and revenge budget; animation and prop expiry use visible simulation time. `pickup-drag.ts` owns each gesture's IPC and fixed hold deadline. Stale acquisition, release, or heartbeat replies cannot change a newer gesture. Cursor movement requires its own bounded authorization; non-cursor retaliation may retain Escape without authorizing pointer movement.

## Native smoke-test commands

While Gullbert is running, a second invocation of its executable accepts local commands such as `--summon`, `--hide`, `--show`, `--clean`, `--poop-here`, `--feed`, `--place-bag`, `--eat-cursor`, `--bring-gift`, `--place-perch`, `--tidy`, and `--cancel`. See the command mapping in `src-tauri/src/actions.rs` for all supported flags. These arguments are ignored on first launch, which opens the control room normally.

## Giving the birds something to say

Edit [`src/simulation/dialogue.json`](src/simulation/dialogue.json) for character speech, postcard captions, and treasure descriptions. No TypeScript edits are needed to change existing lines or add alternatives to a pool. The catalog is bundled locally at build time; rebuild or use the preview watcher to see edits. Installed copies do not hot-load this source file.

- `gullbert.general`, `greetings`, `moods`, and `hats` contain everyday remarks. Other blocks match the interaction or routine: `cleanup`, `crime`, `cursor`, `gags`, `gifts`, `perch`, `pickup`, `quiet`, `snacks`, `theatre`, and `touch`.
- Arrays of strings are pools of alternatives. Append a line to add variety. Keep at least one nonblank, distinct entry. Greetings and moods avoid immediate repeats when multiple options exist; cleanup cycles its responses; hats and general remarks use the simulation's random selection.
- Single strings are fixed cues for a particular action or punchline. Edit their values while retaining the keys. Adding a new situation or turning a fixed cue into a pool needs a corresponding behavior change.
- `gullbert.greetings.treasure` uses `{item}` for the name of an actually owned treasure. Keep that placeholder in each alternative; other placeholders are not supported.
- `guests.pigeon` and `guests.seagull` group conversations by scene beat. Each beat is an array of paired `{ "gullbert": "...", "visitor": "..." }` exchanges. Append a complete pair to add an alternative. An empty string means that speaker stays silent; at least one must speak. Keep replies together so the joke makes sense.

Guest alternatives cycle by visit, separately for each species, starting with the first pair. The same visit index is used across beats, wrapping within each beat's array. For a linked conversation, add a matching alternative at the same index in every beat; standalone pairs can be added to just one beat. Rotation survives restarts through saved visitor counts. Gullbert speaks first, then the visitor replies after a short pause; each line gets reading time based on its length. Interruption clears both bubbles and pending replies. Trick dialogue pools cycle using saved completed-performance counts.

Keep lines short enough to read in the existing bubble duration. Gullbert is a territorial, self-important snack enthusiast; the pigeon is a dry, unimpressed visitor; the rival seagull is loudly competitive. For example, a pigeon exchange can be:

```json
{
  "gullbert": "this is a private potato estate.",
  "visitor": "I shall inform the flock."
}
```

Run `npm test` and `npm run check` after editing. The build rejects empty pools, blank speech, duplicate alternatives, and invalid placeholders with a catalog path. Type checking catches missing or incompatible entries used by the behaviors. Behavior timings, poses, and sound effects stay in TypeScript.

## Run from source

Install Node.js 22+, the current stable Rust toolchain (at least 1.90), and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/): Xcode Command Line Tools on macOS; Microsoft C++ Build Tools with the desktop C++ workload and WebView2 on Windows.

```sh
npm ci
npm run dev
```

For the browser playground, only Node.js is needed:

```sh
npm ci
npm run preview
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The playground shares the app's simulation and rendering but does not create a desktop overlay or control the real pointer. Source edits rebuild automatically; refresh to see changes. Set `PORT` for a different playground port; native development expects port 4173.

### Browser preview builds

`npm run preview` opens the standalone playground at the local site root. For control-room development, open `/index.html` on that local server. `npm run build:pages` creates `pages-dist/` with the playground as its entry point; GitHub Pages publishes that folder. Native builds keep the desktop control room in `web-dist/index.html`.

## Build and release

### Publish the browser preview and downloads

GitHub Pages hosts the browser playground; GitHub Releases hosts the desktop downloads. In the repository's **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. After merging to `main`, the [Pages workflow](.github/workflows/pages.yml) tests and publishes `pages-dist/` at [mihhail-r.github.io/gullbert/](https://mihhail-r.github.io/gullbert/). You can also run **Publish browser preview** manually on `main`.

To release desktop packages, push a new version tag such as `v0.3.0-beta.5`. The build workflow takes the app version from the tag and creates a draft release containing Apple Silicon and Intel Mac DMGs, a Windows x64 installer, and signed update packages. Test the downloaded packages, edit the release notes, and publish the draft. Preview tags are marked **pre-release** automatically. Draft releases are not public downloads.

The playground's download button opens [all releases](https://github.com/Mihhail-R/gullbert/releases), so preview releases remain discoverable without relying on GitHub's latest stable release redirect. Pages updates on `main` independently of desktop releases; publish a new tag when you want updated installers.

### Build desktop packages locally

```sh
# macOS, for the current machine's architecture
npm run build -- --bundles app,dmg

# Windows, on Windows
npm run build -- --bundles nsis
```

These commands write packages to `src-tauri/target/release/bundle/` unless you override the target directory. Passing `--target <triple>` adds that target beneath `src-tauri/target/`, as in CI. Quit any running Gullbert before testing a new build: a second launch communicates with the existing instance.

The [GitHub Actions workflow](.github/workflows/build.yml) checks the frontend on pushes and pull requests. On `main`, it also builds native binaries without installers and runs native tests on Apple Silicon, Intel Mac, and Windows x64. These jobs refresh separate release and test dependency caches that future tags can restore. CI pins Rust with `RUST_TOOLCHAIN` in the workflow; upgrade it deliberately and let a `main` build finish to warm the new caches before releasing. Tags restore caches without saving tag-specific copies.

Version-tag pushes build signed packages and run native tests in parallel on all three platforms. The draft release waits for every packaging and test job to pass. CI sets every embedded version from the tag before checking and building, including the npm and Cargo lockfiles. This only changes the runner's checkout; no version-bump commit is needed. Branch checks still require the checked-in versions to agree. For a local version change, run `node scripts/release.mjs prepare v0.3.0-beta.5`, then `node scripts/release.mjs check`. The visible version is generated from this metadata; native builds display the running app's version.

To retry a failed release without creating or moving a tag, open **Actions → Build Gullbert → Run workflow**, select `main`, and enter the existing tag (for example `v0.3.0-beta.5`) in **release_tag**. The workflow checks out that tag's exact source, applies the selected branch's release tooling, and shares the validated version metadata across all builds and the release manifest. It uploads packages to the same release. New releases are drafts for review; an already-published release stays published, so its uploaded packages become public immediately. Leaving **release_tag** empty runs frontend checks, unsigned native builds, and native tests without creating a release; on `main`, this also refreshes the shared caches. Use a retry when release tooling failed; an application source fix needs a new release tag.

Release builds require the `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret. The matching public key is embedded in `tauri.conf.json`. Back up the private key securely outside the repository: losing it prevents updates to existing installations. Local release builds also need `TAURI_SIGNING_PRIVATE_KEY` (key contents or file path) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key is encrypted. For a local build without update artifacts, pass `--config '{"bundle":{"createUpdaterArtifacts":false}}'` to Tauri.

Push a tag such as `v0.3.0-beta.1` only after merging the intended source. CI produces a **draft GitHub Release** containing versioned Mac DMGs, a Windows installer, signed update packages, and a combined `latest.json` manifest with all three platforms. Tags containing a hyphen are marked prerelease. Review and publish the draft to make it discoverable by the app; drafts are never offered. The updater discovers published releases through GitHub's API, so beta releases do not depend on GitHub's stable-only `/latest` redirect. Mac code signing happens before update archives are generated; do not modify packaged binaries after signing.

Before publishing the first updater release, test a signed upgrade between two distinct versions on each supported platform, including a rejected signature, an interrupted download, and preserved settings. GitHub API rate limits, connectivity failures, and missing update assets surface as errors rather than an “up to date” result.

The macOS deployment target is 11.0. Linux desktop builds are not part of the supported build matrix. Before a stable release, test downloaded packages on each target platform, including installation, click-through, dragging, targeting, Escape, physical shortcuts, sound, and multiple displays. Browser tests and native unit tests do not establish desktop compatibility. Exclusive fullscreen apps and some virtual desktop configurations may hide the overlay. macOS transparency uses Tauri's private API option; distribution targets direct downloads rather than the Mac App Store.
