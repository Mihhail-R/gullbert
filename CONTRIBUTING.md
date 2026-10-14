# Contributing to Gullbert

Small, funny, local. Start with `npm ci` and `npm run preview` to work in the browser playground. For the desktop app, install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and run `npm run dev`.

## Before submitting

```sh
npm test
npm run check
npm run format:check
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

Use `npm run format` to apply frontend and documentation formatting. For native changes, test the desktop overlay and state which operating system you used. Check click-through, dragging, targeting, Escape, hiding, and shortcuts; browser mocks cannot verify OS input delivery. Include a screenshot or short clip for a new gag.

Keep autonomous actions infrequent and bounded. Commands take priority, hidden time does not accumulate events, and remembered belongings survive cleanup. Keep the core offline, without telemetry, cloud AI services, auto-start, or background network calls. Screen capture is confined to the explicitly enabled local-vision feature: transient, cropped, and processed on-device. Discuss larger changes before adding dependencies.

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

The HTML entry points stay at `src/index.html` and `src/pet.html` so browser and Tauri URLs remain stable. Keep CSS beside its UI. CSS asset URLs are relative to the stylesheet; image URLs assigned to DOM nodes are relative to the page.

## Implementation boundaries

Keep TypeScript strict checking enabled and use `.js` extensions in local imports, matching emitted modules. `npm test` builds the frontend and runs Node tests against `web-dist/`. Do not edit or commit build output. Use `.scratch/` for disposable captures and experiments; it is ignored.

The simulation owns state and contains no browser or native dependencies. `Gullbert` coordinates command priority, interruption, and activity transitions. Its composed owners keep body movement, props, belongings, food policy, speech, moods, and interaction history private. Request meaningful operations instead of assigning state. Normal completion, interruption, and hide/resume have distinct outcomes; preserve these distinctions in each routine lifecycle.

Keep DOM, native calls, storage, audio, and wall-clock scheduling outside the simulation. `PetApplication` owns startup, shutdown, timers, subscriptions, persistence, and outstanding native work through explicitly supplied dependencies. `pet.ts` only assembles those dependencies. Renderers consume detached, read-only `PetPresentation` snapshots; they must not inspect the runtime or import behavior implementations. Use `inspect()` for diagnostic observations and behavioral assertions, never as a mutation interface.

Durable belongings have one simulation writer and a separate `roommate.json` snapshot. Normalize new fields through `src/simulation/memory.ts`; never persist moods, in-flight rewards, or scene clocks. Failed native initialization must not overwrite unread belongings.

### Readability and module depth

Use explicit blocks for every `if`, `else`, and loop in the TypeScript runtime. Express value and action choices with `if` blocks instead of ternary expressions. Use function declarations for named functions, and explicit bodies for callbacks. Keep one variable declaration per statement. Optional property access and nullish defaults are useful for reading optional data; avoid hiding state transitions in expressions.

Use classes when a module owns a lifecycle: private state, a few public operations, and named private methods for transitions. Built-in routines share `Routine` for start, update, completion, interruption, visibility, and presentation. Keep phase transitions inside their owner. Prefer composition and focused capability interfaces; routine code must not receive the engine, native input, storage, or wall-clock scheduling. Use ordinary functions for stateless geometry and calculations. Do not add plugin discovery, loading, or distribution to the routine seam.

Additional routines can be supplied as `routines` factories in the fourth `Gullbert` constructor argument. Each factory receives the limited `RoutineCapabilities` interface in `src/simulation/routine.ts`; built-in owners use the same lifecycle with focused internal domain operations. Core commands retain priority. Return `"complete"` from `update()` for normal completion; use `interrupt()` for cancellation cleanup and `visibility()` for hide/resume behavior. The runtime cleans up scoped props and disables effect capabilities when the routine ends. This is an in-process extension seam, not a plugin system.

Keep modules deep: callers should request an operation without managing its timers, pending native replies, or stale-reply checks. The engine's private stepping phases preserve routine priority behind `step(delta)`. Keep hit-region geometry in `src/simulation/interaction.ts` so rendering and native capture use the same rectangles. Test behavior through these interfaces and preserve interruption, random-choice ordering, and lease ownership during refactors.

Cleanup selection runs before generic command resets so removing loose mess cannot cancel a flight. The renderer and native bridge share object geometry and stacking order. Scene-owned props and remembered belongings are protected from direct cleanup.

Native input capture must expire independently of frontend updates. Ordinary placement has a 12-second deadline; focused tidying has a fixed 30-second deadline. Direct interaction uses short leases in `src-tauri/src/native_input/interaction.rs`, with a native exit check that restores click-through on departure or a stalled frontend. Explicit targeting takes precedence.

`src-tauri/src/native_input/` owns targeting, pickup, cursor authorization, Escape, click-through, and failure recovery. Its lease state and effects seam are private. `desktop.rs` supplies Tauri effects and queues commands, shortcuts, tray actions, and deadline callbacks on the main thread; reentrant callbacks wait until the current operation finishes, and no state lock is held across OS calls. Keep new native input entry points on that dispatch path. Monitor selection and overlay positioning live in `windows.rs`.

The Rust desktop shell uses responsibility-based modules within one binary crate:

| Module                          | Responsibility                                                               |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `main.rs`                       | Startup, plugin and command registration, window lifecycle                   |
| `actions.rs`                    | Shared action routing, action messages, and launcher flags                   |
| `windows.rs`                    | Window lookup, monitor selection, and cursor coordinate conversion           |
| `vision.rs` / `native/vision.m` | Opt-in local screen OCR, throttling, permission and detection status         |
| `caret.rs`                      | Read-only caret geometry, Accessibility access, and coordinate normalization |
| `state.rs`                      | Application state, preference persistence, and control-room snapshots        |
| `roommate.rs`                   | Belongings persistence and roommate status messages                          |
| `tray.rs`                       | Tray menus, labels, and menu events                                          |
| `shortcuts.rs`                  | Global shortcut registration and event routing                               |
| `native_input/`                 | Input ownership, deadlines, OS effects, and serialized dispatch              |

Keep commands beside the responsibility they expose, and register their qualified paths in `main.rs`; frontend command names stay unchanged. Keep implementation helpers private and use `pub(crate)` only where another module needs access. Group related types and behavior together rather than creating one file per type. Unit tests stay with their owning module; the larger input lifecycle suite remains in `native_input/tests.rs`.

This follows [Rust's module organization](https://doc.rust-lang.org/book/ch07-05-separating-modules-into-different-files.html) and [Tauri's support for commands in separate modules](https://v2.tauri.app/develop/calling-rust/#defining-commands-in-a-separate-module). The desktop-only app does not currently need a separate library crate or workspace.

Lifecycle tests use a recording adapter and a controlled clock through the same input module as the app. Run them locally with the Cargo command above. The build workflow runs these tests on Apple Silicon Mac, Intel Mac, and Windows runners for every push, pull request, and manual build. Each package is built and tested on its native architecture. CI checks do not replace hands-on desktop interaction testing.

Pickup timing uses elapsed wall time for its rolling history and revenge budget; animation and prop expiry use visible simulation time. `pickup-drag.ts` owns each gesture's IPC and fixed hold deadline. Stale acquisition, release, or heartbeat replies cannot change a newer gesture. Cursor movement requires its own bounded authorization; non-cursor retaliation may retain Escape without authorizing pointer movement.

## Native smoke-test commands

While Gullbert is running, a second invocation of its executable accepts local commands such as `--summon`, `--hide`, `--show`, `--clean`, `--poop-here`, `--feed`, `--place-bag`, `--eat-cursor`, `--bring-gift`, `--place-perch`, `--tidy`, and `--cancel`. See the command mapping in `src-tauri/src/actions.rs` for all supported flags. These arguments are ignored on first launch, which opens the control room normally.

## Local vision checks

`cargo test --manifest-path src-tauri/Cargo.toml --locked` also checks OCR result validation. Actual ScreenCaptureKit capture and permission delivery require manual desktop testing. The build compiles `native/vision.m` with Apple clang for the selected architecture; ScreenCaptureKit is weak-linked so the base app can still launch on macOS 11–13 with vision unavailable.

## Giving the birds something to say

Edit [`src/simulation/dialogue.json`](src/simulation/dialogue.json) for character speech, postcard captions, and treasure descriptions. No TypeScript edits are needed to change existing lines or add alternatives to a pool. The catalog is bundled locally at build time; rebuild or use the preview watcher to see edits. Installed copies do not hot-load this source file.

- `gullbert.general`, `greetings`, `moods`, and `hats` contain everyday remarks. Other blocks match the interaction or routine: `cleanup`, `crime`, `cursor`, `gags`, `gifts`, `perch`, `pickup`, `quiet`, `snacks`, `theatre`, `touch`, and `typing`.
- Arrays of strings are pools of alternatives. Append a line to add variety. Keep at least one nonblank, distinct entry. Greetings and moods avoid immediate repeats when multiple options exist; cleanup cycles its responses; hats and general remarks use the simulation's random selection.
- Single strings are fixed cues for a particular action or punchline. Edit their values while retaining the keys. Adding a new situation or turning a fixed cue into a pool needs a corresponding behavior change.
- `gullbert.greetings.treasure` uses `{item}` for the name of an actually owned treasure. Keep that placeholder in each alternative; other placeholders are not supported.
- `guests.pigeon` and `guests.seagull` group conversations by scene beat. Each beat is an array of paired `{ "gullbert": "...", "visitor": "..." }` exchanges. Append a complete pair to add an alternative. An empty string means that speaker stays silent; at least one must speak. Keep replies together so the joke makes sense.

Guest alternatives cycle by visit, separately for each species, starting with the first pair. The same visit index is used across beats, wrapping within each beat's array. For a linked conversation, add a matching alternative at the same index in every beat; standalone pairs can be added to just one beat. Rotation resets when the app restarts. Interruption still clears both bubbles.

Keep lines short enough to read in the existing bubble duration. Gullbert is a territorial, self-important snack enthusiast; the pigeon is a dry, unimpressed visitor; the rival seagull is loudly competitive. For example, a pigeon exchange can be:

```json
{
  "gullbert": "this is a private potato estate.",
  "visitor": "I shall inform the flock."
}
```

Run `npm test` and `npm run check` after editing. The build rejects empty pools, blank speech, duplicate alternatives, and invalid placeholders with a catalog path. Type checking catches missing or incompatible entries used by the behaviors. Behavior timings, poses, and sound effects stay in TypeScript.
