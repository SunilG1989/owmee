export type AddressGateDecision = 'needs_address' | 'has_address';

type AddressListResponse = {
  data: unknown;
};

type ResolveAddressGateArgs = {
  listAddresses: () => Promise<AddressListResponse>;
  clearAddressCache?: () => void;
};

export const ADDRESS_GATE_RETRY_DELAYS_MS = [500, 1200] as const;

/**
 * Signup address gate must be a fresh backend read. If this check consumes a
 * stale empty/non-empty cache entry, new users can skip the address flow or
 * returning users can be pushed into it incorrectly.
 */
export async function resolveAddressGate({
  listAddresses,
  clearAddressCache,
}: ResolveAddressGateArgs): Promise<AddressGateDecision> {
  clearAddressCache?.();
  const res = await listAddresses();

  if (!Array.isArray(res.data)) {
    throw new Error('ADDRESS_GATE_BAD_RESPONSE');
  }

  return res.data.length === 0 ? 'needs_address' : 'has_address';
}
