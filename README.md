# YouTube Comment Lyrics

A browser extension that shows song lyrics in the YouTube sidebar. It looks for lyrics people have pasted in the comments, falls back to synced lyrics from [LRCLIB](https://lrclib.net), and lets you pick any comment or text yourself.

Works in Chrome (and other Chromium browsers) and Firefox.

## Features

- Detects comments that look like lyrics and shows the best match in a panel above the recommended videos.
- Fetches lyrics from LRCLIB using the video title and channel. Synced lyrics highlight the current line as the video plays; click a line to jump to it.
- Lets you choose the lyrics yourself: use the "Lyrics" button on any comment, or select text and right-click "Set selection as lyrics".
- Previous/next buttons to switch between candidates.
- Per-video sync adjustment for music videos whose timing differs from the album track.
- Off by default. Turn it on per tab, per video, or for a whole channel.
- Follows YouTube's light and dark theme.

## Install

### From a release

Download the zip for your browser from the [Releases](../../releases) page.

Chrome:

1. Unzip `youtube-lyrics-extension-<version>-chrome.zip`.
2. Open `chrome://extensions` and turn on Developer mode.
3. Click "Load unpacked" and select the unzipped folder.

Firefox:

1. Open `about:debugging#/runtime/this-firefox`.
2. Click "Load Temporary Add-on" and select `youtube-lyrics-extension-<version>-firefox.zip`.

Temporary add-ons are removed when Firefox restarts. A permanent install needs the extension to be signed through addons.mozilla.org.

### From source

See [Development](#development).

## Usage

The extension does nothing until you turn it on.

- **Toolbar icon:** click it on a video page to turn lyrics on. It stays on for every video you open in that tab until you click it again. The badge shows `ON` while active.
- **Right-click the toolbar icon:** "Always on for this channel" turns it on for every video from that channel. "Stop always-on for this channel" removes the rule.
- **Comments:** YouTube loads comments only when you scroll to them. Use "Scan comments" in the panel to load them without scrolling yourself.
- **Pick your own:** the "Lyrics" button on a comment, or right-click selected text, saves that text as the lyrics for the video. "Unpin" goes back to automatic detection.
- **Sync:** for synced lyrics, use the minus and plus buttons next to the source name to shift timing by 0.5 seconds (hold Shift for 5 seconds). The adjustment is saved per video.

A turned-off video stays off even in a tab where the extension is on. Your choices are stored locally in the browser.

## Privacy

- Nothing is sent anywhere while the extension is off for a video.
- When it is on, the video title, channel name and video length are sent to lrclib.net to search for lyrics. No other data is sent.
- Pinned lyrics, sync adjustments and on/off settings are kept in the extension's local storage. The "on for this tab" flag is kept in the tab's session storage and cleared when the tab closes.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Save settings, pinned lyrics and sync adjustments |
| `contextMenus` | "Set selection as lyrics" and the channel options |
| `https://lrclib.net/*` | Look up lyrics |
| Content script on `www.youtube.com` | Show the panel and read comments |

## Development

Requirements: Node.js 26.12.1 or newer (see `.nvmrc`) and pnpm 11. npm is blocked on purpose.

```sh
nvm use
pnpm install
pnpm dev            # Chrome with live reload
pnpm dev:firefox    # Firefox with live reload
```

Other commands:

| Command | Does |
|---|---|
| `pnpm build` / `pnpm build:firefox` | Production build into `.output/` |
| `pnpm zip` / `pnpm zip:firefox` | Build release zips (Firefox also produces a sources zip) |
| `pnpm compile` | Type check |
| `pnpm test` / `pnpm test:watch` | Run the Vitest suite |
| `pnpm icons` | Regenerate PNG icons from `assets/*.svg` (needs `rsvg-convert`) |

While `pnpm dev` is running, reload the YouTube tab after changing several files at once, so the page does not keep a half-updated build.

### Project layout

```
entrypoints/
  background.ts           toolbar button, context menus, LRCLIB requests
  youtube.content/
    index.ts              on/off logic, comment scanning, sync loop
    panel.ts              sidebar panel UI
    style.css             panel styles (inside a shadow root)
    page.css              style for the "Lyrics" button on comments
utils/
  score.ts                lyrics detection heuristic
  lrclib.ts               title parsing, LRC parsing, LRCLIB search
  youtube.ts              YouTube page selectors and comment parsing
  messages.ts             message types between scripts
tests/                    Vitest tests
assets/                   icon sources
public/icon/              generated icons
```

## Releasing

1. Update `version` in `package.json` and commit.
2. Tag and push:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

The release workflow checks that the tag matches `package.json`, runs the type check and tests, builds the Chrome and Firefox zips, and publishes them on the Releases page. The CI workflow runs the same checks on every push to `main` and on pull requests.

## Known limitations

- YouTube changes its page structure from time to time. If the panel or the comment buttons stop appearing, the selectors in `utils/youtube.ts` need updating.
- Live streams usually have comments turned off. Select text in the live chat and use "Set selection as lyrics" instead.
- LRCLIB timings follow the album track. Music video edits and live performances may need the sync adjustment.
- A vague video title can match the wrong song. The panel shows which song was matched.
- Only `www.youtube.com` is supported, not `m.youtube.com` or `music.youtube.com`.
