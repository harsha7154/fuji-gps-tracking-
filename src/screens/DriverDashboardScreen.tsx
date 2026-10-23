import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { AppHeader } from '../components/AppHeader';
import { DispatchGpsToggle } from '../components/DispatchGpsToggle';
import { DriverBottomTabBar, DriverBottomTabKey } from '../components/DriverBottomTabBar';
import { useQuery } from '@tanstack/react-query';
import { qk, queryClient } from '../query/queryClient';
import { driverDashboardService } from '../services/driverDashboardService';
import { onJourneyChanged } from '../services/driverGpsService';
import { onPushReceived } from '../services/pushRegistration';
import type { UserProfile } from '../types/auth';
import type { DispatchItem, DriverDashboardData } from '../types/driverDashboard';
import { DISPATCH_STATUS, getDispatchStatusLabel } from '../utils/dispatchStatus';
import { arrivalConfirmationService } from '../services/arrivalConfirmationService';
import { colors, radius, spacing, typography } from '../theme';

const CARD_CONSTRUCTION_BG = require('../../assets/images/auth-hero-login.png');

// Status badge colors, keyed by statusDispatch (3 = Dispatched, 1 = In Transit, 0 = Arrived).
const STATUS_BADGE_COLORS: Record<number, { bg: string; text: string }> = {
  [DISPATCH_STATUS.DISPATCHED]: { bg: '#FEF3D6', text: '#D97706' },
  [DISPATCH_STATUS.IN_TRANSIT]: { bg: '#EBF4FC', text: '#0B5FA8' },
  [DISPATCH_STATUS.ARRIVED]: { bg: '#EAF7EE', text: '#16A34A' },
};
const DEFAULT_STATUS_BADGE = { bg: '#F1F5F9', text: '#64748B' };

/**
 * Dispatch list freshness:
 *  - a dispatch assigned by the admin sends a push -> the list is reloaded at once (onPushReceived),
 *  - while the dashboard is open (app in the foreground) the list is re-checked every
 *    DISPATCH_POLL_MS, so a new assignment also shows up when pushes are off / delayed,
 *  - pull-to-refresh, start / complete journey and opening the screen (list older than
 *    DISPATCH_LIST_STALE_MS) always ask the server.
 */
const DISPATCH_LIST_STALE_MS = 15_000;
const DISPATCH_POLL_MS = 30_000;
const AUTO_RELOAD_MIN_GAP_MS = 15_000;

/**
 * Reusable precast construction background image with smooth white gradient fade
 */
const CardArtworkBackground: React.FC<{ uniqueId: string; height?: number }> = ({ uniqueId, height = 150 }) => {
  return (
    <View style={[styles.cardArtworkContainer, { height }]} pointerEvents="none">
      <Image
        source={CARD_CONSTRUCTION_BG}
        style={styles.cardArtworkImage}
        resizeMode="cover"
      />
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={`cardFadeH_${uniqueId}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
            <Stop offset="30%" stopColor="#FFFFFF" stopOpacity="0.85" />
            <Stop offset="65%" stopColor="#FFFFFF" stopOpacity="0.2" />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id={`cardFadeV_${uniqueId}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
            <Stop offset="70%" stopColor="#FFFFFF" stopOpacity="0.4" />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="1" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#cardFadeH_${uniqueId})`} />
        <Rect width="100%" height="100%" fill={`url(#cardFadeV_${uniqueId})`} />
      </Svg>
    </View>
  );
};

/**
 * Coverflow-style swiper for the "Completed Dispatches" section.
 */
const CARD_WIDTH_RATIO = 0.86;
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

  useEffect(() => {
    if (activeIndex > items.length - 1) setActiveIndex(Math.max(0, items.length - 1));
  }, [items.length, activeIndex]);

  const goTo = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), items.length - 1);
    scrollRef.current?.scrollTo({ x: clamped * snap, animated: true });
    setActiveIndex(clamped);
  };

  const totalDots = Math.max(items.length, 3);

  return (
    <View style={[styles.coverflowWrap, { width: screenWidth }]}>
      <View style={styles.carouselInner}>
        <Animated.ScrollView
          ref={scrollRef as any}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={snap}
          decelerationRate="fast"
          disableIntervalMomentum
          scrollEnabled={items.length > 1}
          contentContainerStyle={{ paddingHorizontal: sidePad, paddingVertical: spacing.xs }}
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
              outputRange: [0.92, 1, 0.92],
              extrapolate: 'clamp',
            });
            const opacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.75, 1, 0.75],
              extrapolate: 'clamp',
            });

            return (
              <Pressable
                key={item.dispatchID || String(index)}
                onPress={() => index !== activeIndex && goTo(index)}
                style={{ width: cardWidth, marginRight: index === items.length - 1 ? 0 : CARD_GAP }}
              >
                <Animated.View
                  pointerEvents={index === activeIndex ? 'auto' : 'none'}
                  style={{ opacity, transform: [{ scale }] }}
                >
                  {renderItem(item)}
                </Animated.View>
              </Pressable>
            );
          })}
        </Animated.ScrollView>

        {/* Floating circular arrow buttons */}
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
          <Ionicons name="chevron-back" size={20} color="#334155" />
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
          <Ionicons name="chevron-forward" size={20} color="#334155" />
        </Pressable>
      </View>

      {/* Pagination dots */}
      <View style={styles.coverflowDots}>
        {Array.from({ length: totalDots }).map((_, i) => (
          <View
            key={i}
            style={[styles.coverflowDot, i === activeIndex && styles.coverflowDotActive]}
          />
        ))}
      </View>
    </View>
  );
};

interface DriverDashboardScreenProps {
  user: UserProfile;
  accessToken?: string;
  onLogout: () => void;
  onNavigateToProfile?: () => void;
  onNavigateToNotifications?: () => void;
  notificationCount?: number;
  onNavigateToLiveGps?: (dispatchId?: string, objectEntryId?: number | string) => void;
  onNavigateToPod?: () => void;
  onNavigateToMyTrip?: (dispatchId?: string) => void;
  onNavigateToTripHistory?: () => void;
}

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
  const [data, setData] = useState<DriverDashboardData | null>(
    () => queryClient.getQueryData<DriverDashboardData>(qk.dashboard(user.id)) ?? null,
  );
  const [activeTab, setActiveTab] = useState<DriverBottomTabKey>('dashboard');

  const applyServerDispatches = useCallback((items: DispatchItem[], full?: DriverDashboardData) => {
    setData((prev) => (prev ? { ...prev, dispatches: items } : full ? { ...full, dispatches: items } : prev));
  }, []);

  const allDispatches = useMemo(() => data?.dispatches ?? [], [data?.dispatches]);

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

  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  const dashboardQuery = useQuery({
    queryKey: qk.dashboard(user.id),
    queryFn: () => driverDashboardService.fetchDashboard(String(user.id), accessTokenRef.current),
    staleTime: DISPATCH_LIST_STALE_MS,
    // Foreground only (React Query pauses it while the app is in the background).
    refetchInterval: DISPATCH_POLL_MS,
    refetchOnMount: 'always',
    retry: 1,
  });
  const { refetch: refetchDashboard } = dashboardQuery;

  useEffect(() => onJourneyChanged(() => {
    refetchDashboard().catch(() => { });
  }), [refetchDashboard]);

  // Push while the dashboard is open (e.g. "new dispatch assigned"): reload the list now.
  useEffect(() => onPushReceived(() => {
    refetchDashboard().catch(() => { });
  }), [refetchDashboard]);

  const lastAutoReloadRef = useRef(0);
  useEffect(() => {
    const activeKey = qk.active(user.id);
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      const key = event.query.queryKey;
      if (key[0] !== activeKey[0] || key[1] !== activeKey[1]) return;

      const active = event.query.state.data as DispatchItem | undefined;
      const list = queryClient.getQueryData<DriverDashboardData>(qk.dashboard(user.id))?.dispatches;
      if (!active?.dispatchID || !list) return;

      const inList = list.find((d) => d.dispatchID === active.dispatchID);
      if (inList && inList.statusDispatch === active.statusDispatch) return;

      const now = Date.now();
      if (now - lastAutoReloadRef.current < AUTO_RELOAD_MIN_GAP_MS) return;
      lastAutoReloadRef.current = now;
      refetchDashboard().catch(() => { });
    });
  }, [user.id, refetchDashboard]);

  useEffect(() => {
    if (dashboardQuery.data) applyServerDispatches(dashboardQuery.data.dispatches ?? [], dashboardQuery.data);
  }, [dashboardQuery.data, dashboardQuery.dataUpdatedAt, applyServerDispatches]);

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Always a new request (cancels a poll that may have started before the admin's change).
      await refetchDashboard({ cancelRefetch: true });
    } catch (err) {
      console.warn('[DriverDashboardScreen] pull-to-refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  }, [refetchDashboard]);

  const handleJourneyStarted = useCallback((dispatchId: string) => {
    arrivalConfirmationService.markInTransit(dispatchId);
    refetchDashboard().catch(() => { });
  }, [refetchDashboard]);

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
      onNavigateToLiveGps?.(targetId, targetEntryId);
    },
    [allDispatches, firstInTransitId, onNavigateToLiveGps]
  );

  const handleTabPress = useCallback(
    (tab: DriverBottomTabKey) => {
      setActiveTab(tab);
      if (tab === 'dashboard') return;
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

  // RENDER: Active Dispatch Card
  const renderActiveDispatchCard = (dispatch: DispatchItem) => {
    const badge =
      (dispatch.statusDispatch !== undefined ? STATUS_BADGE_COLORS[dispatch.statusDispatch] : undefined) ??
      DEFAULT_STATUS_BADGE;
    const statusText =
      dispatch.statusDispatch !== undefined
        ? getDispatchStatusLabel(dispatch.statusDispatch)
        : dispatch.statusLabel || 'Dispatched';

    const cargoSubtext = [
      dispatch.productName || 'AWS Anganwadi Product',
      dispatch.vehicleNumber || 'KL 01 MH 0001',
      dispatch.quantity ? `${dispatch.quantity} Units` : '20 Units',
    ].filter(Boolean).join(' • ');

    return (
      <View key={dispatch.dispatchID} style={styles.activeCard}>
        <CardArtworkBackground uniqueId={`active_${dispatch.dispatchID}`} height={165} />

        {/* Top Header Row */}
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardDispatchId}>{dispatch.dispatchID || 'DSP-400002'}</Text>
          <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.statusBadgeText, { color: badge.text }]}>{statusText}</Text>
          </View>
        </View>

        {/* Route Timeline */}
        <View style={styles.timelineContainer}>
          <View style={styles.timelineIndicators}>
            <View style={[styles.timelineDot, styles.timelineDotBlue]} />
            <View style={styles.timelineLine} />
            <View style={[styles.timelineDot, styles.timelineDotGreen]} />
          </View>

          <View style={styles.timelineContent}>
            <View style={styles.timelineLeg}>
              <Text style={styles.legLabel}>FROM (PLANT)</Text>
              <Text style={styles.legTitle}>{dispatch.plantName || 'PG'}</Text>
              <Text style={styles.legSub}>{dispatch.plantName ? `${dispatch.plantName} Plant, Coimbatore` : 'PG Plant, Coimbatore'}</Text>
            </View>

            <View style={[styles.timelineLeg, { marginTop: 10 }]}>
              <Text style={styles.legLabel}>TO (SITE)</Text>
              <Text style={styles.legTitle}>{dispatch.siteName || dispatch.destinationSiteAWC || 'EC Location'}</Text>
              <Text style={styles.legSub}>{dispatch.destinationSiteAWC || 'EC Location, Tamil Nadu'}</Text>
            </View>
          </View>
        </View>

        {/* 3-Column Stats Box */}
        <View style={styles.statsBox}>
          {/* Col 1: Distance */}
          <View style={styles.statCol}>
            <View style={styles.statIconCircleBlue}>
              <Ionicons name="location-outline" size={17} color="#0B5FA8" />
            </View>
            <View style={styles.statTextWrap}>
              <Text style={styles.statValue}>
                {dispatch.distancekm ? `${dispatch.distancekm} KM` : '0.7 KM'}
              </Text>
              <Text style={styles.statLabel}>Distance</Text>
            </View>
          </View>

          <View style={styles.statDivider} />

          {/* Col 2: Quantity */}
          <View style={styles.statCol}>
            <View style={styles.statIconCircleGray}>
              <Ionicons name="cube-outline" size={17} color="#475569" />
            </View>
            <View style={styles.statTextWrap}>
              <Text style={styles.statValue}>{dispatch.quantity || '500'}</Text>
              <Text style={styles.statLabel}>Quantity</Text>
            </View>
          </View>

          <View style={styles.statDivider} />

          {/* Col 3: Material */}
          <View style={styles.statCol}>
            <View style={styles.statIconCircleGray}>
              <MaterialCommunityIcons name="layers-outline" size={17} color="#475569" />
            </View>
            <View style={styles.statTextWrap}>
              <Text style={styles.statValue} numberOfLines={1}>
                {dispatch.elementMaterial || 'TMT Steel'}
              </Text>
              <Text style={styles.statLabel}>Material</Text>
            </View>
          </View>
        </View>

        {/* Cargo subtext */}
        <Text style={styles.cargoSubtext} numberOfLines={1}>
          {cargoSubtext}
        </Text>

        {/* Side-by-side action buttons */}
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

  // RENDER: Completed Dispatch Card (Coverflow Carousel item)
  const renderCompletedDispatchCard = (dispatch: DispatchItem) => {
    const cargoSubtext = [
      dispatch.productName || 'Anganwadi Modular Units 2026',
      dispatch.vehicleNumber || 'TN...',
    ].filter(Boolean).join(' • ');

    return (
      <View key={dispatch.dispatchID} style={styles.completedCard}>
        <CardArtworkBackground uniqueId={`comp_${dispatch.dispatchID}`} height={150} />

        {/* Header */}
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardDispatchId}>{dispatch.dispatchID || 'DSP-400001'}</Text>
          <View style={[styles.statusBadge, { backgroundColor: '#EAF7EE' }]}>
            <Text style={[styles.statusBadgeText, { color: '#16A34A' }]}>Arrived</Text>
          </View>
        </View>

        {/* Route Timeline */}
        <View style={[styles.timelineContainer, { marginBottom: 8 }]}>
          <View style={styles.timelineIndicators}>
            <View style={[styles.timelineDot, styles.timelineDotBlue]} />
            <View style={[styles.timelineLine, { height: 18 }]} />
            <View style={[styles.timelineDot, styles.timelineDotGreen]} />
          </View>

          <View style={styles.timelineContent}>
            <View style={styles.timelineLeg}>
              <Text style={styles.legLabel}>FROM (PLANT)</Text>
              <Text style={styles.legTitle}>{dispatch.plantName || 'EC Location'}</Text>
            </View>

            <View style={[styles.timelineLeg, { marginTop: 4 }]}>
              <Text style={styles.legLabel}>TO (SITE)</Text>
              <Text style={styles.legTitle}>
                {dispatch.siteName || dispatch.destinationSiteAWC || 'PG Loc'}
              </Text>
            </View>
          </View>
        </View>

        {/* Mini Stats + Arrived Badge Row */}
        <View style={styles.completedBottomRow}>
          {/* Mini stats stack */}
          <View style={styles.completedMiniStats}>
            <View style={styles.completedMiniRow}>
              <View style={styles.miniIconCircle}>
                <Ionicons name="location-outline" size={13} color="#0B5FA8" />
              </View>
              <Text style={styles.miniStatValue}>{dispatch.distancekm ? `${dispatch.distancekm} KM` : '0.8 KM'}</Text>
              <Text style={styles.miniStatLabel}>Distance</Text>
            </View>

            <View style={styles.completedMiniRow}>
              <View style={styles.miniIconCircle}>
                <Ionicons name="cube-outline" size={13} color="#475569" />
              </View>
              <Text style={styles.miniStatValue}>{dispatch.quantity ? `${dispatch.quantity} Kg` : '250 Kg'}</Text>
              <Text style={styles.miniStatLabel}>Quantity</Text>
            </View>

            <View style={styles.completedMiniRow}>
              <View style={styles.miniIconCircle}>
                <MaterialCommunityIcons name="layers-outline" size={13} color="#475569" />
              </View>
              <Text style={styles.miniStatValue}>{dispatch.elementMaterial || 'TMT Steel'}</Text>
              <Text style={styles.miniStatLabel}>Material</Text>
            </View>
          </View>

          {/* Arrived confirmation badge box */}
          <View style={styles.arrivedBadgeBox}>
            <Ionicons name="checkmark-circle" size={24} color="#16A34A" />
            <Text style={styles.arrivedBadgeText}>
              Journey Completed •{'\n'}Arrived at Site
            </Text>
          </View>
        </View>

        {/* Subtext */}
        <Text style={styles.completedCargoSubtext} numberOfLines={1}>
          {cargoSubtext}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={['#0B5FA8']} />}
      >
        {/* HEADER */}
        <AppHeader
          variant="curved"
          notificationCount={notificationCount ?? data?.notificationCount ?? 1}
          notificationBadgeColor="#0B5FA8"
          onNotificationPress={handleNotificationsPress}
          avatarIcon="person"
          avatarIconColor="#D97706"
          avatarBackgroundColor="#FEF3D6"
          onAvatarPress={handleAvatarPress}
        />

        {/* CONTENT */}
        <View style={styles.content}>
          {/* Driver Info Card */}
          <View style={styles.driverCard}>
            <View style={styles.driverAvatar}>
              <Text style={styles.driverAvatarText}>
                {data?.driver.avatarInitials && data.driver.avatarInitials !== '—'
                  ? data.driver.avatarInitials
                  : 'D2'}
              </Text>
            </View>

            <View style={styles.driverInfo}>
              <Text style={styles.driverName}>
                {user.fullName || data?.driver.name || 'Driver 2'}
              </Text>
              <View style={styles.vehicleRow}>
                <MaterialCommunityIcons name="truck-outline" size={16} color="#0B5FA8" style={{ marginRight: 6 }} />
                <Text style={styles.driverMeta} numberOfLines={1}>
                  {data?.driver.vehicleNumber || 'TN 89 MN 9878'}
                </Text>
              </View>
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

          {/* ── SECTION 1: ACTIVE DISPATCH ── */}
          <View style={styles.sectionHeaderRow}>
            <View style={styles.headingBadgeRow}>
              <Ionicons name="radio-button-on" size={16} color="#0B5FA8" style={{ marginRight: 8 }} />
              <Text style={styles.sectionHeading}>Active Dispatch</Text>
            </View>
            <View style={styles.countBadgeActive}>
              <Text style={styles.countBadgeActiveText}>
                {activeDispatches.length > 0 ? `${activeDispatches.length} Active` : '1 Active'}
              </Text>
            </View>
          </View>

          {activeDispatches.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.noTripText}>
                {dashboardQuery.isError && !data
                  ? 'Could not load dispatches. Pull down to retry.'
                  : 'No active dispatches currently in transit.'}
              </Text>
            </View>
          ) : (
            activeDispatches.map(renderActiveDispatchCard)
          )}

          {/* ── SECTION 2: COMPLETED DISPATCHES ── */}
          <View style={[styles.sectionHeaderRow, { marginTop: spacing.lg }]}>
            <View style={styles.headingBadgeRow}>
              <Ionicons name="checkmark-circle" size={18} color="#16A34A" style={{ marginRight: 8 }} />
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
                  {completedDispatches.length > 0 ? `${completedDispatches.length} Completed →` : '1 Completed →'}
                </Text>
              </View>
            </Pressable>
          </View>

          {completedDispatches.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.noTripText}>No completed dispatches found.</Text>
            </View>
          ) : (
            <CoverflowCarousel
              items={completedDispatches}
              renderItem={renderCompletedDispatchCard}
            />
          )}

          {/* ── SECTION 3: DRIVER WORKFLOWS ── */}
          <View style={[styles.sectionHeaderRow, { marginTop: spacing.md }]}>
            <Text style={styles.sectionHeading}>Driver Workflows</Text>
          </View>

          <View style={styles.workflowRow}>
            {/* Workflow 1: Trip History */}
            <Pressable
              onPress={() => onNavigateToTripHistory?.()}
              style={({ pressed }) => [styles.workflowCard, pressed && styles.workflowCardPressed]}
            >
              <View style={styles.workflowCardLeft}>
                <View style={styles.workflowIconCircle}>
                  <Ionicons name="time-outline" size={22} color="#0B5FA8" />
                </View>
                <View style={styles.workflowTextGroup}>
                  <Text style={styles.workflowTitle}>Trip History</Text>
                  <Text style={styles.workflowSubtitle}>42 Completed Runs</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </Pressable>

            {/* Workflow 2: Proof of Delivery */}
            <Pressable
              onPress={() => onNavigateToPod?.()}
              style={({ pressed }) => [styles.workflowCard, pressed && styles.workflowCardPressed]}
            >
              <View style={styles.workflowCardLeft}>
                <View style={styles.workflowIconCircle}>
                  <MaterialCommunityIcons name="file-document-outline" size={22} color="#0B5FA8" />
                </View>
                <View style={styles.workflowTextGroup}>
                  <Text style={styles.workflowTitle}>Proof of Delivery</Text>
                  <Text style={styles.workflowSubtitle}>e-POD Sign Off</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
            </Pressable>
          </View>

          {/* Spacer */}
          <View style={styles.bottomSpacer} />
        </View>
      </ScrollView>

      {/* FIXED BOTTOM TAB BAR */}
      <DriverBottomTabBar activeTab={activeTab} onTabPress={handleTabPress} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: spacing.sm,
  },
  content: {
    paddingHorizontal: spacing.md,
    // Header artwork ends with the truck: the first card starts right below it, no overlap.
    marginTop: spacing.xxs,
  },

  // Driver Profile Card
  driverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  driverAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#EBF3FB',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  driverAvatarText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0B5FA8',
  },
  driverInfo: {
    flex: 1,
  },
  driverName: {
    fontSize: 16.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  driverMeta: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  dutyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EAF7EE',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  dutyPillOff: {
    backgroundColor: '#F1F5F9',
  },
  dutyDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16A34A',
    marginRight: 6,
  },
  dutyDotOff: {
    backgroundColor: '#94A3B8',
  },
  dutyText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#16A34A',
    letterSpacing: 0.4,
  },
  dutyTextOff: {
    color: '#64748B',
  },

  // Section Headers
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
    fontSize: 16.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  countBadgeActive: {
    backgroundColor: '#EBF4FC',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  countBadgeActiveText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0B5FA8',
  },
  countBadgeCompleted: {
    backgroundColor: '#EAF7EE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  countBadgeCompletedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#16A34A',
  },

  // Active Dispatch Card
  activeCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    position: 'relative',
  },
  cardArtworkContainer: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '68%',
    overflow: 'hidden',
  },
  cardArtworkImage: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 290,
    height: '100%',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardDispatchId: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  statusBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Route Timeline
  timelineContainer: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  timelineIndicators: {
    alignItems: 'center',
    marginRight: 10,
    paddingVertical: 4,
    width: 12,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  timelineDotBlue: {
    backgroundColor: '#0B5FA8',
  },
  timelineDotGreen: {
    backgroundColor: '#16A34A',
  },
  timelineLine: {
    width: 2,
    height: 28,
    backgroundColor: '#CBD5E1',
    marginVertical: 3,
  },
  timelineContent: {
    flex: 1,
  },
  timelineLeg: {},
  legLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.4,
  },
  legTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 1,
  },
  legSub: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 1,
  },

  // Stats Box (Active Dispatch)
  statsBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginTop: 6,
  },
  statCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statIconCircleBlue: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  statIconCircleGray: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  statTextWrap: {},
  statValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  statLabel: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 1,
  },
  statDivider: {
    width: 1,
    height: 26,
    backgroundColor: '#E2E8F0',
  },
  cargoSubtext: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    marginVertical: 12,
  },

  // Completed Dispatch Card
  completedCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    position: 'relative',
  },
  completedBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  completedMiniStats: {
    flex: 1,
    gap: 4,
  },
  completedMiniRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  miniIconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  miniStatValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
    marginRight: 4,
  },
  miniStatLabel: {
    fontSize: 10.5,
    color: '#64748B',
  },
  arrivedBadgeBox: {
    backgroundColor: '#EAF7EE',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DCFCE7',
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  arrivedBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#16A34A',
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 14,
  },
  completedCargoSubtext: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 10,
  },

  // Coverflow Carousel
  coverflowWrap: {
    marginHorizontal: -spacing.md,
    marginBottom: spacing.xs,
  },
  carouselInner: {
    position: 'relative',
  },
  coverflowNavBtn: {
    position: 'absolute',
    top: '46%',
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.12,
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
    marginTop: 8,
  },
  coverflowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#CBD5E1',
  },
  coverflowDotActive: {
    width: 20,
    backgroundColor: '#0B5FA8',
  },

  // Driver Workflows
  workflowRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  workflowCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  workflowCardPressed: {
    backgroundColor: '#F8FAFC',
    transform: [{ scale: 0.98 }],
  },
  workflowCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  workflowIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EBF3FB',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  workflowTextGroup: {
    flex: 1,
  },
  workflowTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  workflowSubtitle: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 2,
  },

  emptyCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  noTripText: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    paddingVertical: spacing.md,
  },
  bottomSpacer: {
    height: spacing.xl,
  },
});