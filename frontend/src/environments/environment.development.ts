// Used by `ng serve` (the default "development" build configuration) via angular.json's
// fileReplacements. apiBaseUrl is relative and routed through the dev-server proxy
// (proxy.conf.json forwards /api -> http://localhost:8080) rather than an absolute
// cross-origin URL -- the backend has no CORS configuration yet (that's Phase 5, and only
// covers the deployed Netlify origin, not local dev), so an absolute localhost:8080 URL here
// would have the browser block every response. Requires the backend running locally, per
// CLAUDE.md's backend dev instructions.
export const environment = {
  production: false,
  apiBaseUrl: '/api/v1',
};
