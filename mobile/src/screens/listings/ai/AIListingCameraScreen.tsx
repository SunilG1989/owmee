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
 *   - "Done — analyse" CTA enabled at >=3 photos. Disabled with helper
 *     text below if <4.
 *   - Real X back button in the header pops out of the flow entirely
 *     (back to the previous tab, not back to SellTabRedirect).
 *   - On submit: uploads photos directly to R2, starts async AI analysis,
 *     then polls until the draft is ready.
 *   - On AI failure (ai_failed flag): still navigates forward with the
 *     draft so the seller can fill manually. No more dead-end alerts.
 *
 * Why we still don't use vision-camera: image-picker is already wired,
 * tested, and the value of vision-camera (custom overlays) doesn't
 * matter for this MVP.
 */
import React, { useState, useCallback } from 'react';
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
import {
  Camera,
  CheckCircle2,
  Images,
  Sparkles,
  type LucideIcon,
} from 'lucide-react-native';

import { C, T, S, R, Shadow } from '../../../utils/tokens';
import { Button, IconButton } from '../../../components/ui';
import { AIListing } from '../../../services/api';
import { parseApiError } from '../../../utils/errors';
import type { RootScreen } from '../../../navigation/types';

const MIN_PHOTOS = 3;
const MAX_PHOTOS = 6;
const ANALYSIS_IMAGE_QUALITY = 0.78 as const;
const ANALYSIS_IMAGE_MAX_EDGE = 1280;

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
        quality: ANALYSIS_IMAGE_QUALITY as any,
        maxWidth: ANALYSIS_IMAGE_MAX_EDGE,
        maxHeight: ANALYSIS_IMAGE_MAX_EDGE,
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
        quality: ANALYSIS_IMAGE_QUALITY as any,
        maxWidth: ANALYSIS_IMAGE_MAX_EDGE,
        maxHeight: ANALYSIS_IMAGE_MAX_EDGE,
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
          { text: 'Keep photos', style: 'cancel', onPress: () => setUploading(false) },
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
      {/* Header — real close button that exits the flow */}
      <View style={st.header}>
        <IconButton icon="✕" onPress={exitFlow} a11y="Exit" size="sm" />
        <Text style={st.headerTitle}>Add clear photos</Text>
        <View style={st.headerSpacer} />
      </View>

      {/* Body */}
      {hero ? (
        <ScrollView style={st.flex} contentContainerStyle={st.previewBlock}>
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
              : `Add ${MIN_PHOTOS - photos.length} more photo${MIN_PHOTOS - photos.length === 1 ? '' : 's'} to continue.`}
          </Text>

          {/* Tips for a great listing */}
          <View style={st.tipsCard}>
            <Text style={st.tipsHeading}>Tips for a great listing</Text>
            <View style={st.tipRow}>
              <Text style={st.tipBullet}>•</Text>
              <Text style={st.tipText}>Use natural light, no flash</Text>
            </View>
            <View style={st.tipRow}>
              <Text style={st.tipBullet}>•</Text>
              <Text style={st.tipText}>Place it on a plain, clean background</Text>
            </View>
            <View style={st.tipRow}>
              <Text style={st.tipBullet}>•</Text>
              <Text style={st.tipText}>Show front, back, and both sides</Text>
            </View>
            <View style={st.tipRow}>
              <Text style={st.tipBullet}>•</Text>
              <Text style={st.tipText}>Capture wear honestly, but keep the item sharp</Text>
            </View>
          </View>
        </ScrollView>
      ) : (
        <View style={st.emptyBlock}>
          <View style={st.cameraGuideIcon}>
            <Camera size={44} color={C.petrolDeep} strokeWidth={2.2} />
          </View>
          <Text style={st.emptyTitle}>Take photos of what you're selling</Text>
          <Text style={st.emptySub}>
            Good photos build buyer trust. Add {MIN_PHOTOS}-{MAX_PHOTOS} clear shots before AI creates the listing.
          </Text>

          <View style={st.guideCard}>
            <PhotoGuideItem
              Icon={Camera}
              title="Start with the front"
              text="Keep the item centered on a simple background."
            />
            <PhotoGuideItem
              Icon={Images}
              title="Show proof angles"
              text="Add back, sides, accessories, bill, box, and any wear."
            />
            <PhotoGuideItem
              Icon={Sparkles}
              title="Be honest on defects"
              text="Close-ups of scratches or damage reduce returns later."
            />
          </View>

          <Button
            label="Start with first photo"
            variant="primary"
            size="lg"
            onPress={openCamera}
            style={st.openCameraBtn}
          />
          <Button
            label="Choose from gallery"
            variant="ghost"
            size="sm"
            onPress={openGallery}
            style={st.galleryBtn}
          />
        </View>
      )}

      {/* CTA bar — appears only when at least one photo present */}
      {photos.length > 0 && !uploading && (
        <View style={st.ctaBar}>
          <Button
            label="+ Add photo"
            variant="secondary"
            disabled={!canAddMore}
            onPress={openCamera}
            style={st.secondaryBtn}
          />
          <Button
            label={canSubmit ? 'Done — analyse →' : `Need ${MIN_PHOTOS - photos.length} more`}
            variant="primary"
            disabled={!canSubmit}
            onPress={submit}
            style={st.primaryBtn}
          />
        </View>
      )}

      {/* Uploading overlay */}
      {uploading && (
        <View style={st.uploadingOverlay}>
          <ActivityIndicator size="large" color={C.petrol} />
          <Text style={st.uploadingText}>Uploading and analysing photos...</Text>
          <Text style={st.uploadingSub}>Preparing your listing draft.</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function PhotoGuideItem({
  Icon,
  title,
  text,
}: {
  Icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <View style={st.guideRow}>
      <View style={st.guideIcon}>
        <Icon size={18} color={C.petrolDeep} strokeWidth={2.2} />
      </View>
      <View style={st.guideTextWrap}>
        <Text style={st.guideTitle}>{title}</Text>
        <Text style={st.guideText}>{text}</Text>
      </View>
      <CheckCircle2 size={18} color={C.petrolMid} strokeWidth={2.2} />
    </View>
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
  previewBlock: { padding: S.lg, paddingBottom: S.xl },
  heroWrap: { position: 'relative' },
  preview: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: R.lg,
    backgroundColor: C.bone2,
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
  heroBadgeText: { color: C.white, fontSize: T.size.sm, fontWeight: T.weight.semi },
  thumbsRow: { paddingTop: S.md, paddingBottom: S.sm, gap: S.sm },
  thumbWrap: { position: 'relative', marginRight: S.sm },
  thumb: { width: 64, height: 64, borderRadius: R.md, backgroundColor: C.bone2 },
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
  thumbXText: { color: C.white, fontSize: T.size.sm + 1, lineHeight: 14 },
  thumbAdd: {
    width: 64,
    height: 64,
    borderRadius: R.md,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: C.border,
    backgroundColor: C.bone,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbAddText: { color: C.text2, fontSize: T.size.xxl + 4, lineHeight: 28 },
  previewHint: {
    marginTop: S.md,
    color: C.text3,
    fontSize: T.size.base,
    textAlign: 'center',
  },
  tipsCard: {
    marginTop: S.lg,
    backgroundColor: C.surface,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
  },
  tipsHeading: {
    fontSize: T.size.base,
    fontWeight: T.weight.bold,
    color: C.text,
    marginBottom: S.sm,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 4,
  },
  tipBullet: {
    fontSize: T.size.md,
    color: C.petrol,
    marginRight: S.sm,
    fontWeight: T.weight.bold,
    lineHeight: T.size.md + 4,
  },
  tipText: {
    flex: 1,
    fontSize: T.size.base,
    color: C.text2,
    lineHeight: T.size.base + 4,
  },

  emptyBlock: { flex: 1, paddingHorizontal: S.xl, justifyContent: 'center', alignItems: 'center' },
  cameraGuideIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: C.petrolLight,
    borderWidth: 1,
    borderColor: C.blueBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: S.lg,
    ...Shadow.glow,
  },
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
    lineHeight: 22,
    marginBottom: S.lg,
  },
  guideCard: {
    alignSelf: 'stretch',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.lg,
    padding: S.md,
    marginBottom: S.xl,
    ...Shadow.subtle,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.sm,
    paddingVertical: S.sm,
  },
  guideIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.petrolLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideTextWrap: {
    flex: 1,
  },
  guideTitle: {
    fontSize: T.size.base,
    color: C.text,
    fontWeight: T.weight.bold,
  },
  guideText: {
    marginTop: 2,
    fontSize: T.size.sm + 1,
    color: C.text3,
    lineHeight: 18,
  },
  openCameraBtn: {
    minWidth: 220,
    paddingHorizontal: S.xxl,
    borderRadius: R.pill,
    ...Shadow.glow,
  },
  galleryBtn: { marginTop: S.md },

  ctaBar: {
    flexDirection: 'row',
    paddingHorizontal: S.lg,
    paddingVertical: S.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
    backgroundColor: C.surface,
    gap: S.md,
  },
  secondaryBtn: { flex: 1 },
  primaryBtn: { flex: 2, ...Shadow.card },

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
