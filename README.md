# Gullbert

**A tiny seagull with absolutely no respect for your desktop.**

![Gullbert, an original pixel seagull](art/gullbert.gif)

Gullbert waddles across your desktop, demands chips, has opinions, and occasionally leaves a little gift. An offline desktop toy for macOS and Windows, built with Tauri and TypeScript. No account, analytics, cloud AI service, or background network requests. Optional local vision on macOS reads a small screen region with your permission.

This is an early v0.1 preview. Apple Silicon macOS has had local testing; Windows and Intel Mac still need native testing before a stable release. Current packages are unsigned or ad-hoc signed and are not notarized, so downloaded builds may trigger platform security prompts.

## Meet your new nuisance

- Feed him chips, leave a snack bag, catch him stealing it, or watch him get his head stuck inside.
- Let him roam, nap, preen, and develop passing opinions about his surroundings.
- Send him to fetch questionable treasures and remember a favourite loitering spot.
- Blow bubbles, run a bath, toss chips, choose a tiny hat, and invite rival birds.
- Watch him lean into head scratches, give an offended look when you stop, and hop happily after a chip.
- Dress him in a captain hat, traffic cone, fisherman’s beanie, paper crown, or fried egg.
- Poke him, scratch his head, or drag him somewhere else. Repeated pickups provoke increasingly petty revenge.
- Aim a poop run, clean up his mess, or start a baguette parade, a municipal inspection, or a questionable apology.
- Fish for the typing caret, steal pretend letters, and build a punctuation nest. Approach with the pointer and he suddenly becomes a very innocent bird.

Everything happens locally. There are no hunger chores, streaks, or penalties for being away.

## Controls

The control room and menu bar / system tray expose the main actions. Closing the control room leaves Gullbert running; choose **Quit** to exit. Nothing is added to startup. **Summon Gullbert** moves him to the display containing your cursor; he occupies one display at a time.

| Action                                | Shortcut               |
| ------------------------------------- | ---------------------- |
| Summon beside the cursor              | Ctrl + Alt + G         |
| Hide Gullbert and his mess            | Ctrl + Alt + Shift + G |
| Clean the evidence / cancel targeting | Ctrl + Alt + X         |
| Poop at the current cursor position   | Ctrl + Alt + P         |
| Cancel targeting / release cursor     | Escape                 |

On Mac, Alt means **Option** and Ctrl means **Control**. If another app owns a shortcut, the control room reports it and the tray remains available.

### Play, placement, and tidying

Use the control room to feed, play, or start a routine. **Poop here…**, **Place chip bag…**, **Favourite spot…**, and **Chip toss…** temporarily capture a click to choose a target. Escape or **Never mind** cancels; a 12-second failsafe restores click-through. The underlying app does not receive that placement click. Gullbert does not detect cars; choose the target yourself.

Hover over his head for a scratch, click to poke, or hold and drag to pick him up. Click loose splats, chips, bags, rubbish, and discarded cones to remove them. Other desktop areas pass clicks through. **Focused tidy mode…** captures repeated cleanup clicks until **Done**, Escape, or its 30-second timeout. Remembered belongings survive cleanup, and direct clicks leave objects used in active scenes alone. **Clean the evidence** removes all loose mess and the punctuation nest.

Ordinary cursor nibbling is cosmetic. **Eat cursor** and a **Public enemy** pickup chase can briefly tug the real pointer. Each catch lasts at most 1.2 seconds; Escape, **Send him away**, **Pause autonomous antics**, **Stop routine**, or a replacement command releases it. In the browser playground, the catch uses a pretend pointer.

### Quiet time and belongings

Sound is off by default. **Pause autonomous antics** stops new unsolicited routines; explicit play buttons still work. **Polite-ish** permits calm roaming and bird behaviour without random gags. **Stop routine** cancels the current activity. **Send him away** hides the overlay and its mess and stops simulation time. Ordinary routines are suspended; cursor encounters, typing capers, pickup retaliation, guest visits, and special gags end.

Completed gifts appear in **Questionable treasures**. The favourite spot, collection, and hat survive restarts and cleanup. **Clear favourite spot** forgets the perch. Moods, loose mess, and the punctuation nest last only for the current session.

## Typing mischief and screen access

In supported text fields, caret movement attracts Gullbert. **Menace** fishes and occasionally carries away a decorative `o`; **Public enemy** steals punctuation more often and adds it to a nest. **Polite-ish** disables sensing. Moving the pointer toward him within about 120 pixels makes him freeze and conceal his loot; he resumes after you move away.

Each caper lasts at most 22 seconds. Pausing, hiding, **Stop routine**, a new command, or changing mischief cancels it. The nest holds up to 12 pieces; **Clean the evidence** removes it. Neither sensing mode changes the text in your apps. The browser playground has a typing area for trying the routine without desktop permissions.

### Caret mode

On macOS, choose **Preferences → Caret fishing → Enable access**, then allow Gullbert under **System Settings → Privacy & Security → Accessibility**. On Windows, Gullbert uses the standard system caret without a separate permission prompt.

Some apps, including some web-based editors, do not expose usable caret geometry. Enabling permission alone does not guarantee detection. This mode reads the focused field's identity, caret geometry, and position marker; it does not capture screenshots, read document text, or monitor keystrokes. Arrow keys or scrolling can also attract him by moving the caret. The stolen glyphs are decorative.

### Local vision (macOS 14+)

Turn on **Preferences → Local vision** to use screen text instead of the caret. Grant screen-recording permission when prompted, or use **Allow screen access** to request it again. Restart if macOS requests it. Vision does not need Accessibility access, but it replaces caret sensing while enabled; turn it off to return to caret mode.

Point near visible text on Gullbert's display. He can hunt existing chat messages and other words without waiting for typing. The control room reports scanning, text found, no text, or missing permission. Keep the pointer still to let him approach; moving it toward him makes him act innocent.

Vision captures a region of up to 640 × 360 logical pixels around the pointer, clipped to the pointer's display, with at least two seconds between a completed scan and the next one. Gullbert's own windows are excluded. Apple Vision recognizes text on-device, selects the nearest word, and passes its position plus one printable ASCII character to the routine; unsupported characters become `o`. Screenshots and recognized strings stay in memory only during processing; nothing is saved or sent.

He carries a cosmetic copy of the character. At **Public enemy**, he adds it to his nest, turning letters and digits into punctuation; at **Menace**, he eats it. Vision does not determine whether the text is editable or understand its meaning. Pausing, hiding, **Polite-ish**, or switching vision off stops new scans.

## Run from source

Install Node.js 22+, the current stable Rust toolchain (at least 1.90), and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/): Xcode Command Line Tools on macOS; Microsoft C++ Build Tools with the desktop C++ workload and WebView2 on Windows. The macOS build also needs an SDK with the macOS 14 ScreenCaptureKit APIs, even when building for an older macOS version.

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

## Build and release

### Publish the browser preview and downloads

GitHub Pages hosts the browser playground; GitHub Releases hosts the desktop downloads. In the repository's **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. After merging to `main`, the [Pages workflow](.github/workflows/pages.yml) tests and publishes `web-dist/` at [mihhail-r.github.io/gullbert/](https://mihhail-r.github.io/gullbert/). You can also run **Publish browser preview** manually on `main`.

To release desktop packages, push a new version tag such as `v0.1.0-preview.1`. The existing build workflow creates a draft release containing Apple Silicon and Intel Mac ZIPs and a Windows x64 installer. Test the downloaded packages, edit the release notes, mark preview releases as **pre-release**, and publish the draft. Draft releases are not public downloads.

The playground's download button opens [all releases](https://github.com/Mihhail-R/gullbert/releases), so preview releases remain discoverable without relying on GitHub's latest stable release redirect. Pages updates on `main` independently of desktop releases; publish a new tag when you want updated installers.

### Build desktop packages locally

```sh
# macOS, for the current machine's architecture
npm run build -- --bundles app

# Windows, on Windows
npm run build -- --bundles nsis
```

These commands write packages to `src-tauri/target/release/bundle/` unless you override the target directory. Passing `--target <triple>` adds that target beneath `src-tauri/target/`, as in CI. Quit any running Gullbert before testing a new build: a second launch communicates with the existing instance.

The [GitHub Actions workflow](.github/workflows/build.yml) runs frontend tests, type checks, and formatting checks on pull requests, main-branch pushes, and manual runs. Only pushing a `v*` tag also builds Apple Silicon, Intel Mac, and Windows x64 packages on matching runners and runs native tests. Workflow artifacts are retained for 14 days. After all jobs pass, the tag push creates a **draft GitHub Release** with zipped Mac apps and a Windows installer. Mac artifacts are ad-hoc signed; Windows installers are unsigned. Neither Developer ID signing nor notarization is configured. Review the draft before publishing.

The macOS deployment target is 11.0; local vision requires 14.0 or newer. Linux desktop builds are not part of the supported build matrix. Before a stable release, test downloaded packages on each target platform, including installation, click-through, dragging, targeting, Escape, physical shortcuts, sound, permissions, and multiple displays. Browser tests and native unit tests do not establish desktop compatibility. Exclusive fullscreen apps and some virtual desktop configurations may hide the overlay. macOS transparency uses Tauri's private API option; distribution targets direct downloads rather than the Mac App Store.

## Local data

Preferences live in `settings.json`; remembered belongings live in `roommate.json`, both in Tauri's application configuration directory. The playground uses separate browser local storage. OS permissions can be revoked in system settings.

## Development

```sh
npm test
npm run check
npm run format:check
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

The frontend has no runtime npm dependencies. Tauri uses the operating system's webview. TypeScript compiles into ignored `web-dist/`; tests exercise that emitted code. Use `npm run format` to apply frontend and documentation formatting.

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture, testing, and contribution guidelines.

## License and credits

Code: [MIT](LICENSE). Original artwork and derived app icons: [CC0-1.0](art/LICENSE-CC0.txt). Dependencies retain their own licenses.

Inspired by the desktop-toy genre, including [Desktop Goose](https://samperson.itch.io/desktop-goose). This is an independent project with its own character and implementation; no Desktop Goose code or artwork is included.
