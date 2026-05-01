/**
 * Owmee ErrorState — the "something went wrong" UI we should show
 * instead of a blank screen on a failed fetch. Replaces the silent
 * `catch {}` pattern in screens like OffersScreen.tsx and
 * ListingDetailScreen.tsx.
 *
 * Default copy is intentionally vague ("Couldn't load") because in
 * practice we rarely know enough to be more specific without leaking
 * server internals to the user. Provide `body` if you do know more.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C, I, S, T } from '../../utils/tokens';
import Button from './Button';

interface Props {
  title?: string;
  body?: string;
  onRetry?: () => void;
}

export default function ErrorState({
  title = "Couldn't load",
  body = 'Pull down to refresh, or try again in a moment.',
  onRetry,
}: Props) {
  return (
    <View style={s.wrap}>
      <Text style={s.icon} accessible={false}>⚠️</Text>
      <Text style={s.title} accessibilityRole="header">{title}</Text>
      <Text style={s.body}>{body}</Text>
      {onRetry && (
        <View style={{ marginTop: S.lg }}>
          <Button label="Try again" onPress={onRetry} variant="secondary" size="md" />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingVertical: S.xxxl + S.lg,
    paddingHorizontal: S.xl,
    alignItems: 'center',
  },
  icon: { fontSize: I.lg, marginBottom: S.md },
  title: { fontSize: T.size.lg, fontWeight: T.weight.semi, color: C.text, textAlign: 'center' },
  body: { fontSize: T.size.base, color: C.text2, textAlign: 'center', marginTop: S.sm, lineHeight: 20, maxWidth: 320 },
});
