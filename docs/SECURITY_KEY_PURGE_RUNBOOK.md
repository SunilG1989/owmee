# Runbook: purge the committed JWT key from git history

**Severity:** the RSA JWT signing key was committed in the initial commit
(`e0146e2`, `keys/private.pem` + `keys/public.pem`) and only untracked later
(`bb410f3`). It remains retrievable from history by anyone with repo access.

## Current state (as of the 2026-06-11 hardening pass)

- `keys/` and `*.pem` are gitignored; **no key files are tracked** today.
- The **local dev keypair was rotated** — the on-disk key no longer matches the
  historical one, so no local environment trusts the leaked key.
- **Production signs with the `JWT_PRIVATE_KEY` env var** (`render.yaml`,
  `sync: false`), which is separate from the committed file. Confirm this is
  true for *every* deployed environment (staging included) before relying on it.

So the leaked key is a **dev** key. The residual risk is only real if that key
was ever used to sign tokens in a reachable environment that loaded the file
instead of the env var. Verify that first (step 1).

## Step 1 — confirm no environment trusts the leaked key

For each environment (prod, staging, any preview):
- Confirm `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` env vars are set (not the file).
- If any env loaded `keys/*.pem` from the image, **rotate that env's keypair now**
  (generate a fresh pair, set the env vars) and redeploy. All existing tokens
  become invalid → users re-login; that's expected.

Generate a fresh keypair:
```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private.pem
openssl rsa -in private.pem -pubout -out public.pem
# set JWT_PRIVATE_KEY / JWT_PUBLIC_KEY from these, then delete the files
```

## Step 2 — rewrite history (coordinated; irreversible)

This rewrites every commit hash. **Every collaborator must re-clone afterward.**
Do it when the team is online and no long-lived branches/PRs are mid-review.

```bash
# 1. Fresh mirror clone
git clone --mirror git@github.com:<org>/owmee.git owmee-purge.git
cd owmee-purge.git

# 2. Purge the key files from ALL history (git-filter-repo, not filter-branch)
#    brew install git-filter-repo   (or pipx install git-filter-repo)
git filter-repo --force \
  --path keys/private.pem --path keys/public.pem --invert-paths

# 3. Force-push the rewritten history
git push --force --mirror

# 4. Everyone else:
#    rm -rf their clone && git clone fresh   (rebasing onto rewritten history
#    is error-prone; re-clone is the supported path)
```

## Step 3 — after the rewrite

- Treat the old key as permanently compromised regardless of the purge (it may
  be cached in forks, CI logs, backups). The rotation in Step 1 is what actually
  protects you; the purge just stops casual extraction.
- Add a pre-commit hook / secret scanner (e.g. `gitleaks`) so a key can't be
  committed again. The repo already gitignores `keys/` and `*.pem`.

## Why this wasn't auto-executed

History rewriting + force-push is irreversible and breaks every existing clone.
It's a coordinated team action, not a CI/agent action — hence this runbook
instead of an automatic rewrite.
