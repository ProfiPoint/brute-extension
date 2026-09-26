# FEL CTU BRUTE Deadline Manager

Browser extension for the FEL CTU BRUTE student portal (`brute.fel.cvut.cz` and `cw.felk.cvut.cz`). Adds task state tracking, automatic task completion, party mode, new task badges, and an optional Classic UI layout.

> **Warning:** This project is vibecoded. Expect pragmatic DOM selectors, big functions, and quick fixes rather than textbook architecture. Test changes on real BRUTE pages before shipping.

## Project Structure

- `manifest.json` - Manifest V3 config for Chrome and Firefox.
- `storage.js` - Chunked `storage.sync` wrapper so 500+ tasks fit inside browser sync quotas.
- `content.js` - Page logic (task states, course summary parsing, auto-completion, party mode, plagiat banner hiding).
- `styles.css` - Injected styles for task colors, toasts, disco effects, and Classic BRUTE UI mode.
- `popup/` - Extension popup UI and settings toggles.

## Coding Style & Rules

- **Plain JS/CSS/HTML only:** No build step, bundlers, or frameworks. Everything runs directly in the browser as-is.
- **Always use `storage.js`:** Never write to `localStorage` or raw `chrome.storage` directly. All data must go through `BruteSyncStorage` so it stays synced and within quota limits.
- **Support both BRUTE versions:** Keep selectors compatible with both the new Bootstrap 5 portal (`brute.fel.cvut.cz`) and the older Bootstrap 3 layout (`cw.felk.cvut.cz`).
- **Keep commits simple:** Use short lowercase commit messages with plain words only.

## Bug Reports

If something breaks, email `brute-extension@profipoint.pro` or DM `@profipoint` on Discord.
