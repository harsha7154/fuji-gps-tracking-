import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppHeader, HERO_PAGE_BACKGROUND } from '../components/AppHeader';
import { DriverBottomTabBar, DriverBottomTabKey } from '../components/DriverBottomTabBar';
import { driverDashboardService } from '../services/driverDashboardService';
import { fetchCached, peekQuery, qk, refetchFresh } from '../query/queryClient';
import { liferayProfileService, LiferayProfile, ProfileContact } from '../services/liferayProfileService';
import type { TokenRefreshHandler } from '../services/notificationService';
import type { UserProfile } from '../types/auth';
import type { DispatchItem } from '../types/driverDashboard';
import { DISPATCH_STATUS } from '../utils/dispatchStatus';
import { colors, radius, spacing, typography } from '../theme';

interface DriverProfileScreenProps {
  user: UserProfile;
  /** Used to load the Liferay profile and the driver's dispatches. */
  accessToken?: string;
  refreshToken?: string;
  onTokenRefresh?: TokenRefreshHandler;
  onBack: () => void;
  onLogout: () => void;
  /** Opens the Settings screen (background notifications / background GPS). */
  onOpenSettings?: () => void;
  onNavigateToNotifications?: () => void;
  onNavigateToLiveGps?: () => void;
  onNavigateToMyTrip?: () => void;
  onNavigateToTripHistory?: () => void;
  notificationCount?: number;
}

type IconName = keyof typeof Ionicons.glyphMap;

// ───────────────────────────── helpers ─────────────────────────────

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatDate(value?: string, withTime = false): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/** "2026-09-29 15:42" (dispatch API) -> sortable number; unknown -> 0. */
function deliveryTime(d: DispatchItem): number {
  const t = Date.parse((d.deliveryDate ?? '').replace(' ', 'T'));
  return Number.isFinite(t) ? t : 0;
}

/** User ID as shown to the driver: "100" + Liferay userId (45123 -> "10045123"). */
function displayUserId(id?: string | number): string | undefined {
  const value = id === undefined || id === null ? '' : String(id).trim();
  return value ? `100${value}` : undefined;
}

function titleCase(text?: string): string | undefined {
  if (!text) return undefined;
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

interface TripStats {
  total: number;
  completed: number;
  active: number;
  inTransit?: DispatchItem;
  vehicleNumber?: string;
  vehicles: string[];
}

function buildStats(dispatches: DispatchItem[]): TripStats {
  const byNewest = [...dispatches].sort((a, b) => deliveryTime(b) - deliveryTime(a));
  const completed = dispatches.filter((d) => d.statusDispatch === DISPATCH_STATUS.ARRIVED);
  const vehicles = Array.from(
    new Set(byNewest.map((d) => d.vehicleNumber?.trim()).filter((v): v is string => !!v)),
  );

  return {
    total: dispatches.length,
    completed: completed.length,
    active: dispatches.length - completed.length,
    inTransit: byNewest.find((d) => d.statusDispatch === DISPATCH_STATUS.IN_TRANSIT),
    vehicleNumber: vehicles[0],
    vehicles,
  };
}

// ───────────────────────────── screen ─────────────────────────────

/**
 * Driver profile — everything shown comes from real data:
 *   - Liferay user account (login): name, email, username, job title, status,
 *     member since, last login, user id, photo
 *   - Dispatches API (GET /o/material-dispatch-rest/dispatches?userId=, shared cache):
 *     trip counts, assigned vehicle(s), current trip
 * Rows whose value the server doesn't provide are hidden instead of faked.
 */
export const DriverProfileScreen: React.FC<DriverProfileScreenProps> = ({
  user,
  accessToken,
  refreshToken,
  onTokenRefresh,
  onBack,
  onLogout,
  onOpenSettings,
  onNavigateToNotifications,
  onNavigateToLiveGps,
  onNavigateToMyTrip,
  onNavigateToTripHistory,
  notificationCount,
}) => {
  const [activeTab, setActiveTab] = useState<DriverBottomTabKey>('profile');
  const [dispatches, setDispatches] = useState<DispatchItem[] | null>(
    () => peekQuery<{ dispatches?: DispatchItem[] }>(qk.dashboard(user.id))?.dispatches ?? null,
  );
  const [statsError, setStatsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const { width } = useWindowDimensions();

  // Full Liferay profile (GET /o/headless-admin-user/v1.0/my-user-account).
  const [profile, setProfile] = useState<LiferayProfile | null>(
    () => peekQuery<LiferayProfile>(qk.profile(user.id)) ?? null,
  );
  const [profileLoading, setProfileLoading] = useState(() => !peekQuery(qk.profile(user.id)));
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadProfile = useCallback(
    async (force = false) => {
      if (!accessToken) {
        setProfileLoading(false);
        return;
      }
      setProfileError(null);
      try {
        const fetchProfile = () => liferayProfileService.getMyProfile(accessToken, refreshToken ?? '', onTokenRefresh);
        // Profile rarely changes: reused for 5 min; pull-to-refresh always asks the server.
        const result = force
          ? await refetchFresh(qk.profile(user.id), fetchProfile)
          : await fetchCached(qk.profile(user.id), fetchProfile, 5 * 60_000);
        setProfile(result);
      } catch (err) {
        console.warn('[DriverProfileScreen] could not load Liferay profile:', err);
        setProfileError('Profile details could not be loaded from Liferay.');
      } finally {
        setProfileLoading(false);
      }
    },
    // accessToken omitted on purpose: a silent token refresh must not reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user.id],
  );

  const loadDispatches = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      setStatsError(null);
      try {
        // Stats only: a list up to 60 s old is fine (shared with Dashboard / History); pull-to-refresh forces fresh.
        const items = await driverDashboardService.getDispatches(user.id, accessToken, isRefresh ? 0 : 60_000);
        setDispatches(items);
      } catch (err) {
        console.warn('[DriverProfileScreen] could not load dispatches:', err);
        setStatsError('Trip details could not be loaded.');
        setDispatches((prev) => prev ?? []);
      } finally {
        setRefreshing(false);
      }
    },
    // accessToken omitted on purpose: a silent token refresh must not reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user.id],
  );

  useEffect(() => {
    loadDispatches();
  }, [loadDispatches]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const refreshAll = useCallback(() => {
    loadProfile(true);
    loadDispatches(true);
  }, [loadProfile, loadDispatches]);

  const stats = useMemo(() => (dispatches ? buildStats(dispatches) : null), [dispatches]);

  const handleTabPress = useCallback(
    (tab: DriverBottomTabKey) => {
      if (tab === 'dashboard') {
        onBack();
        return;
      }
      if (tab === 'liveGps') {
        onNavigateToLiveGps?.();
        return;
      }
      if (tab === 'myTrip') {
        onNavigateToMyTrip?.();
        return;
      }
      if (tab === 'history') {
        onNavigateToTripHistory?.();
        return;
      }
      setActiveTab(tab);
    },
    [onBack, onNavigateToLiveGps, onNavigateToMyTrip, onNavigateToTripHistory],
  );

  // Liferay profile first; the login-time user only fills gaps while it loads.
  const displayName =
    profile?.displayName ||
    titleCase(user.fullName) ||
    [user.firstName, user.familyName].filter(Boolean).join(' ') ||
    user.email ||
    'Driver';
  const jobTitle = profile?.jobTitle || user.jobTitle;
  const accountStatus = profile?.status || user.status;
  const photoUrl = profile?.imageUrl || user.avatarUrl;
  const vehicleNumber = stats?.vehicleNumber || user.vehicleNumber;
  const isActiveAccount = !accountStatus || /^active$/i.test(accountStatus);
  const showPhoto = Boolean(photoUrl) && !photoFailed;

  const contactRows: InfoRowData[] = profile
    ? [
        { icon: 'mail-outline', label: 'Email', value: profile.email, link: profile.email && `mailto:${profile.email}` },
        ...profile.emails.map((c) => contactRow('mail-outline', c)),
        ...profile.phones.map((c) => contactRow(/mobile|cell/i.test(c.label) ? 'phone-portrait-outline' : 'call-outline', c)),
        ...profile.addresses.map((c) => contactRow('home-outline', c)),
        ...profile.websites.map((c) => contactRow('globe-outline', c)),
        ...profile.social.map((c) => contactRow('chatbubbles-outline', c)),
      ]
    : [];

  // Phone shown under the name: Liferay phone, else the login username when it is a phone number.
  const loginName = profile?.screenName || user.alternateName;
  const phoneNumber =
    profile?.phones[0]?.value || (loginName && /^\+?\d{8,15}$/.test(loginName) ? loginName : undefined);
  const otherVehicles = stats && stats.vehicles.length > 1 ? stats.vehicles.slice(1).join(', ') : undefined;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshAll}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
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
          onAvatarPress={() => {}}
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

          {/* ── Identity ── */}
          <View style={[styles.card, styles.identityCard]}>
            <View style={styles.avatarRing}>
              {showPhoto ? (
                <Image source={{ uri: photoUrl }} style={styles.avatarImage} onError={() => setPhotoFailed(true)} />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initialsOf(displayName)}</Text>
                </View>
              )}
            </View>

            <View style={styles.identityText}>
              <Text style={styles.name} numberOfLines={2}>
                {displayName}
              </Text>
              <Text style={styles.subtitle}>{jobTitle || 'Truck Driver'}</Text>
              {phoneNumber ? (
                <Pressable
                  onPress={() => openLink(`tel:${phoneNumber.replace(/[^\d+]/g, '')}`)}
                  hitSlop={6}
                  accessibilityRole="link"
                  style={styles.phoneRow}
                >
                  <Ionicons name="call-outline" size={15} color={colors.textSecondary} />
                  <Text style={styles.phoneText}>{phoneNumber}</Text>
                </Pressable>
              ) : null}

              <View style={styles.pillRow}>
                <View style={[styles.pill, isActiveAccount ? styles.pillGreen : styles.pillGrey]}>
                  <View style={[styles.pillDot, isActiveAccount ? styles.pillDotGreen : styles.pillDotGrey]} />
                  <Text style={[styles.pillText, isActiveAccount ? styles.pillTextGreen : styles.pillTextGrey]}>
                    {isActiveAccount ? 'Active' : titleCase(accountStatus)}
                  </Text>
                </View>
                {vehicleNumber ? (
                  <View style={[styles.pill, styles.pillBlue]}>
                    <Ionicons name="bus-outline" size={14} color={colors.primary} />
                    <Text style={[styles.pillText, styles.pillTextBlue]}>{vehicleNumber}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          {/* ── Trip stats (dispatches API) ── */}
          <View style={styles.statsRow}>
            <StatTile icon="bus" tone="blue" label="Total Trips" value={stats ? String(stats.total) : undefined} />
            <StatTile icon="checkmark" tone="green" label="Completed" value={stats ? String(stats.completed) : undefined} />
            <StatTile icon="navigate-outline" tone="orange" label="Active" value={stats ? String(stats.active) : undefined} />
          </View>

          {statsError ? (
            <Pressable onPress={() => loadDispatches()} style={styles.errorBanner}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.error} />
              <Text style={styles.errorBannerText}>{statsError} Tap to retry.</Text>
            </Pressable>
          ) : null}

          {/* ── Current trip ── */}
          {stats?.inTransit ? (
            <Pressable
              onPress={onNavigateToLiveGps}
              style={({ pressed }) => [styles.currentTrip, pressed && styles.pressed]}
            >
              <View style={styles.currentTripIcon}>
                <Ionicons name="navigate" size={18} color={colors.white} />
              </View>
              <View style={styles.flex1}>
                <Text style={styles.currentTripLabel}>ON TRIP NOW</Text>
                <Text style={styles.currentTripTitle} numberOfLines={1}>
                  {stats.inTransit.dispatchID} → {stats.inTransit.siteName || stats.inTransit.destinationSiteAWC}
                </Text>
                <Text style={styles.currentTripMeta} numberOfLines={1}>
                  {[stats.inTransit.elementMaterial, stats.inTransit.quantity && `Qty ${stats.inTransit.quantity}`]
                    .filter(Boolean)
                    .join(' • ')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.primary} />
            </Pressable>
          ) : null}

          {/* ── Vehicle ── */}
          {vehicleNumber || user.vehicleModel ? (
            <Section icon="bus-outline" title="Assigned Vehicle">
              <View style={styles.vehicleBody}>
                <View style={styles.vehicleImageBox}>
                  <Image source={VEHICLE_IMAGE} style={styles.vehicleImage} resizeMode="contain" />
                </View>
                <View style={styles.vehicleInfo}>
                  {vehicleNumber ? (
                    <VehicleLine icon="card-outline" label="Vehicle Number" value={vehicleNumber} />
                  ) : null}
                  {user.vehicleModel ? (
                    <VehicleLine icon="construct-outline" label="Model" value={user.vehicleModel} divider={!!vehicleNumber} />
                  ) : null}
                  {otherVehicles ? (
                    <VehicleLine icon="swap-horizontal" label="Other Vehicles Used" value={otherVehicles} divider />
                  ) : null}
                </View>
              </View>
            </Section>
          ) : null}

          {/* ── Liferay profile (my-user-account) ── */}
          {profileError ? (
            <Pressable onPress={() => { loadProfile(); }} style={styles.errorBanner}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.error} />
              <Text style={styles.errorBannerText}>{profileError} Tap to retry.</Text>
            </Pressable>
          ) : null}

          {profileLoading && !profile ? (
            <View style={styles.card}>
              <View style={styles.sectionLoading}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.loadingText}>Loading profile from Liferay…</Text>
              </View>
            </View>
          ) : null}

          {profile ? (
            <>
              <Section icon="person-outline" title="Personal Details">
                <View style={styles.personalBody}>
                  <View style={styles.flex1}>
                    <InfoRows
                      dividers={false}
                      rows={[
                        { icon: 'person-outline', label: 'First Name', value: profile.givenName },
                        { icon: 'person-outline', label: 'Last Name', value: profile.familyName },
                        { icon: 'calendar-outline', label: 'Date of Birth', value: formatDate(profile.birthDate) },
                        { icon: 'male-female-outline', label: 'Gender', value: profile.gender },
                        { icon: 'language-outline', label: 'Language', value: profile.language },
                      ]}
                    />
                  </View>
                  <View style={styles.personalPhotoWrap}>
                    <View style={styles.personalPhoto}>
                      {showPhoto ? (
                        <Image source={{ uri: photoUrl }} style={styles.personalPhotoImage} onError={() => setPhotoFailed(true)} />
                      ) : (
                        <Ionicons name="person" size={44} color="#C5CDD8" />
                      )}
                    </View>
                  </View>
                </View>
              </Section>

              <Section icon="call-outline" title="Contact">
                <InfoRows rows={contactRows} emptyText="No contact details in Liferay." />
              </Section>

              {profile.customFields.length > 0 ? (
                <Section icon="document-text-outline" title="Additional Details">
                  <InfoRows
                    rows={profile.customFields.map((f) => ({
                      icon: 'information-circle-outline' as IconName,
                      label: f.label,
                      value: f.value,
                    }))}
                  />
                </Section>
              ) : null}
            </>
          ) : null}

          {/* ── Account ── */}
          <Section icon="shield-checkmark-outline" title="Account">
            <InfoRows
              rows={[
                { icon: 'person-outline', label: 'Username', value: loginName },
                { icon: 'id-card-outline', label: 'User ID', value: displayUserId(profile?.id || user.id) },
                {
                  icon: 'checkmark-circle-outline',
                  label: 'Status',
                  value: titleCase(accountStatus),
                  badge: isActiveAccount ? 'green' : 'grey',
                },
                { icon: 'calendar-outline', label: 'Member since', value: formatDate(profile?.dateCreated || user.dateCreated) },
                { icon: 'create-outline', label: 'Profile updated', value: formatDate(profile?.dateModified, true) },
                { icon: 'log-in-outline', label: 'Last login', value: formatDate(profile?.lastLoginDate || user.lastLoginDate, true) },
                { icon: 'key-outline', label: 'Reference code', value: profile?.externalReferenceCode || user.externalReferenceCode },
              ]}
            />
          </Section>

          <View style={styles.actionRow}>
            {onOpenSettings ? (
              <Pressable
                onPress={onOpenSettings}
                accessibilityRole="button"
                accessibilityLabel="Settings"
                style={({ pressed }) => [styles.actionButton, styles.settingsButton, pressed && styles.pressed]}
              >
                <Ionicons name="settings-outline" size={20} color={colors.primary} />
                <Text style={styles.settingsText}>Settings</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onLogout}
              accessibilityRole="button"
              accessibilityLabel="Log out"
              style={({ pressed }) => [styles.actionButton, styles.logoutButton, pressed && styles.pressed]}
            >
              <Ionicons name="log-out-outline" size={20} color={colors.error} />
              <Text style={styles.logoutText}>Log out</Text>
            </Pressable>
          </View>

          <View style={styles.bottomSpacer} />
        </View>
      </ScrollView>

      <DriverBottomTabBar activeTab={activeTab} onTabPress={handleTabPress} />
    </View>
  );
};

// ───────────────────────────── pieces ─────────────────────────────

/** Truck picture of the "Assigned Vehicle" card (from the design). */
const VEHICLE_IMAGE = require('../../assets/images/profile-vehicle.png');
/** The identity card overlaps the header wave by this much (design px of the 887-wide artwork). */
const HERO_CARD_OVERLAP = 38;

const PAGE_TEXT = '#1B2333';

const TONES = {
  blue: { bg: '#E6F0FC', fg: '#1565D8' },
  green: { bg: '#E7F6EC', fg: '#23A04A' },
  orange: { bg: '#FFF2E3', fg: '#F57C1F' },
} as const;

const StatTile: React.FC<{
  icon: IconName;
  tone: keyof typeof TONES;
  label: string;
  value?: string;
}> = ({ icon, tone, label, value }) => (
  <View style={[styles.statTile, { backgroundColor: TONES[tone].bg }]}>
    <View style={[styles.statIcon, { backgroundColor: TONES[tone].fg }]}>
      <Ionicons name={icon} size={20} color={colors.white} />
    </View>
    <View style={styles.statText}>
      {value === undefined ? (
        <ActivityIndicator size="small" color={colors.neutralGray} style={styles.statLoading} />
      ) : (
        <Text style={styles.statValue}>{value}</Text>
      )}
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  </View>
);

const Section: React.FC<{ icon: IconName; title: string; children: React.ReactNode }> = ({
  icon,
  title,
  children,
}) => (
  <View style={styles.card}>
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={22} color={colors.primary} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
    {children}
  </View>
);

const VehicleLine: React.FC<{ icon: IconName; label: string; value: string; divider?: boolean }> = ({
  icon,
  label,
  value,
  divider,
}) => (
  <View style={[styles.vehicleLine, divider && styles.vehicleLineDivider]}>
    <View style={styles.vehicleLineIcon}>
      <Ionicons name={icon} size={16} color={colors.primary} />
    </View>
    <View style={styles.flex1}>
      <Text style={styles.vehicleLineLabel}>{label}</Text>
      <Text style={styles.vehicleLineValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  </View>
);

interface InfoRowData {
  icon: IconName;
  label: string;
  value?: string;
  /** tel: / mailto: / https: — the value becomes tappable. */
  link?: string;
  /** Shows a small "Primary" tag. */
  primary?: boolean;
  /** Shows the value as a coloured pill (Status). */
  badge?: 'green' | 'grey';
}

function contactRow(icon: IconName, c: ProfileContact): InfoRowData {
  return { icon, label: c.label, value: c.value, link: c.link, primary: c.primary };
}

function openLink(link: string) {
  Linking.openURL(link).catch((err) => console.warn('[DriverProfileScreen] cannot open', link, err));
}

/** Rows without a value from the server are left out (nothing is faked). */
const InfoRows: React.FC<{ rows: InfoRowData[]; emptyText?: string; dividers?: boolean }> = ({
  rows,
  emptyText,
  dividers = true,
}) => {
  const visible = rows.filter((r) => r.value !== undefined && String(r.value).trim() !== '');
  if (visible.length === 0) {
    return <Text style={styles.emptyText}>{emptyText ?? 'No details available.'}</Text>;
  }
  return (
    <>
      {visible.map((row, i) => {
        const value = row.badge ? (
          <View style={[styles.valueBadge, row.badge === 'green' ? styles.pillGreen : styles.pillGrey]}>
            <Text style={[styles.pillText, row.badge === 'green' ? styles.pillTextGreen : styles.pillTextGrey]}>
              {row.value}
            </Text>
          </View>
        ) : (
          <Text style={[styles.infoValue, row.link && styles.infoValueLink]} numberOfLines={2}>
            {row.value}
          </Text>
        );
        return (
          <Pressable
            key={`${row.label}-${i}`}
            disabled={!row.link}
            onPress={row.link ? () => openLink(row.link!) : undefined}
            accessibilityRole={row.link ? 'link' : undefined}
            style={[styles.infoRow, dividers && i > 0 && styles.infoRowDivider]}
          >
            <Ionicons name={row.icon} size={18} color="#5B6577" style={styles.infoIcon} />
            <View style={styles.infoLabelWrap}>
              <Text style={styles.infoLabel} numberOfLines={1}>
                {row.label}
              </Text>
              {row.primary ? <Text style={styles.primaryTag}>PRIMARY</Text> : null}
            </View>
            <Text style={styles.infoColon}>:</Text>
            <View style={styles.infoValueWrap}>{value}</View>
            {row.link ? <Ionicons name="chevron-forward" size={16} color="#8A94A6" /> : null}
          </Pressable>
        );
      })}
    </>
  );
};

const CARD_SHADOW = {
  shadowColor: '#1F3B66',
  shadowOpacity: 0.08,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { flex: 1, backgroundColor: '#FFFFFF' },
  scrollContent: { flexGrow: 1 },
  content: { paddingHorizontal: spacing.md },
  flex1: { flex: 1 },
  pressed: { opacity: 0.8 },

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
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
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

  card: {
    backgroundColor: colors.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E8EEF6',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    ...CARD_SHADOW,
  },

  // Identity
  identityCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatarRing: {
    padding: 5,
    borderRadius: 60,
    backgroundColor: colors.white,
    ...CARD_SHADOW,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#FCEBD9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.concreteLight },
  avatarText: { fontSize: 28, fontWeight: '800', color: '#0D3B78' },
  identityText: { flex: 1 },
  name: { fontSize: 22, fontWeight: '800', color: PAGE_TEXT },
  subtitle: { fontSize: 15, color: colors.textSecondary, marginTop: 2 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, alignSelf: 'flex-start' },
  phoneText: { fontSize: 15, color: colors.textSecondary },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  pillGreen: { backgroundColor: '#E3F6E8' },
  pillGrey: { backgroundColor: colors.concreteLight },
  pillBlue: { backgroundColor: '#E3EEFB' },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillDotGreen: { backgroundColor: '#22A447' },
  pillDotGrey: { backgroundColor: colors.neutralGray },
  pillText: { fontSize: 13, fontWeight: '700' },
  pillTextGreen: { color: '#1E8E3E' },
  pillTextGrey: { color: colors.textSecondary },
  pillTextBlue: { color: colors.primary },

  // Stats
  statsRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm },
  statTile: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    paddingVertical: spacing.sm,
    paddingHorizontal: 8,
    ...CARD_SHADOW,
  },
  statIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  statText: { flex: 1 },
  statValue: { fontSize: 20, fontWeight: '800', color: PAGE_TEXT },
  statLoading: { alignSelf: 'flex-start', height: 26 },
  statLabel: { fontSize: 12, color: colors.textSecondary },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.errorBackground,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  errorBannerText: { ...typography.bodySmall, color: colors.error, flex: 1 },

  // Current trip
  currentTrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.statBlueBg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  currentTripIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentTripLabel: { ...typography.caption, fontSize: 10, fontWeight: '800', letterSpacing: 0.6, color: colors.primary },
  currentTripTitle: { ...typography.label, fontWeight: '800', color: colors.textPrimary, marginTop: 1 },
  currentTripMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },

  // Sections
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: PAGE_TEXT },
  sectionLoading: { paddingVertical: spacing.sm, alignItems: 'center' },
  loadingText: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  emptyText: { ...typography.bodySmall, color: colors.textSecondary, paddingVertical: spacing.xs },

  // Vehicle
  vehicleBody: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  vehicleImageBox: {
    width: '44%',
    aspectRatio: 2.5,
    borderRadius: 12,
    backgroundColor: '#F1F4FA',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleImage: { width: '100%', height: '100%' },
  vehicleInfo: { flex: 1 },
  vehicleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  vehicleLineDivider: { borderTopWidth: 1, borderTopColor: '#EEF1F5' },
  vehicleLineIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#E8F0FB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleLineLabel: { fontSize: 12, color: colors.textSecondary },
  vehicleLineValue: { fontSize: 15, fontWeight: '800', color: PAGE_TEXT },

  // Personal details
  personalBody: { flexDirection: 'row', alignItems: 'center' },
  personalPhotoWrap: {
    paddingLeft: spacing.sm,
    marginLeft: spacing.xs,
    borderLeftWidth: 1,
    borderLeftColor: '#E6EAF0',
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  personalPhoto: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F1F4F8',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  personalPhotoImage: { width: 64, height: 64 },

  // Rows
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  infoRowDivider: { borderTopWidth: 1, borderTopColor: '#EEF1F5' },
  infoIcon: { width: 26 },
  infoLabelWrap: { width: '34%' },
  infoLabel: { fontSize: 14, color: '#5B6577' },
  infoColon: { fontSize: 14, color: '#5B6577', marginHorizontal: 8 },
  infoValueWrap: { flex: 1, alignItems: 'flex-start' },
  infoValue: { fontSize: 14, color: PAGE_TEXT },
  infoValueLink: { color: colors.primary },
  valueBadge: { paddingHorizontal: 12, paddingVertical: 3, borderRadius: radius.pill },
  primaryTag: {
    ...typography.caption,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: colors.statGreenIcon,
    marginTop: 1,
  },

  // Buttons
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 13,
  },
  settingsButton: { borderColor: colors.primary },
  settingsText: { fontSize: 16, fontWeight: '700', color: colors.primary },
  logoutButton: { borderColor: '#E53935' },
  logoutText: { fontSize: 16, fontWeight: '700', color: '#E53935' },

  bottomSpacer: { height: spacing.lg },
});

export default DriverProfileScreen;
