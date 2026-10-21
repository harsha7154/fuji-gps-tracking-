import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Dimensions,
  PixelRatio,
  Platform,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBar, BottomTabKey } from '../components/BottomTabBar';
import { AppHeader } from '../components/AppHeader';
import type { CapturedPhoto } from './CameraCaptureScreenX';

const { width } = Dimensions.get('window');

const responsiveFontSize = (size: number) => {
  const fontScale = PixelRatio.getFontScale();
  return size / fontScale;
};

const responsiveSize = (size: number) => {
  const scaleFactor = width / 375;
  return size * scaleFactor;
};

const colors = {
  primary: '#0056A6',
  primaryDark: '#003E78',
  primaryTint: '#EBF3FA',
  white: '#FFFFFF',
  black: '#000000',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  borderGray: '#E2E8F0',
  borderSoft: '#F1F3F5',
  concreteLighter: '#F5F5F5',
  success: '#15803D',
  successBg: '#DCFCE7',
  warning: '#D97706',
  warningBg: '#FEF3C7',
  amber: '#B45309',
  amberBg: '#FEF3C7',
  danger: '#EF4444',
};

const spacing = {
  xxs: responsiveSize(4),
  xs: responsiveSize(8),
  sm: responsiveSize(12),
  md: responsiveSize(16),
  lg: responsiveSize(24),
  xl: responsiveSize(32),
};

const radius = {
  sm: responsiveSize(8),
  md: responsiveSize(12),
  lg: responsiveSize(14),
  pill: 999,
};

const systemFont = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});

const typography = {
  fontFamily: systemFont,
  h2: {
    fontSize: responsiveFontSize(20),
    fontWeight: '800' as const,
    letterSpacing: -0.3,
  },
};

const QUICK_COMMENT_PRESETS = [
  { emoji: '✓', label: 'Erection on Track', text: 'Precast wall panels erection completed as scheduled. Quality & alignment verified.' },
  { emoji: '📐', label: 'Plumb & Alignment Done', text: 'Panel alignment and plumb checked within ±2mm. Shear keys grouted.' },
  { emoji: '⚠️', label: 'Weather Delay', text: 'Work delayed due to afternoon rain. Grout injection deferred to morning shift.' },
];

export interface DailyProgressScreenProps {
  activityCode?: string;
  activityName?: string;
  activityStatus?: string;
  siteCode?: string;
  siteName?: string;
  shiftLogDate?: string;
  totalTargetQty?: number;
  unitLabel?: string;
  loggedBeforeQty?: number;
  loggedBeforePct?: number;
  scheduleLabel?: string;
  stageLabel?: string;
  capturedPhotos: CapturedPhoto[];
  onTakePhoto: () => void;
  onDeletePhoto: (id: string) => void;
  progressNotes: string;
  onProgressNotesChange: (val: string) => void;
  onBack?: () => void;
  onProceed?: () => void;
  onNavigateToProfile?: () => void;
  onBottomTabPress?: (tab: BottomTabKey) => void;
}

export default function DailyProgressScreen({
  activityCode = 'ACT-04',
  activityName = 'Precast Wall Panels Erection',
  activityStatus = 'IN PROGRESS',
  siteCode = 'AW-NGP-014',
  siteName = 'Digdoh Anganwadi',
  shiftLogDate = '06-Mar-2026',
  totalTargetQty = 20,
  unitLabel = 'Wall Panels',
  loggedBeforeQty = 12,
  loggedBeforePct = 60,
  scheduleLabel = '06 Mar – 20 Mar',
  stageLabel = 'Stage 2 Superstructure',
  capturedPhotos,
  onTakePhoto,
  onDeletePhoto,
  progressNotes,
  onProgressNotesChange,
  onBack,
  onProceed,
  onNavigateToProfile,
  onBottomTabPress,
}: DailyProgressScreenProps) {
  const [activeTab, setActiveTab] = useState<BottomTabKey>('activities');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const hasPhotos = capturedPhotos.length > 0;
  const latestPhoto = hasPhotos ? capturedPhotos[capturedPhotos.length - 1] : null;
  const previewPhoto = previewIndex !== null ? capturedPhotos[previewIndex] : null;

  const handleTabPress = useCallback(
    (tab: BottomTabKey) => {
      setActiveTab(tab);
      onBottomTabPress?.(tab);
    },
    [onBottomTabPress]
  );

  const openPreview = (idx: number) => {
    console.log('[DailyProgress] opening photo preview at index', idx);
    setPreviewIndex(idx);
  };
  const closePreview = () => setPreviewIndex(null);

  const navigatePreview = (dir: 1 | -1) => {
    if (previewIndex === null) return;
    const next = (previewIndex + dir + capturedPhotos.length) % capturedPhotos.length;
    setPreviewIndex(next);
  };

  const handleDelete = (id: string) => {
    console.log('[DailyProgress] deleting photo', id);
    onDeletePhoto(id);
    setPreviewIndex(null);
  };

  const applyPreset = (text: string) => {
    onProgressNotesChange(text);
  };

  const handleTakePhoto = () => {
    console.log('[DailyProgress] Take Photo button tapped');
    onTakePhoto();
  };

  return (
    <View style={styles.safeArea}>
      <View style={styles.root}>
        <ScrollView
          style={styles.mainScrollView}
          contentContainerStyle={styles.mainScrollContent}
          showsVerticalScrollIndicator={true}
        >
          <AppHeader
            notificationCount={3}
            onNotificationPress={() => console.log('[DailyProgressScreen] Notifications pressed')}
            avatarIconColor="#0056A6"
            avatarBackgroundColor="#EBF3FA"
            onAvatarPress={() => onNavigateToProfile?.()}
          />

          <View style={styles.titleBlock}>
            <View style={styles.titleRow}>
              <Text style={styles.pageTitle}>Daily Progress Form</Text>
              <View style={styles.shiftLogBadge}>
                <Text style={styles.shiftLogLabel}>Shift Log</Text>
                <Text style={styles.shiftLogValue}>{shiftLogDate}</Text>
              </View>
            </View>
            <View style={styles.badgeRow}>
              <Text style={styles.activityCodeBadge}>{activityCode}</Text>
              <Text style={styles.statusBadge}>{activityStatus}</Text>
              <Text style={styles.activityInline}>
                {siteCode} • {activityName}
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardHeaderTitle}>Task Specification & Milestone</Text>
              <Text style={styles.stagePill}>{stageLabel}</Text>
            </View>
            <View style={styles.specGrid}>
              <View style={styles.specItem}>
                <Text style={styles.specLabel}>Scheduled: </Text>
                <Text style={styles.specValue}>{scheduleLabel}</Text>
              </View>
              <View style={styles.specItem}>
                <Text style={styles.specLabel}>Unit of Work: </Text>
                <Text style={styles.specValue}>{unitLabel} (RCC)</Text>
              </View>
              <View style={styles.specItem}>
                <Text style={styles.specLabel}>Total Target: </Text>
                <Text style={styles.specValue}>
                  {totalTargetQty} {unitLabel}
                </Text>
              </View>
              <View style={styles.specItem}>
                <Text style={styles.specLabel}>Logged Before: </Text>
                <Text style={[styles.specValue, { color: colors.primary }]}>
                  {loggedBeforeQty} {unitLabel} ({loggedBeforePct}%)
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>1. Site Photo Evidence</Text>
                <Text style={styles.sectionSub}>Capture or upload work photo with geo-stamp</Text>
              </View>
              {hasPhotos ? (
                <View style={styles.readyBadge}>
                  <Text style={styles.readyBadgeText}>
                    {capturedPhotos.length} PHOTO{capturedPhotos.length > 1 ? 'S' : ''} READY ✓
                  </Text>
                </View>
              ) : (
                <View style={styles.requiredBadge}>
                  <Text style={styles.requiredBadgeText}>PHOTO REQUIRED</Text>
                </View>
              )}
            </View>

            {hasPhotos && latestPhoto ? (
              <TouchableOpacity
                style={styles.primaryPreviewBox}
                onPress={() => openPreview(capturedPhotos.length - 1)}
                activeOpacity={0.85}
              >
                <Image source={{ uri: latestPhoto.uri }} style={styles.primaryPreviewImg} resizeMode="cover" />
                <View style={styles.liveGeotagBadge}>
                  <Ionicons name="radio-button-on" size={11} color="#FFFFFF" />
                  <Text style={styles.liveGeotagText}>LIVE GEOTAG</Text>
                </View>
                <View style={styles.primaryPreviewFooter}>
                  <View style={styles.primaryPreviewFooterRow}>
                    <Text style={styles.primaryPreviewSite}>
                      {siteCode} • {siteName}
                    </Text>
                    <Text style={styles.primaryPreviewGpsOk}>✓ GPS LOCKED</Text>
                  </View>
                  <View style={styles.primaryPreviewFooterRow}>
                    <Text style={styles.primaryPreviewMuted}>{latestPhoto.coords}</Text>
                    <Text style={styles.primaryPreviewMuted}>
                      Tap to Preview • Photo #{capturedPhotos.length}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.emptyPhotoBox} onPress={handleTakePhoto} activeOpacity={0.8}>
                <View style={styles.emptyPhotoIconWrap}>
                  <Ionicons name="camera-outline" size={24} color={colors.primary} />
                </View>
                <Text style={styles.emptyPhotoTitle}>No Photos Captured Yet</Text>
                <Text style={styles.emptyPhotoSub}>
                  Tap here or click Take Photo below to capture work evidence
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.takePhotoButton} onPress={handleTakePhoto} activeOpacity={0.85}>
              <Ionicons name="camera-outline" size={17} color={colors.white} />
              <Text style={styles.takePhotoButtonText}>
                {hasPhotos ? '+ Take Another Photo' : 'Take Photo'}
              </Text>
            </TouchableOpacity>

            <View style={styles.galleryWrap}>
              <View style={styles.galleryHeaderRow}>
                <View style={styles.galleryHeaderLeft}>
                  <Text style={styles.galleryTitle}>Photos</Text>
                  <View style={styles.galleryCountPill}>
                    <Text style={styles.galleryCountText}>{capturedPhotos.length}</Text>
                  </View>
                </View>
                <Text style={styles.galleryHint}>Tap thumbnail to preview</Text>
              </View>

              {hasPhotos ? (
                <View style={styles.galleryGrid}>
                  {capturedPhotos.map((photo, idx) => (
                    <TouchableOpacity
                      key={photo.id}
                      style={styles.galleryThumbWrap}
                      onPress={() => openPreview(idx)}
                      activeOpacity={0.85}
                    >
                      <Image source={{ uri: photo.uri }} style={styles.galleryThumbImg} resizeMode="cover" />
                      <View style={styles.galleryIndexBadge}>
                        <Text style={styles.galleryIndexText}>#{idx + 1}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.galleryDeleteButton}
                        onPress={() => handleDelete(photo.id)}
                      >
                        <Ionicons name="close" size={11} color="#FFFFFF" />
                      </TouchableOpacity>
                      <View style={styles.galleryStageTag}>
                        <Text style={styles.galleryStageTagText} numberOfLines={1}>
                          {photo.stage || 'Evidence'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}

                  <TouchableOpacity style={styles.addMoreTile} onPress={handleTakePhoto} activeOpacity={0.8}>
                    <View style={styles.addMoreIconWrap}>
                      <Ionicons name="add" size={14} color={colors.primary} />
                    </View>
                    <Text style={styles.addMoreText}>+ Add</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.galleryEmptyBox}>
                  <Text style={styles.galleryEmptyText}>
                    No photos added yet. Use the button above to capture work photos.
                  </Text>
                </View>
              )}
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.commentHeaderRow}>
              <Text style={styles.sectionTitle}>2. Progress Comment & Notes</Text>
              <View style={styles.mandatoryBadge}>
                <Text style={styles.mandatoryBadgeText}>Mandatory</Text>
              </View>
            </View>
            <Text style={styles.commentSub}>
              Enter work details, site observations, or remarks for today
            </Text>

            <TextInput
              style={styles.notesInput}
              multiline
              textAlignVertical="top"
              placeholder="Write today's progress comment, observations, or challenges faced on site..."
              placeholderTextColor={colors.textMuted}
              value={progressNotes}
              onChangeText={onProgressNotesChange}
            />

            <View style={{ marginTop: spacing.sm }}>
              <Text style={styles.presetsLabel}>Quick Presets:</Text>
              <View style={styles.presetsRow}>
                {QUICK_COMMENT_PRESETS.map((preset) => (
                  <TouchableOpacity
                    key={preset.label}
                    style={styles.presetChip}
                    onPress={() => applyPreset(preset.text)}
                  >
                    <Text style={styles.presetChipText}>
                      {preset.emoji} {preset.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.bottomSpacer} />
        </ScrollView>

        <View style={styles.footerContainer}>
          <View style={styles.footerTop}>
            <View style={styles.footerSelected}>
              <Ionicons name="checkmark-circle" size={14} color={colors.primary} />
              <Text style={styles.footerSelectedLabel}>Ready to update:</Text>
              <Text style={styles.footerSelectedText} numberOfLines={1}>
                {activityCode}: {activityName}
              </Text>
            </View>
            {hasPhotos ? (
              <View style={styles.footerReadyBadge}>
                <Text style={styles.footerReadyBadgeText}>
                  {capturedPhotos.length} PHOTO{capturedPhotos.length > 1 ? 'S' : ''} + COMMENT READY
                </Text>
              </View>
            ) : (
              <View style={styles.footerRequiredBadge}>
                <Text style={styles.footerRequiredBadgeText}>PHOTO REQUIRED</Text>
              </View>
            )}
          </View>

          <View style={styles.footerBottom}>
            <TouchableOpacity style={styles.footerBackButton} onPress={onBack}>
              <Ionicons name="arrow-back" size={20} color={colors.primary} />
              <Text style={styles.footerBackText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.footerNextButton} onPress={onProceed}>
              <Text style={styles.footerNextText}>Submit Update Progress</Text>
              <Ionicons name="checkmark-circle" size={18} color={colors.white} />
            </TouchableOpacity>
          </View>
        </View>

        <BottomTabBar activeTab={activeTab} notificationCount={3} onTabPress={handleTabPress} />

        {previewPhoto && previewIndex !== null && (
          <View style={styles.previewOverlay}>
            <View style={styles.previewTopBar}>
              <TouchableOpacity style={styles.previewCloseButton} onPress={closePreview}>
                <Ionicons name="close" size={14} color="#FFFFFF" />
                <Text style={styles.previewCloseText}>Close</Text>
              </TouchableOpacity>
              <Text style={styles.previewTitle}>
                Photo Preview ({previewIndex + 1} of {capturedPhotos.length})
              </Text>
              <TouchableOpacity
                style={styles.previewDeleteButton}
                onPress={() => handleDelete(previewPhoto.id)}
              >
                <Ionicons name="trash-outline" size={13} color="#FCA5A5" />
                <Text style={styles.previewDeleteText}>Delete</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.previewImageWrap}>
              <Image source={{ uri: previewPhoto.uri }} style={styles.previewImage} resizeMode="cover" />
              <View style={styles.previewWatermark}>
                <View style={styles.previewWatermarkRow}>
                  <Text style={styles.previewWatermarkTitle}>{previewPhoto.title || `${siteCode} EVIDENCE`}</Text>
                  <Text style={styles.previewWatermarkVerified}>✓ GEO-VERIFIED</Text>
                </View>
                <View style={styles.previewWatermarkRow}>
                  <Text style={styles.previewWatermarkMuted}>{previewPhoto.coords}</Text>
                  <Text style={styles.previewWatermarkMuted}>{previewPhoto.timestamp}</Text>
                </View>
              </View>
            </View>

            <View style={styles.previewBottomControls}>
              {capturedPhotos.length > 1 && (
                <View style={styles.previewNavRow}>
                  <TouchableOpacity style={styles.previewNavButton} onPress={() => navigatePreview(-1)}>
                    <Ionicons name="arrow-back" size={14} color="#FFFFFF" />
                    <Text style={styles.previewNavText}>Previous</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.previewNavButton} onPress={() => navigatePreview(1)}>
                    <Text style={styles.previewNavText}>Next</Text>
                    <Ionicons name="arrow-forward" size={14} color="#FFFFFF" />
                  </TouchableOpacity>
                </View>
              )}
              <TouchableOpacity style={styles.previewReturnButton} onPress={closePreview}>
                <Text style={styles.previewReturnText}>Return to Daily Progress Form</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.white },
  root: { flex: 1, backgroundColor: colors.concreteLighter },

  mainScrollView: { flex: 1 },
  mainScrollContent: { paddingBottom: spacing.md },

  titleBlock: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    marginTop: 0,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.xs },
  pageTitle: { ...typography.h2, color: colors.textPrimary, flex: 1 },
  shiftLogBadge: {
    backgroundColor: colors.concreteLighter,
    borderWidth: 1,
    borderColor: colors.borderGray,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
  },
  shiftLogLabel: { fontSize: responsiveFontSize(10), fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase' },
  shiftLogValue: { fontSize: responsiveFontSize(14), fontWeight: '900', color: colors.primary, marginTop: 1 },

  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  activityCodeBadge: {
    fontSize: responsiveFontSize(10),
    fontWeight: '800',
    color: colors.primary,
    backgroundColor: colors.primaryTint,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  statusBadge: {
    fontSize: responsiveFontSize(11),
    fontWeight: '800',
    color: colors.warning,
    backgroundColor: colors.warningBg,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  activityInline: { fontSize: responsiveFontSize(12), color: colors.textSecondary },

  card: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderGray,
    borderRadius: radius.lg,
    padding: spacing.sm,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  cardHeaderTitle: { fontSize: responsiveFontSize(12), fontWeight: '800', color: colors.textPrimary },
  stagePill: {
    fontSize: responsiveFontSize(10),
    fontWeight: '700',
    color: colors.success,
    backgroundColor: colors.successBg,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  specGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
  specItem: { width: '50%', flexDirection: 'row', marginBottom: 6 },
  specLabel: { fontSize: responsiveFontSize(11), color: colors.textSecondary },
  specValue: { fontSize: responsiveFontSize(11), fontWeight: '700', color: colors.textPrimary },

  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
  sectionTitle: { fontSize: responsiveFontSize(13), fontWeight: '800', color: colors.textPrimary },
  sectionSub: { fontSize: responsiveFontSize(11), color: colors.textSecondary, marginTop: 1 },

  readyBadge: { backgroundColor: colors.successBg, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  readyBadgeText: { fontSize: responsiveFontSize(10), fontWeight: '800', color: colors.success },
  requiredBadge: { backgroundColor: colors.amberBg, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  requiredBadgeText: { fontSize: responsiveFontSize(10), fontWeight: '800', color: colors.amber },

  emptyPhotoBox: {
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    backgroundColor: '#F8FAFC',
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  emptyPhotoIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyPhotoTitle: { fontSize: responsiveFontSize(13), fontWeight: '800', color: colors.textPrimary },
  emptyPhotoSub: { fontSize: responsiveFontSize(11), color: colors.textSecondary, marginTop: 2, textAlign: 'center' },

  primaryPreviewBox: {
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.borderGray,
    backgroundColor: '#0F172A',
  },
  primaryPreviewImg: { width: '100%', height: 180 },
  liveGeotagBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,86,166,0.92)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  liveGeotagText: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '800' },
  primaryPreviewFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15,23,42,0.92)',
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(56,189,248,0.4)',
  },
  primaryPreviewFooterRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  primaryPreviewSite: { color: '#38BDF8', fontWeight: '800', fontSize: 9.5 },
  primaryPreviewGpsOk: { color: '#4ADE80', fontWeight: '800', fontSize: 9.5 },
  primaryPreviewMuted: { color: '#E2E8F0', fontSize: 9.5 },

  takePhotoButton: {
    marginTop: spacing.sm,
    height: 44,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  takePhotoButtonText: { color: colors.white, fontSize: responsiveFontSize(13), fontWeight: '800' },

  galleryWrap: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  galleryHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  galleryHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  galleryTitle: { fontSize: responsiveFontSize(12.5), fontWeight: '800', color: colors.textPrimary },
  galleryCountPill: { backgroundColor: colors.primaryTint, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 },
  galleryCountText: { fontSize: responsiveFontSize(11), fontWeight: '800', color: colors.primary },
  galleryHint: { fontSize: responsiveFontSize(10.5), color: colors.textSecondary, fontWeight: '600' },

  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  galleryThumbWrap: {
    width: '31%',
    height: 82,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.borderGray,
    backgroundColor: '#0F172A',
  },
  galleryThumbImg: { width: '100%', height: '100%' },
  galleryIndexBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(0,86,166,0.9)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  galleryIndexText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  galleryDeleteButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(239,68,68,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  galleryStageTag: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15,23,42,0.85)',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  galleryStageTagText: { color: '#E2E8F0', fontSize: 8, textAlign: 'center' },

  addMoreTile: {
    width: '31%',
    height: 82,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMoreIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  addMoreText: { fontSize: responsiveFontSize(10), fontWeight: '800', color: colors.primary },

  galleryEmptyBox: {
    padding: 16,
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    borderStyle: 'dashed',
    borderRadius: 10,
  },
  galleryEmptyText: { fontSize: responsiveFontSize(11), color: colors.textSecondary, textAlign: 'center' },

  commentHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xxs },
  mandatoryBadge: { backgroundColor: colors.primaryTint, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  mandatoryBadgeText: { fontSize: responsiveFontSize(10), fontWeight: '700', color: colors.primary },
  commentSub: { fontSize: responsiveFontSize(11), color: colors.textSecondary, marginBottom: spacing.sm },

  notesInput: {
    width: '100%',
    height: 88,
    padding: 10,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 10,
    fontSize: responsiveFontSize(12),
    color: colors.textPrimary,
    backgroundColor: '#FAFAFA',
    lineHeight: 17,
  },

  presetsLabel: { fontSize: responsiveFontSize(10.5), fontWeight: '700', color: colors.textSecondary, marginBottom: 6, textTransform: 'uppercase' },
  presetsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  presetChip: {
    backgroundColor: '#F4F5F7',
    borderWidth: 1,
    borderColor: colors.borderGray,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  presetChipText: { fontSize: responsiveFontSize(10.5), fontWeight: '600', color: '#374151' },

  bottomSpacer: { height: spacing.lg },

  footerContainer: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.borderGray,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 4,
  },
  footerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.xxs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  footerSelected: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1 },
  footerSelectedLabel: { fontSize: responsiveFontSize(10), color: colors.textSecondary },
  footerSelectedText: { fontSize: responsiveFontSize(11), fontWeight: '800', color: colors.textPrimary, flex: 1 },
  footerReadyBadge: { backgroundColor: colors.successBg, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  footerReadyBadgeText: { fontSize: responsiveFontSize(9.5), fontWeight: '800', color: colors.success },
  footerRequiredBadge: { backgroundColor: colors.amberBg, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  footerRequiredBadgeText: { fontSize: responsiveFontSize(9.5), fontWeight: '800', color: colors.amber },

  footerBottom: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs },
  footerBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  footerBackText: { fontSize: responsiveFontSize(13), fontWeight: '600', color: colors.primary },
  footerNextButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.xs,
  },
  footerNextText: { fontSize: responsiveFontSize(13), fontWeight: '600', color: colors.white },

  previewOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,23,42,0.96)',
    zIndex: 200,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  previewTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  previewCloseButton: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previewCloseText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  previewTitle: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '800' },
  previewDeleteButton: {
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F87171',
    backgroundColor: 'rgba(239,68,68,0.25)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  previewDeleteText: { color: '#FCA5A5', fontSize: 12, fontWeight: '700' },

  previewImageWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', marginVertical: spacing.sm },
  previewImage: {
    width: '100%',
    height: 270,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  previewWatermark: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15,23,42,0.92)',
    borderTopWidth: 1,
    borderTopColor: '#38BDF8',
    padding: 10,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
  },
  previewWatermarkRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  previewWatermarkTitle: { color: '#38BDF8', fontWeight: '800', fontSize: 9.5 },
  previewWatermarkVerified: { color: '#4ADE80', fontWeight: '800', fontSize: 9.5 },
  previewWatermarkMuted: { color: '#E2E8F0', fontSize: 9.5 },

  previewBottomControls: { gap: spacing.sm },
  previewNavRow: { flexDirection: 'row', gap: 8 },
  previewNavButton: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  previewNavText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  previewReturnButton: {
    height: 46,
    backgroundColor: colors.primary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewReturnText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '800' },
});