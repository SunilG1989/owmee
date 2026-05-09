/**
 * Ambient declarations for runtime globals that exist in React Native
 * but aren't surfaced by the parent typescript-config's `lib` set.
 *
 * Don't add things here that have proper @types packages — install
 * those instead.
 */

// React Native's runtime setTimeout returns a number (it's backed by
// JavaScriptCore's host timers, not Node's Timer object). The dom lib
// types `setTimeout` as `(...) => number` and `clearTimeout` as
// `(handle?: number) => void`. Existing components store handles in
// refs typed `NodeJS.Timeout | null`, so we alias the namespace to
// `number` to keep call sites typecheck-clean without rewriting every
// ref signature.
declare namespace NodeJS {
  type Timeout = number;
  type Timer = number;
}
