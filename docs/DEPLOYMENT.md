# Deployment runbook — Netlify (frontend) + self-managed VPS (backend)

**Status: not yet executed.** This is the plan, written 2026-08-30 against `dev` at `68bdc92`. Every
fact in the "Verified" table below was read out of the repo rather than remembered; everything else
is a decision or a step for you.

This exists because Phase 5 is the one phase that cannot be delegated — it needs an account, a
payment method, a domain and a shell on a machine that does not exist yet. What *can* be delegated is
marked **[code]**, and is listed at the end.

Re-verify the table before acting if this file has aged.

---

## 0. Three decisions only you can make

Nothing below can start until these are settled. They are recorded in `docs/DECISIONS.md` as
deferred to Phase 5, and they are still deferred.

| Decision | Why it blocks | Notes |
|---|---|---|
| **VPS provider, region, size** | Every command in Part 2 assumes a host | 1 vCPU / 2 GB is enough for one Spring Boot app plus Postgres. 1 GB is not — the JVM plus Postgres will thrash. Pick a region near you, not near nothing. |
| **Hostname for the backend** | The frontend hard-codes it, and TLS is issued against it | A subdomain of a domain you own (`api.example.com`) is much easier than a bare IP: Let's Encrypt will not issue for an IP, so without a domain you get no HTTPS, and without HTTPS the Netlify site cannot call it at all (mixed content). **If you do not own a domain, buy one before starting.** |
| **Netlify site name** | Becomes the CORS origin and the canonical URL | `<name>.netlify.app` is free and fine. A custom domain can come later without redoing anything. |

There is a fourth that is not really open: **Postgres runs on the same VPS**, not as a managed
service, because the whole point of the self-managed choice in `docs/DECISIONS.md` was to avoid a
per-service bill. Managed Postgres is a perfectly good answer if you would rather not carry backups
yourself — it changes only Part 2, step 3.

---

## 1. Verified against the repo, so you do not have to re-derive it

| Thing | Value | Where it comes from |
|---|---|---|
| Backend Java | **25** | `backend/pom.xml`, `<java.version>` |
| Backend packaging | executable jar via `spring-boot-maven-plugin` | `backend/pom.xml` |
| Prod profile name | `prod` | `backend/src/main/resources/application-prod.yml` |
| Schema management | Flyway migrations; `ddl-auto: validate` in prod | `application-prod.yml` |
| Health endpoint | `/actuator/health`, the **only** exposed endpoint | `application.yml` `management.endpoints.web.exposure.include: health` |
| Angular project name | `frontend` | `frontend/angular.json` |
| Angular build output | `dist/frontend/browser` (no explicit `outputPath`, so the `@angular/build:application` default) | `frontend/angular.json` |
| SPA fallback | already committed | `frontend/public/_redirects` |
| Prod API base URL | **`https://TBD-vps-host/api/v1`** — a placeholder that must change | `frontend/src/environments/environment.ts` |
| CORS config | **does not exist** | nothing in `/backend` matches `CorsConfiguration`/`addCorsMappings`/`@CrossOrigin` — this is issue #44 |
| Dockerfile | **does not exist** | issue #41 |
| CI workflows | **none** — `.github/workflows/` contains only a `README.md` | issues #38, #45 |

### Environment variables the backend actually reads

From `application.yml` and `application-prod.yml`. **Bold ones have no default and the app will not
start without them.**

| Variable | Default | Notes |
|---|---|---|
| **`DB_URL`** | none | Full JDBC URL, e.g. `jdbc:postgresql://localhost:5432/mysite` |
| **`DB_USERNAME`** | none | |
| **`DB_PASSWORD`** | none | |
| **`SPRING_PROFILES_ACTIVE`** | none | Must be `prod`. Without it none of the four below is read at all — they exist only in `application-prod.yml` — and the failure is a confusing one about a missing datasource rather than a missing variable |
| **`JWT_SECRET`** | none | Must be ≥32 bytes. Deliberately has no default — the app refuses to boot rather than run on a guessable key |
| `FRONTEND_URL` | `http://localhost:4200` | Used to build password-reset links. Set it to the Netlify URL or reset emails will point at localhost |
| `RESEND_API_KEY` | empty | Empty is a *designed* no-op: password-reset emails are skipped with a warning rather than failing. Fine to leave unset at first |
| `RESEND_FROM_ADDRESS` | `onboarding@resend.dev` | Only matters once `RESEND_API_KEY` is set |
| `GITHUB_SYNC_ENABLED` | `false` | Leave off. Phase 7a is built but not meant to be live yet |
| `GITHUB_WEBHOOK_SECRET` | empty | Only read when sync is enabled |
| `GITHUB_SYNC_REPOSITORIES` | empty | Same |

> **Note a naming trap.** `CLAUDE.md`'s local-development section tells you to set `DB_NAME`,
> `DB_USERNAME`, `DB_PASSWORD` — that is the **dev** profile. The **prod** profile takes a full
> `DB_URL` instead of a database name. Copying the local instructions to the server gives you an app
> that will not start.

---

## 2. The ordering problem

The two halves each need something the other produces:

- The frontend build bakes in the backend URL (`environment.ts`).
- The backend's CORS allowlist needs the exact Netlify origin.

So do **not** try to finish one before starting the other. The sequence that works:

1. Create the Netlify site → you now know the origin.
2. Provision the VPS and DNS → you now know the backend hostname.
3. **[code]** Wire both names into the repo, add CORS, deploy both.

Steps 1 and 2 are independent and can be done in either order, or the same evening.

---

## 3. Part 1 — Netlify

Netlify's UI moves around; treat the labels below as approximately right and the *values* as exact.

### 3.1 Create the site

Connect the GitHub repo, then set:

| Setting | Value |
|---|---|
| Base directory | `frontend` |
| Build command | `npm run build` |
| Publish directory | `dist/frontend/browser` |
| Functions directory | *(leave empty)* |

> **Publish-directory caveat.** When a base directory is set, Netlify resolves the publish path
> relative to it — so `dist/frontend/browser` is correct. If the first deploy succeeds but the site
> 404s, the deploy log's "Deploying to..." line tells you which path it actually used; try
> `frontend/dist/frontend/browser` instead. Check the log rather than guessing twice.

### 3.2 The setting that will bite you

**Set the production branch to `main`.**

Netlify defaults to the repository's default branch, and **this repo's default is `dev`** (changed
2026-08-27, see `docs/DECISIONS.md`). Left alone, Netlify will publish every merge to `dev` straight
to production, which defeats the entire branch model.

- Production branch: **`main`**
- Branch deploys: enable, at minimum for **`dev`** — this is what gives you a staging URL
- Deploy previews: enable for pull requests

### 3.3 Node version

`frontend/package.json` declares no `engines` field, so Netlify picks its own default and can change
it under you. Pin it:

- Environment variable **`NODE_VERSION`** = `24`

(Or commit an `.nvmrc` — but an env var needs no code change and is the smaller step now.)

### 3.4 Verify

```bash
# after the first deploy, from your machine
curl -s -o /dev/null -w '%{http_code}
' https://<your-site>.netlify.app             # expect 200
curl -s -o /dev/null -w '%{http_code}
' https://<your-site>.netlify.app/projects    # expect 200
```

The second command is the real test — it proves `_redirects` survived the build (issue #39). It has to
assert the **status code**: piping the body to `head` cannot tell a served `index.html` from Netlify's
own 404 page, since both are HTML whose first lines look alike.

---

## 4. Part 2 — the VPS

Everything here runs as a **non-root user with sudo**. Do not run the app as root.

### 4.1 First contact

```bash
ssh root@<vps-ip>
```

`adduser` is interactive and prompts for a password. **Remember it** — once 4.1 disables password
SSH, every later step is a `sudo` and that prompt is the only way to authenticate one. Pressing Enter
through the prompts strands you at 4.2.

```bash
adduser deploy && usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
```

Then disable password login — edit `/etc/ssh/sshd_config` so `PasswordAuthentication no` and
`PermitRootLogin no`, and `sudo systemctl restart ssh`. **Open a second terminal and confirm you can
still log in as `deploy` before closing the first one.** Locking yourself out of a fresh VPS is
recoverable only through the provider's console.

### 4.2 Firewall

```bash
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw enable && sudo ufw status
```

**8080 and 5432 must not appear in that list.** The app is reached only through the reverse proxy,
and Postgres only from localhost.

### 4.3 Postgres

```bash
sudo apt update && sudo apt install -y postgresql
sudo -u postgres psql          # interactive, deliberately -- see below
```

```sql
CREATE USER mysite;
\password mysite              -- prompts; never appears on a command line
CREATE DATABASE mysite OWNER mysite;
\c mysite
GRANT ALL ON SCHEMA public TO mysite;
\q
```

**Why interactive rather than `psql -c "... PASSWORD '...'"`.** `sudo` logs full command lines,
arguments included, to `/var/log/auth.log` in plaintext — a file that is not mode 600 and gets swept
into any log shipping or backup. `\password` prompts, hashes client-side, and never writes the value
anywhere. The same reasoning applies to every `psql -c` you may be tempted to write later.

`OWNER mysite` matters on Postgres 15+, where `public` is not writable by default: the database
owner gets `CREATE` on it. The explicit `GRANT` is belt-and-braces for older versions. Without one or
the other, Flyway fails on `V1__init.sql` with an error that reads like a connection problem.

Confirm it is not listening publicly:

```bash
sudo ss -tlnp | grep 5432    # expect 127.0.0.1:5432, not 0.0.0.0:5432
```

### 4.4 Java

```bash
sudo apt install -y openjdk-25-jre-headless
java -version    # must report 25
```

`-jre-headless` rather than the full JDK: this box runs a jar, it does not compile one, and the JDK
is a few hundred megabytes you do not have spare on a 2 GB host.

**This is the step most likely to fail.** Java 25 is recent enough that a stock Ubuntu LTS image may
have no such package. If `apt` cannot find it, use Adoptium:

```bash
sudo apt install -y wget gpg ca-certificates
wget -qO- https://packages.adoptium.net/artifactory/api/gpg/key/public   | sudo gpg --dearmor -o /etc/apt/keyrings/adoptium.gpg
echo "deb [signed-by=/etc/apt/keyrings/adoptium.gpg] https://packages.adoptium.net/artifactory/deb   $(awk -F= '/VERSION_CODENAME/{print $2}' /etc/os-release) main"   | sudo tee /etc/apt/sources.list.d/adoptium.list
sudo apt update && sudo apt install -y temurin-25-jre
```

**Do not settle for 21** — `pom.xml` targets 25 and the jar will not start on an older JVM.

### 4.5 Build and ship the jar

Two paths. **Take the jar path first**, even though the plan calls for Docker (#41, #45).

The reason is diagnostic, not ideological. Everything here is new at once — host, Postgres, DNS, TLS,
systemd — so the goal is one fewer *layer between the app and the machine*, not one fewer thing
overall. The jar path answers "does this app run against this database with these variables". Docker
asks that *and* "is my image right" simultaneously, and its most expensive failure is silent: a
containerised app with `DB_URL=...localhost:5432...` reaches the **container's** loopback rather than
the host's, and the error says nothing about why.

Almost nothing is wasted by going this way. What gets deleted later is the systemd unit and one
`scp`. What is kept is the hardened host, the firewall rules, the Postgres role and grants,
`/etc/mysite/env` (which a container reuses verbatim via `--env-file`), the Caddyfile, the DNS
record, and the demonstrated fact that this app runs against this database.

**The real risk is that interim things become permanent**, so state the exit condition now: issue #41
is not done until this systemd unit is deleted.

```bash
# on your machine -- Docker must be running: twelve test classes use Testcontainers,
# and this deliberately does not skip them
cd backend && mvn clean package -DskipTests=false
scp target/*.jar deploy@<vps-host>:/home/deploy/mysite.jar
```

`spring-boot-maven-plugin` leaves a `*.jar.original` beside the repackaged jar; the `*.jar` glob does
not match it, so exactly one file copies.

### 4.6 Secrets, as a file the app reads and nothing else can

Create the file **at 600 before writing to it**. `tee` runs with root's umask and would create it
world-readable, leaving the JWT secret and database password readable by every user on the box for
the seconds between the heredoc and a later `chmod`.

```bash
sudo mkdir -p /etc/mysite
sudo install -m 600 -o root -g root /dev/null /etc/mysite/env
sudo tee /etc/mysite/env >/dev/null <<'EOF'
DB_URL=jdbc:postgresql://localhost:5432/mysite
DB_USERNAME=mysite
DB_PASSWORD=<the password you set in 4.3>
FRONTEND_URL=https://<your-site>.netlify.app
SPRING_PROFILES_ACTIVE=prod
EOF
```

Then append the JWT secret **without it ever reaching your terminal**, so it cannot land in
`~/.bash_history` or in scrollback you later paste somewhere:

```bash
printf 'JWT_SECRET=%s
' "$(openssl rand -base64 48)" | sudo tee -a /etc/mysite/env >/dev/null
sudo chmod 600 /etc/mysite/env    # belt and braces
```

48 random bytes is 64 base64 characters, comfortably over the 32-byte minimum `SecurityConfig`
enforces for HS256, and the base64 alphabet contains nothing systemd's `EnvironmentFile` parser
mangles.

Before running anything in the next few sections that takes a password as an argument, consider
`unset HISTFILE` for this shell session.

### 4.7 Run it under systemd

```bash
sudo tee /etc/systemd/system/mysite.service >/dev/null <<'EOF'
[Unit]
Description=My Site backend
After=network.target postgresql.service

[Service]
User=deploy
EnvironmentFile=/etc/mysite/env
ExecStart=/usr/bin/java -Xmx512m -jar /home/deploy/mysite.jar
SuccessExitStatus=143
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now mysite
sudo systemctl status mysite
sudo journalctl -u mysite -f      # watch Flyway run the migrations
```

```bash
curl -s localhost:8080/actuator/health    # expect {"status":"UP"}
```

`-Xmx512m` is deliberate. The JVM's default maximum heap is a quarter of RAM, which on a 2 GB box has
it competing with Postgres; many providers also ship no swap, and the OOM killer takes Postgres as
readily as the JVM. If `free -h` shows none, add some:

```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

If it does not come up, the likely causes are: a missing variable from 4.6 (the app names which),
the Java version, or the schema grant from 4.3. Untested, so treat that list as a starting point
rather than an exhaustive one.

### 4.8 TLS and the reverse proxy

Point an **A record** for your chosen hostname at the VPS IP and wait for it to resolve before
continuing — Let's Encrypt validates over HTTP and will fail against stale DNS.

Caddy rather than nginx, because it obtains and renews certificates with no extra tooling. Debian and
Ubuntu ship a `caddy` package with the systemd unit and `/etc/caddy/Caddyfile` already in place,
which is why `reload` below works with no prior `start`. It lags upstream, which does not matter
here; Caddy's own docs pointing at their Cloudsmith repo is not a sign this is wrong:

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
api.example.com {
    reverse_proxy localhost:8080
}
EOF
sudo systemctl reload caddy
```

```bash
curl -s https://api.example.com/actuator/health    # expect {"status":"UP"} over TLS
```

That covers issue #47 for the backend half; Netlify handles its own certificate.

> ### This step breaks per-IP rate limiting. Read before continuing.
>
> `ClientIpHasher` returns `request.getRemoteAddr()` and deliberately ignores `X-Forwarded-For`,
> because until now nothing set it and a client could forge it. Behind Caddy, `getRemoteAddr()` is
> **`127.0.0.1` for every request on the internet**, so both limiters collapse into one global
> bucket:
>
> - **Login**, 5 attempts per 15 minutes — any stranger can lock *you* out of the admin panel.
> - **Contact form**, 5 messages per hour — one submitter silences the form for everybody.
>
> This is a regression introduced by this step, not a pre-existing gap. It needs a code change:
> trust `X-Forwarded-For` **only** when the request came from the proxy, and configure Caddy to
> overwrite rather than append it. `CLAUDE.md`'s "trust boundaries" rule is what makes that
> conditional necessary, and it is exactly the case that rule anticipated.
>
> It also bites immediately: §6 has you retry a login, and the sixth attempt returns **429**, which
> looks like an unrelated failure rather than a rate limit.

---

## 5. Part 3 — wiring the two together **[code]**

These are repo changes, not server steps. They are the delegatable part, and none can be written
until Parts 1 and 2 have produced real names.

1. **CORS (#44)** — allowlist the exact Netlify origin in the backend. Not a wildcard: the site
   sends an `Authorization` header, so a permissive config is both a real exposure and, with
   credentials, one browsers reject anyway.
2. **Trust `X-Forwarded-For`, conditionally (#168)** — required by 4.8, which otherwise collapses
   both rate limiters into a single `127.0.0.1` bucket. The conditional matters: trust the header
   only for requests arriving from the proxy, and have Caddy overwrite rather than append it.
   Unconditional trust is worse than the bug, because a forged header defeats rate limiting
   entirely instead of merely globalising it.
3. **`environment.ts`** — replace `https://TBD-vps-host/api/v1` with the real host. It is a
   placeholder that currently guarantees a broken production build.
4. **`docs/openapi.yaml`** — the production server entry says `TBD-vps-host` too. Contract-first
   means it changes with the code, and **the generated client must be regenerated afterwards**
   (`cd frontend && npm run generate:api`, then `git status --porcelain` must come back empty).
5. **`<link rel="preconnect">` (#89)** — small, real, and only possible once the origin is known.
6. **`README.md`** — the "Live URL: (once deployed — Phase 5)" placeholder.

## 6. Part 4 — the one thing that will not work

**You will not be able to log in.** Issue **#121**: `V2__admin_user_email_and_seed.sql` seeds an
admin whose bcrypt hash was generated once and whose plaintext was never committed — it exists
nowhere. A freshly migrated production database has an admin account nobody can authenticate as.

So before calling the deploy done, set a password you know. Your local `set-admin-password.ps1` does
this against a database it can reach; against the VPS the equivalent is to generate a bcrypt hash and
update the row:

Use Postgres itself. **Nothing in Part 2 installs Node**, and `pgcrypto` ships with the server, so
this needs no new dependency — and running it inside an interactive `psql` keeps the password off
every command line, for the same reason 4.3 uses `\password`.

```bash
unset HISTFILE                      # psql history is the exposure here
sudo -u postgres psql -d mysite
```

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
UPDATE admin_user SET password_hash = crypt('<the password you chose>', gen_salt('bf', 10))
  WHERE username = 'admin';
\q
```

`gen_salt('bf')` emits a `$2a$` hash, which is the format Spring's `BCryptPasswordEncoder` verifies.

Then verify from your machine, not from the server, so you are testing the real path:

```bash
curl -s -X POST https://api.example.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<the password>"}'
```

A `200` with a token proves DNS, TLS, Caddy, the app, the database and the hash. It proves nothing
about CORS or the frontend build — that is what §7 is for. A `401` means the hash did not take, and
remember from 4.8 that the **sixth** attempt returns 429 rather than 401.

**Set the email while you are in there.** `V2` seeds a placeholder, and with `RESEND_API_KEY` unset
there is no working password-reset path — so if you lose this password, another manual `UPDATE` is
the only way back in:

```sql
UPDATE admin_user SET email = '<your real address>' WHERE username = 'admin';
``` Note that
`#121` is properly fixed by changing how the admin is provisioned, not by this manual step — the
manual step just gets you a working site today.

## 7. Part 5 — verify end to end

In a browser, not with curl, because [a test cannot see appearance](../CLAUDE.md):

1. Load the Netlify site. Projects should render — that proves CORS and the API URL.
2. Deep-link to `/projects/<id>` and refresh. Proves `_redirects` (#39).
3. Submit the contact form. Proves a write path and the rate limiter.
4. Log in at `/admin`, edit a project, log out.
5. `sudo journalctl -u mysite -n 100` — confirm no stack traces, and that **no secret was logged**.

---

## 7a. Redeploying, which is the part you will actually repeat

Part 3's `[code]` changes need a second backend deploy, and so does every change after them. This
loop is the only thing here you will run more than once:

```bash
cd backend && mvn clean package && scp target/*.jar deploy@<vps-host>:/home/deploy/mysite.jar
ssh deploy@<vps-host> 'sudo systemctl restart mysite && sleep 5 && curl -s localhost:8080/actuator/health'
```

The frontend needs nothing — Netlify rebuilds on every push to `main`.

---

## 8. Rules for secrets

- Never commit `.env`, a Caddyfile with credentials, or a jar built with values baked in. The root
  `.gitignore` already covers `.env` and `.env.*`.
- `/etc/mysite/env` is `600`, owned by root. That is the store (#46) until CI exists, at which point
  the secrets move to GitHub Actions secrets and the file is generated at deploy time.
- **Rotate `JWT_SECRET` if it is ever pasted anywhere you would not paste a password** — chat, an
  issue, a screenshot. Rotating invalidates live sessions and costs nothing else.
- Nothing in this runbook should be sent to anyone, including to an AI assistant, with real values
  filled in.

---

## 9. What is deliberately not here

- **CI/CD (#38, #45).** Deploying by hand first is the right order — automation of a process nobody
  has performed is automation of a guess.
- **The Dockerfile (#41)** and **`docker-compose.yml` (#42)**, for the reason in 4.5.
- **Backups.** Not a Phase 5 issue and not optional in reality. `pg_dump` on a cron to off-VPS
  storage, before there is data worth losing.
- **Structured logging (#48)** and **monitoring**. Both are easier once something is running.

## 10. Issue map

| Step | Issue |
|---|---|
| Part 1 | #74 (epic), #39 |
| Part 2 | #75 (epic), #43, #47 |
| 4.5 / 4.6 | #41, #46 |
| Part 3 | #44, #89, #168 |
| Part 4 | #121 |
| Not covered | #38, #42, #45, #48 |
