# Deployment runbook — Netlify (frontend) + self-managed VPS (backend)

**Status: the backend is live, 2026-09-03.** Part 2 is complete — §4.1 through §4.8 have all run on
the real host, and `https://tarka1939.bieda.it/actuator/health` answers `{"groups":["liveness","readiness"],"status":"UP"}` from the
public internet in ~430 ms, with `/api/v1/projects` returning a valid empty page. That proves the
whole chain: Cloudflare, the provider's nginx, the container over IPv6, Spring Boot, Flyway's
migrations, and Postgres.

**§4.6 was rewritten after that run** and its secret-writing sequence is untested as written — the
operator used the earlier version, which is what prompted the rewrite.

The jar was redeployed on 2026-09-03 and **CORS (#44) and forwarded-header handling (#168) are both
live and verified against the host**: an exact-origin preflight is answered, a deploy-preview origin
is refused with 403, and the login limiter returns 429 on the sixth attempt.

**Not done:** §6 (the admin password — #121, so nobody can log in yet), §7 (end-to-end
verification, which begins by loading the Netlify site), and all of Part 1 (Netlify).

Sections corrected **after contact with the actual host** are marked as such — §4.2, §4.4, §4.7,
§4.7a and §4.8
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
| **VPS provider, region, size** | Every command in Part 2 assumes a host | 1 vCPU / 2 GB is enough for one Spring Boot app plus Postgres. 1 GB is not — with no swap on this class of host the JVM plus Postgres does not thrash, it gets killed (§4.7a). Pick a region near you, not near nothing. |
| **Hostname for the backend** | The frontend hard-codes it, and TLS is issued against it | ~~If you do not own a domain, buy one before starting.~~ **Resolved 2026-09-02, and the advice was wrong for this host:** the provider offers subdomains on its own domains with TLS already terminated, which is sufficient and free. Settled that day on `tarka1939.tojest.dev`, and **moved to `tarka1939.bieda.it` on 2026-09-03** — both provider domains, and the change cost only a redeploy, which is why `AGENT_LOG.md`'s 2026-09-02 entry names the older one. Check what your provider gives you *before* buying a domain — and if you do buy one, spend it on the frontend, where the URL is actually visible. |
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
| Prod API base URL | `https://tarka1939.bieda.it/api/v1` — was a `TBD` placeholder until 2026-09-03 | `frontend/src/environments/environment.ts` |
| CORS config | **exists** since PR #172 — exact origins, no patterns | `SecurityConfig.java`; issue #44, deployed and verified live 2026-09-03 |
| Dockerfile | **does not exist** | issue #41 |
| CI workflows | **none** — `.github/workflows/` contains only a `README.md` | issues #38, #45 |

### Resolved during the deployment

| | Value |
|---|---|
| Backend public URL | `https://tarka1939.bieda.it` |
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
| `RESEND_API_KEY` | empty | Empty is a *designed* no-op: emails are skipped with a warning rather than failing. Fine to leave unset at first, but note it is no longer only about password reset — since #186 it also gates contact-form notification, which is an operational need rather than a demo |
| `RESEND_FROM_ADDRESS` | `onboarding@resend.dev` | Only matters once `RESEND_API_KEY` is set |
| `CONTACT_NOTIFICATION_EMAIL` | empty | #186. Where contact-form submissions are announced. Empty is a designed no-op — the message is still saved and still answered with 201, nobody is just told about it. A **malformed** value is not tolerated and the app refuses to start, because a typo'd address fails one silent notification at a time and reads as "nobody is writing in" |
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
```

Write the non-secret keys first. Nothing here is worth hiding:

```bash
sudo tee /etc/mysite/env >/dev/null <<'EOF'
DB_URL=jdbc:postgresql://localhost:5432/mysite
DB_USERNAME=mysite
FRONTEND_URL=https://<your-site>.netlify.app
SPRING_PROFILES_ACTIVE=prod
EOF
```

**Then the two secrets, neither of which you type into a command.** The file has to hold them in
plaintext — that is what systemd's `EnvironmentFile` reads, and why it is `600 root:root` — but
nothing should put them in `~/.bash_history`, in `ps` output, or in scrollback you later paste
somewhere.

```bash
IFS= read -rsp 'DB password: ' DBPW; echo
printf 'DB_PASSWORD=%s\n' "$DBPW" | sudo tee -a /etc/mysite/env >/dev/null
unset DBPW
```

`IFS=` matters: without it `read` strips leading and trailing whitespace, so a password with an edge
space would be silently corrupted *before* systemd ever saw it — and the symptom would look exactly
like the parser problem described below, sending you after the wrong cause. `-r` keeps backslashes
literal. `read -s` does not echo; `printf` is a shell builtin, so the value never becomes a process argument
visible in `ps`; and the only thing on a command line is `sudo tee -a /etc/mysite/env`. An earlier
version of this section had you paste the password straight into the heredoc, which put it in shell
history — reported from a live run.

The JWT secret is generated straight into the file and never reaches your terminal at all:

```bash
printf 'JWT_SECRET=%s\n' "$(openssl rand -base64 48)" | sudo tee -a /etc/mysite/env >/dev/null
```

**Verify without printing a single value:**

```bash
sudo awk -F= '{print $1}' /etc/mysite/env && sudo ls -l /etc/mysite/env
```

```
DB_URL
DB_USERNAME
FRONTEND_URL
SPRING_PROFILES_ACTIVE
DB_PASSWORD
JWT_SECRET
-rw------- 1 root root ... /etc/mysite/env
```

#### `RESEND_API_KEY`, if and when you want email to actually leave the host

Optional, and deliberately so: with the key unset every send degrades to warn-and-skip, which is a
designed no-op rather than a broken state. Add it the same way as the others — the value never
reaches a command line:

```bash
unset HISTFILE
IFS= read -rsp 'Resend API key: ' RESEND; echo
printf 'RESEND_API_KEY=%s\n' "$RESEND" | sudo tee -a /etc/mysite/env >/dev/null
unset RESEND
sudo systemctl restart mysite
```

Add `RESEND_FROM_ADDRESS` too if you are sending from your own domain; it defaults to
`onboarding@resend.dev`, which works for testing and is obviously not yours.

**These three keys do not have the same blast radius, and an earlier version of this paragraph got
that backwards.** A leaked `DB_PASSWORD` is useless to anyone who cannot reach `127.0.0.1:5432` —
i.e. to anyone who does not already have the host. **`JWT_SECRET` and `RESEND_API_KEY` both work
from anywhere on the internet.** The first is an HS256 *symmetric* signing key, so a holder mints an
admin token offline and presents it to the public API, never calling `/auth/login` and never meeting
its rate limiter. The second sends mail through this project's Resend account — today from
`onboarding@resend.dev`, and *as* you with valid SPF and DKIM if a sender domain is ever verified.

So **two** of the three are where the handling above does real work rather than hygiene, not one.
Rotate either on suspicion: `JWT_SECRET` per §8, which costs only live sessions, and the Resend key
in its dashboard, where revocation is immediate and free. This paragraph previously said a leaked
`JWT_SECRET` was "useless without the running app", which is the opposite of true and is corrected
in `docs/DECISIONS.md`, 2026-09-03, clause 2a.

**Two flows depend on this key now, not one.** Password reset is a showcase feature rather than an
admin tool, which is what made the key sandbox-shaped. **Contact-form notification (#186) is not** —
it is how the owner learns a real person wrote in, and it needs a destination as well, which is the
next subsection. See `docs/DECISIONS.md`, 2026-09-03, "Contact-form notification".

48 random bytes is 64 base64 characters, comfortably over the 32-byte minimum `SecurityConfig`
enforces for HS256, and the base64 alphabet contains nothing systemd's `EnvironmentFile` parser
mangles. **The database password is not under that guarantee** — it is whatever you chose in 4.3.
If it contains a space or a quote, systemd may mangle it, and the symptom is 4.7 failing to
authenticate against Postgres while `psql` with the same password works. Wrap the value in **single**
quotes in the file if so — not double, which is the obvious guess and the wrong one: systemd applies
C-style escape processing inside double quotes, so a password containing a backslash is mangled *by
the quoting meant to protect it*.

Editing the file to add those quotes means typing the value, which is what the rest of this section
exists to avoid. `sudoedit /etc/mysite/env` is the least-bad way to do it: no shell history, no `ps`,
no pipeline. It is also a perfectly good alternative to the whole sequence above if you would rather
have one step than three.

> **If you already ran the earlier version of this section, the password is in your shell history now.**
> That version pasted it into the heredoc, so it is sitting in plaintext in `~/.bash_history` — a file
> that gets backed up, and that people paste from. Fixing the instructions does not fix the value.
> The clean remedy is to rotate it, which costs two minutes:
>
> ```bash
> sudo -u postgres psql -c '\password mysite'    # prompts; sets a new one
> ```
>
> then re-run this section to write the new value, and restart the service. If you would rather not
> rotate, at minimum scrub the history: `history -d` the offending entry, or truncate the file and
> `history -c` — remembering that the running shell rewrites it on exit, so do it in *every* session
> that saw the password.

#### `CONTACT_NOTIFICATION_EMAIL`, so you find out someone wrote in

Not a secret — it is your own address — so it needs none of the history-suppressing care above,
and it goes in its own step rather than alongside the two keys, which is why it is down here:

```bash
sudoedit /etc/mysite/env    # add: CONTACT_NOTIFICATION_EMAIL=you@yourdomain.example
sudo systemctl restart mysite
```

**Get it right the first time.** A malformed value is refused at startup rather than tolerated, so
a typo here means the service fails to come back up with an `IllegalStateException` naming
`app.contact.notification-email` — deliberate, and much easier to diagnose than notifications that
silently never arrive. Check `journalctl -u mysite -n 50` if the restart does not settle.

Leaving it unset is a supported state: messages are saved and answered with `201` regardless, and
`/admin/messages` still shows them. It just means nobody is told.

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

`-Xmx512m` is deliberate, and it is load-bearing for a reason that is not the obvious one — on
this host the JVM believes it has 120 GiB and would size its heap for a 30 GiB ceiling without it.
§4.7a has the measurement. Do not drop the flag, and do not run the jar by hand without it.

If it does not come up, the likely causes are: a missing variable from 4.6 (the app names which),
the Java version, or the schema grant from 4.3. Untested, so treat that list as a starting point
rather than an exhaustive one.

### 4.7a Memory pressure — swap is not available here, and `-Xmx` is doing more than it looks

**Corrected 2026-09-04, after measuring the host.** An earlier version of this section told you to
create a swapfile. You cannot, on this host. A later version then claimed `-Xmx512m` was mostly
decorative and that an OOM kill leaves no trace. Both of those were wrong too, and the measurements
below are why. This section is now written from output rather than from what is usually true of a
Linux box.

**Check what kind of host you are on first**, because it decides whether the usual answer even
exists:

```bash
systemd-detect-virt; free -h
```

Semicolon, not `&&`: `systemd-detect-virt` exits **non-zero when it finds no virtualization**, so on
bare metal `&&` would swallow the `free -h` that is half the point.

#### Swap is unavailable, not merely unhelpful

**If that says `lxc` (or `openvz`), you cannot enable swap and should not try.** An LXC container,
privileged or not, cannot enable its own — swap is a host-level resource. On an unprivileged one the
kernel refuses outright, which is what happened here:

```
$ sudo swapon /swapfile
swapon: /swapfile: swapon failed: Operation not permitted
```

The trap is that everything before the last step *succeeds*: the file is created, `mkswap` works, the
`fstab` line is accepted. You end up with a gigabyte of disk doing nothing and an `fstab` entry that
looks like it worked. If you already made one: `sudo rm /swapfile`, drop the `fstab` line.

On a real VM the usual three commands do work. **Untested here, for the reason above:**

```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h && swapon --show      # verify -- do not assume the fstab line means it is active
```

#### `-Xmx512m` is not a round number, and not the reason an earlier draft gave

The unit sets `-Xmx512m`. A previous version of this section justified it as "the JVM defaults to a
quarter of RAM, which on a 2 GB box competes with Postgres". The arithmetic is right and the premise
is wrong — and on this host it is wrong by a factor of sixty. Measured, as `deploy`, inside the
container:

```
$ java -XX:+PrintFlagsFinal -version | grep -E "MaxHeapSize|MaxRAMPercentage"
   size_t MaxHeapSize     = 32210157568    {product} {ergonomic}
   double MaxRAMPercentage = 25.000000     {product} {default}
```

**32210157568 bytes is almost exactly 30 GiB** (2 MiB under). At the default 25%, the JVM believes this machine has **120 GiB**.
It has 2. Container memory detection is not working here — that much *is* measured, and it is the
part that matters. **The explanation below is not measured**, and is marked as such because the
rest of this section is: the most plausible account is that `lxcfs` virtualises `/proc/meminfo`,
so `free` reads 2 GiB correctly, while the JVM's own container support looks for a cgroup memory
limit, finds none, and falls back to the physical host's figure. `cat /sys/fs/cgroup/memory.max`
on the host would settle it; nobody has run it.

So the flag is not trimming a default that was nearly right. **Without it the JVM would size its heap
against a ceiling fifteen times the size of the box**, and would grow into it until earlyoom
intervened. Do not remove it, and do not "simplify" it to match a general guide that assumes
container awareness works.

This also means: if you ever run the jar by hand to debug something, `java -jar mysite.jar` **without
`-Xmx`** is not the same program the unit runs. Pass it.

#### What the provider runs, and why it matters more than swap

Read this even if you skipped the rest. On this host:

```
/usr/bin/earlyoom -r 3600 -m 15,8 --avoid (^|/)(sshd|systemd|init|bash)$ --prefer ^(node|python|php|java|chrome)$
```

`--prefer` adds a large badness penalty to any process named `java`, and the JVM is also the largest
single consumer here, so under pressure it is selected first in practice. (`--prefer` biases the
ranking; it does not impose an order, and a second `java` or `node` process would compete.)

`-m 15,8` set the minimum available memory as a percentage of **total** RAM, and earlyoom acts
when `MemAvailable` falls below it. On 2048 MiB total:

| threshold | signal | what it does to the service |
|---|---|---|
| 15% ≈ **307 MiB** | `SIGTERM` | the JVM runs shutdown hooks and exits **143** |
| 8% ≈ **164 MiB** | `SIGKILL` | the JVM dies outright, `signal=KILL` |

**The two produce opposite symptoms, and an earlier draft only described one.** The unit carries
`SuccessExitStatus=143` and `Restart=on-failure`, so systemd treats 143 as a *clean* exit and does
**not** restart. The common case — a `SIGTERM` at 15% — therefore looks like the service stopping
dead and staying stopped, with `systemctl status` reporting `Result: success` and nothing in the
application log explaining why it shut down. That is a far nastier diagnosis than a restart loop, and
it is the one you are most likely to meet. Only the `SIGKILL` case produces the restart-every-few-
minutes pattern.

#### The kill does leave a trace — read earlyoom's own log

An earlier draft said the kill was invisible because `journalctl -k` is empty in a container. That
reasoning does not hold: `journalctl -k` reads the *kernel* ring buffer, where the *kernel's* OOM
killer logs. **earlyoom is a userspace daemon** — it polls `MemAvailable`, sends the signal itself,
and writes to the journal like any other service:

```bash
journalctl -t earlyoom --since -1d | tail -20
```

Its `-r 3600` flag means it writes a memory report every hour even when nothing is killed, so this
command also tells you the log is reachable at all. Real output from this deployment:

```
Sep 03 19:07:00 lee159 earlyoom[248]: mem avail: 1543 of 2048 MiB (75.37%), swap free: 0 of 0 MiB (0.00%)
```

#### Watch `available`, not `free`

`free -h` prints both and they differ a lot on a box with page cache. earlyoom watches
**`available`**. On this deployment:

```
               total        used        free      shared  buff/cache   available
Mem:           2.0Gi       505Mi       481Mi        27Mi       1.1Gi       1.5Gi
Swap:             0B          0B          0B
```

The `free` column reads **481 MiB**, which looks alarmingly close to the 307 MiB trigger. The number
that matters is `available` at **1.5 GiB**, roughly five times the threshold. Reading the wrong
column here is how a comfortable box looks like a failing one.

For a sense of scale: earlyoom's hourly reports show `mem avail` sitting at 1977 MiB before the
backend starts and 1547 MiB after, so **the application's real footprint is about 430 MiB** —
comfortably inside its 512 MiB heap cap plus overhead. If that figure climbs toward the 307 MiB
margin, lower `-Xmx` before earlyoom decides for you.

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
\q
```

Then set the password **without putting it in the statement**. An earlier version of this section had
you type it into the `UPDATE`, which is the same mistake §4.3 and §4.6 each go out of their way to
avoid — reported by the operator, twice, in two different sections.

```bash
unset HISTFILE
IFS= read -rsp 'New admin password: ' ADMPW; echo
```

```bash
# ADMPW comes from the read -rsp prompt in the block above -- never typed here.
# Replace the <...> email with a recovery address you have never published -- see below.
{ printf "SET log_statement = 'none'; SET log_min_duration_statement = -1;\n"
  printf "UPDATE admin_user SET password_hash = crypt('%s', gen_salt('bf',10)), email = '%s' WHERE username = 'admin';\n" \
    "${ADMPW//\'/\'\'}" "<your-unpublished-recovery-address>"
} | sudo -u postgres psql -d mysite
unset ADMPW
```

The value reaches psql through **stdin**, never argv — so it is not in `ps`, not in `/var/log/auth.log`
(which sees only `sudo -u postgres psql -d mysite`), and not in shell history, because the command
line holds `$ADMPW` rather than the password. `${ADMPW//\'/\'\'}` doubles any single quote so a
password containing one cannot break out of the SQL literal.

**The two `SET`s close the one vector the shell cannot.** Postgres can be configured to log
statement text — `log_statement`, or `log_min_duration_statement` catching a slow query — and an
`UPDATE` carrying a plaintext password would land in the server log verbatim. Ubuntu's defaults
(`none` and `-1`) do not, and were confirmed on this host, but a default is not a guarantee: someone
turns statement logging on to debug something and forgets, and the next person to run this section
leaks a credential into a file nobody is thinking about. The `SET`s make it independent of that,
and cost one line. They are themselves logged, harmlessly.

**Use a recovery address you have never published**, rather than the one in your git commits. The
endpoint deliberately returns 202 whether or not an address is registered (`ifPresent` with no
`else`), so an unpublished address stays genuinely unknown — which matters, because an attacker
chooses the weaker of bcrypt and your mailbox, and knowing which mailbox is most of that work.
It cannot be a *secret* — a maintainer address sits in most of this repository's commits — but
withholding which mailbox is real is still work an attacker has to do. See the security-posture
ADR in `docs/DECISIONS.md` (2026-09-03), clause 5.

Setting the email in the same statement matters: `V2` seeds a placeholder, and with `RESEND_API_KEY`
unset there is no working password-reset path, so losing this password means another manual `UPDATE`.

`gen_salt('bf')` emits a `$2a$` hash, which is the format Spring's `BCryptPasswordEncoder` verifies.

Then verify from your machine, not from the server, so you are testing the real path:

```bash
IFS= read -rsp 'Password to test: ' ADMPW; echo
ADMPW="$ADMPW" python3 -c 'import json,os,sys; json.dump({"username":"admin","password":os.environ["ADMPW"]}, sys.stdout)' \
  | curl -sS -o /dev/null -w '%{http_code}\n' -X POST https://tarka1939.bieda.it/api/v1/auth/login \
      -H 'Content-Type: application/json' --data @-
unset ADMPW
```

**The password never reaches `argv`, and the token never reaches your scrollback.** Four things
are deliberate:

**Not `-d '{..."password":"..."}'`,** which an earlier version of this section used. A value passed
in `-d` is a command-line argument: it lands in shell history and is visible in `ps` to every user
on the machine you run it from.

**Not `export ADMPW`,** which an earlier version of *this fix* used. `ADMPW="$ADMPW" python3 ...` is
a one-shot assignment scoped to that single process. An `export` puts the password in the
interactive shell's own environment, where every later child inherits it and any subsequent `env`
or verbose build prints it — and if the pipeline errors or you Ctrl-C, the `unset` never runs and it
stays there. The variable itself survives an interrupt either way — `read` set it — so run
`unset ADMPW` yourself if you Ctrl-C; what the one-shot form removes is every later child
inheriting it. No other unprivileged user can read a process environment (`/proc/<pid>/environ` is
owner-only on Linux; on Windows it is readable only within your own user context), but your own
scrollback is exactly the exposure this runbook is trying to avoid.

**`-o /dev/null -w '%{http_code}\n'`, so only the status code prints.** `-sS` silences the progress
meter, not the body — and the body of a successful login is a bearer token valid for an hour. The
prose below reasons only about `200`/`401`/`429`, so printing the token buys nothing and puts admin
credential material into the scrollback that `docs/DECISIONS.md`'s 2026-09-03 clause 3 prohibits.
That is not hypothetical here: pasted terminal output is the disclosure route that actually
occurred during this deployment.

**`python3` builds the JSON rather than `printf`,** because the password has to be *JSON*-escaped
and a
hand-rolled version is where this goes wrong: a password containing `"` or `\` produces a malformed
body and a `400` or `401` that looks exactly like a bad password, sending you to debug a hash that
is fine. `json.dump` handles every case, including quotes, backslashes and non-ASCII. On Windows the
interpreter is usually `python` rather than `python3`.

A `200` proves DNS, TLS, the provider's proxy, the app, the database and the hash — and the token
it would otherwise have printed stays out of your scrollback. It proves nothing about CORS or the
frontend build — that is what §7 is for. A `401` means the hash did not take, and
remember from 4.8 that the **sixth** attempt returns 429 rather than 401.

Note that `#121` is properly fixed by changing how the admin is provisioned, not by this manual step — the
manual step just gets you a working site today.

## 7. Part 5 — verify end to end

In a browser, not with curl, because [a test cannot see appearance](../CLAUDE.md):

1. Load the Netlify site. Projects should render — that proves CORS and the API URL.
2. Deep-link to `/projects/<id>` and refresh. Proves `_redirects` (#39).
3. Submit the contact form. Proves a write path and the rate limiter — but **not** that the
   notification email sent, which is deliberately best-effort and after-commit. §7c is that check.
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
  && sudo systemctl restart mysite \
  && { ok=; for i in $(seq 30); do curl -sf localhost:8080/actuator/health && { ok=1; break; }; sleep 2; done
       [ "$ok" ] || { echo 'health never passed after 60s' >&2; false; }; }
```

Chained deliberately: if the `scp` never landed — wrong port, full disk, a typo — an unchained
first `mv` would rename the working jar away, the second would fail, and `systemctl restart`
would then run against **no jar at all**.

**Poll rather than sleep.** An earlier version waited a fixed 5 seconds and then curled once, which
on this host reports *nothing at all*: startup takes about 26 seconds, so `curl` hit a closed port
and `-s` swallowed the error. The operator is left staring at a silent prompt with no way to tell
success from failure — reported from a live run. The loop above exits the moment it is healthy and
keeps waiting if it is not; `Ctrl-C` if it never comes.

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

## 7b. Reading the logs

Added 2026-09-04, because `journalctl` appeared in three scattered places in this document — during
migrations, in the verify checklist, and in the rollback path — and nowhere that told you the unit
name or that there is no log file to `tail`.

The service runs as the systemd unit **`mysite`**, and Spring Boot writes to stdout, so everything
goes to journald. There is nothing under `/var/log` to open.

```bash
sudo journalctl -u mysite -f                  # follow live; the one to keep open during a redeploy
sudo journalctl -u mysite -n 200 --no-pager   # last 200 lines
sudo journalctl -u mysite -p err --since today
sudo journalctl -u mysite --since "10 min ago" | grep -iE "exception|caused by"
```

`--no-pager` matters: without it you land in `less` and need `q` to get out, which is the same trap
as 4.8's foreground listener.

For state rather than output — running or dead, uptime, restart count, and the last few lines:

```bash
systemctl status mysite
```

Other logs on this host:

```bash
sudo journalctl -t earlyoom --since -1d       # the OOM daemon -- see 4.7a
sudo journalctl -u postgresql -n 50
```

**`journalctl -k` is expected to return nothing on this host** — an LXC container has no kernel
ring buffer of its own. (A general fact about containers, not something measured here.) It is also why 4.7a reads earlyoom's own journal instead.


#### Structured (JSON) logs, when there is something to read them

The application can emit ECS-format JSON instead of the human-readable lines above. It is **off by
default and deliberately so**: the only reader on this host is `journalctl` and a person, and JSON
would make every command in this section worse in exchange for a benefit nobody can collect until a
log shipper exists.

When one does, it is one variable and a restart — no redeploy:

```bash
sudoedit /etc/mysite/env    # add: STRUCTURED_LOGS=ecs
sudo systemctl restart mysite
sudo journalctl -u mysite -n 5    # lines should now start with {"@timestamp":
```

`ecs`, `logstash` and `gelf` are the accepted values; Boot 4.1 ships all three natively, so this
needs no dependency. Unset or empty restores the normal pattern.

**It changes format, not content.** The contact and password-reset paths log a message UUID and
never visitor data, at any level; `ResendEmailClient` logs a reset link at DEBUG under a comment
explaining why that is safe, and DEBUG is off in production. A formatter cannot reintroduce a field
nobody logs.

Verified both ways before shipping: with `STRUCTURED_LOGS=ecs` the console emits
`{"@timestamp":...,"log":{"level":"INFO",...},"service":{"name":"mysite-backend"}}`; with it empty,
zero JSON lines and the usual `2026-09-04T19:59:34.915+02:00  INFO ... Started MySiteApplication`.

#### Check whether the journal survives a reboot

In a container the journal is often **volatile** — held in RAM and lost on restart, which is the
worst possible property for diagnosing a crash after the fact:

```bash
journalctl --disk-usage; ls -d /var/log/journal 2>/dev/null || echo "VOLATILE -- logs die on reboot"
```

If it reports volatile, `sudo mkdir -p /var/log/journal && sudo systemctl restart systemd-journald`
makes it persistent. Worth knowing before you need the history rather than after.

---

## 7c. Prove the contact notification actually sends

Added 2026-09-04. Everything about this feature is tested as *strings* — the HTML escaping, the
header sanitising, the truncation. **Nothing in the test suite has ever sent an email**, and a
mock cannot tell you whether Resend accepts the message or how a real mail client renders it. This
section is that one send.

Do it once, after 4.6's two variables are set and the service has restarted.

### Confirm both values are actually loaded

Without printing the key:

```bash
sudo grep -c '^RESEND_API_KEY=' /etc/mysite/env        # expect 1
sudo grep '^CONTACT_NOTIFICATION_EMAIL=' /etc/mysite/env
sudo systemctl show mysite -p ExecMainStartTimestamp   # confirm it restarted after you edited
```

`grep -c` on the key rather than printing it: it is the one credential here that works from
anywhere on the internet (§4.6), so it does not belong in your scrollback.

### Send one, from the deployed site

Use the real form rather than `curl`, because the point is the whole path:

1. Open `https://<your-site>.netlify.app/contact`
2. Fill it in with a name you will recognise and submit
3. Expect the form to be replaced by *"Thanks for reaching out — I'll get back to you soon."*

**That acknowledgement does not mean the email sent.** It means the message was saved. Notification
is deliberately best-effort and after-commit: if Resend is down the visitor still gets their `201`,
which is the whole design. So check the journal:

```bash
sudo journalctl -u mysite --since -5m | grep -i "contact notification"
```

| What you see | What it means |
|---|---|
| `Contact notification email sent for message <uuid>` | Resend accepted it. Now go look in your inbox. |
| `app.contact.notification-email not configured` | `CONTACT_NOTIFICATION_EMAIL` is unset — 4.6 |
| `RESEND_API_KEY not configured -- skipping contact notification email` | the key is unset — 4.6 |
| `Failed to send contact notification email for message <uuid>` | Resend rejected or timed out; the line carries the cause, and the message is still saved |
| nothing at all | the listener never ran — check the message reached the database at all via `/admin/messages` |

Note the UUID is all that identifies the message in the logs. **Nothing about the visitor is logged
at any level**, deliberately, so you cannot recover the name or address from the journal — read them
in the admin panel.

### What should arrive

- **Subject:** `New contact message from <name>`, with the name truncated to 100 characters
- **From:** `onboarding@resend.dev` unless you set `RESEND_FROM_ADDRESS`. Resend's shared sender —
  expect it to land in spam the first time, and mark it as not-spam so the next one does not
- **Body:** a short line, the sender's name and address, then their message in a `<blockquote>`

### Then send a second one, with a non-ASCII name

This is the half a test genuinely cannot cover. Use something like **`Łukasz 😀 Kowalski`**, or any
name with accents, non-Latin script or an emoji.

What you are checking is that the **subject line** survives. It is the only value that becomes a
MIME header, and headers are ASCII — a mail system is supposed to encode the rest (RFC 2047), but
whether Resend does it correctly is not something this repository can assert. If the subject arrives
as mojibake or with the name missing, that is a real defect and worth an issue; the body is UTF-8
and should be fine regardless.

### Clean up

Both test messages are real rows. Delete them from `/admin/messages` once you are satisfied.

One quirk worth knowing before you do: the contact form's rate limit counts rows in the database, so
deleting messages refunds the quota. Harmless here, and the reason you can send a second test
immediately after the first.

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
| 7c | #186 |
| Part 3 | #44, #89, #168 |
| Part 4 | #121 |
| Not covered | #38, #42, #45, #48 |
