# Gullbert

**A tiny seagull with absolutely no respect for your desktop.**

![Gullbert, an original pixel seagull](art/gullbert.gif)

Gullbert roams your desktop, demands chips, learns tricks, collects questionable treasures, and occasionally leaves a little gift. Feed him, scratch his head, play games, or let him get on with being a nuisance. No chores or penalties for being away.

[Download](https://github.com/Mihhail-R/gullbert/releases) · [Try the browser playground](https://mihhail-r.github.io/gullbert/)

## Requirements and installation

- **macOS 12.3+ (Monterey)**, Apple Silicon (M-series). Download the `darwin-aarch64.dmg` and drag Gullbert into Applications. Gullbert requires the WebKit APIs included with macOS 12.3 or later.
- **Windows 10+**, x64, with WebView2. Download and run the `setup.exe`.

Mac builds are ad-hoc signed and not notarized by Apple; Windows installers are unsigned. Update packages are cryptographically signed and verified by the app.

- **Mac first launch:** open Gullbert from Applications. If macOS says it cannot verify the app, go to **System Settings → Privacy & Security → Open Anyway**, then confirm. On older macOS versions, use **System Preferences → Security & Privacy → General**. See [Apple's instructions](https://support.apple.com/102445).
- **Windows first install:** if SmartScreen shows **Windows protected your PC**, choose **More info → Run anyway** when available.

Use the control room or menu bar / system tray to play, adjust behaviour, or hide him. Closing the control room leaves him running; choose **Quit** to exit. He does not start automatically at login.

## Offline and private

The installed app works entirely offline. No account, analytics, cloud AI, or background network requests. Settings and Gullbert's memories stay on your device. Memory storage uses SQLite schema version 2 with complete JSON snapshots (current memory format: version 3). Migration is forward-only: older builds reject schema version 2; there are no downgrade or dual-write paths. Imported `roommate.json` files remain untouched as recovery copies.

The only network feature is **App updates**: **Check for updates** manually checks this repository's GitHub releases. Downloading and installing an update requires a separate **Install and restart** action. There are no automatic checks or downloads.

## Contributing and credits

See [CONTRIBUTING.md](CONTRIBUTING.md) for source setup, development, and release instructions.

Code: [MIT](LICENSE). Original artwork and app icons: [CC0-1.0](art/LICENSE-CC0.txt). Dependencies retain their own licenses.

Inspired by [Desktop Goose](https://samperson.itch.io/desktop-goose). An independent project with its own character, code, and artwork.
