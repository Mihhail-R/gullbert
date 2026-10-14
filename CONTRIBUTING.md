# Contributing to Gullbert

Small, funny, local. Start with `npm ci` and `npm run preview` to work in the browser playground. For the desktop app, follow the [README's source setup](README.md#run-from-source) and run `npm run dev`.

## Before submitting

```sh
npm test
npm run check
npm run format:check
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

Use `npm run format` to apply frontend and documentation formatting. For native changes, also run `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, test the desktop overlay, and state which operating system you used. Check click-through, dragging, targeting, Escape, hiding, and shortcuts; browser mocks cannot verify OS input delivery. Include a screenshot or short clip for a new gag.

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

Use comments for constraints, ownership, platform quirks, and decisions that the code cannot explain on its own. Remove comments that repeat a name or narrate a straightforward statement. Keep user-facing behaviour in the README and implementation guidance here.

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

Lifecycle tests use a recording adapter and a controlled clock through the same input module as the app. Run them locally with the Cargo command above. The build workflow runs native tests on Apple Silicon Mac, Intel Mac, and Windows runners for main-branch pushes, `v*` tags, pull requests, and manual builds. Each package is built and tested on its native architecture. CI checks do not replace hands-on desktop interaction testing.

Pickup timing uses elapsed wall time for its rolling history and revenge budget; animation and prop expiry use visible simulation time. `pickup-drag.ts` owns each gesture's IPC and fixed hold deadline. Stale acquisition, release, or heartbeat replies cannot change a newer gesture. Cursor movement requires its own bounded authorization; non-cursor retaliation may retain Escape without authorizing pointer movement.

## Native smoke-test commands

While Gullbert is running, a second invocation of its executable accepts local commands such as `--summon`, `--hide`, `--show`, `--clean`, `--poop-here`, `--feed`, `--place-bag`, `--eat-cursor`, `--bring-gift`, `--place-perch`, `--tidy`, and `--cancel`. See the command mapping in `src-tauri/src/actions.rs` for all supported flags. These arguments are ignored on first launch, which opens the control room normally.

## Local vision checks

`cargo test --manifest-path src-tauri/Cargo.toml --locked` also checks OCR result validation. Actual ScreenCaptureKit capture and permission delivery require manual desktop testing. The build compiles `native/vision.m` with Apple clang for the selected architecture; ScreenCaptureKit is weak-linked so the base app can still launch on macOS 11–13 with vision unavailable.
