import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { TripSummaryCard } from '../components/trip/TripSummaryCard';
import { RouteTimeline } from '../components/trip/RouteTimeline';
import { CargoManifest } from '../components/trip/CargoManifest';
import { OperationalContacts } from '../components/trip/OperationalContacts';
import {
  DriverBottomTabBar,
  DriverBottomTabKey,
} from '../components/DriverBottomTabBar';
import { tripService } from '../services/tripService';
import { mapDispatchToTrip } from '../utils/tripMapper';
import { getAuthSession } from '../services/sessionStorage';
import { fetchCached, peekQuery, qk, refetchFresh } from '../query/queryClient';
import type { OperationalContact, TripDetailsData } from '../types/myTrip';
import type { UserProfile } from '../types/auth';
import type { DispatchItem } from '../types/driverDashboard';

export interface MyTripScreenProps {
  /** Optional pre-loaded trip data */
  initialTripData?: TripDetailsData;

  /** Authenticated user profile */
  user?: UserProfile;

  /** Authenticated driver user ID */
  userId?: string;

  /** OAuth2 bearer access token */
  accessToken?: string;

  /** Specific dispatch ID if selected from dashboard */
  selectedDispatchId?: string;

  /** Unread notification count; falls back to tripData.notificationCount */
  notificationCount?: number;

  /** Navigation callbacks */
  onBack?: () => void;
  onNavigateToDashboard?: () => void;
  onNavigateToLiveGps?: (dispatchId?: string) => void;
  onNavigateToPod?: () => void;
  onNavigateToProfile?: () => void;
  onNavigateToNotifications?: () => void;
  onNavigateToHistory?: () => void;
  onPreTripChecklist?: () => void;
}

/**
 * "My Trip" / "Trip Details & Manifest" Screen.
 *
 * 100% Dynamic Screen integrated with real Liferay APIs:
 *   1. GET {baseURL}/o/material-dispatch-rest/driver/active-dispatch?userId={driverUserId}
 *   2. GET {baseURL}/o/material-dispatch-rest/dispatch/{objectEntryId}?userId={driverUserId}
 *
 * Preserves the exact mobile UI design:
 * 1. AppHeader with Fuji logo, vehicle status pill, notification, avatar & brand curve
 * 2. TripTitleBar with Back button, title, subtitle & LOGISTICS badge
 * 3. TripSummaryCard with E-Way Bill, Vehicle & Dispatch Bay details
 * 4. RouteTimeline vertical timeline
 * 5. CargoManifest table & truck weight specs
 * 6. OperationalContacts with direct call triggers
 * 7. ActionButtons (Proceed to POD, Pre-Trip Checklist, Open Live GPS)
 * 8. Fixed Bottom Navigation with "My Trip" active
 */
export const MyTripScreen: React.FC<MyTripScreenProps> = ({
  initialTripData,
  user,
  userId,
  accessToken,
  selectedDispatchId,
  notificationCount,
  onBack,
  onNavigateToDashboard,
  onNavigateToLiveGps,
  onNavigateToPod,
  onNavigateToProfile,
  onNavigateToNotifications,
  onNavigateToHistory,
  onPreTripChecklist,
}) => {
  // Instant paint: a trip loaded a moment ago (tab away and back) is shown at once and refreshed behind it.
  const seedDispatch = useRef<DispatchItem | null | undefined>(undefined);
  if (seedDispatch.current === undefined) {
    const seedUserId = userId || user?.id;
    seedDispatch.current =
      (!initialTripData && seedUserId
        ? peekQuery<DispatchItem | null>(qk.trip(seedUserId, selectedDispatchId))
        : null) ?? null;
  }
  const [tripData, setTripData] = useState<TripDetailsData | null>(() =>
    initialTripData ??
    (seedDispatch.current
      ? mapDispatchToTrip(seedDispatch.current, seedDispatch.current.driverName || user?.fullName)
      : null)
  );
  const tripDataRef = useRef<TripDetailsData | null>(tripData);
  tripDataRef.current = tripData;

  const [currentDispatch, setCurrentDispatch] = useState<DispatchItem | null>(
    seedDispatch.current ?? null
  );
  const [loading, setLoading] = useState<boolean>(!(initialTripData || seedDispatch.current));
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEmpty, setIsEmpty] = useState<boolean>(false);

  // Load trip details from the real API
  const loadTripDetails = useCallback(
    async (isPullToRefresh = false) => {
      if (isPullToRefresh) {
        setRefreshing(true);
      } else if (!tripDataRef.current) {
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

        // 2. Call real APIs:
        //    active-dispatch -> dispatch details
        // Shared query cache: reused if younger than 15 s, one shared request otherwise; pull-to-refresh always asks the server.
        const uid: string = effectiveUserId;
        const tok = effectiveToken;
        const tripKey = qk.trip(uid, selectedDispatchId);
        const loadFull = () => tripService.getFullTripData(uid, selectedDispatchId, tok);
        const fullDispatch = isPullToRefresh
          ? await refetchFresh(tripKey, loadFull)
          : await fetchCached(tripKey, loadFull, 15_000);

        if (!fullDispatch) {
          setIsEmpty(true);
          setTripData(null);
          setCurrentDispatch(null);
          return;
        }

        setIsEmpty(false);
        setCurrentDispatch(fullDispatch);

        // 3. Map the chosen API dispatch to UI model
        const mappedTrip = mapDispatchToTrip(
          fullDispatch,
          fullDispatch.driverName || user?.fullName
        );

        setTripData(mappedTrip);
      } catch (err: any) {
        console.warn('[MyTripScreen] Failed to load trip details from API:', err);
        if (!tripDataRef.current) {
          setErrorMessage(
            err?.message === 'TIMEOUT'
              ? 'Request timed out. Please check your connection and retry.'
              : 'Unable to load trip details.'
          );
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [userId, user?.id, user?.fullName, accessToken, selectedDispatchId]
  );

  const hasLoadedRef = useRef(false);
  const lastDispatchIdRef = useRef<string | undefined>(selectedDispatchId);

  // Fetch data on mount or when driver/selected dispatch changes
  useEffect(() => {
    if (initialTripData) return;
    if (!hasLoadedRef.current || lastDispatchIdRef.current !== selectedDispatchId) {
      hasLoadedRef.current = true;
      lastDispatchIdRef.current = selectedDispatchId;
      loadTripDetails(false);
    }
  }, [selectedDispatchId, loadTripDetails, initialTripData]);

  // Handle bottom navigation tabs
  const handleTabPress = useCallback(
    (tab: DriverBottomTabKey) => {
      switch (tab) {
        case 'dashboard':
          onNavigateToDashboard?.() ?? onBack?.();
          break;
        case 'myTrip':
          // Already on My Trip screen
          break;
        case 'liveGps':
          onNavigateToLiveGps?.(currentDispatch?.dispatchID);
          break;
        case 'profile':
          onNavigateToProfile?.();
          break;
        case 'history':
          if (onNavigateToHistory) {
            onNavigateToHistory();
          } else {
            Alert.alert('Trip History', 'Trip history view is coming soon.');
          }
          break;
      }
    },
    [
      onNavigateToDashboard,
      onBack,
      onNavigateToLiveGps,
      onNavigateToProfile,
      onNavigateToHistory,
      currentDispatch?.dispatchID,
    ]
  );

  // Operational contact call button interaction
  const handleCallContact = useCallback((contact: OperationalContact) => {
    Alert.alert(
      'Operational Contact',
      `Calling ${contact.name}\n${contact.subtitle}`
    );
  }, []);

  const handlePreTripChecklist = useCallback(() => {
    if (onPreTripChecklist) {
      onPreTripChecklist();
    } else {
      Alert.alert(
        'Pre-Trip Checklist',
        'Pre-trip vehicle & cargo inspection checklist.'
      );
    }
  }, [onPreTripChecklist]);

  const activeNotificationCount =
    notificationCount !== undefined
      ? notificationCount
      : tripData?.notificationCount ?? 0;

  const vehiclePlate =
    tripData?.vehicleNumber || user?.vehicleNumber;

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
            onRefresh={() => loadTripDetails(true)}
            tintColor="#0066B3"
            colors={['#0066B3']}
          />
        }
      >
        {/* 1. EXISTING APP HEADER */}
        <AppHeader
          variant="photo"
          logoWidth={130}
          backLabel="Back to Dashboard"
          onBack={onBack ?? onNavigateToDashboard}
          notificationCount={activeNotificationCount}
          notificationBadgeColor="#0B5FA8"
          onNotificationPress={onNavigateToNotifications}
          avatarIcon="person"
          avatarBackgroundColor="#FEF3D6"
          avatarIconColor="#D97706"
          onAvatarPress={onNavigateToProfile}
        />

        {/* 2. PAGE TITLE SECTION */}
        <TripTitleBar
          title="Trip Details & Manifest"
          tripId={tripData?.tripId}
          categoryBadge={tripData?.categoryBadge || 'LOGISTICS'}
        />

        {/* CONTENT STATES */}
        {loading && !tripData ? (
          /* 7. LOADING STATE */
          <View style={styles.stateCard}>
            <ActivityIndicator size="large" color="#0066B3" />
            <Text style={styles.stateTitle}>Loading trip details...</Text>
            <Text style={styles.stateSubtitle}>
              Fetching material dispatch manifest from server
            </Text>
          </View>
        ) : errorMessage && !tripData ? (
          /* 8. ERROR STATE */
          <View style={styles.stateCard}>
            <Ionicons name="alert-circle-outline" size={44} color="#DC2626" />
            <Text style={styles.stateTitle}>Unable to load trip details</Text>
            <Text style={styles.stateSubtitle}>{errorMessage}</Text>
            <Pressable
              style={styles.actionButton}
              onPress={() => loadTripDetails(false)}
            >
              <Text style={styles.actionButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : isEmpty && !tripData ? (
          /* 9. EMPTY STATE */
          <View style={styles.stateCard}>
            <Ionicons name="car-outline" size={44} color="#64748B" />
            <Text style={styles.stateTitle}>No active trips available</Text>
            <Text style={styles.stateSubtitle}>
              You currently have no dispatches assigned for transit.
            </Text>
            <Pressable
              style={styles.actionButton}
              onPress={() => loadTripDetails(false)}
            >
              <Text style={styles.actionButtonText}>Refresh</Text>
            </Pressable>
          </View>
        ) : tripData ? (
          /* DYNAMIC CARDS CONTAINER */
          <View style={styles.cardsContainer}>
            {/* 3. TRIP SUMMARY CARD */}
            <TripSummaryCard
              tripId={tripData.tripId}
              status={tripData.status}
              statusType={tripData.statusType}
              eWayBill={tripData.eWayBill}
              eWayBillValidTill={tripData.eWayBillValidTill}
              vehicleNumber={tripData.vehicleNumber}
              vehicleType={tripData.vehicleType}
              dispatchBay={tripData.dispatchBay}
            />

            {/* 4. ROUTE CORRIDORS & MILESTONES */}
            <RouteTimeline milestones={tripData.milestones} />

            {/* 5. CARGO MANIFEST */}
            <CargoManifest cargo={tripData.cargo} />

            {/* 6. OPERATIONAL CONTACTS */}
            <OperationalContacts
              contacts={tripData.contacts}
              onCallPress={handleCallContact}
            />

            {/* 7. ACTION BUTTONS */}
          </View>
        ) : null}
      </ScrollView>

      {/* 8. BOTTOM NAVIGATION (Fixed) */}
      <DriverBottomTabBar activeTab="myTrip" onTabPress={handleTabPress} />
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
    paddingTop: 16,
    paddingBottom: 24,
  },
  stateCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  stateTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#172033',
    marginTop: 12,
    textAlign: 'center',
  },
  stateSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 18,
  },
  actionButton: {
    marginTop: 16,
    backgroundColor: '#0066B3',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
