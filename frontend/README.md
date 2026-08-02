# /frontend

Angular app for My Site, scaffolded in Phase 3 (`PROJECT_TODO.md`). Standalone components,
signals for state (no NgRx), lazy-loaded feature routes, a typed API client generated from
`docs/openapi.yaml` via `openapi-generator-cli`. See root `CLAUDE.md` for the locked-in
architecture conventions this follows.

Generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.19.

## Prerequisites

- Node 24+ (see `docs/DECISIONS.md`)
- A locally running backend (see `/backend`'s README) if you want real data instead of network
  errors -- `ng serve`'s dev-server proxy (`proxy.conf.json`) forwards `/api/*` to
  `http://localhost:8080`, so the browser sees same-origin requests and doesn't need the backend's
  CORS config (which only covers the deployed Netlify origin, added in Phase 5 -- see
  `docs/DECISIONS.md`).
- Java (JDK 11+) on `PATH` only if you need to regenerate the API client (`npm run generate:api`)
  -- `openapi-generator-cli` shells out to a Java-based generator.

## Development server

```bash
ng serve
```

Open `http://localhost:4200/`. The application automatically reloads on source changes.

## Regenerating the API client

`docs/openapi.yaml` is the source of truth for `src/app/core/api` -- never hand-edit those files.
After a contract change:

```bash
npm run generate:api
```

## Building

```bash
ng build
```

Compiles the project and writes build artifacts to `dist/frontend`. The production build uses the
default `--base-href /` (Netlify serves from root) and copies `public/_redirects`
(`/* /index.html 200`) for SPA routing -- see `docs/DECISIONS.md`.

## Running unit tests

```bash
ng test
```

Runs the [Vitest](https://vitest.dev/) test runner.

## Additional resources

[Angular CLI Overview and Command Reference](https://angular.dev/tools/cli)
