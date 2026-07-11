# Quick Start Guide

## Installation & Development

### 1. Install Dependencies

```bash
cd claude-usage-app
npm install
```

### 2. Run in Development Mode

```bash
npm run dev
```

This will:

- Launch the widget with DevTools open
- Enable hot-reload for debugging
- Show console logs

### 3. Test the Application

**First Run:**

1. Widget appears (frameless window)
2. Click "Login to Claude"
3. Browser window opens to claude.ai
4. Login with your credentials
5. Widget automatically captures session
6. Usage data displays

**Features to Test:**

- [ ] Drag widget around screen
- [ ] Refresh button updates data
- [ ] Minimize to system tray
- [ ] Right-click tray icon shows menu
- [ ] Settings panel opens from the title bar
- [ ] Theme selector changes the background and both service palettes
- [ ] Progress bars animate smoothly
- [ ] Timers count down correctly
- [ ] Re-login from tray menu works

### 4. Build for Production

```bash
npm run build
```

Then package an installer/binary:

```bash
npm run package
```

Output: `src-tauri/target/release/bundle/` (Tauri bundler artifacts for the current platform)

## Development Tips

### Enable DevTools

Available in dev/debug builds — right-click the widget and choose Inspect, or call
`window.open_devtools()` from Rust. Renderer errors are also forwarded to the Vite
terminal in dev mode (see `clientLogSink` in `vite.config.ts`).

### Test Without Building

```bash
npm run dev
```

### Debug Authentication

Check the console for:

- Cookie capture events
- Organization ID extraction
- API responses

### Change Update Frequency

The default is controlled by `DEFAULT_REFRESH_MINUTES` in `src/renderer/app.ts` (5 minutes). Users can change it
in-app via **Settings → Auto-refresh** with the slider (1–20 minutes).

### Change Theme

The widget theme is persisted through the main process store and can be changed in-app via
**Settings → Theme color**. The current options are:

- Purple
- Lilac
- Orange
- Green
- Metallic

Theme changes update the widget background and apply separate Claude and Codex accent colors across labels,
progress states, and charts.

Use **Settings → Background hue** if you want to override only the widget gradient and leave the selected service
palette alone.

### Mock API Response

For testing UI without API calls, add to `fetchUsageData()`:

```javascript
const mockData = {
  five_hour: { utilization: 45.5, resets_at: "2025-12-13T20:00:00Z" },
  seven_day: { utilization: 78.2, resets_at: "2025-12-17T07:00:00Z" },
};
updateUI(mockData);
return;
```

## File Structure

```
claude-usage-app/
├── package.json
├── src-tauri/
│   ├── tauri.conf.json
│   ├── capabilities/
│   └── src/
│       ├── main.rs
│       ├── commands.rs
│       ├── claude.rs
│       ├── codex.rs
│       ├── fetch_via_window.rs
│       ├── tray.rs
│       ├── settings.rs
│       └── state.rs
├── src/                     # Frontend only (the Electron main process is gone;
│   │                        # its logic now lives in Rust under src-tauri/)
│   ├── renderer/            # The widget UI, unchanged from the Electron version
│   │   ├── index.html
│   │   ├── styles.css
│   │   ├── tauri-api.ts     # window.electronAPI shim over Tauri IPC
│   │   └── app.ts
│   └── shared/              # Renderer types/constants (ElectronAPI contract)
│       ├── ipc-types.ts
│       └── refresh-interval.ts
└── assets/
    ├── icon.*
    └── tray-icon.png
```

## Common Issues

### Port Already in Use

Dev mode runs Vite on port 5173 (strict). Stop whatever else is using it, or change the
port in `vite.config.ts` and `src-tauri/tauri.conf.json` (`build.devUrl`) together.

### White Screen on Launch

Check console for errors. Usually means:

- Missing file paths
- TypeScript/runtime errors in `src/renderer/app.ts`
- CSS not loading

### Login Window Not Capturing Session

Check `src-tauri/src/claude.rs` (`detect_session_key`) — the login window + cookie polling flow should:

1. Open a webview window at claude.ai/login
2. Poll `cookies_for_url` for the `sessionKey` cookie
3. Try to get organization ID via `validate_session_key`

### API Returns 401

Session expired. Click "Re-login" from tray menu.

## Adding Features

### Custom Themes

Built-in themes live in `src/renderer/styles.css`, and the allowed theme values are validated in
`src-tauri/src/commands.rs`.

To add a new theme:

1. Add a new `[data-theme="..."]` block in `src/renderer/styles.css`
2. Define the widget background plus both Claude and Codex color tokens
3. Add the new option to the theme dropdown in `src/renderer/index.html`
4. Add the theme key to the `VALID_THEMES` array in `src-tauri/src/commands.rs`

Example structure:

```css
[data-theme="your-theme"] {
  --claude-primary: #your-claude-color;
  --claude-secondary: #your-claude-secondary;
  --codex-primary: #your-codex-color;
  --codex-secondary: #your-codex-secondary;
  --widget-bg-start: #your-background-start;
  --widget-bg-end: #your-background-end;
}
```

### Notification Alerts

Add to `updateUI()` in `src/renderer/app.ts`:

```javascript
if (weeklyUtilization >= 90) {
  new Notification("Agent Usage Alert", {
    body: "You're at 90% of weekly limit!",
  });
}
```

### Keyboard Shortcuts

Add the `tauri-plugin-global-shortcut` plugin and register a shortcut in
`src-tauri/src/main.rs` that toggles the main window's visibility.

## Debugging

### Console Logs

- Main process: Check the terminal where you ran `npm run dev`
- Renderer process: Check DevTools console (F12)

### Network Requests

DevTools → Network tab shows all API calls

### Storage

Check stored credentials:

```javascript
// In DevTools console:
await window.electronAPI.getCredentials();
```

## Publishing

1. Update version in `package.json` and `src-tauri/tauri.conf.json` (and `src-tauri/Cargo.toml`)
2. Run `npm run package`
3. Test the artifacts in `src-tauri/target/release/bundle/`
4. Create GitHub release
5. Upload the installer/artifacts

## Next Steps

- [ ] Add app icon (`.ico` file)
- [ ] Add tray icon (16x16 PNG)
- [ ] Test on clean Windows machine
- [ ] Create installer screenshots
- [ ] Write changelog
- [ ] Submit to releases

---

Happy coding! 🚀
