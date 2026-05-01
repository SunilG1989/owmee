/**
 * Owmee ErrorState — v6 "Petrol"
 *
 * Use whenever a screen failed to load or an action failed and the
 * user needs to retry. NOT for empty states — use EmptyState for those.
 *
 * Voice rules:
 *   - Don't say "Oops" or "Something went wrong" — too generic
 *   - Name the failure as plainly as you can: "Couldn't load offers"
 *     "Pickup couldn't be scheduled" "We lost the connection"
 *   - One sentence of what to do next
 *   - "Try again" is the standard CTA label
 *
 * Severity drives the visual: `connection` is neutral (you'll be back),
 * `failure` is warning (something didn't work), `critical` is red
 * (a real problem the user should escalate).
 *
 * Examples:
 *   <ErrorState
 *     severity="connection"
 *     title="No internet"
 *     body="Check your connection and try again."
 *     onRetry={refetch}
 *   />
 *
 *   <ErrorState
 *     severity="critical"
 *     title="Offer couldn't be sent"
 *     body="Your card was declined. Update payment in Settings."
 *     onRetry={retry}
 *     onSecondary={() => nav.navigate('PaymentSettings')}
 *     secondaryLabel="Update payment"
 *   />
 */
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { C, FONTS, R, S, T } from '../../utils/tokens';
import Button from './Button';

export type ErrorSeverity = 'connection' | 'failure' | 'critical';

interface Props {
  severity?: ErrorSeverity;
  title: string;
  body?: string;
  /** Optional error code shown in mono — e.g. "ERR_NETWORK" or "402". */
  code?: string;
  onRetry?: () => void;
  retryLabel?: string;
  onSecondary?: () => void;
  secondaryLabel?: string;
  /** Compact inline variant. */
  compact?: boolean;
  style?: ViewStyle;
}

export default function ErrorState({
  severity = 'failure',
  title,
  body,
  code,
  onRetry,
  retryLabel = 'Try again',
  onSecondary,
  secondaryLabel,
  compact = false,
  style,
}: Props) {
  const s = severityStyle[severity];
  return (
    <View style={[styles.wrap, compact && styles.wrapCompact, style]}>
      <View style={[styles.glyphChip, { backgroundColor: s.bg, borderColor: s.border }]}>
        <Text style={[styles.glyph, { color: s.fg }]}>{s.glyph}</Text>
      </View>

      <Text style={styles.title}>{title}</Text>

      {body && <Text style={styles.body}>{body}</Text>}

      {code && (
        <View style={styles.codePill}>
          <Text style={styles.codeText}>{code}</Text>
        </View>
      )}

      {(onRetry || onSecondary) && (
        <View style={styles.actions}>
          {onRetry && (
            <Button
              label={retryLabel}
              onPress={onRetry}
              variant="primary"
              size={compact ? 'sm' : 'md'}
            />
          )}
          {onSecondary && secondaryLabel && (
            <Button
              label={secondaryLabel}
              onPress={onSecondary}
              variant="ghost"
              size={compact ? 'sm' : 'md'}
            />
          )}
        </View>
      )}
    </View>
  );
}

const severityStyle: Record<ErrorSeverity, { glyph: string; bg: string; fg: string; border: string }> = {
  connection: { glyph: '⚡', bg: C.bone2,       fg: C.text2,     border: C.border },
  failure:    { glyph: '!',  bg: C.yellowLight, fg: C.yellow,    border: C.yellow },
  critical:   { glyph: '×',  bg: C.redLight,    fg: C.red,       border: C.red },
};

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.xxl,
    paddingVertical: S.xxxl,
  },
  wrapCompact: { flex: 0, paddingVertical: S.xl },
  glyphChip: {
    width: 56,
    height: 56,
    borderRadius: R.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: S.lg,
  },
  glyph: {
    fontFamily: FONTS.displayMedium,
    fontSize: T.size.xxl,
    fontWeight: T.weight.bold,
    lineHeight: T.size.xxl * 1.05,
  },
  title: {
    fontFamily: FONTS.displayMedium,
    fontSize: T.size.xl,
    fontWeight: T.weight.medium,
    color: C.text,
    textAlign: 'center',
    marginBottom: S.sm,
  },
  body: {
    fontFamily: FONTS.sans,
    fontSize: T.size.md,
    color: C.text2,
    textAlign: 'center',
    lineHeight: T.size.md * 1.5,
    maxWidth: 320,
    marginBottom: S.lg,
  },
  codePill: {
    paddingHorizontal: S.md,
    paddingVertical: S.xs,
    borderRadius: R.xs,
    backgroundColor: C.bone2,
    marginBottom: S.lg,
  },
  codeText: {
    fontFamily: FONTS.mono,
    fontSize: T.size.xs,
    color: C.text3,
    letterSpacing: 0.5,
  },
  actions: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: S.sm,
  },
});
