/**
 * Local config — edit this file to point at your backend.
 *
 * Emulator:       http://10.0.2.2:8000   (default, works out of the box)
 * Physical device: http://YOUR_MAC_IP:8000
 *   Find your Mac IP: System Settings → Wi-Fi → Details → IP Address
 *   e.g. http://192.168.1.42:8000
 *
 * Production: https://api.owmee.in
 */

const LOCAL_IP = '10.0.2.2'; // ← change to your Mac IP for physical device

export const API_BASE_URL = __DEV__
  ? `http://${LOCAL_IP}:8000`
  : 'https://api.owmee.in';
