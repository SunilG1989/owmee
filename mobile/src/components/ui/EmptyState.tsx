/**
 * Owmee EmptyState — the standard "nothing here yet" treatment.
 *
 * Replaces the three patterns we had: bare ActivityIndicator, raw text
 * "No items", and emoji-with-text-no-CTA. This one always has icon +
 * heading + body; an optional action button keeps the user moving
 * instead of staring at a dead screen.
 *
 * Tone of voice: encouraging + specific. "No offers received yet" beats
 * "No data". "List your first item" beats "Click here".
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C, I, S, T } from '../../utils/tokens';
import Button, { ButtonVariant } from './Button';

interface Props {
  icon?: string;          // emoji
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: ButtonVariant;
}

export default function EmptyState({
  icon, title, body, actionLabel, onAction, actionVariant = 'primary',
}: Props) {
  return (
    <View style={s.wrap}>
      {icon && <Text style={s.icon} accessible={false}>{icon}</Text>}
      <Text style={s.title} accessibilityRole="header">{title}</Text>
      {body && <Text style={s.body}>{body}</Text>}
      {actionLabel && onAction && (
        <View style={{ marginTop: S.lg }}>
          <Button label={actionLabel} onPress={onAction} variant={actionVariant} size="md" />
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
  icon: {
    fontSize: I.xl,
    marginBottom: S.md,
  },
  title: {
    fontSize: T.size.lg,
    fontWeight: T.weight.semi,
    color: C.text,
    textAlign: 'center',
  },
  body: {
    fontSize: T.size.base,
    color: C.text2,
    textAlign: 'center',
    marginTop: S.sm,
    lineHeight: 20,
    maxWidth: 320,
  },
});
