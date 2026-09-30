// Production build defaults (used unless a build configuration's fileReplacements swaps this
// out, e.g. the "development" configuration replaces this with environment.development.ts).
//
// apiBaseUrl is the real deployed backend: a Mikrus VPS reached through the bieda.it subdomain,
// fronted by Cloudflare and served over TLS. It must stay in agreement with four other places --
// the <link rel="preconnect"> and <link rel="dns-prefetch"> to this origin in src/index.html,
// which only help if they name the origin actually requested; the production `servers:` entry in
// docs/openapi.yaml; and the public health check in .github/workflows/deploy-backend.yml.
// src/api-origin-hints.spec.ts fails if any of them disagrees (#180, #181). docs/DEPLOYMENT.md §1
// lists every place for a host change, including the content seed's allowlist, which is left to a
// separate decision on purpose.
//
// This is cross-origin from the Netlify frontend, so it depends on the backend allowlisting that
// origin in CORS; environment.development.ts stays relative precisely to avoid needing that
// locally.
export const environment = {
  production: true,
  apiBaseUrl: 'https://tarka1939.bieda.it/api/v1',
};
