export function parseApiError(e: any, fallback = 'Something went wrong'): string {
  if (!e) return fallback;
  const d = e.response?.data?.detail;
  if (typeof d === 'string') return d;
  // Prefer human-readable message over error code
  if (d?.message) return d.message;
  if (d?.error) return d.error;
  if (Array.isArray(d)) return d.map((x: any) => `${x.loc?.slice(-1)?.[0] || 'field'}: ${x.msg}`).join('. ');
  if (e.message === 'Network Error') return 'No internet connection';
  if (e.code === 'ECONNABORTED') return 'Request timed out';
  return e.message || fallback;
}
