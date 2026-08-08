# Data Model

Draft the ER diagram and entity definitions here before writing migrations or JPA entities.

## Conventions (locked 2026-07-24, see `docs/DECISIONS.md`)

- **Primary keys:** `uuid` on every table (app- or DB-generated `gen_random_uuid()` / `uuid_generate_v4()`). Avoids sequential-ID enumeration on public API URLs; consistent with the original ER diagram draft.
- **Timestamps:** `timestamptz`, defaulting to `now()` where the field marks creation time.
- **Images:** plain array of external URL strings — no upload endpoint or storage backend. Admin pastes a link (GitHub raw, image host, etc.).
- **Links:** `jsonb` array of `{label, url}` objects (e.g. `[{"label":"GitHub","url":"..."},{"label":"Live demo","url":"..."}]`) — supports multiple labeled links per project without a join table.

## Core entities

### Project

| Field | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| title | varchar(200), not null | |
| description | text, not null | |
| links | jsonb, not null default `[]` | array of `{label, url}` — see Conventions above |
| images | text[], not null default `{}` | array of external image URLs |
| started_on | date, nullable | when work on the project started; null = unspecified. Added 2026-08-08, see ADR below |
| completed_on | date, nullable | when work finished; **null = ongoing**, a meaningful value rather than missing data. Must not precede `started_on` — enforced at the DTO layer *and* by a table `CHECK` constraint |
| created_at | timestamptz, not null default `now()` | |
| updated_at | timestamptz, not null default `now()` | bump on every update |

**On `started_on`/`completed_on` vs `created_at`/`updated_at`:** these are not duplicates. `created_at`/`updated_at` are *record* timestamps — when the row was entered and last edited. `started_on`/`completed_on` describe *the work itself*, which routinely predates the row by years. Both are `date`, not `timestamptz`: the UI renders month/year only, since the source material can't support day-level accuracy, and the convention is the 1st of the month. Sorting a portfolio by "most recent work" means ordering on these, not on `created_at`.

Relationships: many-to-many with `Tag` via join table `project_tags` (`project_id` FK, `tag_id` FK, composite PK, `ON DELETE CASCADE` both sides). Needs pagination/filtering support from the start (Phase 2 — retrofitting later, once real data and a frontend depend on the shape, is the thing to avoid).

### Tag

| Field | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| name | varchar(50), not null, unique | case-insensitive uniqueness (`citext` or a lowercased unique index) to avoid `"React"` / `"react"` duplicates |

Relationships: many-to-many with `Project` via `project_tags` (see above).

### ~~BlogPost / Writeup~~ — cut from scope (2026-07-21)

Was floated in the original data-model draft; confirmed out of scope in `SPEC.md` → Explicit non-goals. Left here only for traceability — don't implement.

### ContactMessage

| Field | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| name | varchar(200), not null | |
| email | varchar(320), not null | max length per RFC 5321; validate format at the DTO layer, not here |
| message | text, not null | |
| created_at | timestamptz, not null default `now()` | |
| requester_ip_hash | varchar(64), not null | sha-256 hex digest of requester IP, never the raw IP — same privacy stance as `AnalyticsEvent.visitor_hash` below |

Rate limiting: no separate table — query `count(*) where requester_ip_hash = ? and created_at > now() - interval` at request time. Revisit only if this endpoint sees enough volume for that query to matter.

### AdminUser

_Confirmed in scope — see SPEC.md → Auth scope decision._

| Field | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| username | varchar(100), not null, unique | |
| email | varchar(320), not null, unique | **added Phase 2** — the original draft omitted this, but `POST /auth/password-reset-request` (`docs/openapi.yaml`) takes an email and needs somewhere to look it up; added via `V2__admin_user_email_and_seed.sql` alongside the seed row rather than retrofitted into `V1__init.sql` (already shipped in Phase 1/PR #76) |
| password_hash | varchar(255), not null | bcrypt or argon2 — never store plaintext or use a reversible hash |
| created_at | timestamptz, not null default `now()` | |

### PasswordResetToken

_Added 2026-07-24 — see `docs/DECISIONS.md` → Password reset flow ADR. Supports the `POST /auth/password-reset-request` / `POST /auth/password-reset` endpoints in `docs/openapi.yaml`._

| Field | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| admin_user_id | uuid, FK → AdminUser, not null | `ON DELETE CASCADE` |
| token_hash | varchar(255), not null, unique | sha-256 of the reset token — store the hash, never the raw token, same principle as `password_hash`. Unique index added Phase 2 (`V3__password_reset_token_hash_index.sql`) — V1 had no index at all on the column every confirm-reset lookup hits |
| expires_at | timestamptz, not null | 30 minutes from creation — deliberately shorter than the 1-hour JWT session expiry, since a leaked reset token (e.g. via email interception) is a higher-risk artifact than a session token |
| used_at | timestamptz, nullable | set on consumption; a used or expired token must be rejected on `POST /auth/password-reset` |
| created_at | timestamptz, not null default `now()` | |

---

## Phase 7 extension entities

**These are inferred from the Phase 7 feature descriptions in `PROJECT_TODO.md` — the TODO does not specify exact fields. Treat every table below as a draft to confirm or rewrite before implementing, not a settled schema.**

### GithubSyncRecord (7a — GitHub webhook auto-sync)

Tracks synced repo metadata and links it back to a `Project`. Needs to support idempotency (same webhook delivery arriving twice shouldn't duplicate data).

| Field | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| project_id | uuid, FK → Project, nullable | nullable until matched/created |
| repo_full_name | varchar(255), not null | e.g. `user/repo` |
| github_delivery_id | varchar(255), not null, unique | GitHub's `X-GitHub-Delivery` header — unique constraint is the idempotency check on webhook redelivery |
| last_synced_at | timestamptz | |
| raw_payload | jsonb, nullable | optional, for debugging sync issues |

### AgentLogEntry (7b — rendered agent build-log page)

TODO floats two options: parse `AGENT_LOG.md` directly, or move entries into the DB ("arguably cleaner"). If DB-backed, mirror the `AGENT_LOG.md` entry format:

| Field | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| logged_at | timestamptz, not null | |
| session_label | varchar(255) | |
| task_given | text | |
| agents_used | text[] | e.g. `{backend-agent, frontend-agent}` |
| what_went_wrong | text | |
| how_it_was_caught | text | |
| fix_applied | text | |
| takeaway | text | |

### AnalyticsEvent (7c — custom analytics)

Privacy constraint from the TODO: no fingerprinting, no third-party trackers, IPs hashed or not stored at all.

| Field | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| project_id | uuid, FK → Project, nullable | null for site-wide events |
| event_type | varchar(50), not null | e.g. `page_view`, `project_click` |
| occurred_at | timestamptz, not null default `now()` | |
| visitor_hash | varchar(64), not null | sha-256 of IP + daily-rotating salt (not raw IP) — dedup/rate-limiting only, not cross-session tracking |

### DspJob (7d — live DSP/audio demo)

Async job record: build this last, on the `@Async` executor provisioned in Phase 1. Needs strict file size/type limits and a queue, results delivered via polling or WebSocket (not a blocking request).

| Field | Type | Notes |
|---|---|---|
| id | uuid, PK | |
| status | varchar(20), not null | `queued` / `processing` / `done` / `failed` |
| uploaded_file_ref | varchar(500), not null | path/blob reference, with size/type limits enforced before storing |
| result_ref | varchar(500), nullable | |
| created_at | timestamptz, not null default `now()` | |
| completed_at | timestamptz, nullable | |

---

## ER diagram

Core entities (confirmed scope) — `ContactMessage` and `AdminUser` have no FK relationships to `Project`/`Tag`, shown standalone:

```mermaid
erDiagram
    PROJECT }o--o{ TAG : "project_tags"
    PROJECT {
        uuid id PK
        string title
        text description
        jsonb links
        text_array images
        timestamptz created_at
        timestamptz updated_at
    }
    TAG {
        uuid id PK
        string name
    }
    CONTACT_MESSAGE {
        uuid id PK
        string name
        string email
        text message
        timestamptz created_at
        string requester_ip_hash
    }
    ADMIN_USER {
        uuid id PK
        string username
        string email
        string password_hash
        timestamptz created_at
    }
    ADMIN_USER ||--o{ PASSWORD_RESET_TOKEN : "issues"
    PASSWORD_RESET_TOKEN {
        uuid id PK
        uuid admin_user_id FK
        string token_hash
        timestamptz expires_at
        timestamptz used_at
        timestamptz created_at
    }
```

Phase 7 draft entities (speculative — see caveat above each table) relate back to `PROJECT` as follows; not implemented until each sub-phase starts:

```mermaid
erDiagram
    PROJECT ||--o{ GITHUB_SYNC_RECORD : "nullable FK"
    PROJECT ||--o{ ANALYTICS_EVENT : "nullable FK"
    GITHUB_SYNC_RECORD {
        uuid id PK
        uuid project_id FK
        string repo_full_name
        string github_delivery_id
        timestamptz last_synced_at
        jsonb raw_payload
    }
    ANALYTICS_EVENT {
        uuid id PK
        uuid project_id FK
        string event_type
        timestamptz occurred_at
        string visitor_hash
    }
    AGENT_LOG_ENTRY {
        uuid id PK
        timestamptz logged_at
        string session_label
    }
    DSP_JOB {
        uuid id PK
        string status
        string uploaded_file_ref
        string result_ref
    }
```

(`AgentLogEntry` and `DspJob` have no FK relationship to `Project`, so they're listed but not connected above.)

## Migration notes

- First migration: `V1__init.sql` (Flyway) — should create `project`, `tag`, `project_tags`, `contact_message`, `admin_user`, `password_reset_token`. Phase 7 tables land in their own later migrations, one per sub-phase, not upfront.
- `V2__admin_user_email_and_seed.sql` (Phase 2) — adds `admin_user.email` (see AdminUser table above) and seeds the single admin row with a bcrypt-hashed password, per the Auth Flow ADR in `docs/DECISIONS.md`.
- `V3__password_reset_token_hash_index.sql` (Phase 2) — adds a unique index on `password_reset_token.token_hash` (see PasswordResetToken table above), caught in cross-review after V1/V2 had already shipped without one.
- `V4__project_dates.sql` (Phase 6) — adds nullable `project.started_on` and `project.completed_on` plus a `CHECK` enforcing that `completed_on` neither precedes `started_on` nor exists without it. Additive and non-destructive: both columns are nullable, so existing rows are untouched and no backfill is required. See the 2026-08-08 project-dates ADR in `docs/DECISIONS.md`.
- Record schema changes here as they land, or link to migration files directly.
