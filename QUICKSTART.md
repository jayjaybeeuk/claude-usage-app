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
# Windows:
npm run package:win
```

Output: `dist/` (electron-builder artifacts)

## Development Tips

### Enable DevTools

Already enabled in dev mode. To disable, edit `src/main/main.ts`: 

```javascript
if (process.env.NODE_ENV === "development") {
  // Comment out this line:
  // mainWindow.webContents.openDevTools({ mode: 'detach' });
}
```

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
├── src/
│   ├── main/
│   │   ├── main.ts
│   │   ├── preload.ts
│   │   └── fetch-via-window.ts
│   ├── renderer/
│   │   ├── index.html
│   │   ├── styles.css
│   │   └── app.ts
│   └── shared/
│       ├── ipc-channels.ts
│       └── ipc-types.ts
└── assets/
    ├── icon.*
    └── tray-icon.png
```

## Common Issues

### Port Already in Use

Electron doesn't use ports, so this shouldn't happen.

### White Screen on Launch

Check console for errors. Usually means:

- Missing file paths
- TypeScript/runtime errors in `src/renderer/app.ts`
- CSS not loading

### Login Window Not Capturing Session

Check `src/main/main.ts` - the BrowserWindow + cookie listener flow should:

1. Check URL contains 'chat' or 'new'
2. Extract sessionKey cookie
3. Try to get organization ID

### API Returns 401

Session expired. Click "Re-login" from tray menu.

## Adding Features

### Custom Themes

Built-in themes live in `src/renderer/styles.css`, and the allowed theme values are validated in
`src/main/main.ts`.

To add a new theme:

1. Add a new `[data-theme="..."]` block in `src/renderer/styles.css`
2. Define the widget background plus both Claude and Codex color tokens
3. Add the new option to the theme dropdown in `src/renderer/index.html`
4. Add the theme key to the `validThemes` array in `src/main/main.ts`

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

Add to `src/main/main.ts`:

```ts
import { globalShortcut } from 'electron'

app.whenReady().then(() => {
  globalShortcut.register('CommandOrControl+Shift+C', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
    }
  })
})
```

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

1. Update version in `package.json`
2. Run `npm run package:win`
3. Test the installer in `dist/`
4. Create GitHub release
5. Upload the installer/artifacts from `dist/`

## Next Steps

- [ ] Add app icon (`.ico` file)
- [ ] Add tray icon (16x16 PNG)
- [ ] Test on clean Windows machine
- [ ] Create installer screenshots
- [ ] Write changelog
- [ ] Submit to releases

---

Happy coding! 🚀
