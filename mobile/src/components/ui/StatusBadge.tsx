/**
 * Owmee StatusBadge — small pill rendering a status string with a
 * tone-appropriate color. Driven by tokens.statusTone() so the same
 * status string gets the same tone everywhere in the app.
 *
 * Examples:
 *   <StatusBadge status="delivered" />        → green
 *   <StatusBadge status="failed" />           → red
 *   <StatusBadge status="processing" />       → amber
 *   <StatusBadge status="completed" tone="positive" label="Done" />
 *
 * Override `label` when the raw status string isn't end-user-friendly.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { R, S, StatusColor, T, prettyStatus, statusTone } from '../../utils/tokens';

type Tone = keyof typeof StatusColor;

interface Props {
  status?: string | null;
  tone?: Tone;
  label?: string;
}

export default function StatusBadge({ status, tone, label }: Props) {
  const resolvedTone: Tone = tone || statusTone(status);
  const palette = StatusColor[resolvedTone];
  return (
    <View style={[s.pill, { backgroundColor: palette.bg }]}>
      <Text
        style={[s.text, { color: palette.text }]}
        numberOfLines={1}
      >
        {label || prettyStatus(status)}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: R.pill,
    paddingHorizontal: S.md,
    paddingVertical: 4,
  },
  text: {
    fontSize: T.size.xs,
    fontWeight: T.weight.semi,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
});
