/**
 * ComparablesSheet — read-only "See similar sales" sheet.
 * Has a CTA to transition to the price-edit sheet if the seller wants
 * to override based on what they see.
 */
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Image,
} from 'react-native';

import { C, T, S, R, formatPrice, O } from '../../../../utils/tokens';
import { Button, IconButton } from '../../../../components/ui';
import type { AIComparable } from '../../../../services/api';

interface Props {
  comparables: AIComparable[];
  onSetMyPrice: () => void;
  onClose: () => void;
}

export default function ComparablesSheet({ comparables, onSetMyPrice, onClose }: Props) {
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={st.backdrop}>
        <TouchableOpacity style={st.backdropTouch} activeOpacity={1} onPress={onClose} />
        <View style={st.sheet}>
          <View style={st.handle} />
          <View style={st.headerRow}>
            <Text style={st.title}>Recent similar sales</Text>
            <IconButton icon="✕" onPress={onClose} a11y="Close" size="sm" />
          </View>

          {comparables.length === 0 ? (
            <Text style={st.empty}>No similar sales found yet.</Text>
          ) : (
            <ScrollView style={st.scroll}>
              {comparables.map((c, i) => (
                <View key={i} style={st.row}>
                  {c.image_url ? (
                    <Image source={{ uri: c.image_url }} style={st.thumb} />
                  ) : (
                    <View style={[st.thumb, st.thumbEmpty]} />
                  )}
                  <View style={st.info}>
                    <Text style={st.rowTitle} numberOfLines={1}>
                      {c.title}
                    </Text>
                    <Text style={st.rowMeta}>
                      {c.days_ago < 1 ? 'today' : `${Math.round(c.days_ago)} days ago`}
                      {c.city ? ` · ${c.city}` : ''}
                    </Text>
                  </View>
                  <Text style={st.rowPrice}>{formatPrice(c.price)}</Text>
                </View>
              ))}
            </ScrollView>
          )}

          <Button
            label="Set my own price →"
            variant="primary"
            onPress={onSetMyPrice}
            fullWidth
            style={st.actionBtn}
          />
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: O.dark50, justifyContent: 'flex-end' },
  backdropTouch: { ...StyleSheet.absoluteFillObject },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.xl,
    borderTopRightRadius: R.xl,
    padding: S.lg,
    paddingBottom: S.xxl,
    maxHeight: '85%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    marginBottom: S.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: S.lg,
  },
  title: { fontSize: T.size.xl, fontWeight: T.weight.bold, color: C.text },
  scroll: { maxHeight: 460 },
  thumbEmpty: { backgroundColor: C.bone2 },
  empty: {
    paddingVertical: S.xxl,
    textAlign: 'center',
    color: C.text3,
    fontSize: T.size.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: S.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  thumb: { width: 56, height: 56, borderRadius: R.sm, marginRight: S.md },
  info: { flex: 1 },
  rowTitle: { fontSize: T.size.md, fontWeight: T.weight.semi, color: C.text },
  rowMeta: { marginTop: 2, fontSize: T.size.sm, color: C.text3 },
  rowPrice: { fontSize: T.size.md, fontWeight: T.weight.bold, color: C.text },

  actionBtn: { marginTop: S.lg },
});
