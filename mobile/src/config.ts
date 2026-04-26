/**
 * Owmee API config — platform & environment aware
 *
 * Priority order:
 *   1. OVERRIDE_URL (if set, wins)
 *   2. Auto-detect based on platform when in __DEV__
 *   3. Production URL fallback
 *
 * Android emulator -> http://10.0.2.2:8000 (special host loopback)
 * iOS simulator    -> http://localhost:8000 (shares host network)
 * Real device      -> set OVERRIDE_URL to http://<MAC_LAN_IP>:8000
 *
 * Find your Mac's IP: ifconfig | grep "inet " | grep -v 127.0.0.1
 */
import { Platform } from 'react-native';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CHANGE THIS LINE PER ENVIRONMENT
//  Empty string '' = use platform auto-detect (recommended for dev)
//  Real device:   'http://192.168.x.x:8000'
//  Railway:       'https://owmee-api.up.railway.app'
//  Production:    'https://api.owmee.in'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const OVERRIDE_URL = 'http://192.168.0.4:8000';

function getBaseUrl(): string {
  if (OVERRIDE_URL) return OVERRIDE_URL;

  if (__DEV__) {
    // Android emulator must use 10.0.2.2 to reach the Mac host
    if (Platform.OS === 'android') return 'http://10.0.2.2:8000';
    // iOS simulator shares the Mac's network stack — localhost works
    return 'http://localhost:8000';
  }

  // Production fallback — should never reach this in a properly built app
  console.warn('Owmee: No API URL configured. Set OVERRIDE_URL in config.ts');
  return 'https://api.owmee.in';
}

export const API_URL = getBaseUrl();
export const REQUEST_TIMEOUT = 15000;
export const UPLOAD_TIMEOUT = 60000;
