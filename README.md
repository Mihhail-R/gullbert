# Gullbert

**A tiny seagull with absolutely no respect for your desktop.**

![Gullbert, an original pixel seagull](art/gullbert.gif)

Gullbert roams your desktop, demands chips, learns tricks, collects questionable treasures, and occasionally leaves a little gift. Feed him, scratch his head, play games, or let him get on with being a nuisance. No chores or penalties for being away.

[Download](https://github.com/Mihhail-R/gullbert/releases) · [Try the browser playground](https://mihhail-r.github.io/gullbert/)

## Requirements and installation

- **macOS 11+**, Apple Silicon or Intel. Download the matching `.dmg` and drag Gullbert into Applications.
- **Windows 10+**, x64, with WebView2. Download and run the `setup.exe`.
- Optional local vision needs **macOS 14+** or **Windows 10 version 2004+**.

This is an early preview. Apple Silicon Macs have had local testing; Intel Macs and Windows still need hands-on testing. Builds are unsigned or ad-hoc signed and not notarized, so you may see system security prompts.

Use the control room or menu bar / system tray to play, adjust behaviour, or hide him. Closing the control room leaves him running; choose **Quit** to exit. He does not start automatically at login.

## Permissions

Screen and typing access are optional; Gullbert can roam and play without them. Enable these features in **Settings**.

| Access                                          | What he uses it for                                                                                                                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accessibility** on macOS                      | Finds the text cursor in supported apps so he can pretend to steal letters while you type. Reads cursor position and focused-field identity, not document text or keystrokes. Windows uses the system caret without a separate permission prompt. |
| **Screen Recording** on macOS, for local vision | Reads text in a small screen region around your pointer so he can carry away a cosmetic copy of a character. Recognition runs entirely on your device. Windows supports the same feature without a separate permission prompt or OCR download.    |

Neither feature changes text in your apps. Screen captures and recognized text are processed in memory, never saved or sent anywhere. Local vision does not need Accessibility access. You can turn these features off in Settings and revoke macOS permissions in System Settings.

## Offline and private

The installed app works entirely offline. No account, analytics, cloud AI, or background network requests. Settings and Gullbert's memories stay on your device.

The only network feature is **App updates**: **Check for updates** manually checks this repository's GitHub releases. Downloading and installing an update requires a separate **Install and restart** action. There are no automatic checks or downloads.

## Contributing and credits

See [CONTRIBUTING.md](CONTRIBUTING.md) for source setup, development, and release instructions.

Code: [MIT](LICENSE). Original artwork and app icons: [CC0-1.0](art/LICENSE-CC0.txt). Dependencies retain their own licenses.

Inspired by [Desktop Goose](https://samperson.itch.io/desktop-goose). An independent project with its own character, code, and artwork.
