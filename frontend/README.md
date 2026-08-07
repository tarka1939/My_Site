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

### Build budgets

`angular.json`'s production budgets were re-baselined against a real build in Phase 6. They are
deliberately close to current output -- a budget with several hundred kB of headroom can't fail on
any realistic regression, and one that fails on every feature branch gets ignored.

| Budget | Baseline (2026-08-07) | Warning | Error |
|---|---|---|---|
| `initial` | 284.39 kB | 320 kB | 400 kB |
| `any` (single chunk) | 170.84 kB (the Angular framework chunk) | 200 kB | 300 kB |
| `anyComponentStyle` | 991 bytes (`projects-list.component.scss`) | 2 kB | 4 kB |

Notes, all verified against the builder rather than assumed:

- Budgets are measured against **raw** size, not the "estimated transfer size" column the build
  also prints. `initial` at 284.39 kB raw is 81.34 kB over the wire.
- `initial` is the budget that should stay meaningful as the app grows: Phase 7's four extensions
  are lazy routes, so they must not move it. If it fires for a legitimate reason, re-baseline it
  here rather than doubling the number.
- `any` exists because `initial` is blind to lazy chunks. It's set just above the Angular framework
  chunk, so it means "no single chunk should outweigh the framework" -- normal feature work won't
  approach it; a heavyweight dependency dragged into one route will.
- There is deliberately **no per-name `bundle` budget**. A `bundle` budget whose `name` matches no
  chunk is silently ignored -- no warning, no error -- and chunk names are derived from component
  filenames, so renaming a component would switch its budget off without telling anyone.
- There is deliberately no `all` budget: Phase 7 adds four whole feature areas as lazy routes, so a
  total-size budget would fire repeatedly for expected growth.

### Images

Project images are external URLs pasted by the admin (`docs/DECISIONS.md`, 2026-07-24). There is no
upload pipeline, no local image assets, and therefore no build-time image compression step. Their
intrinsic dimensions are unknown, so `width`/`height` attributes can't be emitted; layout space is
reserved with CSS instead (a fixed height on the card grid, `aspect-ratio` on the detail gallery).
The first card thumbnail and the first gallery image are the LCP candidates on their pages and load
eagerly at high fetch priority; everything else is `loading="lazy"`.

`NgOptimizedImage` was evaluated in Phase 6 and deliberately not adopted -- with arbitrary external
origins, no image CDN loader, no SSR, and unknown dimensions (forcing `fill` mode) every feature it
provides is either inert or actively counterproductive here. If an image CDN is ever put in front of
project images, revisit that.

## Running unit tests

```bash
ng test
```

Runs the [Vitest](https://vitest.dev/) test runner.

## Additional resources

[Angular CLI Overview and Command Reference](https://angular.dev/tools/cli)
