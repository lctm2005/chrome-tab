# Space Tabs product site

Product, privacy, and support pages for Space Tabs. The copy mirrors the Chrome
Web Store listing and extension UI around three promises: Arc migration,
controlled BYOK AI, and local-first workspace data.

## Routes

- `/` — product positioning, migration, controlled AI, and current extension screenshots
- `/privacy` — data handling, permissions, network requests, and user control
- `/support` — setup, Arc import, Ask Page, Auto Group, backup, and contact

## Development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
npm test
```

`npm test` creates the production Sites build and verifies all three rendered
routes. Hosting metadata is stored in `.openai/hosting.json`; runtime secrets do
not belong in source files.
