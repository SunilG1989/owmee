/**
 * Owmee API config — platform & environment aware
 *
 * Priority order:
 *   1. OVERRIDE_URL (if set, wins)
 *   2. Auto-detect based on platform when in __DEV__
 *   3. Production URL fallback (Render while we are in private staging)
 *
 * Android emulator -> http://10.0.2.2:8000 (special host loopback)
 * iOS simulator    -> http://localhost:8000 (shares host network)
 * Real device debug -> set OVERRIDE_URL to http://<MAC_LAN_IP>:8000
 * Real device release -> https://owmee-api.onrender.com
 *
 * Find your Mac's IP: ifconfig | grep "inet " | grep -v 127.0.0.1
 */
import { Platform } from 'react-native';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  KEEP THIS AS '' IN GIT.
//  Empty string '' = use platform auto-detect (correct for prod + dev).
//  For local-only override, change in your working tree and run:
//    git update-index --skip-worktree mobile/src/config.ts
//  Real device debug: 'http://192.168.x.x:8000'
//  Staging/Render:    'https://owmee-api.onrender.com'
//  Future public:     'https://api.owmee.in'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const OVERRIDE_URL = '';

function getBaseUrl(): string {
  if (OVERRIDE_URL) return OVERRIDE_URL;

  if (__DEV__) {
    // Android emulator must use 10.0.2.2 to reach the Mac host
    if (Platform.OS === 'android') return 'http://10.0.2.2:8000';
    // iOS simulator shares the Mac's network stack — localhost works
    return 'http://localhost:8000';
  }

  return 'https://owmee-api.onrender.com';
}

export const API_URL = getBaseUrl();
export const REQUEST_TIMEOUT = 15000;
export const UPLOAD_TIMEOUT = 60000;
