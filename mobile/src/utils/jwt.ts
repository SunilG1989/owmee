const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/g, '');
  let buffer = 0;
  let bits = 0;
  let out = '';

  for (const ch of normalized) {
    const value = BASE64_ALPHABET.indexOf(ch);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }

  return out;
}

export function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const raw = token.split('.')[1];
    if (!raw) return null;
    return JSON.parse(decodeBase64Url(raw));
  } catch {
    return null;
  }
}

export function decodeJwtSub(token: string): string {
  const payload = decodeJwtPayload(token);
  return typeof payload?.sub === 'string' ? payload.sub : '';
}
