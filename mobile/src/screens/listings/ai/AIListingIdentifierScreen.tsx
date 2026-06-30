/**
 * AIListingIdentifierScreen — Sprint 8 Phase 2
 *
 * Conditional sub-step for smartphones / laptops / tablets.
 *
 * Smartphones: capture IMEI via AI photo OCR → CEIR check → confirm
 * Laptops/tablets: capture serial number, no CEIR
 *
 * Flow:
 *   1. Show overlay guide ("IMEI is on Settings → About / box / SIM tray")
 *   2. User takes photo OR taps "Enter manually"
 *   3. If photo: API extracts via AI OCR. Show extracted IMEI + Confirm/Fix
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
import { Button, ScreenHeader } from '../../../components/ui';
import { parseApiError } from '../../../utils/errors';
import type { RootScreen } from '../../../navigation/types';

const SMARTPHONE = 'smartphones';
const MIN_PUBLISH_PHOTOS = 3;

function isValidImei(value: string): boolean {
  if (!/^\d{15}$/.test(value)) return false;
  let total = 0;
  const reversed = value.split('').reverse();
  reversed.forEach((ch, i) => {
    let n = Number(ch);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    total += n;
  });
  return total % 10 === 0;
}

function normalizeSerialInput(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 50);
}

async function requestCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: 'Camera permission',
        message: 'Used to capture the device identifier label.',
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
  const reviewPhotoCount = (
    draft.photo_urls && draft.photo_urls.length > 0 ? draft.photo_urls : [draft.photo_url]
  ).filter(Boolean).filter((_: string, index: number) => !(finalFields.removed_photo_indices || []).includes(index)).length;

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

        setExtracting(true);
        try {
          const { data } = await AIListing.extractIdentifier(draft.draft_id, uri, finalFields.category_slug);
          const nextAttempts = extractionAttempts + 1;
          setExtractionAttempts(nextAttempts);

          if (isSmartphone) {
            if (data.imei && data.luhn_valid) {
              setImei(data.imei);
            } else if (data.imei) {
              setImei(data.imei);
              setManualMode(true);
              Alert.alert(
                'Please verify IMEI',
                'Owmee read 15 digits, but the checksum did not match. Compare it with the photo and fix any wrong digit.',
                [{ text: 'Review number' }],
              );
            } else if (nextAttempts >= 2) {
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
          } else {
            const extractedSerial = normalizeSerialInput(data.serial_number || data.identifier_value || '');
            if (extractedSerial) {
              setSerial(extractedSerial);
              if (data.suggest_manual) {
                setManualMode(true);
                Alert.alert(
                  'Please verify serial number',
                  'Owmee found a serial/service tag, but the photo confidence was low. Compare it with the device or box before listing.',
                  [{ text: 'Review number' }],
                );
              }
            } else if (nextAttempts >= 2) {
              Alert.alert(
                "Couldn't read serial number",
                'Two attempts failed. Please type the serial or service tag.',
                [{ text: 'OK', onPress: () => setManualMode(true) }],
              );
            } else {
              Alert.alert(
                "Couldn't read clearly",
                'Try a closer photo of the Serial Number, S/N, SN, or Service Tag label.',
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
      },
    );
  }, [draft, finalFields.category_slug, isSmartphone, extractionAttempts]);

  const submit = useCallback(async () => {
    if (submitting) return;
    if (reviewPhotoCount < MIN_PUBLISH_PHOTOS) {
      Alert.alert(
        'Add more photos',
        `Listings need at least ${MIN_PUBLISH_PHOTOS} clear photos. Go back and retake the item photos.`,
      );
      return;
    }

    if (isSmartphone) {
      if (!imei || imei.length !== 15 || !/^\d+$/.test(imei)) {
        Alert.alert('Invalid IMEI', 'IMEI must be exactly 15 digits.');
        return;
      }
      if (!isValidImei(imei)) {
        Alert.alert('Check IMEI', 'This IMEI does not pass checksum. Please recheck the digits on the device or box.');
        return;
      }
    } else {
      const normalizedSerial = normalizeSerialInput(serial);
      if (!normalizedSerial) {
        Alert.alert('Serial required', 'Please enter the serial number.');
        return;
      }
      if (normalizedSerial.length < 4) {
        Alert.alert('Check serial number', 'Serial number or service tag looks too short. Please recheck the device or box.');
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
        serial_number: !isSmartphone ? normalizeSerialInput(serial) : null,
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
  }, [imei, serial, isSmartphone, finalFields, submitting, reviewPhotoCount]);

  // Success state
  if (success) {
    return (
      <SafeAreaView style={st.root}>
        <View style={st.successWrap}>
          <Text style={st.successCheck}>✓</Text>
          <Text style={st.successTitle}>Your listing is ready</Text>
          <Text style={st.successSpecs}>{success.title}</Text>
          <Text style={st.successPrice}>{formatPrice(success.price)}</Text>

          <View style={st.successDivider} />
          <Text style={st.successSection}>WHAT HAPPENS NEXT</Text>
          <Text style={st.successStep}>• A buyer commits (usually within 72 hours)</Text>
          <Text style={st.successStep}>• Owmee manages protected payment and delivery support</Text>
          <Text style={st.successStep}>• Payout is released after delivery as per Owmee policy</Text>

          <View style={st.flex} />
          <Button
            label="See my listing"
            variant="primary"
            size="lg"
            onPress={() =>
              navigation.replace('ListingDetail' as never, { listingId: success.listingId } as never)
            }
            fullWidth
            style={st.primaryBtn}
          />
          <Button
            label="List another item"
            variant="secondary"
            onPress={() => navigation.replace('AIListingCamera' as never, undefined as never)}
            fullWidth
            style={st.secondaryBtn}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Capture / manual entry view
  return (
    <SafeAreaView style={st.root}>
      <ScreenHeader
        title={isSmartphone ? 'Capture IMEI' : 'Capture serial number'}
        onBack={() => navigation.goBack()}
        tone="surface"
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={st.flex}>
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
                  <ActivityIndicator size="small" color={C.petrol} />
                  <Text style={st.extractingText}>Reading number...</Text>
                </View>
              )}

              <Button
                label="📷  Take a photo"
                variant="primary"
                size="lg"
                onPress={openCameraForIdentifier}
                fullWidth
                style={st.cameraBtn}
              />
              <Button
                label="Or enter manually"
                variant="ghost"
                size="sm"
                onPress={() => setManualMode(true)}
                style={st.manualLink}
              />
            </>
          ) : (
            // Manual / confirm path
            <>
              <Text style={st.bodyTitle}>
                {isSmartphone ? 'IMEI number' : 'Serial number'}
              </Text>
              <Text style={st.bodySub}>
                {isSmartphone ? '15-digit number, no spaces.' : 'Serial Number, S/N, SN, or Service Tag as shown on the device or box.'}
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
                  onChangeText={(v) => setSerial(normalizeSerialInput(v))}
                  placeholder="e.g. C02XR1234ABC"
                  placeholderTextColor={C.text4}
                  autoCapitalize="characters"
                  maxLength={50}
                />
              )}

              {isSmartphone && imei.length > 0 && imei.length < 15 && (
                <Text style={st.errText}>{15 - imei.length} more digit{15 - imei.length === 1 ? '' : 's'} needed</Text>
              )}

              {!photoUri && (
                <Button
                  label="📷 Try photo extraction instead"
                  variant="ghost"
                  size="sm"
                  onPress={openCameraForIdentifier}
                  style={st.tryPhotoBtn}
                />
              )}
            </>
          )}
        </View>

        {/* Sticky CTA */}
        <View style={st.ctaBar}>
          <Button
            label={`List for ${formatPrice(finalFields.price)} →`}
            variant="primary"
            size="lg"
            loading={submitting}
            disabled={submitting}
            onPress={submit}
            fullWidth
            style={st.primaryBtn}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bone },
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
  headerSpacer: { width: 36 },
  headerTitle: { fontSize: T.size.lg, fontWeight: T.weight.semi, color: C.text },
  flex: { flex: 1 },

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
    backgroundColor: C.bone2,
    marginBottom: S.md,
  },

  extractingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: S.md },
  extractingText: { marginLeft: S.sm, color: C.text2, fontSize: T.size.base },

  cameraBtn: { ...Shadow.glow },
  manualLink: { marginTop: S.md, alignSelf: 'center' },

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

  tryPhotoBtn: { marginTop: S.lg, alignSelf: 'center' },

  ctaBar: {
    paddingHorizontal: S.lg,
    paddingTop: S.md,
    paddingBottom: S.lg,
    backgroundColor: C.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  primaryBtn: { ...Shadow.glow },
  secondaryBtn: { marginTop: S.md },

  // Success
  successWrap: { flex: 1, padding: S.xxl, alignItems: 'center' },
  successCheck: { fontSize: T.size.display + 34, color: C.petrol, marginTop: S.xxl, marginBottom: S.lg },
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
