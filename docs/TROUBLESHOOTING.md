# Troubleshooting

Issues we've actually hit, with the actual fix.

## Backend won't start

### Port conflicts

Owmee binds 5432, 6379, 9000, 9001, 7233, 8088, 8000. Check:

```bash
lsof -i :5432
lsof -i :8000
```

Kill conflicting processes or edit `docker-compose.yml` to remap.

### `api` container keeps restarting

```bash
docker compose logs api --tail 50
```

Common causes:
- Database not ready yet — wait 30s and `docker compose restart api`
- Missing GEMINI_API_KEY — set it in `.env` and `docker compose up -d --force-recreate api`
- Migration mismatch — see "Migration state" below

### Postgres can't create extensions

```bash
docker compose exec postgres psql -U owmee -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; CREATE EXTENSION IF NOT EXISTS postgis;'
```

Then re-run migrations.

### Migration state out of sync

```bash
docker compose exec api alembic current
docker compose exec api alembic heads
```

If they differ:

```bash
# If schema is fine, just realign:
docker compose exec api alembic stamp head

# If schema is corrupt, nuke and rebuild (DEV ONLY):
docker compose down -v   # destroys data
docker compose up -d
sleep 10
docker compose exec api alembic upgrade head
docker compose exec api python -m app.modules.admin.seed
```

## Mobile issues

### Metro bundler won't start

```bash
lsof -ti:8081 | xargs kill -9
cd mobile && npx react-native start --reset-cache
```

### Java version error

RN 0.73 needs JDK 17 specifically. Verify:

```bash
java -version
```

Must say `17.x`. Set in shell rc:

```bash
# macOS
export JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home

# Linux
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
```

### "SDK location not found"

```bash
echo "sdk.dir=$ANDROID_HOME" > mobile/android/local.properties
```

If `$ANDROID_HOME` is empty, install Android Studio.

### `adb devices` shows "unauthorized"

Tap "Allow" on the dialog on the phone. If no dialog:

```bash
adb kill-server && adb start-server && adb devices
```

### App opens, blank white screen

Metro bundler not reachable. Try:

```bash
adb reverse tcp:8081 tcp:8081
```

Then shake phone → Reload.

### App opens, API requests fail

99% it's a wrong IP in `mobile/src/config.ts`. Your LAN IP changed when you reconnected to Wi-Fi. Re-detect:

```bash
ifconfig | grep "inet " | grep -v 127.0.0.1   # macOS
hostname -I | awk '{print $1}'                # Linux
```

Update `OVERRIDE_URL` in `mobile/src/config.ts` AND `R2_PUBLIC_ENDPOINT` in `.env`. Both must be the SAME LAN IP. Then rebuild.

### Image upload fails / images don't load on phone

This is the MinIO presigned URL hostname problem. Both `mobile/src/config.ts` `OVERRIDE_URL` and `.env` `R2_PUBLIC_ENDPOINT` must use your LAN IP, not `localhost`.

```bash
grep R2_PUBLIC_ENDPOINT .env
grep OVERRIDE_URL mobile/src/config.ts
```

After fixing:

```bash
docker compose up -d --force-recreate api
```

### MIUI (Xiaomi/Redmi) blocks `adb shell pm clear`

Use uninstall instead:

```bash
adb uninstall com.owmee
cd mobile && npx react-native run-android
```

## AI listing issues

### "No data fetched" — Everything Screen blank

Check for the actual error:

```bash
docker compose logs --tail=200 api 2>&1 | grep -E "from-images|gemini|ai_failed|429"
```

#### `429 RESOURCE_EXHAUSTED`

Free Gemini tier is **20 vision calls/day**. Three options:

**A — Enable billing** (~$1/mo at dev rates): https://aistudio.google.com/apikey → enable Pay-as-you-go.

**B — Wait** until midnight Pacific (~12:30 PM IST) for reset.

**C — Switch model:**

```bash
sed -i.bak 's|GEMINI_VISION_MODEL=.*|GEMINI_VISION_MODEL=gemini-1.5-flash|' .env
docker compose up -d --force-recreate api
```

#### `403 PERMISSION_DENIED`

API key invalid. Generate new one at https://aistudio.google.com/apikey.

### IMEI Luhn check fails on a real iPhone IMEI

Get the IMEI: Settings → General → About → IMEI, or dial `*#06#`. **15 digits, no typos.**

Test the validator:

```bash
docker compose exec -T api python3 -c "
from app.modules.ai_assistant.ceir_client import luhn_valid
print(luhn_valid('490154203237518'))   # True
print(luhn_valid('123456789012345'))   # False
"
```

If True/False prints right, your typed IMEI just had a typo.

### Camera back button does weird things

Sell tab shows a landing screen with a "Take photos →" button. Tap button → camera. Tap ✕ → back to landing. Tap button again → camera. **Always works.** If you see a loop or stuck state, you're on old code — pull main.

## Database

### Wipe and rebuild (DEV ONLY)

```bash
docker compose down -v   # destroys ALL data
docker compose up -d
sleep 10
docker compose exec api alembic upgrade head
docker compose exec api python -m app.modules.admin.seed
```

## Git

### `.env` accidentally committed

1. **Rotate ALL secrets in it immediately**
2. `git rm --cached .env && git commit -m "Remove .env"`
3. For full history scrub: BFG Repo-Cleaner
