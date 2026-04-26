/**
 * ProfileScreen
 * Seller reputation ladder, KYC status, my listings, notification prefs.
 * India UX: reputation progress is visible and motivating.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Colors, Spacing, Radius } from '../../utils/tokens';
import { UserApi, Notifications, Auth } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import type { Reputation, NotificationPrefs } from '../../services/api';

export default function ProfileScreen() {
  const navigation = useNavigation();
  const { tier, kycStatus, clearAuth } = useAuthStore();

  const [reputation, setReputation] = useState<Reputation | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      tier === 'verified' ? UserApi.reputation() : Promise.resolve(null),
      Notifications.getPrefs(),
    ]).then(([repRes, prefsRes]) => {
      if (repRes) setReputation(repRes.data);
      setPrefs(prefsRes.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [tier]);

  const handlePrefToggle = useCallback(async (key: keyof NotificationPrefs) => {
    if (!prefs) return;
    // transactions_enabled cannot be disabled
    if (key === 'transactions_enabled') return;
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    try {
      await Notifications.updatePrefs(updated);
    } catch { setPrefs(prefs); }
  }, [prefs]);

  const handleLogout = useCallback(() => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => {
        try { await Auth.logout(); } catch {}
        clearAuth();
      }},
    ]);
  }, [clearAuth]);

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.scroll}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.logoText}>owm<Text style={{ color: Colors.teal }}>ee</Text></Text>
        </View>

        {/* Verification status */}
        <View style={s.card}>
          <View style={s.verifyRow}>
            <View style={[s.verifyDot, tier === 'verified' && s.verifyDotActive]} />
            <Text style={s.verifyLabel}>
              {tier === 'verified' ? 'KYC Verified — ready to buy & sell' : 'Verify to start buying and selling'}
            </Text>
          </View>
          {tier !== 'verified' && (
            <TouchableOpacity
              style={s.kycBtn}
              onPress={() => (navigation as any).navigate('KycFlow')}
            >
              <Text style={s.kycBtnText}>Complete verification →</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Reputation ladder */}
        {tier === 'verified' && reputation && (
          <View style={s.sectionContainer}>
            <Text style={s.sectionTitle}>Your reputation</Text>
            <View style={s.card}>
              <View style={s.repHeader}>
                <View>
                  <Text style={s.repStep}>{reputation.current_step}</Text>
                  <Text style={s.repMeta}>
                    {reputation.deal_count} deal{reputation.deal_count !== 1 ? 's' : ''}
                    {reputation.avg_rating ? `  ·  ★ ${reputation.avg_rating}` : ''}
                  </Text>
                </View>
                <Text style={s.repBadge}>🏅</Text>
              </View>
              {/* Ladder */}
              <View style={s.ladder}>
                {reputation.ladder.map((rung, i) => (
                  <View key={i} style={s.ladderRung}>
                    <View style={[s.ladderDot, rung.achieved && s.ladderDotDone]} />
                    <Text style={[s.ladderLabel, rung.achieved && s.ladderLabelDone]}>{rung.label}</Text>
                    {i < reputation.ladder.length - 1 && <View style={[s.ladderLine, rung.achieved && s.ladderLineDone]} />}
                  </View>
                ))}
              </View>
              {reputation.next_step !== 'complete' && (
                <Text style={s.nextStep}>Next: {reputation.next_step}</Text>
              )}
            </View>
          </View>
        )}

        {/* Notification preferences */}
        {prefs && (
          <View style={s.sectionContainer}>
            <Text style={s.sectionTitle}>Notifications</Text>
            <View style={s.card}>
              <View style={s.prefRow}>
                <View style={s.prefInfo}>
                  <Text style={s.prefLabel}>Transactions</Text>
                  <Text style={s.prefSub}>Payments, offers, deals — always on</Text>
                </View>
                <Switch value={true} disabled trackColor={{ true: Colors.teal }} />
              </View>
              <View style={[s.prefRow, s.prefRowBorder]}>
                <View style={s.prefInfo}>
                  <Text style={s.prefLabel}>Messages</Text>
                  <Text style={s.prefSub}>Chat notifications</Text>
                </View>
                <Switch value={prefs.messages_enabled} onValueChange={() => handlePrefToggle('messages_enabled')} trackColor={{ true: Colors.teal }} />
              </View>
              <View style={[s.prefRow, s.prefRowBorder]}>
                <View style={s.prefInfo}>
                  <Text style={s.prefLabel}>Promotions</Text>
                  <Text style={s.prefSub}>Tips, deal recommendations</Text>
                </View>
                <Switch value={prefs.promotions_enabled} onValueChange={() => handlePrefToggle('promotions_enabled')} trackColor={{ true: Colors.teal }} />
              </View>
            </View>
          </View>
        )}

        {/* My listings shortcut */}
        <View style={s.sectionContainer}>
          <Text style={s.sectionTitle}>Selling</Text>
          <View style={s.card}>
            <TouchableOpacity style={s.menuRow} onPress={() => (navigation as any).navigate('MainTabs', { screen: 'Sell' })}>
              <Text style={s.menuIcon}>📦</Text>
              <Text style={s.menuLabel}>My listings</Text>
              <Text style={s.menuArrow}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.menuRow, s.menuRowBorder]}>
              <Text style={s.menuIcon}>₹</Text>
              <Text style={s.menuLabel}>Earnings & payouts</Text>
              <Text style={s.menuArrow}>›</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Sign out */}
        <TouchableOpacity style={s.signOut} onPress={handleLogout}>
          <Text style={s.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { paddingBottom: 60 },
  header: { padding: Spacing.lg, paddingBottom: Spacing.md },
  logoText: { fontSize: 20, fontWeight: '500', color: Colors.text, letterSpacing: -0.5 },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.card, borderWidth: 0.5, borderColor: Colors.border, padding: Spacing.lg, marginHorizontal: Spacing.lg },
  verifyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 10 },
  verifyDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.text4 },
  verifyDotActive: { backgroundColor: Colors.teal },
  verifyLabel: { fontSize: 13, color: Colors.text2, flex: 1 },
  kycBtn: { backgroundColor: Colors.teal, borderRadius: Radius.md, padding: 12, alignItems: 'center' },
  kycBtnText: { fontSize: 13, fontWeight: '500', color: Colors.white },
  sectionContainer: { marginTop: Spacing.xl },
  sectionTitle: { fontSize: 11, fontWeight: '500', color: Colors.text3, letterSpacing: 0.08, textTransform: 'uppercase', marginHorizontal: Spacing.lg, marginBottom: Spacing.sm },
  repHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  repStep: { fontSize: 15, fontWeight: '500', color: Colors.text },
  repMeta: { fontSize: 12, color: Colors.text3, marginTop: 2 },
  repBadge: { fontSize: 28 },
  ladder: { flexDirection: 'row', alignItems: 'center', gap: 0, marginBottom: Spacing.sm },
  ladderRung: { alignItems: 'center', flex: 1, position: 'relative' },
  ladderDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.border, borderWidth: 1.5, borderColor: Colors.border, zIndex: 1 },
  ladderDotDone: { backgroundColor: Colors.teal, borderColor: Colors.teal },
  ladderLabel: { fontSize: 8, color: Colors.text4, marginTop: 4, textAlign: 'center' },
  ladderLabelDone: { color: Colors.teal },
  ladderLine: { position: 'absolute', top: 5, left: '50%', right: '-50%', height: 2, backgroundColor: Colors.border, zIndex: 0 },
  ladderLineDone: { backgroundColor: Colors.teal },
  nextStep: { fontSize: 11, color: Colors.teal, marginTop: 4 },
  prefRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  prefRowBorder: { borderTopWidth: 0.5, borderTopColor: Colors.border2, marginTop: Spacing.sm, paddingTop: Spacing.md },
  prefInfo: { flex: 1 },
  prefLabel: { fontSize: 13, fontWeight: '500', color: Colors.text },
  prefSub: { fontSize: 11, color: Colors.text3, marginTop: 2 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  menuRowBorder: { borderTopWidth: 0.5, borderTopColor: Colors.border2, marginTop: Spacing.sm, paddingTop: Spacing.md },
  menuIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  menuLabel: { flex: 1, fontSize: 14, color: Colors.text },
  menuArrow: { fontSize: 18, color: Colors.text4 },
  signOut: { margin: Spacing.lg, marginTop: Spacing.xxxl, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 0.5, borderColor: Colors.border, alignItems: 'center' },
  signOutText: { fontSize: 14, color: Colors.error },
});
