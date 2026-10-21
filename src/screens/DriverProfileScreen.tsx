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
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppHeader } from '../components/AppHeader';
import { DriverBottomTabBar, DriverBottomTabKey } from '../components/DriverBottomTabBar';
import { driverDashboardService } from '../services/driverDashboardService';
import { fetchCached, peekQuery, qk, refetchFresh } from '../query/queryClient';
import { liferayProfileService, LiferayProfile, ProfileContact } from '../services/liferayProfileService';
import type { TokenRefreshHandler } from '../services/notificationService';
import type { UserProfile } from '../types/auth';
import type { DispatchItem } from '../types/driverDashboard';
import { DISPATCH_STATUS, getDispatchStatusLabel } from '../utils/dispatchStatus';
import { colors, radius, spacing, typography } from '../theme';

interface DriverProfileScreenProps {
  user: UserProfile;
  /** Used to load the Liferay profile and the driver's dispatches. */
  accessToken?: string;
  refreshToken?: string;
  onTokenRefresh?: TokenRefreshHandler;
  onBack: () => void;
  onLogout: () => void;
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

function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function formatQuantity(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
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
  quantityDelivered: number;
  sitesServed: number;
  vehicleNumber?: string;
  vehicles: string[];
  lastPlant?: string;
  lastDelivery?: DispatchItem;
  latest?: DispatchItem;
}

function buildStats(dispatches: DispatchItem[]): TripStats {
  const byNewest = [...dispatches].sort((a, b) => deliveryTime(b) - deliveryTime(a));
  const completed = dispatches.filter((d) => d.statusDispatch === DISPATCH_STATUS.ARRIVED);
  const vehicles = Array.from(
    new Set(byNewest.map((d) => d.vehicleNumber?.trim()).filter((v): v is string => !!v)),
  );
  const sites = new Set(
    completed.map((d) => d.siteMasterObjectEntryId ?? d.siteName ?? d.destinationSiteAWC).filter(Boolean),
  );

  return {
    total: dispatches.length,
    completed: completed.length,
    active: dispatches.length - completed.length,
    inTransit: byNewest.find((d) => d.statusDispatch === DISPATCH_STATUS.IN_TRANSIT),
    quantityDelivered: completed.reduce((sum, d) => sum + toNumber(d.quantity), 0),
    sitesServed: sites.size,
    vehicleNumber: vehicles[0],
    vehicles,
    lastPlant: byNewest[0]?.plantName || undefined,
    lastDelivery: [...completed].sort((a, b) => deliveryTime(b) - deliveryTime(a))[0],
    latest: byNewest[0],
  };
}

// ───────────────────────────── screen ─────────────────────────────

/**
 * Driver profile — everything shown comes from real data:
 *   - Liferay user account (login): name, email, username, job title, status,
 *     member since, last login, user id, photo
 *   - Dispatches API (GET /o/material-dispatch-rest/dispatches?userId=):
 *     trip counts, quantity delivered, sites served, assigned vehicle(s),
 *     current trip, last delivery
 * Rows whose value the server doesn't provide are hidden instead of faked.
 */
export const DriverProfileScreen: React.FC<DriverProfileScreenProps> = ({
  user,
  accessToken,
  refreshToken,
  onTokenRefresh,
  onBack,
  onLogout,
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
          logoWidth={100}
          notificationCount={notificationCount ?? 0}
          onNotificationPress={onNavigateToNotifications}
          avatarIconColor={colors.statOrangeIcon}
          avatarBackgroundColor={colors.statOrangeBg}
          onAvatarPress={() => {}}
        />

        <View style={styles.content}>
          <Pressable onPress={onBack} hitSlop={8} style={styles.backLink}>
            <Ionicons name="chevron-back" size={16} color={colors.primary} />
            <Text style={styles.backLinkText}>Back to Dashboard</Text>
          </Pressable>

          {/* ── Identity ── */}
          <View style={styles.heroCard}>
            <View style={styles.heroBand} />

            <View style={styles.avatarRing}>
              {showPhoto ? (
                <Image
                  source={{ uri: photoUrl }}
                  style={styles.avatarImage}
                  onError={() => setPhotoFailed(true)}
                />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initialsOf(displayName)}</Text>
                </View>
              )}
            </View>

            <Text style={styles.name}>{displayName}</Text>
            <Text style={styles.subtitle}>{jobTitle || 'Truck Driver'}</Text>
            {profile?.screenName ? <Text style={styles.screenName}>@{profile.screenName}</Text> : null}

            <View style={styles.pillRow}>
              <View style={[styles.pill, isActiveAccount ? styles.pillGreen : styles.pillGrey]}>
                <View style={[styles.pillDot, isActiveAccount ? styles.pillDotGreen : styles.pillDotGrey]} />
                <Text style={[styles.pillText, isActiveAccount ? styles.pillTextGreen : styles.pillTextGrey]}>
                  {isActiveAccount ? 'Active' : titleCase(accountStatus)}
                </Text>
              </View>
              {vehicleNumber ? (
                <View style={[styles.pill, styles.pillBlue]}>
                  <Ionicons name="bus-outline" size={12} color={colors.primary} />
                  <Text style={[styles.pillText, styles.pillTextBlue]}>{vehicleNumber}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* ── Trip stats (dispatches API) ── */}
          <View style={styles.statsGrid}>
            <StatTile
              icon="layers-outline"
              tone="blue"
              label="Total Trips"
              value={stats ? String(stats.total) : undefined}
            />
            <StatTile
              icon="checkmark-done-outline"
              tone="green"
              label="Completed"
              value={stats ? String(stats.completed) : undefined}
            />
            <StatTile
              icon="navigate-outline"
              tone="orange"
              label="Active"
              value={stats ? String(stats.active) : undefined}
            />
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

          {/* ── Delivery summary ── */}
          <Section icon="stats-chart-outline" title="Delivery Summary">
            {stats === null ? (
              <View style={styles.sectionLoading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : stats.total === 0 ? (
              <Text style={styles.emptyText}>No dispatches assigned yet.</Text>
            ) : (
              <InfoRows
                rows={[
                  {
                    icon: 'cube-outline',
                    label: 'Quantity delivered',
                    value: stats.completed > 0 ? formatQuantity(stats.quantityDelivered) : undefined,
                  },
                  {
                    icon: 'location-outline',
                    label: 'Sites delivered to',
                    value: stats.completed > 0 ? String(stats.sitesServed) : undefined,
                  },
                  {
                    icon: 'flag-outline',
                    label: 'Last delivery',
                    value: stats.lastDelivery
                      ? `${stats.lastDelivery.siteName || stats.lastDelivery.destinationSiteAWC}${
                          stats.lastDelivery.deliveryDate ? ` • ${stats.lastDelivery.deliveryDate}` : ''
                        }`
                      : undefined,
                  },
                  { icon: 'business-outline', label: 'Dispatching plant', value: stats.lastPlant },
                  {
                    icon: 'time-outline',
                    label: 'Latest trip status',
                    value: stats.latest ? getDispatchStatusLabel(stats.latest.statusDispatch) : undefined,
                  },
                ]}
              />
            )}
          </Section>

          {/* ── Vehicle ── */}
          {vehicleNumber || user.vehicleModel ? (
            <Section icon="bus-outline" title="Assigned Vehicle">
              <InfoRows
                rows={[
                  { icon: 'card-outline', label: 'Vehicle number', value: vehicleNumber },
                  { icon: 'construct-outline', label: 'Model', value: user.vehicleModel },
                  {
                    icon: 'swap-horizontal-outline',
                    label: 'Other vehicles used',
                    value: stats && stats.vehicles.length > 1 ? stats.vehicles.slice(1).join(', ') : undefined,
                  },
                ]}
              />
            </Section>
          ) : null}

          {/* ── Liferay profile (my-user-account) ── */}
          {profileError ? (
            <Pressable onPress={loadProfile} style={styles.errorBanner}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.error} />
              <Text style={styles.errorBannerText}>{profileError} Tap to retry.</Text>
            </Pressable>
          ) : null}

          {profileLoading && !profile ? (
            <View style={styles.section}>
              <View style={styles.sectionLoading}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.loadingText}>Loading profile from Liferay…</Text>
              </View>
            </View>
          ) : null}

          {profile ? (
            <>
              <Section icon="person-outline" title="Personal Details">
                <InfoRows
                  rows={[
                    { icon: 'person-outline', label: 'First name', value: profile.givenName },
                    { icon: 'people-outline', label: 'Last name', value: profile.familyName },
                    { icon: 'briefcase-outline', label: 'Job title', value: profile.jobTitle },
                    { icon: 'gift-outline', label: 'Date of birth', value: formatDate(profile.birthDate) },
                    { icon: 'male-female-outline', label: 'Gender', value: profile.gender },
                    { icon: 'language-outline', label: 'Language', value: profile.language },
                  ]}
                />
              </Section>

              <Section icon="call-outline" title="Contact">
                <InfoRows rows={contactRows} emptyText="No contact details in Liferay." />
              </Section>

              {/* {profile.organizations.length + profile.sites.length + profile.userGroups.length + profile.roles.length > 0 ? (
                <Section icon="business-outline" title="Organization & Access">
                  <ChipGroup label="Organizations" items={profile.organizations} tone="blue" />
                  <ChipGroup label="Sites" items={profile.sites} tone="green" />
                  <ChipGroup label="User groups" items={profile.userGroups} tone="orange" />
                  <ChipGroup label="Roles" items={profile.roles} tone="grey" />
                </Section>
              ) : null} */}

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
          <Section icon="person-circle-outline" title="Account">
            <InfoRows
              rows={[
                { icon: 'at-outline', label: 'Username', value: profile?.screenName || user.alternateName },
                { icon: 'id-card-outline', label: 'User ID', value: profile?.id || user.id },
                { icon: 'checkmark-circle-outline', label: 'Status', value: titleCase(accountStatus) },
                {
                  icon: 'calendar-outline',
                  label: 'Member since',
                  value: formatDate(profile?.dateCreated || user.dateCreated),
                },
                {
                  icon: 'create-outline',
                  label: 'Profile updated',
                  value: formatDate(profile?.dateModified, true),
                },
                {
                  icon: 'log-in-outline',
                  label: 'Last login',
                  value: formatDate(profile?.lastLoginDate || user.lastLoginDate, true),
                },
                {
                  icon: 'pricetag-outline',
                  label: 'Reference code',
                  value: profile?.externalReferenceCode || user.externalReferenceCode,
                },
              ]}
            />
          </Section>

          <Pressable
            onPress={onLogout}
            accessibilityRole="button"
            accessibilityLabel="Log out"
            style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}
          >
            <Ionicons name="log-out-outline" size={18} color={colors.error} />
            <Text style={styles.logoutText}>Log out</Text>
          </Pressable>

          <View style={styles.bottomSpacer} />
        </View>
      </ScrollView>

      <DriverBottomTabBar activeTab={activeTab} onTabPress={handleTabPress} />
    </View>
  );
};

// ───────────────────────────── pieces ─────────────────────────────

const TONES = {
  blue: { bg: colors.statBlueBg, fg: colors.statBlueIcon },
  green: { bg: colors.statGreenBg, fg: colors.statGreenIcon },
  orange: { bg: colors.statOrangeBg, fg: colors.statOrangeIcon },
} as const;

const StatTile: React.FC<{
  icon: IconName;
  tone: keyof typeof TONES;
  label: string;
  value?: string;
}> = ({ icon, tone, label, value }) => (
  <View style={styles.statTile}>
    <View style={[styles.statIcon, { backgroundColor: TONES[tone].bg }]}>
      <Ionicons name={icon} size={16} color={TONES[tone].fg} />
    </View>
    {value === undefined ? (
      <ActivityIndicator size="small" color={colors.neutralGray} style={styles.statLoading} />
    ) : (
      <Text style={styles.statValue}>{value}</Text>
    )}
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const Section: React.FC<{ icon: IconName; title: string; children: React.ReactNode }> = ({
  icon,
  title,
  children,
}) => (
  <View style={styles.section}>
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={16} color={colors.primary} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
    {children}
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
}

function contactRow(icon: IconName, c: ProfileContact): InfoRowData {
  return { icon, label: c.label, value: c.value, link: c.link, primary: c.primary };
}

function openLink(link: string) {
  Linking.openURL(link).catch((err) => console.warn('[DriverProfileScreen] cannot open', link, err));
}

/** Rows without a value from the server are left out (nothing is faked). */
const InfoRows: React.FC<{ rows: InfoRowData[]; emptyText?: string }> = ({ rows, emptyText }) => {
  const visible = rows.filter((r) => r.value !== undefined && String(r.value).trim() !== '');
  if (visible.length === 0) {
    return <Text style={styles.emptyText}>{emptyText ?? 'No details available.'}</Text>;
  }
  return (
    <>
      {visible.map((row, i) => {
        const valueText = (
          <Text style={[styles.infoValue, row.link && styles.infoValueLink]} numberOfLines={3}>
            {row.value}
          </Text>
        );
        return (
          <View key={`${row.label}-${i}`} style={[styles.infoRow, i === visible.length - 1 && styles.infoRowLast]}>
            <Ionicons name={row.icon} size={15} color={colors.neutralGray} style={styles.infoIcon} />
            <View style={styles.infoLabelWrap}>
              <Text style={styles.infoLabel}>{row.label}</Text>
              {row.primary ? <Text style={styles.primaryTag}>PRIMARY</Text> : null}
            </View>
            {row.link ? (
              <Pressable
                onPress={() => openLink(row.link!)}
                hitSlop={6}
                accessibilityRole="link"
                style={styles.infoValuePress}
              >
                {valueText}
              </Pressable>
            ) : (
              valueText
            )}
          </View>
        );
      })}
    </>
  );
};

const CHIP_TONES = {
  blue: { bg: colors.statBlueBg, fg: colors.statBlueIcon },
  green: { bg: colors.statGreenBg, fg: colors.statGreenIcon },
  orange: { bg: colors.statOrangeBg, fg: colors.statOrangeIcon },
  grey: { bg: colors.concreteLight, fg: colors.darkGray },
} as const;

const ChipGroup: React.FC<{ label: string; items: string[]; tone: keyof typeof CHIP_TONES }> = ({
  label,
  items,
  tone,
}) => {
  if (items.length === 0) return null;
  return (
    <View style={styles.chipGroup}>
      <Text style={styles.chipGroupLabel}>{label}</Text>
      <View style={styles.chipRow}>
        {items.map((item) => (
          <View key={item} style={[styles.chip, { backgroundColor: CHIP_TONES[tone].bg }]}>
            <Text style={[styles.chipText, { color: CHIP_TONES[tone].fg }]}>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.concreteLighter },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { paddingHorizontal: spacing.md },
  flex1: { flex: 1 },
  pressed: { opacity: 0.8 },

  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
  },
  backLinkText: { ...typography.label, color: colors.primary, marginLeft: 2 },

  // Identity
  heroCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  heroBand: {
    alignSelf: 'stretch',
    height: 64,
    backgroundColor: colors.primary,
  },
  avatarRing: {
    marginTop: -40,
    padding: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.statOrangeBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.concreteLight,
  },
  avatarText: { ...typography.h1, fontSize: 26, color: colors.statOrangeIcon },
  name: { ...typography.h2, fontSize: 20, color: colors.textPrimary, marginTop: spacing.xs, textAlign: 'center' },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2, textAlign: 'center' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  pillGreen: { backgroundColor: colors.statGreenBg },
  pillGrey: { backgroundColor: colors.concreteLight },
  pillBlue: { backgroundColor: colors.statBlueBg },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillDotGreen: { backgroundColor: colors.statGreenIcon },
  pillDotGrey: { backgroundColor: colors.neutralGray },
  pillText: { ...typography.caption, fontWeight: '700' },
  pillTextGreen: { color: colors.statGreenIcon },
  pillTextGrey: { color: colors.textSecondary },
  pillTextBlue: { color: colors.primary },

  // Stats
  statsGrid: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  statTile: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.sm,
  },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: { ...typography.h2, fontSize: 22, color: colors.textPrimary, marginTop: spacing.xs },
  statLoading: { alignSelf: 'flex-start', marginTop: spacing.xs, height: 27 },
  statLabel: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.errorBackground,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  errorBannerText: { ...typography.bodySmall, color: colors.error, flex: 1 },

  // Current trip
  currentTrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.statBlueBg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    padding: spacing.sm,
    marginBottom: spacing.md,
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
  section: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    marginBottom: spacing.md,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xxs },
  sectionTitle: { ...typography.label, fontWeight: '800', color: colors.textPrimary },
  sectionLoading: { paddingVertical: spacing.md, alignItems: 'center' },
  loadingText: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  screenName: { ...typography.caption, color: colors.neutralGray, marginTop: 2 },

  chipGroup: { paddingVertical: spacing.xs },
  chipGroupLabel: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill },
  chipText: { ...typography.caption, fontWeight: '700' },
  emptyText: { ...typography.bodySmall, color: colors.textSecondary, paddingVertical: spacing.sm },

  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.concreteLight,
  },
  infoRowLast: { borderBottomWidth: 0 },
  infoIcon: { marginRight: spacing.xs },
  infoLabelWrap: { flex: 1 },
  infoLabel: { ...typography.bodySmall, color: colors.textSecondary },
  primaryTag: {
    ...typography.caption,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: colors.statGreenIcon,
    marginTop: 1,
  },
  infoValuePress: { flex: 1.3 },
  infoValueLink: { color: colors.primary },
  infoValue: {
    ...typography.bodySmall,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1.3,
    textAlign: 'right',
  },

  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
  },
  logoutText: { ...typography.button, fontSize: 15, color: colors.error },

  bottomSpacer: { height: spacing.lg },
});

export default DriverProfileScreen;
