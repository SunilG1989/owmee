/**
 * AsyncStorage key constants. LOCATION_KEY is a cold-start cache of the
 * backend default user_addresses row. The saved-address API remains the
 * source of truth for home, checkout, and concierge bookings.
 */
export const LOCATION_KEY = '@ow_location';
export const ONBOARDING_SEEN_KEY = '@ow_onboarding_seen';
