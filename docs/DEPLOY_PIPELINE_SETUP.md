# Turning the deploy pipelines on

The workflows in `.github/workflows/deploy-backend.yml` and `deploy-frontend.yml` are written and
committed. They do nothing until the steps below are done, because every one of them involves a
credential or a host change that has to be made by the owner rather than by an assistant.

Issues #45, #38 and #46. Decisions in `docs/DECISIONS.md`, 2026-09-04; sequence in
`docs/CI_PLAN.md`.

**Nothing here is reversible by rerunning a workflow.** Do it in order, and keep an SSH session
open while changing anything about SSH.

---

## 1. Generate a key that exists only for GitHub

On your own machine, not the server. **This is a third key** — not the one you log in with, and not
the one the assistant uses. It ends up able to run one script and nothing else, which is only true
if it is not also a general-access key.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/mysite_github_deploy -C "github-actions" -N ""
```

No passphrase, because a workflow cannot type one. That is the trade: the key is unencrypted at
rest in GitHub's secret store, and its power is bounded by step 2 instead.

## 2. Install the public half, restricted

On the VPS, as `deploy`. The `command=` prefix is the whole point — it forces `deploy.sh` for every
use of this key, whatever the client asks for, so possession becomes *"can trigger a deploy"* rather
than *"owns the host"*.

```bash
# paste the contents of ~/.ssh/mysite_github_deploy.pub where indicated
printf 'command="/home/deploy/deploy.sh",restrict %s\n' '<paste the .pub line here>' \
  >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

`restrict` disables port forwarding, agent forwarding, X11 and PTY allocation. Both parts matter:
without `command=` the key is a shell; without `restrict` it can forward ports out of your network.

## 3. Install the deploy script

From the repository, still on the VPS as `deploy`:

```bash
curl -fsSL https://raw.githubusercontent.com/tarka1939/My_Site/main/deploy/deploy.sh \
  -o /home/deploy/deploy.sh
chmod 700 /home/deploy/deploy.sh
```

Read it before you chmod it. It is what the key can run, so it is part of the security boundary and
deserves the same look you would give the workflow calling it.

## 4. Allow exactly one sudo command, without a password

A workflow cannot type your sudo password. Rather than giving `deploy` blanket `NOPASSWD`, permit
the single command the script needs:

```bash
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart mysite' \
  | sudo tee /etc/sudoers.d/mysite-deploy
sudo chmod 440 /etc/sudoers.d/mysite-deploy
sudo visudo -c        # syntax check -- a broken sudoers file locks out sudo entirely
```

`visudo -c` is not optional. A malformed file in `/etc/sudoers.d/` breaks `sudo` for everyone, and
the way back is the provider's console.

Verify it is scoped rather than blanket:

```bash
sudo -n /usr/bin/systemctl restart mysite   # should work, no password
sudo -n /usr/bin/systemctl restart ssh      # should be REFUSED
```

If the second one succeeds, the entry is too broad — fix it before continuing.

## 5. Add the secrets

**Settings → Secrets and variables → Actions → New repository secret.** Six of them:

| Name | Value |
|---|---|
| `DEPLOY_SSH_KEY` | the entire contents of `~/.ssh/mysite_github_deploy` — the **private** half, including the BEGIN/END lines |
| `DEPLOY_KNOWN_HOSTS` | the host key line, below |
| `DEPLOY_HOST` | `lee159.mikrus.xyz` |
| `DEPLOY_PORT` | `10159` |
| `NETLIFY_AUTH_TOKEN` | Netlify → User settings → Applications → Personal access tokens |
| `NETLIFY_SITE_ID` | Netlify → Site configuration → General → Site ID |

For `DEPLOY_KNOWN_HOSTS`, run this **on your own machine** and paste the output — pinning the key
rather than accepting it on first use, because trust-on-first-use on a deploy path means the very
first run trusts whatever answers:

```bash
ssh-keyscan -t ed25519 -p 10159 lee159.mikrus.xyz
```

Confirm the fingerprint matches what your own client already trusts before pasting it:

```bash
ssh-keygen -lF "[lee159.mikrus.xyz]:10159"
# expect: ED25519 SHA256:3HRskh5i34GHxItl6pywncEhY2ki2EzAG4qbo5rcPSw
```

**The rule from the 2026-09-03 security ADR now applies to workflow YAML.** GitHub masks known
secret values in logs, but only exact matches — a secret that is base64-decoded, split, or
interpolated into a larger string is no longer masked, and this repository's logs are public.

## 6. Switch Netlify's own build off

**Before** the frontend workflow first runs, or you get two builds racing for one site, potentially
from different commits.

Netlify → **Site configuration → Build & deploy → Continuous deployment → Build settings → Stop
builds**.

This is what makes #38 a move rather than a duplication. It also ends per-PR deploy previews, which
is a real capability being traded for a single visible pipeline — the backend deliberately does not
allowlist their origins anyway.

## 7. First run, by hand

Both workflows have `workflow_dispatch`, deliberately: the first run of a deploy pipeline should be
one you chose to start.

**Actions → Deploy backend → Run workflow.** Watch it, then check the site.

Then the same for **Deploy frontend**.

## 8. Prove the rollback works

This is the half nobody tests, and the half that matters at 2am.

Break the build deliberately — a syntax error in a controller is enough — push it to a branch, and
run **Deploy backend** against that branch by hand. Expect:

- `deploy.sh` reports the health check never passed
- it moves the failed jar to `/home/deploy/mysite-bad.jar` and restores the previous one
- the site stays up
- the workflow goes red

Then delete the branch. If any of those four is untrue, the pipeline is not finished, whatever the
green runs say.

---

## What each piece can do if it leaks

Recorded because it is the argument for the shape above, not decoration.

- **`DEPLOY_SSH_KEY`** — can run `deploy.sh` on the host and nothing else. It cannot open a shell,
  forward a port, or read a file. It *can* deploy an arbitrary jar, so it is not harmless: an
  attacker with it can replace the application. That is bounded by GitHub's control of the secret
  and by the workflow being the only caller.
- **`NETLIFY_AUTH_TOKEN`** — Netlify account-wide, not site-scoped. Rotate it in Netlify's UI if it
  is ever exposed.
- **`DEPLOY_HOST` / `DEPLOY_PORT` / `DEPLOY_KNOWN_HOSTS`** — not secrets in any real sense; they are
  secrets here only to keep the host out of a public workflow file and its logs.
