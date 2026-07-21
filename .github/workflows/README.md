# /.github/workflows

Placeholder — no workflows yet.

Phase 5 (`PROJECT_TODO.md`) adds two separate pipelines, not one combined workflow:

- **Frontend:** builds the Angular app with the correct `--base-href` and deploys to GitHub Pages on merge to `main` (`actions/deploy-pages` or `angular-cli-ghpages`).
- **Backend:** runs backend tests, builds the Docker image, and deploys to the chosen VPS on merge to `main`.

Both need CI checks (tests, lint, build) running on every PR per Phase 0/4, not just pre-merge.
