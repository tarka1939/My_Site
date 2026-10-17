# frontend/CLAUDE.md

The frontend's commands. They moved here from the root `CLAUDE.md` (#188), which every agent is
given in full, so that work outside `/frontend` stops paying for them. This file adds to the root
one, which holds the project-wide rules; the few kept here apply only to these commands. It
arrives with the first file read under `frontend/`.

## Commands

### Frontend (`/frontend`)

Requires Node 24+. `ng serve`'s dev-server proxy (`frontend/proxy.conf.json`) forwards `/api/*`
to `http://localhost:8080` so the browser sees same-origin requests — the backend's CORS allowlist
(`app.cors.allowed-origins`) holds only the deployed Netlify origin, never `localhost:4200`, so
without the proxy every API call from `ng serve` fails with a CORS error. Regenerating the API
client (`npm run generate:api`) needs Java (JDK 11+) on `PATH`, since `openapi-generator-cli`
shells out to a Java-based generator.

```bash
# Install:
cd frontend && npm install

# Dev server (proxies /api to localhost:8080, see above). For real data, start the backend first;
# its commands and the local database are in backend/CLAUDE.md:
cd frontend && npm start

# Build (production, default --base-href /):
cd frontend && npm run build

# Run all tests (Vitest):
cd frontend && npm test

# Run a single test file:
cd frontend && npx ng test --include='**/projects-list.component.spec.ts'

# Regenerate the typed API client from docs/openapi.yaml:
cd frontend && npm run generate:api

# Lint (ESLint via angular-eslint, #210; CI runs it). Its essential rules ban the
# bypassSecurityTrust* calls and raw innerHTML-style DOM writes, either of which would make the
# Markdown renderer an XSS sink:
cd frontend && npm run lint
# No formatter: `frontend/.prettierrc` exists from the Angular scaffold but nothing runs it —
# don't reformat files wholesale with it.
```
