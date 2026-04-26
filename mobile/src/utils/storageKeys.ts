/**
 * AsyncStorage key constants. Kept here so multiple modules cannot drift
 * apart on naming (a real bug previously: useLocation used '@ow_loc'
 * while LocationPickerScreen + RootNavigator used '@ow_location', so
 * picked locations never persisted into the home screen's hook).
 */
export const LOCATION_KEY = '@ow_location';
export const ONBOARDING_SEEN_KEY = '@ow_onboarding_seen';
