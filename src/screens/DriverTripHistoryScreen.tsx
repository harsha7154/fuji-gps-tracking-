import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../components/AppHeader';
import { TripTitleBar } from '../components/trip/TripTitleBar';
import { TripFilterTabs } from '../components/history/TripFilterTabs';
import { TripHistoryCard } from '../components/history/TripHistoryCard';
import {
  DriverBottomTabBar,
  DriverBottomTabKey,
} from '../components/DriverBottomTabBar';
import { driverDashboardService } from '../services/driverDashboardService';
import { getAuthSession } from '../services/sessionStorage';
import { peekQuery, qk } from '../query/queryClient';
import { mapDispatchesToTripHistory } from '../utils/tripHistoryMapper';
import type {
  TripHistoryFilter,
  TripHistoryItem,
  TripHistorySummary,
} from '../types/tripHistory';
import type { UserProfile } from '../types/auth';
import type { DriverDashboardData } from '../types/driverDashboard';

export interface DriverTripHistoryScreenProps {
  /** Optional pre-loaded summary data (e.g. for testing) */
  initialData?: TripHistorySummary;

  /** Authenticated user profile */
  user?: UserProfile;

  /** Authenticated driver user ID */
  userId?: string;

  /** OAuth2 bearer access token */
  accessToken?: string;

  /** Unread notification count */
  notificationCount?: number;

  /** Navigation callbacks */
  onBack?: () => void;
  onNavigateToDashboard?: () => void;
  onNavigateToMyTrip?: (dispatchId?: string) => void;
  onNavigateToLiveGps?: (dispatchId?: string) => void;
  onNavigateToProfile?: () => void;
  onNavigateToNotifications?: () => void;
  onNavigateToTripDetails?: (tripId: string) => void;
  onDownloadReceiptPdf?: (trip: TripHistoryItem) => void;
}

function extractInitials(name?: string): string {
  if (!name || name.trim() === '') return 'GS';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'GS';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * "Trip History & Logs" Screen for Truck Drivers.
 *
 * 100% Dynamic Screen integrated with real Liferay Dispatches API:
 *   GET {baseURL}/o/material-dispatch-rest/dispatches?userId={driverUserId}&page=1&pageSize=10
 *
 * Preserves the exact mobile UI design:
 * 1. AppHeader with Fuji logo, vehicle status pill, notification bell & avatar
 * 2. TripTitleBar with "<" back button, title, subtitle & LOGISTICS badge
 * 3. Filter tabs: All Trips (N) / Delivered (N) / In Transit (N)
 * 4. Vertically scrollable list of TripHistoryCards
 * 5. Fixed DriverBottomTabBar with "History" active
 */
export const DriverTripHistoryScreen: React.FC<DriverTripHistoryScreenProps> = ({
  initialData,
  user,
  userId,
  accessToken,
  notificationCount = 2,
  onBack,
  onNavigateToDashboard,
  onNavigateToMyTrip,
  onNavigateToLiveGps,
  onNavigateToProfile,
  onNavigateToNotifications,
  onNavigateToTripDetails,
  onDownloadReceiptPdf,
}) => {
  // Instant paint from the cache when this screen was loaded a moment ago; refreshed behind it.
  const seedSummary = useRef<TripHistorySummary | null | undefined>(undefined);
  if (seedSummary.current === undefined) {
    const seedUserId = userId || user?.id;
    // Same shared dispatch list as Dashboard / Profile (one request, one copy).
    const cachedDashboard =
      !initialData && seedUserId ? peekQuery<DriverDashboardData>(qk.dashboard(seedUserId)) : undefined;
    seedSummary.current = cachedDashboard
      ? mapDispatchesToTripHistory(cachedDashboard.dispatches, cachedDashboard.dispatches.length)
      : null;
  }
  const [historyData, setHistoryData] = useState<TripHistorySummary | null>(
    initialData ?? seedSummary.current ?? null
  );
  const historyDataRef = useRef<TripHistorySummary | null>(historyData);
  historyDataRef.current = historyData;

  const [activeFilter, setActiveFilter] = useState<TripHistoryFilter>('ALL');
  const [loading, setLoading] = useState<boolean>(!(initialData || seedSummary.current));
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEmpty, setIsEmpty] = useState<boolean>(false);

  const isFetchingRef = useRef(false);
  const hasFetchedRef = useRef(false);

  // Load trip history from the real dispatches API
  const loadTripHistory = useCallback(
    async (isPullToRefresh = false) => {
      if (isFetchingRef.current) {
        return;
      }
      isFetchingRef.current = true;

      if (isPullToRefresh) {
        setRefreshing(true);
      } else if (!historyDataRef.current) {
        setLoading(true);
      }
      setErrorMessage(null);

      try {
        // 1. Resolve effective authenticated driver user ID and access token
        let effectiveUserId = userId || user?.id;
        let effectiveToken = accessToken;

        if (!effectiveUserId || !effectiveToken) {
          const session = await getAuthSession();
          if (session) {
            effectiveUserId = effectiveUserId || session.user.id;
            effectiveToken = effectiveToken || session.accessToken;
          }
        }

        if (!effectiveUserId) {
          throw new Error('No authenticated driver session found.');
        }

        // 2. Shared dispatch list (same cache as Dashboard / Profile): reused if < 20 s old,
        //    pull-to-refresh (maxAge 0) always asks the server. Shows ALL trips, not just 10.
        const uid: string = effectiveUserId;
        const tok = effectiveToken;
        const startedAt = Date.now();
        const dispatches = await driverDashboardService.getDispatches(uid, tok, isPullToRefresh ? 0 : 20_000);
        const summary = mapDispatchesToTripHistory(dispatches, dispatches.length);
        console.log(`[HISTORY] ${dispatches.length} trip(s) loaded + mapped in ${Date.now() - startedAt}ms`);

        if (!summary || summary.trips.length === 0) {
          setIsEmpty(true);
          setHistoryData({
            allCount: 0,
            deliveredCount: 0,
            inTransitCount: 0,
            trips: [],
          });
          return;
        }

        setIsEmpty(false);
        setHistoryData(summary);
      } catch (err: any) {
        if (__DEV__) {
          console.warn('[DriverTripHistoryScreen] API error:', err);
        }
        setErrorMessage(
          err?.message || 'Failed to load trip history from server. Please try again.'
        );
      } finally {
        isFetchingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userId, user?.id, accessToken]
  );

  useEffect(() => {
    if (initialData || hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    loadTripHistory(false);
  }, [initialData, loadTripHistory]);

  // Filter trips based on selected filter pill
  const filteredTrips = useMemo(() => {
    if (!historyData) return [];
    let result = historyData.trips;
    if (activeFilter === 'DELIVERED') {
      result = historyData.trips.filter((t) => t.status === 'DELIVERED');
    } else if (activeFilter === 'IN_TRANSIT') {
      result = historyData.trips.filter((t) => t.status === 'IN TRANSIT');
    }
    return result;
  }, [historyData, activeFilter]);

  // Handle bottom navigation tabs
  const handleTabPress = useCallback(
    (tab: DriverBottomTabKey) => {
      switch (tab) {
        case 'dashboard':
          onNavigateToDashboard?.() ?? onBack?.();
          break;
        case 'myTrip':
          onNavigateToMyTrip?.();
          break;
        case 'liveGps':
          onNavigateToLiveGps?.();
          break;
        case 'history':
          // Already on Trip History screen
          break;
        case 'profile':
          onNavigateToProfile?.();
          break;
      }
    },
    [onNavigateToDashboard, onBack, onNavigateToMyTrip, onNavigateToLiveGps, onNavigateToProfile]
  );

  const handleViewDetails = useCallback(
    (trip: TripHistoryItem) => {
      const targetId = trip.dispatchId ?? trip.id;
      if (onNavigateToTripDetails) {
        onNavigateToTripDetails(targetId);
      } else if (onNavigateToMyTrip) {
        onNavigateToMyTrip(targetId);
      } else {
        Alert.alert('Trip Details', `Viewing manifest for ${trip.tripIdFormatted}`);
      }
    },
    [onNavigateToTripDetails, onNavigateToMyTrip]
  );

  const handleReceiptPdf = useCallback(
    (trip: TripHistoryItem) => {
      if (onDownloadReceiptPdf) {
        onDownloadReceiptPdf(trip);
      } else {
        Alert.alert(
          'Receipt PDF',
          `Downloading official handover receipt PDF for ${trip.tripIdFormatted}.\nSite: ${trip.destination}`
        );
      }
    },
    [onDownloadReceiptPdf]
  );

  const vehiclePlate = user?.vehicleNumber || 'MH-31-CB-8842';
  const avatarInitials = extractInitials(user?.fullName);

  return (
    <View style={styles.root}>
      {/* SCROLLABLE MAIN CONTENT */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadTripHistory(true)}
            colors={['#0066B3']}
            tintColor="#0066B3"
          />
        }
      >
        {/* 1. APP HEADER */}
        <AppHeader
          logoWidth={105}
          notificationCount={notificationCount}
          notificationBadgeColor="#EF4444"
          onNotificationPress={onNavigateToNotifications}
          avatarLabel={avatarInitials}
          avatarBackgroundColor="#FFEDD5"
          avatarIconColor="#9A3412"
          onAvatarPress={onNavigateToProfile}
        />

        {/* 2. PAGE TITLE SECTION */}
        <TripTitleBar
          title="Trip History & Logs"
          subtitle="Completed Logistics Runs"
          categoryBadge="LOGISTICS"
          onBack={onBack ?? onNavigateToDashboard}
        />

        {/* 3. FILTER TABS */}
        <TripFilterTabs
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          allCount={historyData?.allCount ?? 0}
          deliveredCount={historyData?.deliveredCount ?? 0}
          inTransitCount={historyData?.inTransitCount ?? 0}
        />

        {/* 4. CONTENT / STATUS STATES */}
        {loading && !historyData ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color="#0066B3" />
            <Text style={styles.loadingText}>Loading trip history...</Text>
          </View>
        ) : errorMessage && !historyData ? (
          <View style={styles.stateCard}>
            <Ionicons name="alert-circle-outline" size={38} color="#EF4444" />
            <Text style={styles.stateTitle}>Unable to Load Trips</Text>
            <Text style={styles.stateSubtitle}>{errorMessage}</Text>
            <Pressable
              style={styles.retryButton}
              onPress={() => loadTripHistory(false)}
              hitSlop={8}
            >
              <Ionicons name="refresh-outline" size={16} color="#FFFFFF" />
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : isEmpty || !historyData || historyData.trips.length === 0 ? (
          <View style={styles.stateCard}>
            <Ionicons name="document-text-outline" size={40} color="#94A3B8" />
            <Text style={styles.stateTitle}>No Trips Found</Text>
            <Text style={styles.stateSubtitle}>
              Dispatches assigned to your account will appear here.
            </Text>
          </View>
        ) : (
          <View style={styles.cardsContainer}>
            {filteredTrips.length === 0 ? (
              <View style={styles.emptyFilterCard}>
                <Text style={styles.emptyFilterText}>
                  No trips matching the selected filter.
                </Text>
              </View>
            ) : (
              filteredTrips.map((item) => (
                <TripHistoryCard
                  key={item.id}
                  item={item}
                  onViewDetails={handleViewDetails}
                  onReceiptPdf={handleReceiptPdf}
                />
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* 5. FIXED BOTTOM NAVIGATION */}
      <DriverBottomTabBar activeTab="history" onTabPress={handleTabPress} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F3F5F7',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 20,
  },
  platePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    shadowColor: '#000000',
    shadowOpacity: 0.03,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  plateDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16A34A',
    marginRight: 6,
  },
  plateText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
    letterSpacing: 0.2,
  },
  cardsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  centerBox: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  stateCard: {
    marginHorizontal: 16,
    marginTop: 20,
    padding: 24,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  stateTitle: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  stateSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  retryButton: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0066B3',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
    marginLeft: 6,
  },
  emptyFilterCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 8,
  },
  emptyFilterText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
});
