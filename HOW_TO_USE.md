# How to use this bundle

This bundle contains README + docs + scripts + .gitignore + .env.example. All as files. Just drop them in.

## Step 1 — Extract and copy

```bash
# Wherever you put the tarball
tar -xzf owmee_repo_files.tar.gz

# Copy into your owmee project
cp -r owmee_repo_files/* ~/owmee/
cp owmee_repo_files/.gitignore ~/owmee/
cp owmee_repo_files/.env.example ~/owmee/

# Make scripts executable
chmod +x ~/owmee/scripts/setup.sh
chmod +x ~/owmee/scripts/dev.sh
```

## Step 2 — Verify the files are in place

```bash
cd ~/owmee
ls -la README.md .gitignore .env.example
ls docs/
ls scripts/
```

You should see:

- `README.md`
- `.gitignore`
- `.env.example`
- `docs/SETUP.md`
- `docs/TROUBLESHOOTING.md`
- `docs/DEV_NOTES.md`
- `scripts/setup.sh`
- `scripts/dev.sh`

## Step 3 — Clean up before committing

```bash
cd ~/owmee

# Delete patcher backup files
find . -name "*.bak.*" -type f -delete
find . -name "*.bak" -type f -delete

# Delete the typo file
rm -f =0.39.0

# Dissolve mobile's nested git (so parent repo can include mobile files)
rm -rf mobile/.git
```

## Step 4 — Commit and push

```bash
cd ~/owmee

git add .
git status     # eyeball the list — shouldn't see .env or any AIzaSy keys

git commit -m "Sprint 8 Phase 2 + setup docs and scripts"
git push origin main
```

## Step 5 — Send your friend the URL

```
https://github.com/<your-username>/owmee

To set up:
  git clone https://github.com/<your-username>/owmee.git
  cd owmee
  ./scripts/setup.sh
```

If repo is private, add him as collaborator: GitHub → Settings → Collaborators.

## What the friend sees

When he runs `./scripts/setup.sh`, it:

1. Checks Docker, Node, npm, Java 17 are installed
2. Detects his LAN IP automatically
3. Creates `.env` from `.env.example` with his LAN IP filled in
4. Asks for his Gemini API key
5. Starts Docker stack (postgres, redis, minio, temporal, api)
6. Runs migrations
7. Seeds initial data
8. Installs mobile dependencies
9. Updates `mobile/src/config.ts` with his LAN IP

He just needs to:
- Have Docker Desktop, Node 18+, JDK 17, Android Studio installed
- Have a Gemini API key
- Run `./scripts/setup.sh`

After that, `cd mobile && npx react-native run-android` to build the app.

The `docs/SETUP.md`, `docs/TROUBLESHOOTING.md`, and `docs/DEV_NOTES.md` cover everything else.
