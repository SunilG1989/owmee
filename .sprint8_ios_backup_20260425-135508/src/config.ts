/**
 * Owmee API config — environment-aware
 *
 * Priority order:
 * 1. OVERRIDE_URL (hardcoded below — for quick dev testing)
 * 2. Auto-detect based on platform
 *
 * For production builds: set OVERRIDE_URL to your production API URL
 * For Railway: set to https://your-app.up.railway.app
 * For local dev: set to http://<YOUR_MAC_IP>:8000
 *
 * To find your Mac's IP: ifconfig | grep "inet " | grep -v 127.0.0.1
 */
import { Platform } from 'react-native';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CHANGE THIS ONE LINE PER ENVIRONMENT
//  Local dev:  'http://192.168.x.x:8000'
//  Railway:    'https://owmee-api.up.railway.app'
//  Production: 'https://api.owmee.in'
//  Auto-detect: '' (empty string — uses platform defaults below)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const OVERRIDE_URL = 'http://10.0.2.2:8000';

function getBaseUrl(): string {
  if (OVERRIDE_URL) return OVERRIDE_URL;

  // Auto-detect for development
  if (__DEV__) {
    // Android emulator uses 10.0.2.2 to reach host machine
    if (Platform.OS === 'android') return 'http://10.0.2.2:8000';
    // iOS simulator uses localhost
    return 'http://10.0.2.2:8000';
  }

  // Production — must be set via OVERRIDE_URL above
  // This fallback should never be reached in a properly configured build
  console.warn('Owmee: No API URL configured. Set OVERRIDE_URL in config.ts');
  return 'https://api.owmee.in';
}

export const API_URL = getBaseUrl();
export const REQUEST_TIMEOUT = 15000;  // bumped from 10s — Indian networks can be slow
export const UPLOAD_TIMEOUT = 60000;   // bumped from 30s — large photos on 3G
