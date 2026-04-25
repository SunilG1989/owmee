# Setup Guide

Detailed setup instructions. Most of this is automated by `./scripts/setup.sh`.

## Prerequisites

### macOS

```bash
# Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Core tools
brew install --cask docker
brew install node
brew install --cask zulu@17       # Java JDK 17 (RN 0.73 needs this exact version)
brew install --cask android-studio

# Add to ~/.zshrc
echo 'export JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-17.jdk/Contents/Home' >> ~/.zshrc
echo 'export PATH=$JAVA_HOME/bin:$PATH' >> ~/.zshrc
echo 'export ANDROID_HOME=$HOME/Library/Android/sdk' >> ~/.zshrc
echo 'export PATH=$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH' >> ~/.zshrc
source ~/.zshrc

# Verify
java -version    # must say "openjdk version 17.x"
node -v          # v18+
docker --version
```

After installing Android Studio, open it once and let it install the SDK.

### Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin openjdk-17-jdk
sudo usermod -aG docker $USER
newgrp docker

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

echo 'export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64' >> ~/.bashrc
source ~/.bashrc

# Android Studio: download from https://developer.android.com/studio
# After install: export ANDROID_HOME=$HOME/Android/Sdk
```

## Step 1 — Clone

```bash
git clone https://github.com/<your-username>/owmee.git
cd owmee
```

## Step 2 — Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

- `GEMINI_API_KEY` — get one at https://aistudio.google.com/apikey
- `JWT_SECRET` — `openssl rand -hex 32`
- `R2_PUBLIC_ENDPOINT` — `http://YOUR_LAN_IP:9000`

Find your LAN IP:

```bash
# macOS
ifconfig | grep "inet " | grep -v 127.0.0.1

# Linux
hostname -I | awk '{print $1}'
```

You want something like `192.168.1.x`. NOT `localhost` or `127.0.0.1` — your phone needs to reach this.

**Why R2_PUBLIC_ENDPOINT needs your LAN IP:** when the mobile app uploads photos, presigned URLs from the server must contain a hostname your phone can reach. The Docker internal hostname `minio:9000` doesn't resolve from the phone.

## Step 3 — Start backend

```bash
docker compose up -d
```

Wait 30 seconds. Check status:

```bash
docker compose ps
```

You should see `postgres`, `redis`, `minio`, `temporal`, `api` all up.

## Step 4 — Migrations

```bash
docker compose exec api alembic upgrade head
```

## Step 5 — Seed data

```bash
docker compose exec api python -m app.modules.admin.seed
```

This creates the 5 MVP categories and demo data.

## Step 6 — Verify backend

```bash
curl http://localhost:8000/openapi.json | head -c 200
```

Should print JSON. If not, check `docker compose logs api`.

API docs in browser: http://localhost:8000/docs

## Step 7 — Mobile dependencies

```bash
cd mobile
npm install
```

Takes 2-5 minutes.

Edit `mobile/src/config.ts` — set `OVERRIDE_URL` to your LAN IP (the same one you put in `.env`):

```typescript
export const OVERRIDE_URL = 'http://192.168.1.x:8000';
```

## Step 8 — Run on Android

### Physical device

1. Settings → About phone → tap "Build number" 7 times to enable Developer Options
2. Settings → System → Developer options → enable USB Debugging
3. Connect via USB
4. `adb devices` — should list your device. Accept any prompt.
5. Phone must be on the SAME Wi-Fi as your dev machine.
6. Build:

```bash
cd mobile
npx react-native run-android
```

First build is 10-15 minutes.

### Emulator

1. Android Studio → Tools → Device Manager → create a Pixel 7 with Android 13+
2. Start the emulator
3. `npx react-native run-android` from `mobile/`

For emulator, you can use `OVERRIDE_URL = 'http://10.0.2.2:8000'` (special hostname Android emulator uses for the host machine).

## Step 9 — First login

OTPs are logged to backend console in dev mode (not SMSed):

1. Open the app
2. Enter any Indian phone, e.g. `+919876543210`
3. Tap "Send OTP"
4. In another terminal:

```bash
docker compose logs api --tail 20 | grep -i otp
```

5. Enter the OTP.

To skip the full KYC dance during dev:

```bash
curl -X POST http://localhost:8000/v1/dev/kyc-approve/+919876543210
```

This marks the user as fully KYC verified.

## Step 10 — Try the AI listing flow

1. Sign in
2. Run KYC bypass
3. Tap Sell tab → "Take photos →"
4. Take 4-6 photos of any item
5. Tap "Done — analyse →"
6. AI fills in brand, model, price

If the screen is blank, check Gemini quota:

```bash
docker compose logs api --tail 30 | grep -E "gemini|429|RESOURCE_EXHAUSTED"
```

Free Gemini tier is 20 vision calls per day. See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for fixes.

## You're done

For daily workflow: `./scripts/dev.sh`.
