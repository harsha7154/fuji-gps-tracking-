import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppHeader } from '../components/AppHeader';
import { DriverBottomTabBar, DriverBottomTabKey } from '../components/DriverBottomTabBar';
import type { CapturedPhoto } from './CameraCaptureScreenX';
import { driverPodService } from '../services/driverPodService';
import type { PodTripSummary } from '../types/driverWorkflow';
import { colors, radius, spacing, typography } from '../theme';

interface DriverPodScreenProps {
  capturedPhotos: CapturedPhoto[];
  onTakePhoto: () => void;
  onDeletePhoto: (id: string) => void;
  onBack: () => void;
  onSubmit: (tripSummary?: PodTripSummary | null) => Promise<void> | void;
  onNavigateToProfile?: () => void;
  onNavigateToNotifications?: () => void;
  onNavigateToMyTrip?: () => void;
  onNavigateToTripHistory?: () => void;
  onNavigateToLiveGps?: () => void;
  notificationCount?: number;
  userId?: string | number;
  accessToken?: string;
  selectedDispatchId?: string;
  objectEntryId?: string | number;
  initialTripSummary?: PodTripSummary | null;
  /**
   * Arrival confirmed, journey not completed yet. When the photo is already on the server
   * (e.g. after an app restart) the button completes the journey instead of uploading again.
   */
  journeyCompletionPending?: boolean;
}

/**
 * Truck Driver Proof of Delivery (POD) screen.
 *
 * Dedicated to geotagged cargo photo evidence capture and submission:
 *  - Displays verified trip and site details
 *  - Live camera photo capture with geo-stamp
 *  - Real-time photo preview with retake and remove actions
 *  - Single-action POD submission uploading image data to the backend
 */
export const DriverPodScreen: React.FC<DriverPodScreenProps> = ({
  capturedPhotos,
  onTakePhoto,
  onDeletePhoto,
  onBack,
  onSubmit,
  onNavigateToProfile,
  onNavigateToNotifications,
  onNavigateToMyTrip,
  onNavigateToTripHistory,
  onNavigateToLiveGps,
  notificationCount,
  userId,
  accessToken,
  selectedDispatchId,
  objectEntryId,
  initialTripSummary,
  journeyCompletionPending = false,
}) => {
  const [tripSummary, setTripSummary] = useState<PodTripSummary | null>(initialTripSummary ?? null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DriverBottomTabKey>('myTrip');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isAlreadySubmitted, setIsAlreadySubmitted] = useState(false);
  const [submittedInfo, setSubmittedInfo] = useState<{
    fileEntryId?: string;
    fileName?: string;
    submittedAt?: string;
  } | null>(null);
  const inFlightSubmitRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    const sanitizedEntryId =
      objectEntryId !== undefined &&
      !String(objectEntryId).toUpperCase().startsWith('DSP-') &&
      /^\d+$/.test(String(objectEntryId))
        ? objectEntryId
        : undefined;

    console.log('[DriverPodScreen] Loading POD trip summary for identifiers:', {
      selectedDispatchId,
      objectEntryId: sanitizedEntryId,
      userId,
    });

    // 1. Fetch trip summary
    driverPodService
      .getPodTripSummary({
        userId,
        dispatchId: selectedDispatchId,
        objectEntryId: sanitizedEntryId,
        accessToken,
      })
      .then((result) => {
        if (isMounted && result) {
          console.log('[DriverPodScreen] Loaded POD trip summary successfully:', {
            tripId: result.tripId,
            objectEntryId: result.objectEntryId,
            siteName: result.siteName,
            siteCode: result.siteCode,
          });
          setTripSummary(result);
        }
      })
      .catch((err) => {
        console.warn('[DriverPodScreen] getPodTripSummary failed:', err);
      });

    // 2. Authoritative check: has POD already been submitted for this dispatch?
    driverPodService
      .checkPodSubmissionStatus(
        {
          objectEntryId: sanitizedEntryId,
          dispatchId: selectedDispatchId,
        },
        accessToken
      )
      .then((status) => {
        if (isMounted && status.isSubmitted) {
          console.log('[DriverPodScreen] Confirmed existing POD submission for dispatch:', {
            selectedDispatchId,
            objectEntryId: sanitizedEntryId,
            fileEntryId: status.fileEntryId,
            fileName: status.fileName,
          });
          setIsAlreadySubmitted(true);
          setSubmittedInfo({
            fileEntryId: status.fileEntryId,
            fileName: status.fileName,
            submittedAt: status.submittedAt,
          });
        }
      })
      .catch((err) => {
        console.warn('[DriverPodScreen] checkPodSubmissionStatus failed:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [userId, selectedDispatchId, objectEntryId, accessToken]);

  const hasPhotos = capturedPhotos.length > 0;
  const latestPhoto = hasPhotos ? capturedPhotos[capturedPhotos.length - 1] : null;
  // Photo already uploaded but the journey is still open: only "Complete Journey" is left.
  const completeOnly = isAlreadySubmitted && journeyCompletionPending;
  const canSubmit = (hasPhotos && !isAlreadySubmitted) || completeOnly;

  const handleSubmit = useCallback(async () => {
    // Prevent duplicate taps and submissions
    if (!canSubmit || isSubmitting || inFlightSubmitRef.current || (isAlreadySubmitted && !completeOnly)) {
      return;
    }
    inFlightSubmitRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const candidateEntryId =
        (tripSummary?.objectEntryId &&
         !String(tripSummary.objectEntryId).toUpperCase().startsWith('DSP-') &&
         /^\d+$/.test(String(tripSummary.objectEntryId))
          ? tripSummary.objectEntryId
          : undefined) ??
        (objectEntryId &&
         !String(objectEntryId).toUpperCase().startsWith('DSP-') &&
         /^\d+$/.test(String(objectEntryId))
          ? objectEntryId
          : undefined);

      console.log('[DriverPodScreen] Immediately before POD submit decision:', {
        selectedDispatchId,
        objectEntryId: candidateEntryId,
        photoCount: capturedPhotos.length,
        navigationDecision: 'Submitting POD photo evidence to complete delivery',
      });
      await onSubmit(tripSummary ? { ...tripSummary, objectEntryId: candidateEntryId } : null);
      console.log('[DriverPodScreen] Immediately after POD submit succeeded');
      setIsAlreadySubmitted(true);
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : 'Failed to submit Proof of Delivery.';
      setSubmitError(msg);
    } finally {
      inFlightSubmitRef.current = false;
      setIsSubmitting(false);
    }
  }, [canSubmit, completeOnly, isSubmitting, isAlreadySubmitted, onSubmit, tripSummary, selectedDispatchId, objectEntryId, capturedPhotos.length]);

  const handleTabPress = useCallback(
    (tab: DriverBottomTabKey) => {
      setActiveTab(tab);
      if (tab === 'dashboard') {
        onBack();
        return;
      }
      if (tab === 'profile') {
        onNavigateToProfile?.();
        return;
      }
      if (tab === 'myTrip') {
        onNavigateToMyTrip?.();
        return;
      }
      if (tab === 'liveGps') {
        onNavigateToLiveGps?.();
        return;
      }
      if (tab === 'history') {
        onNavigateToTripHistory?.();
        return;
      }
    },
    [onBack, onNavigateToProfile, onNavigateToMyTrip, onNavigateToTripHistory, onNavigateToLiveGps]
  );

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <AppHeader
          variant="curved"
          logoWidth={130}
          notificationCount={notificationCount ?? 0}
          notificationBadgeColor="#0B5FA8"
          onNotificationPress={onNavigateToNotifications}
          avatarIcon="person"
          avatarIconColor="#D97706"
          avatarBackgroundColor="#FEF3D6"
          onAvatarPress={onNavigateToProfile}
        />

        <View style={styles.content}>
          <Pressable
            onPress={onBack}
            hitSlop={8}
            style={({ pressed }) => [styles.backLink, pressed && styles.backLinkPressed]}
            accessibilityRole="button"
            accessibilityLabel="Back to Dashboard"
          >
            <Ionicons name="chevron-back" size={16} color="#0B5FA8" />
            <Text style={styles.backLinkText}>Back to Dashboard</Text>
          </Pressable>

          <View style={styles.titleRow}>
            <View style={styles.headerTitleBlock}>
              <Text style={styles.title}>Proof of Delivery (POD)</Text>
              <Text style={styles.titleSubtext}>Cargo Photo Evidence & Handover</Text>
            </View>
            <View style={styles.moduleBadge}>
              <Text style={styles.moduleBadgeText}>LOGISTICS</Text>
            </View>
          </View>

          {/* Trip banner */}
          <View style={[styles.card, styles.tripBanner]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.tripBannerId}>TRIP {tripSummary?.tripId ?? '—'}</Text>
              <Text style={styles.tripBannerSite}>
                {tripSummary?.siteCode ?? '—'} {tripSummary?.siteName ?? ''}
              </Text>
            </View>
            <View style={styles.atSitePill}>
              <Text style={styles.atSiteText}>AT SITE</Text>
            </View>
          </View>

          {/* Submitted Banner if POD is already submitted */}
          {isAlreadySubmitted && (
            <View style={styles.submittedCard}>
              <View style={styles.submittedCardHeader}>
                <View style={styles.submittedIconWrap}>
                  <Ionicons name="checkmark-circle" size={26} color="#16A34A" />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.submittedTitle}>Proof of Delivery Submitted</Text>
                  <Text style={styles.submittedSubtitle}>
                    {submittedInfo?.fileName
                      ? `Verified record on file: ${submittedInfo.fileName}`
                      : 'Delivery confirmation and photo evidence recorded for this dispatch.'}
                  </Text>
                  {submittedInfo?.submittedAt ? (
                    <Text style={styles.submittedTimeText}>
                      Recorded: {new Date(submittedInfo.submittedAt).toLocaleDateString()} {new Date(submittedInfo.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          )}

          {/* Cargo photo evidence card */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Cargo Photo Evidence</Text>
                <Text style={styles.sectionSub}>Capture delivery photo with geo-stamp</Text>
              </View>
              {isAlreadySubmitted ? (
                <View style={styles.submittedBadge}>
                  <Text style={styles.submittedBadgeText}>SUBMITTED ✓</Text>
                </View>
              ) : hasPhotos ? (
                <View style={styles.readyBadge}>
                  <Text style={styles.readyBadgeText}>
                    PHOTO READY ✓
                  </Text>
                </View>
              ) : (
                <View style={styles.requiredBadge}>
                  <Text style={styles.requiredBadgeText}>PHOTO REQUIRED</Text>
                </View>
              )}
            </View>

            {hasPhotos && latestPhoto ? (
              <View>
                <Pressable
                  style={styles.primaryPreviewBox}
                  onPress={() => setPreviewOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Tap to view full screen preview"
                >
                  <Image source={{ uri: latestPhoto.uri }} style={styles.primaryPreviewImg} resizeMode="cover" />
                  <View style={styles.liveGeotagBadge}>
                    <Ionicons name="radio-button-on" size={11} color={colors.white} />
                    <Text style={styles.liveGeotagText}>LIVE GEOTAG</Text>
                  </View>
                  <View style={styles.primaryPreviewFooter}>
                    <View style={styles.primaryPreviewFooterRow}>
                      <Text style={styles.primaryPreviewMuted} numberOfLines={1}>
                        {latestPhoto.coords}
                      </Text>
                      <Text style={styles.primaryPreviewGpsOk}>✓ GPS LOCKED</Text>
                    </View>
                  </View>
                </Pressable>

                {/* Retake and Remove buttons - hidden if already submitted */}
                {!isAlreadySubmitted && (
                  <View style={styles.photoActionsRow}>
                    <Pressable style={styles.retakeButton} onPress={onTakePhoto}>
                      <Ionicons name="camera-reverse-outline" size={16} color={colors.white} />
                      <Text style={styles.retakeButtonText}>Retake Photo</Text>
                    </Pressable>
                    <Pressable
                      style={styles.removeButton}
                      onPress={() => onDeletePhoto(latestPhoto.id)}
                    >
                      <Ionicons name="trash-outline" size={16} color="#DC2626" />
                      <Text style={styles.removeButtonText}>Remove Photo</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ) : isAlreadySubmitted ? (
              <View style={styles.lockedPhotoBox}>
                <View style={styles.lockedPhotoIconWrap}>
                  <Ionicons name="checkmark-done" size={26} color="#16A34A" />
                </View>
                <Text style={styles.emptyPhotoTitle}>Photo Evidence on File</Text>
                <Text style={styles.emptyPhotoSub}>
                  {submittedInfo?.fileName
                    ? `Evidence file: ${submittedInfo.fileName}`
                    : 'Proof of Delivery has been confirmed on the server.'}
                </Text>
              </View>
            ) : (
              <View>
                <Pressable style={styles.emptyPhotoBox} onPress={onTakePhoto}>
                  <View style={styles.emptyPhotoIconWrap}>
                    <Ionicons name="camera-outline" size={24} color={colors.primary} />
                  </View>
                  <Text style={styles.emptyPhotoTitle}>No Photo Captured Yet</Text>
                  <Text style={styles.emptyPhotoSub}>
                    Tap here or the button below to capture delivery evidence
                  </Text>
                </Pressable>

                <Pressable style={styles.takePhotoButton} onPress={onTakePhoto}>
                  <Ionicons name="camera-outline" size={17} color={colors.white} />
                  <Text style={styles.takePhotoButtonText}>Take Photo</Text>
                </Pressable>
              </View>
            )}
          </View>

          {submitError ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.errorText}>{submitError}</Text>
            </View>
          ) : null}

          {/* Submit Action */}
          {isAlreadySubmitted && !completeOnly ? (
            <View style={styles.submitButtonDisabledContainer}>
              <View style={styles.submitButtonSubmitted}>
                <Ionicons name="checkmark-done-circle" size={20} color="#16A34A" />
                <Text style={styles.submitButtonTextSubmitted}>
                  Proof of Delivery Already Submitted
                </Text>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={handleSubmit}
              disabled={!canSubmit || isSubmitting}
              style={[styles.submitButton, (!canSubmit || isSubmitting) && styles.submitButtonDisabled]}
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Ionicons name="checkmark-circle-outline" size={18} color={colors.white} />
              )}
              <Text style={styles.submitButtonText}>
                {completeOnly
                  ? isSubmitting
                    ? 'Completing Journey...'
                    : 'Complete Journey →'
                  : isSubmitting
                    ? 'Submitting Proof of Delivery...'
                    : 'Submit Proof of Delivery (POD) →'}
              </Text>
            </Pressable>
          )}

          <View style={styles.bottomSpacer} />
        </View>
      </ScrollView>

      <DriverBottomTabBar activeTab={activeTab} onTabPress={handleTabPress} />

      {/* Full-screen photo preview overlay */}
      {previewOpen && latestPhoto ? (
        <View style={styles.previewOverlay}>
          <View style={styles.previewTopBar}>
            <Pressable onPress={() => setPreviewOpen(false)} style={styles.previewCloseButton}>
              <Ionicons name="close" size={14} color={colors.white} />
              <Text style={styles.previewCloseText}>Close</Text>
            </Pressable>
            <Text style={styles.previewTitle}>Captured Delivery Evidence</Text>
            <Pressable
              onPress={() => {
                onDeletePhoto(latestPhoto.id);
                setPreviewOpen(false);
              }}
              style={styles.previewDeleteButton}
            >
              <Ionicons name="trash-outline" size={13} color="#FCA5A5" />
              <Text style={styles.previewDeleteText}>Delete</Text>
            </Pressable>
          </View>

          <View style={styles.previewImageWrapper}>
            <Image source={{ uri: latestPhoto.uri }} style={styles.previewImage} resizeMode="contain" />
            <View style={styles.previewFooter}>
              <Text style={styles.previewFooterTitle}>
                {latestPhoto.title || 'FUJI SILVERTECH CONCRETE • DELIVERY PROOF'}
              </Text>
              <Text style={styles.previewFooterMeta}>{latestPhoto.coords}</Text>
              <Text style={styles.previewFooterMeta}>{latestPhoto.timestamp}</Text>
            </View>
          </View>

          <Pressable style={styles.previewReturnButton} onPress={() => setPreviewOpen(false)}>
            <Text style={styles.previewReturnText}>Return to Proof of Delivery</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flex: 1, backgroundColor: '#FFFFFF' },
  scrollContent: { paddingBottom: 80 },
  content: { padding: spacing.md, gap: spacing.sm },

  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginBottom: spacing.xs,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.07,
    shadowRadius: 3,
    elevation: 2,
    gap: 4,
  },
  backLinkPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
    backgroundColor: '#F8FAFC',
  },
  backLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0B5FA8',
    letterSpacing: -0.1,
  },

  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitleBlock: { flex: 1 },
  title: { ...typography.h2, fontSize: 20, color: colors.textPrimary },
  titleSubtext: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  moduleBadge: {
    backgroundColor: colors.statOrangeBg,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  moduleBadgeText: { ...typography.caption, fontSize: 10, fontWeight: '800', color: colors.statOrangeIcon },

  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderGray,
  },

  tripBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tripBannerId: { ...typography.caption, fontWeight: '800', color: colors.primary, letterSpacing: 0.5 },
  tripBannerSite: { ...typography.label, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
  atSitePill: {
    backgroundColor: colors.statGreenBg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  atSiteText: { ...typography.caption, fontSize: 11, fontWeight: '800', color: colors.statGreenIcon },

  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  sectionTitle: { ...typography.label, color: colors.textPrimary },
  sectionSub: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  readyBadge: {
    backgroundColor: colors.statGreenBg,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  readyBadgeText: { ...typography.caption, fontSize: 10, fontWeight: '800', color: colors.statGreenIcon },
  requiredBadge: {
    backgroundColor: '#FEF2F2',
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  requiredBadgeText: { ...typography.caption, fontSize: 10, fontWeight: '800', color: colors.error },

  primaryPreviewBox: {
    marginTop: spacing.xs,
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    position: 'relative',
    borderWidth: 1,
    borderColor: colors.borderGray,
  },
  primaryPreviewImg: { width: '100%', height: '100%' },
  liveGeotagBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(11,95,168,0.92)',
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  liveGeotagText: { ...typography.caption, fontSize: 9.5, fontWeight: '800', color: colors.white },
  primaryPreviewFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15,23,42,0.85)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  primaryPreviewFooterRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  primaryPreviewMuted: { ...typography.caption, fontSize: 9.5, color: '#E2E8F0', flex: 1, marginRight: spacing.xs },
  primaryPreviewGpsOk: { ...typography.caption, fontSize: 9.5, fontWeight: '800', color: '#4ADE80' },

  photoActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  retakeButton: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  retakeButtonText: { ...typography.label, fontWeight: '800', color: colors.white },
  removeButton: {
    flex: 1,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  removeButtonText: { ...typography.label, fontWeight: '700', color: '#DC2626' },

  emptyPhotoBox: {
    borderRadius: radius.md,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    backgroundColor: colors.concreteLighter,
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  emptyPhotoIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.statBlueBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyPhotoTitle: { ...typography.label, fontWeight: '800', color: colors.textPrimary },
  emptyPhotoSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2, textAlign: 'center' },

  takePhotoButton: {
    marginTop: spacing.sm,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  takePhotoButtonText: { ...typography.label, fontWeight: '800', color: colors.white },

  submitButton: {
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.statGreenIcon,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  submitButtonDisabled: { backgroundColor: colors.disabled },
  submitButtonText: { ...typography.button, color: colors.white },

  submitButtonDisabledContainer: {
    marginBottom: spacing.md,
  },
  submitButtonSubmitted: {
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: '#DCFCE7',
    borderWidth: 1.5,
    borderColor: '#86EFAC',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  submitButtonTextSubmitted: {
    ...typography.button,
    color: '#15803D',
    fontWeight: '800',
  },

  submittedCard: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1.5,
    borderColor: '#86EFAC',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  submittedCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  submittedIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submittedTitle: {
    ...typography.label,
    fontWeight: '800',
    color: '#15803D',
  },
  submittedSubtitle: {
    ...typography.caption,
    color: '#166534',
    marginTop: 2,
  },
  submittedTimeText: {
    ...typography.caption,
    fontSize: 10,
    color: '#15803D',
    marginTop: 3,
    fontWeight: '600',
  },
  submittedBadge: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  submittedBadgeText: {
    ...typography.caption,
    fontWeight: '800',
    color: '#15803D',
    letterSpacing: 0.5,
  },
  lockedPhotoBox: {
    height: 140,
    borderWidth: 1.5,
    borderColor: '#86EFAC',
    borderRadius: radius.md,
    backgroundColor: '#F0FDF4',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  lockedPhotoIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#F87171',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  errorText: {
    ...typography.caption,
    color: colors.error,
    flex: 1,
    fontWeight: '600',
  },

  bottomSpacer: { height: spacing.lg },

  // ===== Photo preview overlay =====
  previewOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,23,42,0.96)',
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  previewTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  previewCloseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    height: 32,
  },
  previewCloseText: { ...typography.caption, fontWeight: '700', color: colors.white },
  previewTitle: { ...typography.label, fontWeight: '800', color: colors.white },
  previewDeleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: '#F87171',
    backgroundColor: 'rgba(239,68,68,0.25)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    height: 32,
  },
  previewDeleteText: { ...typography.caption, fontWeight: '700', color: '#FCA5A5' },

  previewImageWrapper: {
    flex: 1,
    marginVertical: spacing.sm,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  previewImage: { width: '100%', height: '100%' },
  previewFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15,23,42,0.92)',
    padding: spacing.sm,
  },
  previewFooterTitle: { ...typography.caption, fontWeight: '800', color: '#38BDF8' },
  previewFooterMeta: { ...typography.caption, fontSize: 9.5, color: '#E2E8F0', marginTop: 2 },

  previewReturnButton: {
    height: 46,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewReturnText: { ...typography.button, color: colors.white },
});
