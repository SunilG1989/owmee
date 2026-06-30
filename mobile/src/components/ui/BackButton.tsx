/**
 * Owmee BackButton — v6 "Petrol"
 *
 * The standard chevron-back used by every detail screen. Default
 * variant is a borderless circular tap target on bone surfaces.
 * `floating` variant is for hero-image headers (translucent on
 * the photo, ensures contrast over any background).
 *
 *   <BackButton onPress={() => nav.goBack()} />
 *   <BackButton onPress={() => nav.goBack()} variant="floating" />
 *   <BackButton onPress={() => nav.goBack()} variant="onDark" />
 */
import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import IconButton from './IconButton';

export type BackButtonVariant = 'default' | 'floating' | 'onDark';

interface Props {
  onPress: () => void;
  variant?: BackButtonVariant;
  style?: StyleProp<ViewStyle>;
  a11y?: string;
}

export default function BackButton({
  onPress,
  variant = 'default',
  style,
  a11y = 'Back',
}: Props) {
  const mapped = variant === 'floating'
    ? { variant: 'floating' as const, size: 'overlay' as const }
    : variant === 'onDark'
      ? { variant: 'onDark' as const, size: 'md' as const }
      : { variant: 'outlined' as const, size: 'md' as const };

  return (
    <IconButton
      icon="←"
      onPress={onPress}
      a11y={a11y}
      variant={mapped.variant}
      size={mapped.size}
      style={style}
    />
  );
}
