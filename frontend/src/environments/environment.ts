// Production build defaults (used unless a build configuration's fileReplacements swaps this
// out, e.g. the "development" configuration replaces this with environment.development.ts).
//
// apiBaseUrl is the real deployed backend: a Mikrus VPS reached through the bieda.it subdomain,
// fronted by Cloudflare and served over TLS. It must stay in agreement with two other places --
// the production `servers:` entry in docs/openapi.yaml, and the <link rel="preconnect"> to this
// origin in src/index.html, which only helps if it names the origin actually requested.
//
// This is cross-origin from the Netlify frontend, so it depends on the backend allowlisting that
// origin in CORS; environment.development.ts stays relative precisely to avoid needing that
// locally.
export const environment = {
  production: true,
  apiBaseUrl: 'https://tarka1939.bieda.it/api/v1',
};
