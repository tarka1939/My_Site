-- Core schema per docs/DATA_MODEL.md. UUID PKs everywhere (gen_random_uuid() is a
-- built-in Postgres function since v13, no extension required).

CREATE TABLE project (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title       varchar(200) NOT NULL,
    description text NOT NULL,
    links       jsonb NOT NULL DEFAULT '[]'::jsonb,
    images      text[] NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tag (
    id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name varchar(50) NOT NULL
);

-- Case-insensitive uniqueness so "React" and "react" can't both exist.
CREATE UNIQUE INDEX ux_tag_name_lower ON tag (lower(name));

CREATE TABLE project_tags (
    project_id uuid NOT NULL REFERENCES project (id) ON DELETE CASCADE,
    tag_id     uuid NOT NULL REFERENCES tag (id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, tag_id)
);

CREATE TABLE contact_message (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               varchar(200) NOT NULL,
    email              varchar(320) NOT NULL,
    message            text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    requester_ip_hash  varchar(64) NOT NULL
);

-- Supports the rate-limit query: count(*) where requester_ip_hash = ? and created_at > ?
CREATE INDEX ix_contact_message_ip_hash_created_at ON contact_message (requester_ip_hash, created_at);

CREATE TABLE admin_user (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username      varchar(100) NOT NULL,
    password_hash varchar(255) NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_admin_user_username ON admin_user (username);

CREATE TABLE password_reset_token (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id uuid NOT NULL REFERENCES admin_user (id) ON DELETE CASCADE,
    token_hash    varchar(255) NOT NULL,
    expires_at    timestamptz NOT NULL,
    used_at       timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_password_reset_token_admin_user_id ON password_reset_token (admin_user_id);
