# Deployment runbook — Netlify (frontend) + self-managed VPS (backend)

**Status: the backend is live, 2026-09-03.** Part 2 is complete — §4.1 through §4.8 have all run on
the real host, and `https://tarka1939.tojest.dev/actuator/health` answers `{"groups":["liveness","readiness"],"status":"UP"}` from the
public internet in ~430 ms, with `/api/v1/projects` returning a valid empty page. That proves the
whole chain: Cloudflare, the provider's nginx, the container over IPv6, Spring Boot, Flyway's
migrations, and Postgres.

**§4.6 was rewritten after that run** and its secret-writing sequence is untested as written — the
operator used the earlier version, which is what prompted the rewrite.

**Not done:** §6 (the admin password — #121, so nobody can log in yet), §7 (end-to-end
verification, which begins by loading the Netlify site), all of Part 1 (Netlify), and
a redeploy of the jar, which was built before CORS (#44) and forwarded-header handling (#168)
merged. Until that redeploy the API answers `curl` but a browser on the Netlify origin would be
blocked, and both rate limiters are still collapsed into one bucket.

Sections corrected **after contact with the actual host** are marked as such — §4.2, §4.4 and §4.8
each said something that turned out to be wrong, and the wrongness is left on the record rather than
quietly replaced, because each one cost time and the reasoning behind it was plausible.

This exists because Phase 5 is the one phase that cannot be delegated — it needs an account, a
payment method, a domain and a shell on a machine that, when this was written, did not exist yet. What *can* be delegated is
marked **[code]**, and is listed at the end.

Re-verify the table before acting if this file has aged.

---

## 0. Three decisions only you can make

Nothing below can start until these are settled. They are recorded in `docs/DECISIONS.md` as
deferred to Phase 5. **Two of the three are now settled** — see the strikethroughs below and the ADR of 2026-09-03. The Netlify site name is reserved but the site is not yet created, which is why Part 1 is still outstanding.

| Decision | Why it blocks | Notes |
|---|---|---|
| **VPS provider, region, size** | Every command in Part 2 assumes a host | 1 vCPU / 2 GB is enough for one Spring Boot app plus Postgres. 1 GB is not — the JVM plus Postgres will thrash. Pick a region near you, not near nothing. |
| **Hostname for the backend** | The frontend hard-codes it, and TLS is issued against it | ~~If you do not own a domain, buy one before starting.~~ **Resolved 2026-09-02, and the advice was wrong for this host:** the provider offers subdomains on its own domains with TLS already terminated, which is sufficient and free. Settled on `tarka1939.tojest.dev`. Check what your provider gives you *before* buying a domain — and if you do buy one, spend it on the frontend, where the URL is actually visible. |
| **Netlify site name** | Becomes the CORS origin and the canonical URL | **Settled as `krzysztof-tarka`** — the name is fixed and already baked into the backend's CORS allowlist and `FRONTEND_URL`, but **the site itself is not created yet**, which is why Part 1 is still outstanding. A custom domain can come later without redoing anything. |

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
| Prod API base URL | `https://tarka1939.tojest.dev/api/v1` — was a `TBD` placeholder until 2026-09-03 | `frontend/src/environments/environment.ts` |
| CORS config | **does not exist** | nothing in `/backend` matches `CorsConfiguration`/`addCorsMappings`/`@CrossOrigin` — this is issue #44 |
| Dockerfile | **does not exist** | issue #41 |
| CI workflows | **none** — `.github/workflows/` contains only a `README.md` | issues #38, #45 |

### Resolved during the deployment

| | Value |
|---|---|
| Backend public URL | `https://tarka1939.tojest.dev` |
| Frontend origin (CORS allowlist, `FRONTEND_URL`) | `https://krzysztof-tarka.netlify.app` — name settled, site not yet created |
| Container app port | `8080` — Spring Boot's default, so no `SERVER_PORT` needed |
| Host | Ubuntu 24.04 LTS, LXC, 2 GB RAM, 25 GB disk |
| Postgres | 16.15, listening on `127.0.0.1:5432` only |

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

**Both names are now known** (see the table above), so this section is history rather than a live
constraint. It is kept because the shape recurs on any redeploy to a new host. The sequence that
works:

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
curl -s -o /dev/null -w '%{http_code}\n' https://<your-site>.netlify.app             # expect 200
curl -s -o /dev/null -w '%{http_code}\n' https://<your-site>.netlify.app/projects    # expect 200
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
sudo ufw allow 22/tcp    # NOT 80/443 on a shared-IP host -- see the note below
sudo ufw enable && sudo ufw status
```

**5432 must not appear in that list**, and Postgres should be listening only on localhost anyway.

**8080 is a different story, and 4.2 originally got it wrong.** Whether the app's port must be open
depends on where the reverse proxy runs. A proxy on this same box reaches it over loopback and 8080
stays closed; a proxy belonging to your *provider* connects across the network and a default-deny
firewall silently drops it. See 4.8, which sets the rule this host actually needs.

**Two things about ports on a NAT'd container**, both of which surprised this deployment:

- The forwarded IPv4 port is not the port inside the box. SSH arrives on `10159` from outside and is
  NAT'd to `22` internally, so `ufw allow 22/tcp` is the correct rule despite `22` being closed from
  the internet over IPv4.
- **IPv6 bypasses the port mapping entirely.** The container's public IPv6 exposes ports *directly*,
  so `22` really is reachable from the internet over IPv6 even though the IPv4 mapping suggests SSH
  lives somewhere obscure. A high-numbered SSH port buys nothing here, which makes key-only
  authentication the control that actually matters — confirm it with
  `sudo sshd -T | grep -iE 'permitrootlogin|passwordauthentication|kbdinteractive'`, and note that
  `PasswordAuthentication no` alone is not enough while `KbdInteractiveAuthentication` is `yes`.

Rules for `80/tcp` and `443/tcp` are worth omitting on a shared-IP host: those ports belong to the
provider, so the rules protect nothing and imply a level of control you do not have.

### 4.3 Postgres

```bash
sudo apt update && sudo apt install -y postgresql
sudo -u postgres psql          # interactive, deliberately -- see below
```

What you should see. **`\password` prints nothing on success** — it only speaks up if the two
entries disagree — so the changing prompt is the one visible sign anything happened:

```
postgres=# CREATE USER mysite;
CREATE ROLE
postgres=# \password mysite
Enter new password for user "mysite":
Enter it again:
postgres=# CREATE DATABASE mysite OWNER mysite;
CREATE DATABASE
postgres=# \c mysite
You are now connected to database "mysite" as user "postgres".
mysite=# GRANT ALL ON SCHEMA public TO mysite;
GRANT
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

**Verify before moving on, rather than finding out at 4.7.** The second check is the one that
matters — a missing `CREATE` on the schema makes Flyway fail with an error that reads like a
connection problem:

```bash
psql -h localhost -U mysite -d mysite -c 'SELECT current_user, current_database();'
```

`-h localhost` forces TCP, so it prompts for the password — which is what actually tests that
`\password` took. Expect `mysite | mysite`.

```bash
psql -h localhost -U mysite -d mysite -c "SELECT has_schema_privilege('mysite','public','CREATE');"
```

Expect `t`. An `f` means the `GRANT` did not land and 4.7 will fail its first migration.

Confirm it is not listening publicly:

```bash
sudo ss -tlnp | grep 5432    # expect 127.0.0.1:5432, not 0.0.0.0:5432
```

### 4.4 Java

```bash
sudo apt install -y openjdk-25-jre-headless
java -version
```

```
openjdk version "25.0.4" 2026-07-21
OpenJDK Runtime Environment (build 25.0.4+7...)
```

The leading `25` is what matters; the build string varies by vendor. Note `java -version` writes to
**stderr**, so piping it to `grep` needs `2>&1`.

`-jre-headless` rather than the full JDK: this box runs a jar, it does not compile one, and the JDK
is a few hundred megabytes you do not have spare on a 2 GB host.

**Check before assuming this fails.** An earlier version of this section called it the step most
likely to fail, on the reasoning that Java 25 is too recent for a stock LTS image. That proved wrong
on Ubuntu 24.04, which carries `openjdk-25-jre-headless` at `25.0.4+7-1~24.04` — matching the JDK
this project builds with. One read-only command settles it without sudo:

```bash
apt-cache policy openjdk-25-jre-headless
```

A `Candidate:` line means the plain `apt install` above is all you need. Only if it says
`(none)` do you need Adoptium:

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
`/etc/mysite/env` (which a container reuses verbatim via `--env-file`), the subdomain mapping, the DNS
record, and the demonstrated fact that this app runs against this database.

**The real risk is that interim things become permanent**, so state the exit condition now: issue #41
is not done until this systemd unit is deleted.

```bash
# on your machine -- Docker must be running: twelve test classes use Testcontainers,
# and this deliberately does not skip them
cd backend && mvn clean package -DskipTests=false
scp -P 10159 target/*.jar deploy@<vps-host>:/home/deploy/mysite.jar   # SSH is NAT'd to a high port
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
printf 'JWT_SECRET=%s\n' "$(openssl rand -base64 48)" | sudo tee -a /etc/mysite/env >/dev/null
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

`systemctl status` should show `Active: active (running)`. The journal is the useful one — a healthy
start ends with Flyway reporting the migration count and Tomcat announcing the port:

```
Successfully applied 7 migrations to schema "public" ...
Tomcat started on port 8080 (http) with context path '/'
Started MySiteApplication in N.NNN seconds
```

`Successfully validated 7 migrations` on later starts is also correct — Flyway found the schema
already at the right version and did nothing.

```bash
curl -s localhost:8080/actuator/health
```

```
{"groups":["liveness","readiness"],"status":"UP"}
```

Nothing else. `show-details: when-authorized` means an anonymous caller sees only the status, which
is why it is safe to expose through the provider's proxy in 4.8.

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

### 4.8 Exposing it to the internet

**Rewritten 2026-09-03, after doing it.** The original version of this section had you install Caddy
and obtain a Let's Encrypt certificate on ports 80 and 443. That is wrong on this host, and the way
it is wrong is worth keeping: it assumed a VPS with its own IPv4 address and its own ports. This is a
NAT'd LXC container on shared infrastructure, and almost every assumption downstream of that changed.

#### What the host actually is

Measured, not assumed:

- **The container is LXC**, on a private IPv4 (`192.168.1.x`) behind NAT. `systemd-detect-virt`
  reports `lxc`.
- **Ports 80 and 443 belong to the provider**, not to you. `curl` against them returns a certificate
  for the *host* (`CN=srv73.mikr.us`) and a redirect to the host's own page. You cannot bind them and
  Let's Encrypt cannot validate through them.
- **You get a handful of forwarded IPv4 ports** — here `10159` (SSH), `20159`, `30159`.
- **The container has a public, routable IPv6 address**, and this is the important one. It is
  reachable from the internet directly, on any port the firewall allows.
- **The provider's HTTP proxy reaches your container over that IPv6**, not over the private IPv4.

The resulting request path has *two* proxies, because the provider fronts its own domains with
Cloudflare:

```
visitor → Cloudflare → provider nginx → your container, public IPv6 :8080
```

#### Configure the subdomain

The provider panel maps a subdomain to a port inside your container. **Set the port to 8080**, not
the default 80 — nothing listens on 80 here, and Spring Boot defaults to 8080 with no `server.port`
in `application.yml`. That also means you need no `SERVER_PORT` in `/etc/mysite/env`.

**The panel probes the port when you save**, so it fails unless something is already listening. Two
things follow, and the second cost an hour:

1. **Prove the path before deploying the app.** Same principle as preferring the jar to Docker in
   4.5: separate "is the mapping right" from "does my app work", so a later failure has one meaning.
2. **The listener must bind IPv6.** `python3 -m http.server 8080` binds `0.0.0.0` — IPv4 only — and
   fails the probe identically to having nothing there at all, which sends you hunting the wrong
   problem.

```bash
cd /tmp && echo '<h1>mapping test</h1>' > index.html && python3 -m http.server 8080 --bind ::
```

Leave it in the foreground, save the subdomain, then `Ctrl-C`. Verify from **outside** — from your
own machine, not the server:

```bash
curl -sS -w '\nstatus=%{http_code}\n' https://<your-sub>.<provider-domain>/
```

`200` and the test page means DNS, the provider's proxy, TLS, the port mapping and your container
all work. Anything else is one of those five, and the listener's own log tells you whether the
request arrived.

#### The firewall rule this needs, which 4.2 got wrong

4.2 said 8080 must not appear in `ufw status`, because "the app is reached only through the reverse
proxy". That is true when the proxy runs **on the same box**. Here it is external and connects over
the public IPv6, so a default-deny firewall drops it — the symptom is a connection that times out
rather than refuses, and the provider panel simply reports no server listening.

Open it, but not to everyone. The listener's log shows the proxy's source addresses; here they were
`2a01:4f8:c012:8ba::1` and `2a01:4f9:c012:f2aa::1`:

```bash
sudo ufw allow from 2a01:4f8:c012:8ba::/64 to any port 8080 proto tcp
sudo ufw allow from 2a01:4f9:c012:f2aa::/64 to any port 8080 proto tcp
```

`/64` rather than the exact addresses leaves headroom for sibling proxy nodes. **If the subdomain
starts returning 502 later, a new proxy node outside those ranges is the first thing to check.**

A blanket `ufw allow 8080/tcp` works and should not be left in place: it exposes the app in plaintext
on the public IPv6, bypassing the provider's TLS entirely.

#### What this means for #168, which is now mandatory

With two proxies in the path, `request.getRemoteAddr()` is one address for the entire internet, so
both rate limiters collapse into a single bucket — any stranger can lock the owner out of the admin
panel and silence the contact form. That is no longer a consequence to handle later; the site is
broken in a way nobody will notice until it bites.

**Status: the code half is done** (#168, `ClientIpResolver`). The `prod` profile already defaults to this measured chain — the two provider `/64`s as trusted proxies, `CF-Connecting-IP` as the client-ip header, and a hop count of 2 — so nothing extra goes in `/etc/mysite/env`. Override with `TRUSTED_PROXIES`, `CLIENT_IP_HEADER` and `TRUSTED_HOP_COUNT` only if the provider moves its proxy nodes; a stale list is not a security hole (an untrusted peer keeps its own address) but it does silently restore the collapsed bucket.

The firewall rule above is also what makes the fix *possible*. A forwarded-for header is only
trustworthy if nothing can reach the app except through the proxy. With 8080 open to the world,
anyone could set the header to anything and defeat rate limiting completely — strictly worse than
the bug being fixed.

#### Certificates

Nothing to do. The provider terminates TLS and renews its own certificate. `openssl s_client` showed
a valid Google Trust Services certificate for the provider's domain. That covers issue #47 for the
backend; Netlify handles the frontend's.

#### If you leave this provider

Everything above is provider-shaped, which is the argument for the alternative that was considered
and not taken: **Cloudflare Tunnel** needs no inbound ports at all, works from behind NAT, and
follows you to a different host unchanged. It costs a domain, a Cloudflare account and a daemon.
Worth revisiting if this arrangement ever becomes limiting; not worth paying for up front.

Note that Cloudflare is *already* in the request path here regardless — the provider put it there.
Choosing the provider's subdomain did not avoid a third-party processor, and an earlier version of
this document claimed it did.

---

## 5. Part 3 — wiring the two together **[code]**

These are repo changes, not server steps. They are the delegatable part, and none can be written
until Parts 1 and 2 have produced real names.

1. **CORS (#44)** — allowlist the exact Netlify origin in the backend. Not a wildcard: the site
   sends an `Authorization` header, so a permissive config is both a real exposure and, with
   credentials, one browsers reject anyway.
2. **Trust `X-Forwarded-For`, conditionally (#168)** — required by 4.8, which otherwise collapses
   both rate limiters into a single `127.0.0.1` bucket. The conditional matters: trust the header
   only for requests arriving from the proxy. **There is no Caddy here and neither proxy is ours to
   configure**, so "have the proxy overwrite rather than append" is not an available move — whatever
   `X-Forwarded-For` arrives is what Cloudflare and the provider's nginx chose to send, and a client
   can prepend to it. The fix therefore has to know *which* element is the real client: prefer
   Cloudflare's `CF-Connecting-IP`, which it overwrites and is single-valued, and otherwise count
   **from the right**, since a caller can only prepend. Unconditional trust is worse than the bug,
   because a forged header defeats rate limiting entirely instead of merely globalising it.
3. ~~**`environment.ts`** — replace the placeholder host.~~ **Done 2026-09-03.**
4. ~~**`docs/openapi.yaml`** — the production server entry.~~ **Done 2026-09-03.** The regenerate
   produced no client change, and that is a *property* rather than luck: the typescript-angular
   client embeds no server URL at all — `basePath` is injected at runtime by `provideApi()`. Note
   the check is `git diff --numstat`, not `git status --porcelain`; see `CLAUDE.md`.
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
curl -s -X POST https://tarka1939.tojest.dev/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<the password>"}'
```

A `200` with a token proves DNS, TLS, the provider's proxy, the app, the database and the hash. It proves nothing
about CORS or the frontend build — that is what §7 is for. A `401` means the hash did not take, and
remember from 4.8 that the **sixth** attempt returns 429 rather than 401.

**Set the email while you are in there.** `V2` seeds a placeholder, and with `RESEND_API_KEY` unset
there is no working password-reset path — so if you lose this password, another manual `UPDATE` is
the only way back in:

```sql
UPDATE admin_user SET email = '<your real address>' WHERE username = 'admin';
```

Note that `#121` is properly fixed by changing how the admin is provisioned, not by this manual step — the
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

**Stage, then swap** — do not `scp` over the live jar. Copying straight onto it leaves no way back
if the new build refuses to start, and the failure happens on a host you are not looking at.

```bash
# on your machine (note the port -- SSH is NAT'd to a high port on this host)
cd backend && mvn clean package
scp -P 10159 target/*.jar deploy@<vps-host>:/home/deploy/mysite-new.jar
```

```bash
# on the host -- neither mv needs sudo, and replacing an open file does not disturb
# the running JVM, which keeps its own inode until it restarts
test -s /home/deploy/mysite-new.jar \
  && mv /home/deploy/mysite.jar /home/deploy/mysite-prev.jar \
  && mv /home/deploy/mysite-new.jar /home/deploy/mysite.jar \
  && sudo systemctl restart mysite && sleep 5 && curl -s localhost:8080/actuator/health
```

Chained deliberately: if the `scp` never landed — wrong port, full disk, a typo — an unchained
first `mv` would rename the working jar away, the second would fail, and `systemctl restart`
would then run against **no jar at all**.

Expect `{"groups":["liveness","readiness"],"status":"UP"}`. If not, roll back — keeping the
failed build, because rolling straight over it destroys the thing you were about to diagnose:

```bash
mv /home/deploy/mysite.jar /home/deploy/mysite-bad.jar          # keep it to diagnose
mv /home/deploy/mysite-prev.jar /home/deploy/mysite.jar && sudo systemctl restart mysite
sudo journalctl -u mysite -n 40
```

Under the `prod` profile the app **fails to start** on configuration that is present but wrong — a
malformed CIDR in `TRUSTED_PROXIES`, a negative hop count, a trusted-proxy list with no header
configured to read. That is deliberate (#168), and it is the most likely cause of a redeploy that
boots fine one build and not the next. The journal names the property.

The frontend needs nothing — Netlify rebuilds on every push to `main`.

---

## 8. Rules for secrets

- Never commit `.env`, a proxy config with credentials, or a jar built with values baked in. The root
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
