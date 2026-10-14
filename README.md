# Gullbert

**A tiny seagull with absolutely no respect for your desktop.**

![Gullbert, an original pixel seagull](art/gullbert.gif)

Gullbert waddles across your desktop, demands chips, has opinions, and occasionally leaves a little gift. An offline desktop toy for macOS and Windows, built with Tauri and TypeScript. No account, analytics, cloud AI service, or runtime network access. Optional local vision on macOS reads a small screen region with your permission.

This is an early v0.1 preview. Apple Silicon macOS has had local testing; Windows and Intel Mac still need native testing before a stable release. Current packages are unsigned or ad-hoc signed and are not notarized, so downloaded builds may trigger platform security prompts.

## Meet your new nuisance

- Feed him chips, leave a snack bag, catch him stealing it, or watch him get his head stuck inside.
- Let him roam, nap, preen, and develop passing opinions about his surroundings.
- Send him to fetch questionable treasures and remember a favourite loitering spot.
- Blow bubbles, run a bath, toss chips, choose a tiny hat, and invite rival birds.
- Poke him, scratch his head, or drag him somewhere else. Repeated pickups provoke increasingly petty revenge.
- Aim a poop run, clean up his mess, or witness a rare baguette parade.
- Fish for the typing caret, steal pretend letters, and build a punctuation nest. Approach with the pointer and he suddenly becomes a very innocent bird.

Everything happens locally. There are no hunger chores, streaks, or penalties for being away.

## Controls

The control room and menu bar / system tray expose the main actions. Closing the control room leaves Gullbert running; choose **Quit** to exit. Nothing is added to startup.

| Action                              | Shortcut               |
| ----------------------------------- | ---------------------- |
| Summon beside the cursor            | Ctrl + Alt + G         |
| Hide Gullbert and his mess          | Ctrl + Alt + Shift + G |
| Clean the screen / cancel targeting | Ctrl + Alt + X         |
| Poop at the current cursor position | Ctrl + Alt + P         |
| Cancel targeting / release cursor   | Escape                 |

On Mac, Alt means **Option** and Ctrl means **Control**. If another app owns a shortcut, the control room reports it and the tray remains available.

**Play and placement.** Use the control room to feed, play, or start a routine. Actions such as **Poop here…**, **Place chip bag…**, and **Chip toss…** temporarily capture a click to choose a target. Escape or **Never mind** cancels; a 12-second failsafe restores click-through. The underlying app does not receive that placement click. Car detection is manual: choose the car yourself.

**Direct interaction.** Hover over his head for a scratch, click to poke, or hold and drag to pick him up. Click loose splats, chips, bags, and discarded cones to remove them. Other desktop areas pass clicks through. **Focused tidy mode…** captures repeated cleanup clicks until Done, Escape, or its 30-second timeout. Belongings and objects used in active scenes are protected.

**Cursor mischief.** Ordinary nibbling is cosmetic. **Eat cursor** and a Public enemy pickup chase can briefly tug the real pointer. Each catch lasts at most 1.2 seconds; Escape, Hide, Pause, Stop routine, or a replacement command releases it. In the browser playground, the catch uses a pretend pointer.

**Typing mischief.** In supported text fields, caret movement attracts Gullbert. **Menace** fishes and occasionally carries away a decorative `o`; **Public enemy** steals punctuation more often and adds it to a nest. **Polite-ish** disables caret sensing. Moving the pointer toward him within about 120 pixels makes him freeze and conceal his loot; he resumes after you move away. Each caper lasts at most 22 seconds. Pause, Hide, Stop routine, a new command, or changing mischief cancels it. The nest holds up to 12 pieces for the current session; **Clean the screen** removes it.

**Caret mode** uses Accessibility on macOS: choose **Preferences → Caret fishing → Enable access**, then allow Gullbert under **System Settings → Privacy & Security → Accessibility**. On Windows it uses the standard system caret. Some apps, including some web-based editors, do not expose usable caret geometry. Enabling permission alone does not guarantee detection. This mode reads only geometry and a position marker; it does not capture screenshots or read document text. Arrow keys or scrolling can also attract him. The stolen glyphs in caret mode are decorative.

**Local vision (macOS 14+)** works independently of caret support. Turn on **Local vision** in Preferences and use **Allow screen access** to grant **Screen & System Audio Recording** access in System Settings. Restart if macOS requests it. Point near visible text on Gullbert’s display; he can hunt existing chat messages and other words without waiting for typing. The control room reports looking, text found, no text, or missing permission. A stationary pointer attracts him; moving it toward him makes him act innocent.

Vision captures a 640 × 360 logical-pixel region around the pointer, clipped to that display, at most once every two seconds after the previous scan finishes. Gullbert’s own windows are excluded. Apple Vision recognizes text on-device, selects the nearest word, and passes its position plus one printable character to the routine. The screenshots and recognized strings stay in memory only during processing; nothing is saved or sent. He carries a cosmetic copy of the character, chewing it into punctuation for his nest. He can recognize text, but does not determine whether it is an editable field or understand its meaning. **Pause**, **Hide**, **Polite-ish**, or switching vision off stops new scans. The browser playground has a typing area for trying the routine without desktop permissions.

**Quiet time.** Sound is off by default. **Pause autonomous antics** stops new unsolicited routines; explicit play buttons still work. **Polite-ish** permits calm roaming and bird behaviour without random gags. **Stop routine** cancels the current activity. Hiding stops simulation time, suspends ordinary routines, and cancels cursor and guest encounters.

**Belongings.** Completed gifts appear in **Questionable treasures**. The favourite spot, collection, and hat survive restarts and cleanup. **Clear favourite spot** forgets the perch. Summoning moves the overlay to the display containing your cursor; Gullbert occupies one display at a time.

## Run from source

Install Node.js 22+, the stable Rust toolchain, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/): Xcode Command Line Tools on macOS; Microsoft C++ Build Tools and WebView2 on Windows.

```sh
npm ci
npm run dev
```

For the browser playground, only Node.js is needed:

```sh
npm ci
npm run preview
```

Open `http://127.0.0.1:4173`. The playground shares the app's simulation and rendering but does not create a desktop overlay. Source edits rebuild automatically; refresh to see changes. Set `PORT` for a different playground port; native development expects port 4173.

## Build and release

```sh
# macOS, for the current machine's architecture
npm run build -- --bundles app

# Windows, on Windows
npm run build -- --bundles nsis
```

Packages are written to `src-tauri/target/release/bundle/` unless you override the target directory. Quit any running Gullbert before testing a new build: a second launch communicates with the existing instance.

The [GitHub Actions workflow](.github/workflows/build.yml) checks the frontend, runs native tests, and builds Apple Silicon, Intel Mac, and Windows x64 packages on matching runners. Main-branch pushes and pull requests produce workflow artifacts. Pushing a `v*` tag creates a **draft GitHub Release** with zipped Mac apps and a Windows installer after all jobs pass. Review the draft before publishing; signing credentials are not configured.

Before a stable release, test downloaded packages on each supported platform, including installation, click-through, dragging, targeting, Escape, physical shortcuts, sound, and multiple displays. Browser tests and native unit tests do not establish desktop compatibility. Exclusive fullscreen apps and some virtual desktop configurations may hide the overlay. macOS transparency uses Tauri's private API option; distribution targets direct downloads rather than the Mac App Store.

## Development

```sh
npm test
npm run check
npm run format:check
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

The frontend has no runtime npm dependencies. Tauri uses the operating system's webview. TypeScript compiles into ignored `web-dist/`; tests exercise that emitted code. Preferences and remembered belongings live locally in `settings.json` and `roommate.json` in Tauri's application configuration directory. The playground uses separate browser local storage.

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture, testing, and contribution guidelines.

## License and credits

Code: [MIT](LICENSE). Original artwork and derived app icons: [CC0-1.0](art/LICENSE-CC0.txt). Dependencies retain their own licenses.

Inspired by the desktop-toy genre, including [Desktop Goose](https://samperson.itch.io/desktop-goose). This is an independent project with its own character and implementation; no Desktop Goose code or artwork is included.
