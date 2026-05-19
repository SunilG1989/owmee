# Android Release Builds

Owmee Android releases must be built with Google Maps enabled. The production
pattern is the same one used by mature mobile teams:

1. One restricted Google Maps Android API key per environment.
2. One release/upload signing key.
3. A centralized CI or release machine injects both as secrets.
4. Developers and testers install the produced APK/AAB artifact.

Do not ask every developer, tester, or friend to create
`mobile/android/local.properties`. That file is only a local escape hatch.

## Required Secrets

Release builds need:

```text
GOOGLE_MAPS_API_KEY
OWMEE_RELEASE_STORE_FILE
OWMEE_RELEASE_STORE_PASSWORD
OWMEE_RELEASE_KEY_ALIAS
OWMEE_RELEASE_KEY_PASSWORD
```

For a production-gated build, also set:

```text
REQUIRE_RELEASE_SIGNING=true
```

## Google Maps Key Restriction

In Google Cloud, enable `Maps SDK for Android` and restrict the Android key to:

```text
Package name: com.owmee
SHA-1: release/upload signing certificate fingerprint
```

Use the same certificate fingerprint that signs the APK/AAB sent to users.
For local inspection:

```bash
cd mobile/android
./gradlew signingReport
```

## Local Builds

Local release builds can read `GOOGLE_MAPS_API_KEY` from:

1. Gradle property: `-PGOOGLE_MAPS_API_KEY=...`
2. `mobile/android/local.properties`
3. Environment variable: `GOOGLE_MAPS_API_KEY`

Example:

```bash
cd mobile/android
GOOGLE_MAPS_API_KEY=... ./gradlew assembleRelease
```

Only use this non-production escape hatch for smoke builds that are never sent
to users:

```bash
ALLOW_MISSING_GOOGLE_MAPS_API_KEY=true ./gradlew assembleRelease
```
