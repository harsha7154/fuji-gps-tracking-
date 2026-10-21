import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppHeader } from '../components/AppHeader';
import { DispatchGpsToggle } from '../components/DispatchGpsToggle';
import { DriverBottomTabBar, DriverBottomTabKey } from '../components/DriverBottomTabBar';
import { PrimaryButton } from '../components/PrimaryButton';
import { useQuery } from '@tanstack/react-query';
import { qk, queryClient } from '../query/queryClient';
import { driverDashboardService } from '../services/driverDashboardService';
import type { UserProfile } from '../types/auth';
import type { DispatchItem, DriverDashboardData, DriverWorkflowKey } from '../types/driverDashboard';
import { DISPATCH_STATUS, getDispatchStatusLabel } from '../utils/dispatchStatus';
import { arrivalConfirmationService } from '../services/arrivalConfirmationService';
import { colors, radius, spacing, typography } from '../theme';

// Icon mapping for each Driver Workflow tile.
const WORKFLOW_ICONS: Record<DriverWorkflowKey, keyof typeof Ionicons.glyphMap> = {
  tripHistory: 'time-outline',
  preTripInspection: 'clipboard-outline',
  proofOfDelivery: 'checkmark-done-outline',
  notifications: 'notifications-outline',
};

// Status badge colors, keyed by statusDispatch (3 = Dispatched, 1 = In Transit, 0 = Arrived).
const STATUS_BADGE_COLORS: Record<number, { bg: string; text: string }> = {
  [DISPATCH_STATUS.DISPATCHED]: { bg: colors.statOrangeBg, text: colors.statOrangeIcon },
  [DISPATCH_STATUS.IN_TRANSIT]: { bg: colors.statBlueBg, text: colors.statBlueIcon },
  [DISPATCH_STATUS.ARRIVED]: { bg: colors.statGreenBg, text: colors.statGreenIcon },
};
const DEFAULT_STATUS_BADGE = { bg: colors.concreteLight, text: colors.textSecondary };

/** While at least one dispatch is In Transit, re-fetch the list this often so Arrived (0) shows up on its own. */
const DISPATCH_REFRESH_INTERVAL_MS = 10_000;

/**
 * After a successful start-journey the backend may need a moment before the
 * list endpoint reports statusDispatch 1. For this long we keep showing
 * "In Transit" even if a refresh still says 3, so the Live GPS button doesn't
 * flicker back to "Activate Journey". After the grace period the server wins.
 */
const START_JOURNEY_GRACE_MS = 30_000;

/**
 * Coverflow-style swiper for the "Completed Dispatches" section.
 * - Centre card is full size; one card peeks on the left and one on the right
 *   (smaller, tilted in 3D, dimmed).
 * - Pure React Native Animated (no extra packages) -> works in Expo Go and APK.
 */
const CARD_WIDTH_RATIO = 0.74; // centre card width as a share of the screen
const CARD_GAP = 10;

interface CoverflowCarouselProps {
  items: DispatchItem[];
  renderItem: (item: DispatchItem) => React.ReactNode;
}

const CoverflowCarousel: React.FC<CoverflowCarouselProps> = ({ items, renderItem }) => {
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = Math.round(screenWidth * CARD_WIDTH_RATIO);
  const snap = cardWidth + CARD_GAP;
  const sidePad = (screenWidth - cardWidth) / 2;

  const scrollX = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Keep the active index valid if the list shrinks after a refresh.
  useEffect(() => {
    if (activeIndex > items.length - 1) setActiveIndex(Math.max(0, items.length - 1));
  }, [items.length, activeIndex]);

  const goTo = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), items.length - 1);
    scrollRef.current?.scrollTo({ x: clamped * snap, animated: true });
    setActiveIndex(clamped);
  };

  return (
    <View style={[styles.coverflowWrap, { width: screenWidth }]}>
      <View>
      <Animated.ScrollView
        ref={scrollRef as any}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={snap}
        decelerationRate="fast"
        disableIntervalMomentum
        scrollEnabled={items.length > 1}
        contentContainerStyle={{ paddingHorizontal: sidePad, paddingVertical: spacing.md }}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: true,
        })}
        onMomentumScrollEnd={(e) => {
          setActiveIndex(Math.round(e.nativeEvent.contentOffset.x / snap));
        }}
      >
        {items.map((item, index) => {
          const inputRange = [(index - 1) * snap, index * snap, (index + 1) * snap];
          const scale = scrollX.interpolate({
            inputRange,
            outputRange: [0.86, 1, 0.86],
            extrapolate: 'clamp',
          });
          const rotateY = scrollX.interpolate({
            inputRange,
            outputRange: ['28deg', '0deg', '-28deg'],
            extrapolate: 'clamp',
          });
          const opacity = scrollX.interpolate({
            inputRange,
            outputRange: [0.55, 1, 0.55],
            extrapolate: 'clamp',
          });

          return (
            <Pressable
              key={item.dispatchID}
              onPress={() => index !== activeIndex && goTo(index)}
              style={{ width: cardWidth, marginRight: index === items.length - 1 ? 0 : CARD_GAP }}
            >
              <Animated.View
                pointerEvents={index === activeIndex ? 'auto' : 'none'}
                style={{ opacity, transform: [{ perspective: 900 }, { scale }, { rotateY }] }}
              >
                {renderItem(item)}
              </Animated.View>
            </Pressable>
          );
        })}
      </Animated.ScrollView>

      {items.length > 1 && (
        <>
          <Pressable
            onPress={() => goTo(activeIndex - 1)}
            disabled={activeIndex <= 0}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Previous completed dispatch"
            style={[
              styles.coverflowNavBtn,
              styles.coverflowNavBtnLeft,
              activeIndex <= 0 && styles.coverflowNavBtnDisabled,
            ]}
          >
            <Ionicons name="chevron-back" size={22} color={colors.statGreenIcon} />
          </Pressable>
          <Pressable
            onPress={() => goTo(activeIndex + 1)}
            disabled={activeIndex >= items.length - 1}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Next completed dispatch"
            style={[
              styles.coverflowNavBtn,
              styles.coverflowNavBtnRight,
              activeIndex >= items.length - 1 && styles.coverflowNavBtnDisabled,
            ]}
          >
            <Ionicons name="chevron-forward" size={22} color={colors.statGreenIcon} />
          </Pressable>
        </>
      )}
      </View>

      {items.length > 1 && (
        <View style={styles.coverflowDots}>
          {items.map((item, i) => (
            <View
              key={item.dispatchID}
              style={[styles.coverflowDot, i === activeIndex && styles.coverflowDotActive]}
            />
          ))}
        </View>
      )}
    </View>
  );
};

interface DriverDashboardScreenProps {
  user: UserProfile;
  accessToken?: string;
  onLogout: () => void;
  onNavigateToProfile?: () => void;
  onNavigateToNotifications?: () => void;
  /** Unread notification count from AppNavigator (falls back to the dashboard data's count). */
  notificationCount?: number;
  /** Called with the dispatch to track; called with no id when no specific dispatch applies. */
  onNavigateToLiveGps?: (dispatchId?: string, objectEntryId?: number | string) => void;
  onNavigateToPod?: () => void;
  onNavigateToMyTrip?: (dispatchId?: string) => void;
  onNavigateToTripHistory?: () => void;
}

/**
 * Truck Driver Dashboard with 2 distinct sections, split purely on statusDispatch:
 * 1. Active Dispatch       — statusDispatch 3 (Dispatched) or 1 (In Transit)
 * 2. Completed Dispatches  — statusDispatch 0 (Arrived)
 */
export const DriverDashboardScreen: React.FC<DriverDashboardScreenProps> = ({
  user,
  accessToken,
  onLogout,
  onNavigateToProfile,
  onNavigateToNotifications,
  notificationCount,
  onNavigateToLiveGps,
  onNavigateToPod,
  onNavigateToMyTrip,
  onNavigateToTripHistory,
}) => {
  // Seeded from the cache: coming back to the dashboard paints instantly, the query refreshes it behind.
  const [data, setData] = useState<DriverDashboardData | null>(
    () => queryClient.getQueryData<DriverDashboardData>(qk.dashboard(user.id)) ?? null,
  );
  const [activeTab, setActiveTab] = useState<DriverBottomTabKey>('dashboard');

  // dispatchID -> time the driver successfully started it (see START_JOURNEY_GRACE_MS).
  const recentlyStartedRef = useRef<Map<string, number>>(new Map());

  // Subscribe to arrival confirmations so confirmed dispatches cleanly transition to completed
  const [, setArrivalVersion] = useState(0);
  useEffect(() => {
    return arrivalConfirmationService.subscribe(() => {
      setArrivalVersion((v) => v + 1);
    });
  }, []);

  // Merge a fresh server list into state, honouring the start-journey grace window.
  const applyServerDispatches = useCallback((items: DispatchItem[], full?: DriverDashboardData) => {
    const now = Date.now();
    const started = recentlyStartedRef.current;

    const merged = items.map((item) => {
      // An in-transit dispatch must NEVER prematurely flip to Arrived on server/Redis signals
      // unless the driver has explicitly confirmed arrival.
      const effectiveStatus = arrivalConfirmationService.getEffectiveStatus(
        item.dispatchID,
        item.statusDispatch
      );
      const withStatus: DispatchItem =
        effectiveStatus !== item.statusDispatch
          ? { ...item, statusDispatch: effectiveStatus, arrived: effectiveStatus === DISPATCH_STATUS.ARRIVED }
          : item;

      const startedAt = started.get(item.dispatchID);
      if (startedAt === undefined) return withStatus;

      const serverStillSaysDispatched = withStatus.statusDispatch === DISPATCH_STATUS.DISPATCHED;
      if (!serverStillSaysDispatched || now - startedAt > START_JOURNEY_GRACE_MS) {
        started.delete(item.dispatchID); // server has caught up (or grace expired) — trust it
        return withStatus;
      }
      return { ...withStatus, statusDispatch: DISPATCH_STATUS.IN_TRANSIT };
    });

    setData((prev) => (prev ? { ...prev, dispatches: merged } : full ? { ...full, dispatches: merged } : prev));
  }, []);

  const allDispatches = useMemo(() => {
    return (data?.dispatches ?? []).map((d) => {
      const effectiveStatus = arrivalConfirmationService.getEffectiveStatus(
        d.dispatchID,
        d.statusDispatch
      );
      if (effectiveStatus !== d.statusDispatch) {
        return { ...d, statusDispatch: effectiveStatus, arrived: effectiveStatus === DISPATCH_STATUS.ARRIVED };
      }
      return d;
    });
  }, [data?.dispatches]);

  // Filter into 2 distinct sections: Active vs Completed (statusDispatch 0 === Arrived).
  const { activeDispatches, completedDispatches } = useMemo(
    () => ({
      activeDispatches: allDispatches.filter((d) => d.statusDispatch !== DISPATCH_STATUS.ARRIVED),
      completedDispatches: allDispatches.filter((d) => d.statusDispatch === DISPATCH_STATUS.ARRIVED),
    }),
    [allDispatches]
  );

  const firstInTransitId = useMemo(
    () => allDispatches.find((d) => d.statusDispatch === DISPATCH_STATUS.IN_TRANSIT)?.dispatchID,
    [allDispatches]
  );
  const hasInTransit = firstInTransitId !== undefined;

  // ONE query owns the dashboard data (React Query):
  //  - cached across screens and shared with every other caller of the same key (Live GPS, Profile, ...),
  //  - polled every 10 s ONLY while a trip is in transit and ONLY while the app is in the foreground,
  //  - refreshed when the app returns to the foreground (if the data is older than staleTime),
  //  - a failed refresh keeps the list that is on screen (no blanking on a transient network error).
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const dashboardQuery = useQuery({
    queryKey: qk.dashboard(user.id),
    queryFn: () => driverDashboardService.fetchDashboard(String(user.id), accessTokenRef.current),
    staleTime: 8_000,
    refetchInterval: hasInTransit ? DISPATCH_REFRESH_INTERVAL_MS : false,
    retry: 1,
  });
  const { refetch: refetchDashboard } = dashboardQuery;
  useEffect(() => {
    if (dashboardQuery.data) applyServerDispatches(dashboardQuery.data.dispatches ?? [], dashboardQuery.data);
    // dataUpdatedAt (not data): every successful poll must re-run the start-journey grace merge,
    // even when the server's list is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardQuery.dataUpdatedAt]);

  // Pull-to-refresh: ask the server now.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetchDashboard();
    } catch (err) {
      console.warn('[DriverDashboardScreen] pull-to-refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  }, [refetchDashboard]);

  // start-journey succeeded -> flip this card to In Transit right away (button becomes "Live GPS").
  const handleJourneyStarted = useCallback((dispatchId: string) => {
    recentlyStartedRef.current.set(dispatchId, Date.now());
    arrivalConfirmationService.markInTransit(dispatchId);
    setData((prev) =>
      prev
        ? {
          ...prev,
          dispatches: prev.dispatches.map((d) =>
            d.dispatchID === dispatchId ? { ...d, statusDispatch: DISPATCH_STATUS.IN_TRANSIT } : d
          ),
        }
        : prev
    );
  }, []);

  const openLiveGps = useCallback(
    (dispatchId?: string, objectEntryId?: number | string) => {
      setActiveTab('liveGps');
      const targetItem = dispatchId
        ? allDispatches.find((d) => d.dispatchID === dispatchId)
        : allDispatches.find((d) => d.statusDispatch === DISPATCH_STATUS.IN_TRANSIT);
      const targetId = dispatchId ?? targetItem?.dispatchID ?? firstInTransitId;
      const targetEntryId =
        objectEntryId ??
        targetItem?.MaterialDispatchId ??
        targetItem?.objectEntryId;
      console.log('[DriverDashboardScreen] Navigating to Live GPS:', {
        dispatchId: targetId,
        objectEntryId: targetEntryId,
      });
      onNavigateToLiveGps?.(targetId, targetEntryId);
    },
    [allDispatches, firstInTransitId, onNavigateToLiveGps]
  );

  const handleTabPress = useCallback(
    (tab: DriverBottomTabKey) => {
      setActiveTab(tab);

      if (tab === 'dashboard') {
        return;
      }
      if (tab === 'myTrip') {
        onNavigateToMyTrip?.(firstInTransitId);
        return;
      }
      if (tab === 'liveGps') {
        openLiveGps();
        return;
      }
      if (tab === 'history') {
        onNavigateToTripHistory?.();
        return;
      }
      if (tab === 'profile') {
        onNavigateToProfile?.();
        return;
      }
    },
    [onNavigateToProfile, openLiveGps, onNavigateToMyTrip, onNavigateToTripHistory, firstInTransitId]
  );

  const handleNotificationsPress = useCallback(() => {
    onNavigateToNotifications?.();
  }, [onNavigateToNotifications]);

  const handleAvatarPress = useCallback(() => {
    onNavigateToProfile?.();
  }, [onNavigateToProfile]);

  // "Live GPS Map" button — opens the In Transit dispatch (if any).
  const handleLiveGpsMap = useCallback(() => {
    openLiveGps();
  }, [openLiveGps]);

  const handleViewManifest = useCallback((dispatch: DispatchItem) => {
    console.log(`[DriverDashboardScreen] View Manifest pressed for ${dispatch.dispatchID}`);
  }, []);

  const handleWorkflowPress = useCallback(
    (key: DriverWorkflowKey) => {
      if (key === 'tripHistory') {
        onNavigateToTripHistory?.();
        return;
      }
      if (key === 'proofOfDelivery') {
        onNavigateToPod?.();
        return;
      }
      if (key === 'notifications') {
        onNavigateToNotifications?.();
        return;
      }
      console.log(`[DriverDashboardScreen] Workflow "${key}" pressed`);
    },
    [onNavigateToTripHistory, onNavigateToPod, onNavigateToNotifications]
  );

  const renderDispatchCard = (dispatch: DispatchItem) => {
    const badge =
      (dispatch.statusDispatch !== undefined ? STATUS_BADGE_COLORS[dispatch.statusDispatch] : undefined) ??
      DEFAULT_STATUS_BADGE;
    const statusText =
      dispatch.statusDispatch !== undefined
        ? getDispatchStatusLabel(dispatch.statusDispatch)
        : dispatch.statusLabel || getDispatchStatusLabel(undefined);

    return (
      <View key={dispatch.dispatchID} style={[styles.card, styles.dispatchCard]}>
        <View style={styles.tripHeaderRow}>
          <Text style={styles.tripId}>{dispatch.dispatchID}</Text>
          <View style={[styles.tripStatusBadge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.tripStatusText, { color: badge.text }]}>{statusText}</Text>
          </View>
        </View>

        <View style={styles.tripDivider} />

        <View style={styles.timelineRow}>
          <View style={styles.timelineIndicator}>
            <View style={[styles.legDot, styles.legDotFrom]} />
            <View style={styles.timelineConnector} />
            <View style={[styles.legDot, styles.legDotTo]} />
          </View>

          <View style={styles.timelineContent}>
            <View style={styles.legInfo}>
              <Text style={styles.legLabel}>FROM (PLANT)</Text>
              <Text style={styles.legName}>{dispatch.plantName}</Text>
            </View>

            <View style={styles.legInfo}>
              <Text style={styles.legLabel}>TO (SITE)</Text>
              <Text style={styles.legName}>
                {dispatch.siteName || dispatch.destinationSiteAWC}
              </Text>
              <Text style={styles.legMeta}>{dispatch.destinationSiteAWC}</Text>
            </View>
          </View>
        </View>

        <View style={styles.tripStatsRow}>
          <View style={styles.tripStatCell}>
            <Text style={styles.tripStatValue}>{dispatch.distancekm}</Text>
            <Text style={styles.tripStatLabel}>Distance</Text>
          </View>
          <View style={styles.tripStatDivider} />
          <View style={styles.tripStatCell}>
            <Text style={styles.tripStatValue}>{dispatch.quantity}</Text>
            <Text style={styles.tripStatLabel}>Quantity</Text>
          </View>
          <View style={styles.tripStatDivider} />
          <View style={styles.tripStatCell}>
            <Text style={styles.tripStatValue}>{dispatch.elementMaterial}</Text>
            <Text style={styles.tripStatLabel}>Material</Text>
          </View>
        </View>

        <View style={styles.cargoRow}>
          <Text style={styles.cargoText} numberOfLines={1} ellipsizeMode="tail">
            {dispatch.productName} • {dispatch.vehicleNumber} • {dispatch.deliveryDate}
          </Text>
        </View>

        <DispatchGpsToggle
          dispatchId={dispatch.dispatchID}
          objectEntryId={dispatch.MaterialDispatchId ?? dispatch.objectEntryId}
          statusDispatch={dispatch.statusDispatch}
          accessToken={accessToken}
          onJourneyStarted={handleJourneyStarted}
          onOpenLiveGps={openLiveGps}
          destLatitude={dispatch.destinationLatitude}
          destLongitude={dispatch.destinationLongitude}
          destLabel={dispatch.siteName || dispatch.destinationSiteAWC}
        />
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={[colors.primary]} />}
      >
        {/* HEADER */}
        <AppHeader
          logoWidth={100}
          notificationCount={notificationCount ?? data?.notificationCount ?? 0}
          onNotificationPress={handleNotificationsPress}
          avatarIconColor={colors.statOrangeIcon}
          avatarBackgroundColor={colors.statOrangeBg}
          onAvatarPress={handleAvatarPress}
        />

        {/* CONTENT */}
        <View style={styles.content}>
          {/* Driver info card */}
          <View style={[styles.card, styles.driverCard]}>
            <View style={styles.driverAvatar}>
              <Text style={styles.driverAvatarText}>{data?.driver.avatarInitials ?? '—'}</Text>
            </View>
            <View style={styles.driverInfo}>
              <Text style={styles.driverName}>{user.fullName || data?.driver.name}</Text>
              <Text style={styles.driverMeta} numberOfLines={1}>
                {data
                  ? data.driver.vehicleModel
                    ? `${data.driver.vehicleNumber} • ${data.driver.vehicleModel}`
                    : data.driver.vehicleNumber
                  : '—'}
              </Text>
            </View>
            <View
              style={[
                styles.dutyPill,
                data?.driver.dutyStatus === 'OFF_DUTY' && styles.dutyPillOff,
              ]}
            >
              <View
                style={[
                  styles.dutyDot,
                  data?.driver.dutyStatus === 'OFF_DUTY' && styles.dutyDotOff,
                ]}
              />
              <Text
                style={[
                  styles.dutyText,
                  data?.driver.dutyStatus === 'OFF_DUTY' && styles.dutyTextOff,
                ]}
              >
                {data?.driver.dutyStatus === 'OFF_DUTY' ? 'OFF DUTY' : 'ON DUTY'}
              </Text>
            </View>
          </View>

          {/*}  <PrimaryButton
            label="Live GPS Map"
            onPress={handleLiveGpsMap}
            style={styles.liveGpsButton}
          /> {*/}

          {/* ── SECTION 1: ACTIVE DISPATCH ── */}
          <View style={styles.sectionHeaderRow}>
            <View style={styles.headingBadgeRow}>
              <Ionicons name="radio-button-on" size={16} color="#0284c7" style={{ marginRight: 6 }} />
              <Text style={styles.sectionHeading}>Active Dispatch</Text>
            </View>
            <View style={styles.countBadgeActive}>
              <Text style={styles.countBadgeActiveText}>{activeDispatches.length} Active</Text>
            </View>
          </View>

          {activeDispatches.length === 0 ? (
            <View style={[styles.card, styles.dispatchCard]}>
              <Text style={styles.noTripText}>
                {dashboardQuery.isError && !data
                  ? 'Could not load dispatches. Pull down to retry.'
                  : 'No active dispatches currently in transit.'}
              </Text>
            </View>
          ) : (
            activeDispatches.map(renderDispatchCard)
          )}

          {/* ── SECTION 2: COMPLETED DISPATCHES (HISTORY) ── */}
          <View style={[styles.sectionHeaderRow, { marginTop: spacing.md }]}>
            <View style={styles.headingBadgeRow}>
              <Ionicons name="checkmark-done-circle" size={18} color="#16a34a" style={{ marginRight: 6 }} />
              <Text style={styles.sectionHeading}>Completed Dispatches</Text>
            </View>
            <Pressable
              onPress={() => onNavigateToTripHistory?.()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="View Trip History"
            >
              <View style={styles.countBadgeCompleted}>
                <Text style={styles.countBadgeCompletedText}>
                  {completedDispatches.length} Completed →
                </Text>
              </View>
            </Pressable>
          </View>


          {completedDispatches.length === 0 ? (
            <View style={[styles.card, styles.dispatchCard]}>
              <Text style={styles.noTripText}>
                No completed dispatches found.
              </Text>
            </View>
          ) : (
            <CoverflowCarousel items={completedDispatches} renderItem={renderDispatchCard} />
          )}


          {/* ── DRIVER WORKFLOWS ── */}
          <View style={[styles.sectionHeaderRow, { marginTop: spacing.md }]}>
            <Text style={styles.sectionHeading}>Driver Workflows</Text>
            <Pressable
              onPress={() => onNavigateToTripHistory?.()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="View Trip History"
            >
            </Pressable>
          </View>

          <View style={styles.workflowGrid}>
            {(data?.workflows ?? []).map((workflow) => (
              <Pressable
                key={workflow.key}
                onPress={() => handleWorkflowPress(workflow.key)}
                style={({ pressed }) => [
                  styles.workflowCard,
                  pressed && styles.workflowCardPressed,
                ]}
              >
                <View style={styles.workflowSquareTop}>
                  <View style={styles.workflowIconWrapper}>
                    <Ionicons name={WORKFLOW_ICONS[workflow.key]} size={20} color={colors.primary} />
                  </View>
                  <Ionicons name="chevron-forward" size={15} color={colors.tabInactive} />
                </View>
                <View style={styles.workflowText}>
                  <Text style={styles.workflowLabel} numberOfLines={2}>
                    {workflow.label}
                  </Text>
                  <Text style={styles.workflowSublabel} numberOfLines={1}>
                    {workflow.sublabel}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>

          {/* Spacer */}
          <View style={styles.bottomSpacer} />
        </View>
      </ScrollView>

      <DriverBottomTabBar activeTab={activeTab} onTabPress={handleTabPress} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },

  // Header
  platePill: {
    borderWidth: 1,
    borderColor: colors.statGreenIcon,
    backgroundColor: colors.statGreenBg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  plateText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.statGreenIcon,
  },


  // Coverflow carousel (Completed Dispatches)
  coverflowWrap: {
    // Break out of the screen's horizontal padding so side cards reach the edges.
    marginHorizontal: -spacing.md,
    marginBottom: spacing.sm,
  },
  coverflowNavBtn: {
    position: 'absolute',
    top: '50%',
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    zIndex: 10,
  },
  coverflowNavBtnLeft: {
    left: 8,
  },
  coverflowNavBtnRight: {
    right: 8,
  },
  coverflowNavBtnDisabled: {
    opacity: 0.35,
  },
  coverflowDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  coverflowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.cardBorder,
  },
  coverflowDotActive: {
    width: 18,
    backgroundColor: colors.statGreenIcon,
  },


  // Content
  content: {
    paddingHorizontal: spacing.md,
    marginTop: -spacing.sm,
  },

  card: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
  },

  // Driver Card
  driverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  driverAvatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.statOrangeBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  driverAvatarText: {
    ...typography.label,
    fontWeight: '700',
    color: colors.statOrangeIcon,
  },
  driverInfo: {
    flex: 1,
  },
  driverName: {
    ...typography.label,
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  driverMeta: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
  },
  dutyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.statGreenBg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  dutyPillOff: {
    backgroundColor: colors.concreteLight,
  },
  dutyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.statGreenIcon,
    marginRight: spacing.xxs,
  },
  dutyDotOff: {
    backgroundColor: colors.tabInactive,
  },
  dutyText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.statGreenIcon,
  },
  dutyTextOff: {
    color: colors.textSecondary,
  },

  liveGpsButton: {
    marginBottom: spacing.md,
  },

  // Section Headers & Badges
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headingBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionHeading: {
    ...typography.h2,
    fontSize: 17,
    color: colors.textPrimary,
  },
  countBadgeActive: {
    backgroundColor: colors.statBlueBg,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  countBadgeActiveText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: colors.statBlueIcon,
  },
  countBadgeCompleted: {
    backgroundColor: colors.statGreenBg,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  countBadgeCompletedText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: colors.statGreenIcon,
  },

  // Dispatch cards
  dispatchCard: {
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  tripHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tripId: {
    ...typography.label,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  tripStatusBadge: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
  },
  tripStatusText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
  },
  tripDivider: {
    height: 1,
    backgroundColor: colors.cardBorder,
    marginVertical: spacing.sm,
  },
  timelineRow: {
    flexDirection: 'row',
  },
  timelineIndicator: {
    alignItems: 'center',
    marginRight: spacing.sm,
    paddingVertical: 2,
  },
  timelineConnector: {
    flex: 1,
    width: 2,
    minHeight: spacing.lg,
    backgroundColor: colors.cardBorder,
    marginVertical: 4,
  },
  timelineContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  legDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legDotFrom: {
    backgroundColor: colors.primary,
  },
  legDotTo: {
    backgroundColor: colors.statGreenIcon,
  },
  legInfo: {
    marginBottom: spacing.sm,
  },
  legLabel: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  legName: {
    ...typography.label,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 2,
  },
  legMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  tripStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.concreteLighter,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  tripStatCell: {
    flex: 1,
    alignItems: 'center',
  },
  tripStatDivider: {
    width: 1,
    height: '80%',
    backgroundColor: colors.cardBorder,
  },
  tripStatValue: {
    ...typography.label,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  tripStatLabel: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
  },
  cargoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  cargoText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.sm,
  },
  viewManifestButton: {
    flexShrink: 0,
  },
  linkText: {
    ...typography.label,
    color: colors.primary,
  },
  noTripText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.md,
  },

  // Driver Workflows
  workflowGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  workflowCard: {
    flex: 1,
    aspectRatio: 1.15,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    padding: spacing.sm,
    flexDirection: 'column',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  workflowCardPressed: {
    backgroundColor: colors.concreteLighter,
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  workflowSquareTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    width: '100%',
  },
  workflowIconWrapper: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.statBlueBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workflowText: {
    width: '100%',
  },
  workflowLabel: {
    ...typography.label,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    lineHeight: 17,
  },
  workflowSublabel: {
    ...typography.caption,
    fontSize: 10.5,
    color: colors.textSecondary,
    marginTop: 2,
  },

  bottomSpacer: {
    height: spacing.lg,
  },
});