/**
 * Owmee Card — the base container that anything info-grouped should
 * use. Replaces the four ad-hoc card patterns we had scattered (12px /
 * 16px / 20px paddings, 8 / 10 / 16 radii, three border colors).
 *
 * Variants
 *   default   surface bg, soft border (most common)
 *   tinted    cream bg, no border (for "informational, not interactive" blocks)
 *   accent    honeyLight bg, honey border (for trust/highlight callouts)
 *   warning   yellow tinted (e.g. ack code box)
 *   success   green tinted (refund completed, etc.)
 *   danger    red tinted (refund failed, dispute open)
 */
import React from 'react';
import {
  StyleSheet, TouchableOpacity, View, ViewProps, ViewStyle,
} from 'react-native';
import { C, R, S, Shadow } from '../../utils/tokens';

export type CardVariant = 'default' | 'tinted' | 'accent' | 'warning' | 'success' | 'danger';
export type CardElevation = 'flat' | 'subtle' | 'card';

interface Props extends ViewProps {
  variant?: CardVariant;
  elevation?: CardElevation;
  /** Override default S.md padding. */
  padding?: number;
  /** When set, the card is tappable (TouchableOpacity wrapper). */
  onPress?: () => void;
  style?: ViewStyle;
}

export default function Card({
  variant = 'default',
  elevation = 'flat',
  padding,
  onPress,
  style,
  children,
  ...rest
}: Props) {
  const v = variantStyles[variant];
  const elev = elevation === 'card' ? Shadow.card : elevation === 'subtle' ? Shadow.subtle : null;
  const composed = [
    styles.base,
    v,
    padding != null ? { padding } : { padding: S.md },
    elev as any,
    style,
  ];

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={composed} {...(rest as any)}>
        {children}
      </TouchableOpacity>
    );
  }
  return (
    <View style={composed} {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: R.md,
    borderWidth: 1,
  },
});

const variantStyles: Record<CardVariant, ViewStyle> = {
  default: { backgroundColor: C.surface, borderColor: C.border },
  tinted:  { backgroundColor: C.cream, borderColor: C.border2 },
  accent:  { backgroundColor: C.honeyLight, borderColor: C.honey },
  warning: { backgroundColor: C.yellowLight, borderColor: C.yellow },
  success: { backgroundColor: C.greenLight, borderColor: C.green },
  danger:  { backgroundColor: C.redLight, borderColor: C.red },
};
