# SPEC — [Project Name]

Source of truth for scope. Update this **before** changing code, not after.

## Purpose

_What problem does this site solve, and for whom?_

## In scope

- [ ] Portfolio: browse projects, view project detail
- [ ] Contact form
- [ ] (fill in: blog/writeups?)
- [ ] (fill in: admin content management via login, or config-file-based?)

## Explicit non-goals

_Be specific — this list is what keeps scope from creeping._

- No multi-user support
- No real-time features
- (fill in more, e.g. "no comments system," "no analytics dashboard")

## User stories

Fill in as short "As a [user], I want to [action], so that [benefit]" statements.

1.
2.
3.

## Auth scope decision

> TODO's default is "include JWT admin auth" for interview/learning value, but it's the one genuinely optional decision. Record your call here in writing before Phase 2.

**Decision:**

**Reasoning:**

## Entities (high level)

See `docs/DATA_MODEL.md` for the full data model. Summary:

- `Project`
- `Tag`
- `BlogPost` / `Writeup`
- `ContactMessage`
- `AdminUser` (only if auth is in scope)

## API contract

The full OpenAPI 3.0 spec lives at `docs/openapi.yaml` (write this before backend/frontend code). Link it here once created:

- `docs/openapi.yaml`

## Open questions

_Anything undecided that needs an answer before the relevant phase starts._

-
