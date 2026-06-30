import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import BackButton from './BackButton';
import IconButton from './IconButton';
import { C, MIN_TAP, S, T } from '../../utils/tokens';

type HeaderTone = 'surface' | 'canvas' | 'transparent';
type BackKind = 'back' | 'close';

interface Props {
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  backKind?: BackKind;
  right?: React.ReactNode;
  tone?: HeaderTone;
  centerTitle?: boolean;
  style?: StyleProp<ViewStyle>;
}

export default function ScreenHeader({
  title,
  subtitle,
  onBack,
  backKind = 'back',
  right,
  tone = 'canvas',
  centerTitle = true,
  style,
}: Props) {
  const hasRight = !!right;
  const left = onBack
    ? backKind === 'close'
      ? <IconButton icon="✕" onPress={onBack} a11y="Close" size="md" variant="outlined" />
      : <BackButton onPress={onBack} />
    : <View style={styles.sideSlot} />;

  return (
    <View style={[styles.root, toneStyles[tone], style]}>
      <View style={styles.sideSlot}>{left}</View>
      <View style={[styles.titleWrap, centerTitle && styles.titleWrapCentered]}>
        {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View style={[styles.sideSlot, styles.rightSlot]}>
        {hasRight ? right : <View style={styles.sideReserve} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.lg,
    paddingVertical: S.sm,
    gap: S.sm,
  },
  sideSlot: {
    width: MIN_TAP,
    minHeight: MIN_TAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideReserve: {
    width: MIN_TAP,
    height: MIN_TAP,
  },
  rightSlot: {
    alignItems: 'flex-end',
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  titleWrapCentered: {
    alignItems: 'center',
  },
  title: {
    fontSize: T.size.lg,
    fontWeight: T.weight.semi,
    color: C.text,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 1,
    fontSize: T.size.xs,
    fontWeight: T.weight.medium,
    color: C.text4,
    textAlign: 'center',
  },
});

const toneStyles: Record<HeaderTone, ViewStyle> = {
  canvas: {
    backgroundColor: C.bone,
  },
  surface: {
    backgroundColor: C.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  transparent: {
    backgroundColor: 'transparent',
  },
};
