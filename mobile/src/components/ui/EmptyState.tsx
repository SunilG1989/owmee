/**
 * Owmee EmptyState — v6 "Petrol"
 *
 * Use whenever a screen has nothing to show — no listings, no offers,
 * no orders, empty search, no notifications, etc. NOT for errors —
 * use ErrorState for those.
 *
 * The voice is conversational and a little dry, matching the
 * marketing voice ("you bought a Pixel 7. now we go get it.").
 * Don't apologize. Don't say "Oops". State the situation, give
 * the user one obvious next step.
 *
 * Layout: centered glyph + Fraunces headline + Inter supporting
 * line + optional CTA button. Generous vertical padding so it
 * never feels cramped on a tall screen.
 *
 * Examples:
 *   <EmptyState
 *     glyph="📦"
 *     title="Nothing here yet"
 *     body="When you list a phone, it'll show up here."
 *     ctaLabel="List a phone"
 *     onCtaPress={() => nav.navigate('Sell')}
 *   />
 *
 *   <EmptyState
 *     glyph="🔍"
 *     title="No matches"
 *     body="Try widening the radius or removing a filter."
 *   />
 */
import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { C, FONTS, S, T } from '../../utils/tokens';
import Button from './Button';

interface Props {
  /** Single emoji or short glyph. Replace with an SVG icon when you ship them. */
  glyph?: string;
  title: string;
  body?: string;
  /** Optional primary CTA. */
  ctaLabel?: string;
  onCtaPress?: () => void;
  /** Optional secondary action (ghost). */
  secondaryLabel?: string;
  onSecondaryPress?: () => void;
  /** Compact variant — for inline empty states inside cards. */
  compact?: boolean;
  style?: ViewStyle;
}

export default function EmptyState({
  glyph,
  title,
  body,
  ctaLabel,
  onCtaPress,
  secondaryLabel,
  onSecondaryPress,
  compact = false,
  style,
}: Props) {
  return (
    <View style={[styles.wrap, compact && styles.wrapCompact, style]}>
      {glyph && (
        <Text style={[styles.glyph, compact && styles.glyphCompact]}>{glyph}</Text>
      )}
      <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
      {body && (
        <Text style={[styles.body, compact && styles.bodyCompact]}>{body}</Text>
      )}
      {(ctaLabel || secondaryLabel) && (
        <View style={styles.actions}>
          {ctaLabel && onCtaPress && (
            <Button
              label={ctaLabel}
              onPress={onCtaPress}
              variant="primary"
              size={compact ? 'sm' : 'md'}
            />
          )}
          {secondaryLabel && onSecondaryPress && (
            <Button
              label={secondaryLabel}
              onPress={onSecondaryPress}
              variant="ghost"
              size={compact ? 'sm' : 'md'}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: S.xxl,
    paddingVertical: S.xxxl * 2,
  },
  wrapCompact: {
    flex: 0,
    paddingVertical: S.xxl,
  },
  glyph: {
    fontSize: 56,
    marginBottom: S.lg,
    opacity: 0.85,
  },
  glyphCompact: {
    fontSize: 36,
    marginBottom: S.md,
  },
  title: {
    fontFamily: FONTS.displayMedium,
    fontSize: T.size.xl,
    fontWeight: T.weight.medium,
    color: C.text,
    textAlign: 'center',
    marginBottom: S.sm,
  },
  titleCompact: {
    fontSize: T.size.lg,
  },
  body: {
    fontFamily: FONTS.sans,
    fontSize: T.size.md,
    color: C.text2,
    textAlign: 'center',
    lineHeight: T.size.md * 1.5,
    maxWidth: 320,
    marginBottom: S.xl,
  },
  bodyCompact: {
    fontSize: T.size.base,
    marginBottom: S.lg,
  },
  actions: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: S.sm,
  },
});
