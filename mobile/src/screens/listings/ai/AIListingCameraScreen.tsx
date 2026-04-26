/**
 * AIListingCameraScreen — Sprint 8 Phase 2.1 v3 (SPRINT8_PHASE2_GEMINI_V2_NAV_FIX)
 *
 * Replaces the v1 single-photo screen. Now supports 1-6 photos in one
 * upload, with a thumbnail strip and inline delete.
 *
 * Behaviour:
 *   - On mount: opens the native camera once (only on the FIRST mount).
 *     On subsequent re-focus from the back button, stays put — that
 *     was the v1 loop bug.
 *   - User captures photos, sees them stacked in a horizontal thumbnail
 *     strip below the live preview / latest photo.
 *   - Each thumbnail has an X overlay to delete it.
 *   - "Add another" CTA opens the camera again. Hidden once 6 reached.
 *   - "Done — analyse" CTA enabled at >=4 photos. Disabled with helper
 *     text below if <4.
 *   - Real X back button in the header pops out of the flow entirely
 *     (back to the previous tab, not back to SellTabRedirect).
 *   - On submit: uploads all photos in one multipart call to the new
 *     /v1/listings/draft/from-images endpoint.
 *   - On AI failure (ai_failed flag): still navigates forward with the
 *     draft so the seller can fill manually. No more dead-end alerts.
 *
 * Why we still don't use vision-camera: image-picker is already wired,
 * tested, and the value of vision-camera (custom overlays) doesn't
 * matter for this MVP.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  PermissionsAndroid,
  Linking,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';

import { C, T, S, R, Shadow } from '../../../utils/tokens';
import { AIListing } from '../../../services/api';
import { parseApiError } from '../../../utils/errors';
import type { RootScreen } from '../../../navigation/types';

const MIN_PHOTOS = 4;
const MAX_PHOTOS = 6;

type Photo = { uri: string; localId: string };

async function requestCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: 'Camera permission',
        message: 'Owmee uses the camera to capture photos of items you want to sell.',
        buttonPositive: 'OK',
      },
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export default function AIListingCameraScreen({ navigation }: RootScreen<'AIListingCamera'>) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const autoOpenedRef = useRef(false);

  const exitFlow = useCallback(() => {
    // Plain goBack(). The camera is presented as a fullScreenModal in the
    // root stack; goBack() pops the modal cleanly. The Sell tab's
    // SellTabRedirect uses tabPress (not useFocusEffect), so it won't
    // re-trigger when focus returns to the tab. No loop.
    navigation.goBack();
  }, [navigation]);

  const openCamera = useCallback(async () => {
    if (photos.length >= MAX_PHOTOS) {
      Alert.alert('Limit reached', `You can add up to ${MAX_PHOTOS} photos.`);
      return;
    }
    const ok = await requestCameraPermission();
    if (!ok) {
      Alert.alert(
        'Camera permission needed',
        'Please enable camera access in Settings to take a photo.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
      return;
    }
    launchCamera(
      {
        mediaType: 'photo',
        quality: 0.85 as any,
        maxWidth: 1600,
        maxHeight: 1600,
        saveToPhotos: false,
        cameraType: 'back',
      },
      (r) => {
        if (r.didCancel || r.errorCode) return;
        const uri = r.assets?.[0]?.uri;
        if (uri) {
          setPhotos((p) => [...p, { uri, localId: `${Date.now()}-${p.length}` }]);
        }
      },
    );
  }, [photos.length]);

  const openGallery = useCallback(() => {
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      Alert.alert('Limit reached', `You can add up to ${MAX_PHOTOS} photos.`);
      return;
    }
    launchImageLibrary(
      {
        mediaType: 'photo',
        quality: 0.85 as any,
        maxWidth: 1600,
        maxHeight: 1600,
        selectionLimit: remaining,
      },
      (r) => {
        if (r.didCancel || r.errorCode) return;
        const newOnes = (r.assets || [])
          .map((a, i) => (a.uri ? { uri: a.uri, localId: `${Date.now()}-${i}` } : null))
          .filter(Boolean) as Photo[];
        setPhotos((p) => [...p, ...newOnes].slice(0, MAX_PHOTOS));
      },
    );
  }, [photos.length]);

  // Open camera once on first mount only. Avoids the v1 loop where
  // navigating back would re-trigger camera launch.
  useEffect(() => {
    if (autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    const t = setTimeout(openCamera, 200);
    return () => clearTimeout(t);
  }, [openCamera]);

  const removePhoto = useCallback((localId: string) => {
    setPhotos((p) => p.filter((x) => x.localId !== localId));
  }, []);

  const submit = useCallback(async () => {
    if (photos.length < MIN_PHOTOS || uploading) return;
    setUploading(true);
    try {
      const { data } = await AIListing.draftFromImages(photos.map((p) => p.uri));
      navigation.replace('AIListingSuggest', { draft: data });
    } catch (e) {
      const msg = parseApiError(e);
      Alert.alert(
        "Upload failed",
        msg + '\n\nWould you like to try again?',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setUploading(false) },
          {
            text: 'Use manual form',
            onPress: () => {
              setUploading(false);
              navigation.replace('CreateListing' as never, undefined as never);
            },
          },
          { text: 'Try again', onPress: () => setUploading(false) },
        ],
      );
      return;
    }
    setUploading(false);
  }, [photos, uploading, navigation]);

  const canSubmit = photos.length >= MIN_PHOTOS;
  const canAddMore = photos.length < MAX_PHOTOS;
  const hero = photos[photos.length - 1];

  return (
    <SafeAreaView style={st.root}>
      {/* Header — real back button that exits the flow */}
      <View style={st.header}>
        <TouchableOpacity onPress={exitFlow} style={st.headerBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={st.headerBtnText}>✕</Text>
        </TouchableOpacity>
        <Text style={st.headerTitle}>Sell an item</Text>
        <View style={st.headerBtn} />
      </View>

      {/* Body */}
      {hero ? (
        <View style={st.previewBlock}>
          <View style={st.heroWrap}>
            <Image source={{ uri: hero.uri }} style={st.preview} resizeMode="cover" />
            <View style={st.heroBadge}>
              <Text style={st.heroBadgeText}>{photos.length} / {MAX_PHOTOS}</Text>
            </View>
          </View>

          {/* Thumbnail strip */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.thumbsRow}>
            {photos.map((p) => (
              <View key={p.localId} style={st.thumbWrap}>
                <Image source={{ uri: p.uri }} style={st.thumb} />
                <TouchableOpacity
                  onPress={() => removePhoto(p.localId)}
                  style={st.thumbX}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={st.thumbXText}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
            {canAddMore && (
              <TouchableOpacity onPress={openCamera} style={st.thumbAdd}>
                <Text style={st.thumbAddText}>+</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          {/* Helper line */}
          <Text style={st.previewHint}>
            {canSubmit
              ? `${photos.length} photos — looking good. Tap "Done" when ready.`
              : `Add ${MIN_PHOTOS - photos.length} more photo${MIN_PHOTOS - photos.length === 1 ? '' : 's'} (front, back, and sides). Min ${MIN_PHOTOS}, max ${MAX_PHOTOS}.`}
          </Text>
        </View>
      ) : (
        <View style={st.emptyBlock}>
          <Text style={st.emptyEmoji}>📸</Text>
          <Text style={st.emptyTitle}>Take photos of what you're selling</Text>
          <Text style={st.emptySub}>
            Front, back, both sides, and any damage. {MIN_PHOTOS}-{MAX_PHOTOS} photos.
          </Text>
          <TouchableOpacity onPress={openCamera} style={st.openCameraBtn}>
            <Text style={st.openCameraBtnText}>Take a photo</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={openGallery} style={st.galleryBtn}>
            <Text style={st.galleryBtnText}>Choose from gallery</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* CTA bar — appears only when at least one photo present */}
      {photos.length > 0 && !uploading && (
        <View style={st.ctaBar}>
          <TouchableOpacity onPress={openCamera} style={st.secondaryBtn} disabled={!canAddMore}>
            <Text style={[st.secondaryBtnText, !canAddMore && { opacity: 0.4 }]}>
              + Add photo
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={submit}
            style={[st.primaryBtn, !canSubmit && st.primaryBtnDisabled]}
            disabled={!canSubmit}
          >
            <Text style={st.primaryBtnText}>
              {canSubmit ? 'Done — analyse →' : `Need ${MIN_PHOTOS - photos.length} more`}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Uploading overlay */}
      {uploading && (
        <View style={st.uploadingOverlay}>
          <ActivityIndicator size="large" color={C.honey} />
          <Text style={st.uploadingText}>Analysing your photos...</Text>
          <Text style={st.uploadingSub}>This usually takes a few seconds.</Text>
        </View>
      )}
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

  previewBlock: { flex: 1, padding: S.lg },
  heroWrap: { position: 'relative' },
  preview: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: R.lg,
    backgroundColor: C.sand,
  },
  heroBadge: {
    position: 'absolute',
    top: S.md,
    right: S.md,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    paddingHorizontal: S.md,
    paddingVertical: S.xs,
    borderRadius: R.pill,
  },
  heroBadgeText: { color: '#fff', fontSize: T.size.sm, fontWeight: T.weight.semi },
  thumbsRow: { paddingTop: S.md, paddingBottom: S.sm, gap: S.sm },
  thumbWrap: { position: 'relative', marginRight: S.sm },
  thumb: { width: 64, height: 64, borderRadius: R.md, backgroundColor: C.sand },
  thumbX: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbXText: { color: '#fff', fontSize: 14, lineHeight: 14 },
  thumbAdd: {
    width: 64,
    height: 64,
    borderRadius: R.md,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: C.border,
    backgroundColor: C.cream,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbAddText: { color: C.text2, fontSize: 28, lineHeight: 28 },
  previewHint: {
    marginTop: S.md,
    color: C.text3,
    fontSize: T.size.base,
    textAlign: 'center',
  },

  emptyBlock: { flex: 1, paddingHorizontal: S.xxl, justifyContent: 'center', alignItems: 'center' },
  emptyEmoji: { fontSize: 56, marginBottom: S.lg },
  emptyTitle: {
    fontSize: T.size.xl,
    fontWeight: T.weight.bold,
    color: C.text,
    textAlign: 'center',
    marginBottom: S.sm,
  },
  emptySub: {
    fontSize: T.size.md,
    color: C.text2,
    textAlign: 'center',
    marginBottom: S.xxl,
  },
  openCameraBtn: {
    backgroundColor: C.honey,
    paddingHorizontal: S.xxl,
    paddingVertical: S.lg,
    borderRadius: R.pill,
    minWidth: 220,
    alignItems: 'center',
    ...Shadow.glow,
  },
  openCameraBtnText: { color: C.surface, fontSize: T.size.lg, fontWeight: T.weight.bold },
  galleryBtn: { marginTop: S.md, paddingVertical: S.sm, paddingHorizontal: S.lg },
  galleryBtnText: { color: C.text2, fontSize: T.size.md, textDecorationLine: 'underline' },

  ctaBar: {
    flexDirection: 'row',
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    backgroundColor: C.surface,
    gap: S.md,
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: S.md,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    backgroundColor: C.cream,
  },
  secondaryBtnText: { color: C.text2, fontSize: T.size.md, fontWeight: T.weight.semi },
  primaryBtn: {
    flex: 2,
    paddingVertical: S.md,
    borderRadius: R.md,
    backgroundColor: C.honey,
    alignItems: 'center',
    ...Shadow.card,
  },
  primaryBtnDisabled: { backgroundColor: C.sand },
  primaryBtnText: { color: C.surface, fontSize: T.size.md, fontWeight: T.weight.bold },

  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(254, 251, 244, 0.97)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: S.xxl,
  },
  uploadingText: { marginTop: S.lg, fontSize: T.size.lg, fontWeight: T.weight.semi, color: C.text },
  uploadingSub: { marginTop: S.sm, fontSize: T.size.base, color: C.text3, textAlign: 'center' },
});
