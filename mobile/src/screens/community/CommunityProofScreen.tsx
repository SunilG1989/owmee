/**
 * CommunityProofScreen — Sprint 7 / Phase 1
 *
 * Shown after OTP verification for users without a community_id.
 * Two tabs:
 *   1. Referral code (primary path — instant)
 *   2. Manual upload (fallback — admin review)
 *
 * Either path lands the user in MainTabs once a community is assigned.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Community } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { C, T, S, R, Shadow } from '../../utils/tokens';
import { parseApiError } from '../../utils/errors';

type Tab = 'referral' | 'manual';

interface CommunityOption {
  id: string;
  name: string;
  city: string;
  type: string;
}

export default function CommunityProofScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('referral');

  // Referral state
  const [code, setCode] = useState('');
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState<{
    valid: boolean;
    community: { name: string; city: string } | null;
    referrer_name: string | null;
  } | null>(null);
  const validateTimer = useRef<NodeJS.Timeout | null>(null);

  // Manual state
  const [communities, setCommunities] = useState<CommunityOption[]>([]);
  const [loadingCommunities, setLoadingCommunities] = useState(false);
  const [selectedCommunityId, setSelectedCommunityId] = useState<string | null>(null);
  const [requestedName, setRequestedName] = useState('');
  const [proofImageUri, setProofImageUri] = useState<string | null>(null);
  const [proofR2Key, setProofR2Key] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [submittingManual, setSubmittingManual] = useState(false);

  // Load community list when tab switches to manual
  useEffect(() => {
    if (tab === 'manual' && communities.length === 0 && !loadingCommunities) {
      setLoadingCommunities(true);
      Community.list()
        .then((res) => {
          setCommunities(res.data?.communities || []);
        })
        .catch(() => setCommunities([]))
        .finally(() => setLoadingCommunities(false));
    }
  }, [tab]);

  // Debounced referral validation
  function onCodeChange(text: string) {
    const upper = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    setCode(upper);
    setValidated(null);
    if (validateTimer.current) clearTimeout(validateTimer.current);
    if (upper.length === 6) {
      validateTimer.current = setTimeout(() => {
        runValidate(upper);
      }, 350);
    }
  }

  async function runValidate(c: string) {
    setValidating(true);
    try {
      const res = await Community.validateReferral(c);
      setValidated({
        valid: !!res.data?.valid,
        community: res.data?.community || null,
        referrer_name: res.data?.referrer_name || null,
      });
    } catch (_e) {
      setValidated({ valid: false, community: null, referrer_name: null });
    } finally {
      setValidating(false);
    }
  }

  async function joinByReferral() {
    if (code.length !== 6 || !validated?.valid) return;
    Keyboard.dismiss();
    try {
      const res = await Community.joinByReferral(code);
      // Backend returns { community, referrer_name, verified_by }
      Alert.alert(
        'Welcome to ' + (res.data?.community?.name || 'your community'),
        `You're now part of this community. ${res.data?.referrer_name || 'A neighbor'} brought you in.`,
        [{ text: 'Start browsing', onPress: () => navigation.replace('MainTabs') }]
      );
    } catch (e: any) {
      Alert.alert('Could not join', parseApiError(e, 'Please check the code and try again.'));
    }
  }

  // Manual upload — request presigned URL, PUT bytes, set proof key
  async function pickAndUploadProof() {
    let ImagePicker: any;
    try {
      ImagePicker = require('react-native-image-picker');
    } catch (_e) {
      Alert.alert(
        'Camera module not installed',
        'Install react-native-image-picker to upload proof images.'
      );
      return;
    }

    const result = await ImagePicker.launchImageLibrary({
      mediaType: 'photo',
      quality: 0.8,
      includeBase64: false,
    });

    if (result.didCancel || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (!asset.uri) {
      Alert.alert('No image picked', 'Please try again.');
      return;
    }

    setProofImageUri(asset.uri);
    setUploadingProof(true);
    try {
      const presignRes = await Community.requestProofUpload(asset.type || 'image/jpeg');
      const { r2_key, presigned_url } = presignRes.data || {};
      if (!r2_key || !presigned_url) {
        throw new Error('Failed to get upload URL');
      }

      // RN-safe upload
      const xhr = new XMLHttpRequest();
      const uploadPromise = new Promise<void>((resolve, reject) => {
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`));
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.open('PUT', presigned_url);
        xhr.setRequestHeader('Content-Type', asset.type || 'image/jpeg');
        // RN binary blob: use { uri, type, name }-style FormData? No — direct PUT works with the file URI in RN.
        // Instead, fetch the file as a blob first then send.
      });
      // Replace XHR approach with fetch+blob, more reliable:
      const blobResp = await fetch(asset.uri);
      const blob = await blobResp.blob();
      const putResp = await fetch(presigned_url, {
        method: 'PUT',
        headers: { 'Content-Type': asset.type || 'image/jpeg' },
        body: blob,
      });
      if (!putResp.ok) {
        throw new Error(`Upload failed (${putResp.status})`);
      }

      setProofR2Key(r2_key);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Please try again.');
      setProofImageUri(null);
      setProofR2Key(null);
    } finally {
      setUploadingProof(false);
    }
  }

  async function submitManualVerification() {
    if (!selectedCommunityId && !requestedName.trim()) {
      Alert.alert('Missing community', 'Pick a community from the list or type a community name.');
      return;
    }
    if (!proofR2Key) {
      Alert.alert(
        'Proof required',
        'Please upload a photo of your society ID, utility bill, or any document showing you live/work here.'
      );
      return;
    }
    setSubmittingManual(true);
    try {
      await Community.submitVerification({
        community_id: selectedCommunityId || undefined,
        requested_community_name: selectedCommunityId ? undefined : requestedName.trim(),
        proof_r2_key: proofR2Key,
        notes: undefined,
      });
      Alert.alert(
        'Submitted for review',
        'A team member will review your proof within 24 hours. You can browse listings once approved.',
        [{ text: 'OK', onPress: () => navigation.replace('MainTabs') }]
      );
    } catch (e: any) {
      Alert.alert('Could not submit', parseApiError(e, 'Please try again.'));
    } finally {
      setSubmittingManual(false);
    }
  }

  function skipForNow() {
    Alert.alert(
      'Browse limited content?',
      'Without a community, you can browse but cannot make offers or sell. You can verify anytime from your profile.',
      [
        { text: 'Go back', style: 'cancel' },
        { text: 'Skip for now', onPress: () => navigation.replace('MainTabs') },
      ]
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Header */}
        <View style={styles.headerWrap}>
          <Text style={styles.title}>Verify your community</Text>
          <Text style={styles.subtitle}>
            Owmee works inside trusted communities — apartments, schools, neighborhoods. Pick one
            way to verify yours.
          </Text>
        </View>

        {/* Tab switcher */}
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tab, tab === 'referral' && styles.tabActive]}
            onPress={() => setTab('referral')}
          >
            <Text style={[styles.tabLabel, tab === 'referral' && styles.tabLabelActive]}>
              I have a code
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === 'manual' && styles.tabActive]}
            onPress={() => setTab('manual')}
          >
            <Text style={[styles.tabLabel, tab === 'manual' && styles.tabLabelActive]}>
              Upload proof
            </Text>
          </TouchableOpacity>
        </View>

        {tab === 'referral' ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.tabBody}
          >
            <Text style={styles.sectionTitle}>Enter your 6-letter code</Text>
            <Text style={styles.sectionHelp}>
              Ask a neighbor or fellow parent who's already on Owmee.
            </Text>

            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={onCodeChange}
              placeholder="ABC123"
              placeholderTextColor={C.muted}
              maxLength={6}
              autoCapitalize="characters"
              autoCorrect={false}
              keyboardType="default"
            />

            {validating && <Text style={styles.statusLine}>Checking…</Text>}
            {validated?.valid && validated.community && (
              <View style={styles.validCard}>
                <Text style={styles.validTitle}>{validated.community.name}</Text>
                <Text style={styles.validSubtitle}>
                  Brought to you by {validated.referrer_name || 'a neighbor'}
                </Text>
              </View>
            )}
            {validated && !validated.valid && code.length === 6 && (
              <Text style={styles.errorLine}>
                Code not found. Check the spelling or ask for a fresh code.
              </Text>
            )}

            <TouchableOpacity
              disabled={!validated?.valid}
              style={[styles.primaryBtn, !validated?.valid && styles.primaryBtnDisabled]}
              onPress={joinByReferral}
            >
              <Text
                style={[
                  styles.primaryBtnLabel,
                  !validated?.valid && styles.primaryBtnLabelDisabled,
                ]}
              >
                Join community
              </Text>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        ) : (
          <View style={styles.tabBody}>
            <Text style={styles.sectionTitle}>Pick your community</Text>
            <Text style={styles.sectionHelp}>
              Don't see yours? Type the name below — we'll add new communities after a quick check.
            </Text>

            {loadingCommunities ? (
              <Text style={styles.statusLine}>Loading communities…</Text>
            ) : communities.length === 0 ? (
              <Text style={styles.statusLine}>No communities yet — type yours below.</Text>
            ) : (
              <View style={{ marginVertical: S.md }}>
                {communities.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => {
                      setSelectedCommunityId(c.id);
                      setRequestedName('');
                    }}
                    style={[
                      styles.communityRow,
                      selectedCommunityId === c.id && styles.communityRowActive,
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.communityName}>{c.name}</Text>
                      <Text style={styles.communityMeta}>
                        {c.city} · {c.type}
                      </Text>
                    </View>
                    {selectedCommunityId === c.id && (
                      <Text style={styles.communityCheck}>✓</Text>
                    )}
                  </Pressable>
                ))}
              </View>
            )}

            <Text style={[styles.sectionTitle, { marginTop: S.lg }]}>Or type a new community</Text>
            <TextInput
              style={styles.textInput}
              value={requestedName}
              onChangeText={(t) => {
                setRequestedName(t);
                setSelectedCommunityId(null);
              }}
              placeholder="e.g. Prestige Shantiniketan"
              placeholderTextColor={C.muted}
              maxLength={150}
            />

            <Text style={[styles.sectionTitle, { marginTop: S.lg }]}>Upload proof</Text>
            <Text style={styles.sectionHelp}>
              Society ID card, lease, utility bill, or school ID. We use it only to verify
              membership and never share it.
            </Text>

            <TouchableOpacity
              style={styles.uploadBtn}
              onPress={pickAndUploadProof}
              disabled={uploadingProof}
            >
              {proofImageUri ? (
                <Image source={{ uri: proofImageUri }} style={styles.previewImg} />
              ) : (
                <Text style={styles.uploadLabel}>
                  {uploadingProof ? 'Uploading…' : '+ Pick a photo'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              disabled={
                submittingManual ||
                uploadingProof ||
                !proofR2Key ||
                (!selectedCommunityId && !requestedName.trim())
              }
              style={[
                styles.primaryBtn,
                (submittingManual ||
                  uploadingProof ||
                  !proofR2Key ||
                  (!selectedCommunityId && !requestedName.trim())) &&
                  styles.primaryBtnDisabled,
              ]}
              onPress={submitManualVerification}
            >
              <Text style={styles.primaryBtnLabel}>
                {submittingManual ? 'Submitting…' : 'Submit for review'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Skip */}
        <View style={styles.skipWrap}>
          <TouchableOpacity onPress={skipForNow}>
            <Text style={styles.skipLabel}>Skip — browse only</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  headerWrap: {
    paddingHorizontal: S.lg,
    paddingTop: S.lg,
    paddingBottom: S.md,
  },
  title: {
    ...T.h1,
    color: C.text,
    marginBottom: S.xs,
  },
  subtitle: {
    ...T.body,
    color: C.muted,
    lineHeight: 22,
  },
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: S.lg,
    marginTop: S.md,
    marginBottom: S.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: C.border,
  },
  tabActive: {
    borderBottomColor: C.primary,
  },
  tabLabel: {
    ...T.body,
    color: C.muted,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: C.primary,
  },
  tabBody: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
  },
  sectionTitle: {
    ...T.h3,
    color: C.text,
    marginBottom: 4,
  },
  sectionHelp: {
    ...T.body,
    color: C.muted,
    marginBottom: S.sm,
    lineHeight: 20,
  },
  codeInput: {
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: R.md,
    padding: 16,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 6,
    textAlign: 'center',
    color: C.text,
    backgroundColor: C.surface,
    marginVertical: S.md,
  },
  textInput: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    padding: 14,
    fontSize: 16,
    color: C.text,
    backgroundColor: C.surface,
    marginVertical: S.sm,
  },
  statusLine: {
    ...T.body,
    color: C.muted,
    textAlign: 'center',
    marginTop: 4,
  },
  errorLine: {
    ...T.body,
    color: C.danger,
    textAlign: 'center',
    marginTop: 4,
  },
  validCard: {
    backgroundColor: C.successBg || '#E8F5E9',
    borderRadius: R.md,
    padding: 14,
    marginTop: S.sm,
    borderLeftWidth: 4,
    borderLeftColor: C.success || '#2E7D32',
  },
  validTitle: {
    ...T.h3,
    color: C.text,
    marginBottom: 2,
  },
  validSubtitle: {
    ...T.body,
    color: C.muted,
  },
  primaryBtn: {
    backgroundColor: C.primary,
    borderRadius: R.md,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: S.lg,
    ...Shadow.sm,
  },
  primaryBtnDisabled: {
    backgroundColor: C.border,
  },
  primaryBtnLabel: {
    ...T.body,
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  primaryBtnLabelDisabled: {
    color: C.muted,
  },
  communityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: R.md,
    backgroundColor: C.surface,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  communityRowActive: {
    borderColor: C.primary,
    backgroundColor: C.surfaceMuted || '#F0F7FF',
  },
  communityName: {
    ...T.body,
    color: C.text,
    fontWeight: '600',
  },
  communityMeta: {
    ...T.caption,
    color: C.muted,
    marginTop: 2,
  },
  communityCheck: {
    fontSize: 18,
    color: C.primary,
    marginLeft: 12,
  },
  uploadBtn: {
    height: 180,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: C.border,
    borderRadius: R.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
    marginVertical: S.sm,
    overflow: 'hidden',
  },
  uploadLabel: {
    ...T.body,
    color: C.muted,
  },
  previewImg: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  skipWrap: {
    alignItems: 'center',
    marginTop: S.xl,
    paddingHorizontal: S.lg,
  },
  skipLabel: {
    ...T.body,
    color: C.muted,
    textDecorationLine: 'underline',
  },
});
