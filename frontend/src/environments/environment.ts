// Production build defaults (used unless a build configuration's fileReplacements swaps this
// out, e.g. the "development" configuration replaces this with environment.development.ts).
//
// apiBaseUrl is a placeholder until the VPS backend host is chosen (see docs/DECISIONS.md and
// docs/openapi.yaml's "TBD-vps-host" production server entry) -- update this alongside Phase 5.
export const environment = {
  production: true,
  apiBaseUrl: 'https://TBD-vps-host/api/v1',
};
