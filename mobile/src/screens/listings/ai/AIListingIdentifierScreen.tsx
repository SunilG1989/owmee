/**
 * AIListingIdentifierScreen — Sprint 8 Phase 2
 *
 * Conditional sub-step for smartphones / laptops / tablets.
 *
 * Smartphones: capture IMEI via photo OCR (Claude vision) → CEIR check → confirm
 * Laptops/tablets: capture serial number, no CEIR
 *
 * Flow:
 *   1. Show overlay guide ("IMEI is on Settings → About / box / SIM tray")
 *   2. User takes photo OR taps "Enter manually"
 *   3. If photo: API extracts via Claude OCR. Show extracted IMEI + Confirm/Fix
 *   4. After 2 failed photo extractions, force manual keypad entry
 *   5. Validate Luhn (smartphones) and CEIR check
 *   6. On success: createFromDraft with imei_1 set, then in-place success
 */
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  PermissionsAndroid,
  Image,
  KeyboardAvoidingView,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { launchCamera } from 'react-native-image-picker';

import { C, T, S, R, Shadow, formatPrice } from '../../../utils/tokens';
import { AIListing } from '../../../services/api';
import { parseApiError } from '../../../utils/errors';
import type { RootScreen } from '../../../navigation/types';

const SMARTPHONE = 'smartphones';

async function requestCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: 'Camera permission',
        message: 'Used to capture the IMEI sticker on your phone.',
        buttonPositive: 'OK',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export default function AIListingIdentifierScreen({
  route,
  navigation,
}: RootScreen<'AIListingIdentifier'>) {
  const { draft, finalFields } = route.params;
  const isSmartphone = finalFields.category_slug === SMARTPHONE;

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [imei, setImei] = useState('');
  const [serial, setSerial] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [extractionAttempts, setExtractionAttempts] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ listingId: string; price: number; title: string } | null>(null);

  const openCameraForIdentifier = useCallback(async () => {
    const ok = await requestCameraPermission();
    if (!ok) {
      Alert.alert('Camera permission needed', 'Enable camera in Settings.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Settings', onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    launchCamera(
      {
        mediaType: 'photo',
        quality: 0.95 as any,
        maxWidth: 2000,
        maxHeight: 2000,
        cameraType: 'back',
        saveToPhotos: false,
      },
      async (r) => {
        if (r.didCancel || r.errorCode || !r.assets?.[0]?.uri) return;
        const uri = r.assets[0].uri;
        setPhotoUri(uri);

        if (isSmartphone) {
          // Run OCR
          setExtracting(true);
          try {
            const { data } = await AIListing.extractIMEI(draft.draft_id, uri);
            setExtractionAttempts((n) => n + 1);
            if (data.imei && data.luhn_valid) {
              setImei(data.imei);
            } else {
              if (extractionAttempts + 1 >= 2) {
                Alert.alert(
                  "Couldn't read IMEI",
                  'Two attempts failed. Please type it in.',
                  [{ text: 'OK', onPress: () => setManualMode(true) }],
                );
              } else {
                Alert.alert(
                  "Couldn't read clearly",
                  'Try a closer or better-lit photo.',
                  [{ text: 'Retry', style: 'default' }, { text: 'Type manually', onPress: () => setManualMode(true) }],
                );
              }
            }
          } catch (e) {
            Alert.alert('Could not extract', parseApiError(e), [
              { text: 'Type manually', onPress: () => setManualMode(true) },
              { text: 'OK', style: 'cancel' },
            ]);
          } finally {
            setExtracting(false);
          }
        }
      },
    );
  }, [draft, isSmartphone, extractionAttempts]);

  const submit = useCallback(async () => {
    if (submitting) return;

    if (isSmartphone) {
      if (!imei || imei.length !== 15 || !/^\d+$/.test(imei)) {
        Alert.alert('Invalid IMEI', 'IMEI must be exactly 15 digits.');
        return;
      }
    } else {
      if (!serial.trim()) {
        Alert.alert('Serial required', 'Please enter the serial number.');
        return;
      }
    }

    setSubmitting(true);
    try {
      // SPRINT8_PHASE2_V3_1_DRAFT_ID_FIX: include draft_id (the spread doesn't carry it from route params)
      const { data } = await AIListing.createFromDraft({
        draft_id: draft.draft_id,
        ...finalFields,
        imei_1: isSmartphone ? imei : null,
        serial_number: !isSmartphone ? serial.trim() : null,
      });
      setSuccess({
        listingId: data.listing_id,
        price: data.price,
        title: data.title,
      });
    } catch (e) {
      Alert.alert('Could not list', parseApiError(e));
      setSubmitting(false);
    }
  }, [imei, serial, isSmartphone, finalFields, submitting]);

  // Success state
  if (success) {
    return (
      <SafeAreaView style={st.root}>
        <View style={st.successWrap}>
          <Text style={st.successCheck}>✓</Text>
          <Text style={st.successTitle}>Your listing is live</Text>
          <Text style={st.successSpecs}>{success.title}</Text>
          <Text style={st.successPrice}>{formatPrice(success.price)}</Text>

          <View style={st.successDivider} />
          <Text style={st.successSection}>WHAT HAPPENS NEXT</Text>
          <Text style={st.successStep}>• A buyer commits (usually within 72 hours)</Text>
          <Text style={st.successStep}>• We schedule pickup from your address</Text>
          <Text style={st.successStep}>• You get paid 2 days after pickup</Text>

          <View style={{ flex: 1 }} />
          <TouchableOpacity
            style={st.primaryBtn}
            onPress={() =>
              navigation.replace('ListingDetail' as never, { listingId: success.listingId } as never)
            }>
            <Text style={st.primaryBtnText}>See my listing</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={st.secondaryBtn}
            onPress={() => navigation.replace('AIListingCamera' as never, undefined as never)}>
            <Text style={st.secondaryBtnText}>List another item</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Capture / manual entry view
  return (
    <SafeAreaView style={st.root}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.headerBtn}>
          <Text style={st.headerBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={st.headerTitle}>{isSmartphone ? 'Capture IMEI' : 'Capture serial number'}</Text>
        <View style={st.headerBtn} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <View style={st.body}>
          {!manualMode && !imei && !serial ? (
            // Photo path
            <>
              <Text style={st.bodyTitle}>
                {isSmartphone ? 'Take a photo of the IMEI sticker' : 'Take a photo of the serial number'}
              </Text>
              <Text style={st.bodySub}>You can find it on:</Text>
              <View style={st.bulletList}>
                <Text style={st.bullet}>• Back of the device</Text>
                <Text style={st.bullet}>• Settings → About / About this device</Text>
                {isSmartphone && <Text style={st.bullet}>• SIM tray</Text>}
                <Text style={st.bullet}>• Original box / packaging</Text>
              </View>

              {photoUri && (
                <Image source={{ uri: photoUri }} style={st.preview} resizeMode="cover" />
              )}

              {extracting && (
                <View style={st.extractingRow}>
                  <ActivityIndicator size="small" color={C.honey} />
                  <Text style={st.extractingText}>Reading number...</Text>
                </View>
              )}

              <TouchableOpacity onPress={openCameraForIdentifier} style={st.cameraBtn}>
                <Text style={st.cameraBtnText}>📷  Take a photo</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setManualMode(true)} style={st.manualLink}>
                <Text style={st.manualLinkText}>Or enter manually</Text>
              </TouchableOpacity>
            </>
          ) : (
            // Manual / confirm path
            <>
              <Text style={st.bodyTitle}>
                {isSmartphone ? 'IMEI number' : 'Serial number'}
              </Text>
              <Text style={st.bodySub}>
                {isSmartphone ? '15-digit number, no spaces.' : 'As shown on the device or its box.'}
              </Text>

              {isSmartphone ? (
                <TextInput
                  style={st.input}
                  value={imei}
                  onChangeText={(v) => setImei(v.replace(/[^0-9]/g, '').slice(0, 15))}
                  placeholder="123456789012345"
                  placeholderTextColor={C.text4}
                  keyboardType="number-pad"
                  maxLength={15}
                />
              ) : (
                <TextInput
                  style={st.input}
                  value={serial}
                  onChangeText={setSerial}
                  placeholder="e.g. C02XR1234ABC"
                  placeholderTextColor={C.text4}
                  autoCapitalize="characters"
                  maxLength={32}
                />
              )}

              {isSmartphone && imei.length > 0 && imei.length < 15 && (
                <Text style={st.errText}>{15 - imei.length} more digit{15 - imei.length === 1 ? '' : 's'} needed</Text>
              )}

              {!photoUri && (
                <TouchableOpacity onPress={openCameraForIdentifier} style={st.tryPhotoBtn}>
                  <Text style={st.tryPhotoText}>📷 Try photo extraction instead</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>

        {/* Sticky CTA */}
        <View style={st.ctaBar}>
          <TouchableOpacity
            style={[st.primaryBtn, submitting && { opacity: 0.6 }]}
            onPress={submit}
            disabled={submitting}>
            {submitting ? (
              <ActivityIndicator color={C.surface} />
            ) : (
              <Text style={st.primaryBtnText}>
                List for {formatPrice(finalFields.price)} →
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  headerBtn: { minWidth: 32, height: 32, justifyContent: 'center' },
  headerBtnText: { fontSize: 22, color: C.text2 },
  headerTitle: { fontSize: T.size.lg, fontWeight: T.weight.semi, color: C.text },

  body: { flex: 1, padding: S.xl },
  bodyTitle: {
    fontSize: T.size.xl,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: S.sm,
  },
  bodySub: { fontSize: T.size.md, color: C.text2, marginBottom: S.md },
  bulletList: { marginBottom: S.lg },
  bullet: { fontSize: T.size.base, color: C.text2, paddingVertical: 2 },

  preview: {
    width: '100%',
    aspectRatio: 1.5,
    borderRadius: R.md,
    backgroundColor: C.sand,
    marginBottom: S.md,
  },

  extractingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: S.md },
  extractingText: { marginLeft: S.sm, color: C.text2, fontSize: T.size.base },

  cameraBtn: {
    backgroundColor: C.honey,
    paddingVertical: S.lg,
    borderRadius: R.md,
    alignItems: 'center',
    ...Shadow.glow,
  },
  cameraBtnText: { color: C.surface, fontSize: T.size.lg, fontWeight: T.weight.bold },
  manualLink: { marginTop: S.md, paddingVertical: S.sm, alignItems: 'center' },
  manualLinkText: { color: C.text2, fontSize: T.size.md, textDecorationLine: 'underline' },

  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingHorizontal: S.md,
    paddingVertical: Platform.OS === 'ios' ? S.md : S.sm,
    fontSize: T.size.xl,
    fontWeight: T.weight.bold,
    color: C.text,
    backgroundColor: C.surface,
    letterSpacing: 2,
  },
  errText: { marginTop: S.sm, color: C.red, fontSize: T.size.sm },

  tryPhotoBtn: { marginTop: S.lg, paddingVertical: S.md, alignItems: 'center' },
  tryPhotoText: { color: C.honey, fontSize: T.size.md, fontWeight: T.weight.semi },

  ctaBar: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.lg,
    backgroundColor: C.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  primaryBtn: {
    backgroundColor: C.honey,
    paddingVertical: S.lg,
    borderRadius: R.md,
    alignItems: 'center',
    ...Shadow.glow,
  },
  primaryBtnText: { color: C.surface, fontSize: T.size.lg, fontWeight: T.weight.bold },
  secondaryBtn: {
    marginTop: S.md,
    paddingVertical: S.lg,
    borderRadius: R.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.cream,
  },
  secondaryBtnText: { color: C.text2, fontSize: T.size.md, fontWeight: T.weight.semi },

  // Success
  successWrap: { flex: 1, padding: S.xxl, alignItems: 'center' },
  successCheck: { fontSize: 64, color: C.forest, marginTop: S.xxl, marginBottom: S.lg },
  successTitle: {
    fontSize: T.size.xxl,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: S.md,
  },
  successSpecs: { fontSize: T.size.md, color: C.text2, marginBottom: 4 },
  successPrice: {
    fontSize: T.size.display,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: S.xl,
  },
  successDivider: { width: '60%', height: 1, backgroundColor: C.border, marginBottom: S.lg },
  successSection: {
    fontSize: T.size.sm,
    fontWeight: T.weight.bold,
    color: C.text2,
    letterSpacing: 1.5,
    marginBottom: S.md,
  },
  successStep: { fontSize: T.size.md, color: C.text, marginBottom: 6, alignSelf: 'flex-start' },
});
