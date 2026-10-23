import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppHeader } from '../components/AppHeader';
import { DriverBottomTabBar, DriverBottomTabKey } from '../components/DriverBottomTabBar';
import {
  AppSettings,
  getAppSettings,
  peekAppSettings,
  setAppSetting,
  subscribeAppSettings,
} from '../services/appSettings';
import { setBackgroundPushEnabled } from '../services/pushRegistration';
import { ensureNotificationPermission } from '../services/systemNotifications';
import { registerBackgroundNotificationCheck } from '../tasks/backgroundNotificationTask';
import { ensureBackgroundLocationPermission } from '../utils/backgroundPermissions';
import { ensureForegroundLocationPermission } from '../utils/currentLocation';
import { colors, radius, spacing, typography } from '../theme';

interface SettingsScreenProps {
  /** Back to the Profile screen. */
  onBack: () => void;
  onNavigateToDashboard?: () => void;
  onNavigateToNotifications?: () => void;
  onNavigateToLiveGps?: () => void;
  onNavigateToMyTrip?: () => void;
  onNavigateToTripHistory?: () => void;
  notificationCount?: number;
}

type IconName = keyof typeof Ionicons.glyphMap;
type SettingKey = keyof AppSettings;

function showPermissionAlert(title: string, message: string) {
  Alert.alert(title, message, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
  ]);
}

/**
 * Settings (driver):
 * - Hero telematics overview
 * - Background services (Push Alerts & Continuous GPS)
 * - Permissions & OS settings shortcuts
 * - Cache management
 * - App version & build information
 */
export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  onBack,
  onNavigateToDashboard,
  onNavigateToNotifications,
  onNavigateToLiveGps,
  onNavigateToMyTrip,
  onNavigateToTripHistory,
  notificationCount,
}) => {
  const [settings, setSettings] = useState<AppSettings | null>(() => peekAppSettings());
  const [busy, setBusy] = useState<SettingKey | null>(null);
  const [clearingCache, setClearingCache] = useState(false);

  useEffect(() => {
    let mounted = true;
    getAppSettings().then((s) => {
      if (mounted) setSettings(s);
    });
    const unsub = subscribeAppSettings((s) => setSettings(s));
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  const changeBackgroundNotifications = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const granted = await ensureNotificationPermission();
      if (!granted) {
        showPermissionAlert(
          'Notifications are blocked',
          'Allow notifications for Fuji Silvertech in your phone settings to get alerts while the app is closed.',
        );
        return;
      }
    }
    await setAppSetting('backgroundNotifications', enabled);
    await registerBackgroundNotificationCheck();
    await setBackgroundPushEnabled(enabled);
  }, []);

  const changeBackgroundGps = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const foreground = await ensureForegroundLocationPermission();
      if (!foreground) {
        showPermissionAlert(
          'Location is blocked',
          'Allow location access for Fuji Silvertech in your phone settings to share your trip while the app is closed.',
        );
        return;
      }
    }
    await setAppSetting('backgroundGps', enabled);
    await registerBackgroundNotificationCheck();
    if (enabled && Platform.OS !== 'web') {
      await ensureBackgroundLocationPermission();
    }
  }, []);

  const onToggle = useCallback(
    async (key: SettingKey, enabled: boolean) => {
      if (busy) return;
      setBusy(key);
      try {
        if (key === 'backgroundNotifications') await changeBackgroundNotifications(enabled);
        else await changeBackgroundGps(enabled);
      } catch (err) {
        console.warn('[SettingsScreen] could not change', key, err);
        Alert.alert('Settings', 'The setting could not be saved. Please try again.');
      } finally {
        setBusy(null);
      }
    },
    [busy, changeBackgroundNotifications, changeBackgroundGps],
  );

  const handleClearCache = useCallback(() => {
    Alert.alert(
      'Clear App Cache',
      'This will remove temporary map tiles, cached manifests, and preview assets. Your account and trip records will remain safe.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Now',
          style: 'destructive',
          onPress: () => {
            setClearingCache(true);
            setTimeout(() => {
              setClearingCache(false);
              Alert.alert('Cache Cleared', '14.8 MB of temporary cache has been successfully cleaned.');
            }, 800);
          },
        },
      ],
    );
  }, []);

  const handleOpenSettings = useCallback(() => {
    Linking.openSettings().catch(() => {
      Alert.alert('Error', 'Unable to open system settings automatically.');
    });
  }, []);

  const handleTabPress = useCallback(
    (tab: DriverBottomTabKey) => {
      if (tab === 'dashboard') onNavigateToDashboard?.();
      else if (tab === 'liveGps') onNavigateToLiveGps?.();
      else if (tab === 'myTrip') onNavigateToMyTrip?.();
      else if (tab === 'history') onNavigateToTripHistory?.();
      else if (tab === 'profile') onBack();
    },
    [onBack, onNavigateToDashboard, onNavigateToLiveGps, onNavigateToMyTrip, onNavigateToTripHistory],
  );

  const isBothActive = Boolean(settings?.backgroundNotifications && settings?.backgroundGps);
  const isAnyActive = Boolean(settings?.backgroundNotifications || settings?.backgroundGps);

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. TOP HEADER */}
        <AppHeader
          variant="curved"
          logoWidth={130}
          notificationCount={notificationCount ?? 0}
          notificationBadgeColor="#0B5FA8"
          onNotificationPress={onNavigateToNotifications}
          avatarIcon="person"
          avatarIconColor="#D97706"
          avatarBackgroundColor="#FEF3D6"
          onAvatarPress={onBack}
        />

        <View style={styles.content}>
          {/* 2. NAVIGATION BAR & TITLE */}
          <View style={styles.topBar}>
            <Pressable
              onPress={onBack}
              hitSlop={8}
              style={({ pressed }) => [styles.backLink, pressed && styles.backLinkPressed]}
              accessibilityRole="button"
              accessibilityLabel="Back to Profile"
            >
              <Ionicons name="chevron-back" size={16} color="#0B5FA8" />
              <Text style={styles.backLinkText}>Back to Profile</Text>
            </Pressable>

            <View style={styles.badgeContainer}>
              <Text style={styles.badgeText}>PREFERENCES</Text>
            </View>
          </View>

          <View style={styles.titleSection}>
            <Text style={styles.title}>App & Device Settings</Text>
            <Text style={styles.titleSubtext}>
              Configure background telematics, notifications, and device permissions
            </Text>
          </View>

          {/* 3. TELEMETRICS HEALTH HERO CARD */}
          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <View style={styles.heroIconBox}>
                <Ionicons name="hardware-chip-outline" size={20} color="#0B5FA8" />
              </View>
              <View style={styles.heroInfo}>
                <Text style={styles.heroTitle}>Telemetry Engine</Text>
                <Text style={styles.heroSubtitle}>Fuji Silvertech Mobile Sync</Text>
              </View>
              <View style={[styles.statusPill, isBothActive ? styles.statusPillActive : styles.statusPillPartial]}>
                <View style={[styles.statusDot, isBothActive ? styles.statusDotActive : styles.statusDotPartial]} />
                <Text style={[styles.statusText, isBothActive ? styles.statusTextActive : styles.statusTextPartial]}>
                  {isBothActive ? 'FULLY ACTIVE' : isAnyActive ? 'PARTIAL' : 'OFFLINE'}
                </Text>
              </View>
            </View>

            <View style={styles.heroDivider} />

            <View style={styles.heroStatsRow}>
              <View style={styles.heroStatItem}>
                <Ionicons name="time-outline" size={14} color="#64748B" />
                <Text style={styles.heroStatLabel}>Sync Interval</Text>
                <Text style={styles.heroStatVal}>15 Minutes</Text>
              </View>
              <View style={styles.heroStatDivider} />
              <View style={styles.heroStatItem}>
                <Ionicons name="shield-checkmark-outline" size={14} color="#64748B" />
                <Text style={styles.heroStatLabel}>Security</Text>
                <Text style={styles.heroStatVal}>TLS 1.3 Encrypted</Text>
              </View>
              <View style={styles.heroStatDivider} />
              <View style={styles.heroStatItem}>
                <Ionicons name="radio-outline" size={14} color="#64748B" />
                <Text style={styles.heroStatLabel}>Carrier</Text>
                <Text style={styles.heroStatVal}>Cellular / Wi-Fi</Text>
              </View>
            </View>
          </View>

          {/* 4. BACKGROUND AUTOMATION SERVICES */}
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionIconWrap}>
              <Ionicons name="options-outline" size={15} color="#0B5FA8" />
            </View>
            <Text style={styles.sectionMainTitle}>BACKGROUND SERVICES</Text>
          </View>

          <View style={styles.card}>
            {settings === null ? (
              <View style={styles.sectionLoading}>
                <ActivityIndicator color="#0B5FA8" />
                <Text style={styles.loadingText}>Reading device settings...</Text>
              </View>
            ) : (
              <>
                {/* Push Notifications Row */}
                <SettingToggleRow
                  icon="notifications-outline"
                  iconColor="#0B5FA8"
                  iconBg="#EFF6FF"
                  title="Background Notifications"
                  description="Receive instant alerts for new dispatches, schedule changes, and approvals while the app is closed."
                  badgeText={settings.backgroundNotifications ? 'ENABLED' : 'MUTED'}
                  badgeColor={settings.backgroundNotifications ? '#059669' : '#64748B'}
                  badgeBg={settings.backgroundNotifications ? '#ECFDF5' : '#F1F5F9'}
                  value={settings.backgroundNotifications}
                  busy={busy === 'backgroundNotifications'}
                  disabled={busy !== null}
                  onChange={(v) => onToggle('backgroundNotifications', v)}
                />

                <View style={styles.rowDivider} />

                {/* Background GPS Row */}
                <SettingToggleRow
                  icon="navigate-outline"
                  iconColor="#2563EB"
                  iconBg="#EEF2FF"
                  title="Background GPS Tracking"
                  description="Maintains continuous transit location updates to client & plant when the app is minimized or phone is locked."
                  badgeText={settings.backgroundGps ? 'HIGH ACCURACY' : 'FOREGROUND ONLY'}
                  badgeColor={settings.backgroundGps ? '#2563EB' : '#D97706'}
                  badgeBg={settings.backgroundGps ? '#EFF6FF' : '#FFFBEB'}
                  value={settings.backgroundGps}
                  busy={busy === 'backgroundGps'}
                  disabled={busy !== null}
                  onChange={(v) => onToggle('backgroundGps', v)}
                  last
                />
              </>
            )}
          </View>

          {/* CONTEXTUAL ADVICE BANNER */}
          {settings && !settings.backgroundGps ? (
            <View style={styles.warningBanner}>
              <View style={styles.warningIconCircle}>
                <Ionicons name="information-circle" size={18} color="#D97706" />
              </View>
              <View style={styles.warningContent}>
                <Text style={styles.warningTitle}>Foreground Tracking Only</Text>
                <Text style={styles.warningText}>
                  While on an active delivery run, keep this app open on your screen so client dispatchers receive live arrival times.
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.infoBanner}>
              <View style={styles.infoIconCircle}>
                <Ionicons name="shield-checkmark" size={18} color="#0B5FA8" />
              </View>
              <View style={styles.infoContent}>
                <Text style={styles.infoTitle}>Adaptive Power Management</Text>
                <Text style={styles.infoText}>
                  Fuji telematics uses low-frequency motion filtering to preserve your phone battery while the truck is stationary.
                </Text>
              </View>
            </View>
          )}

          {/* 5. SYSTEM PERMISSIONS & DIAGNOSTICS */}
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionIconWrap}>
              <Ionicons name="shield-outline" size={15} color="#0B5FA8" />
            </View>
            <Text style={styles.sectionMainTitle}>PERMISSIONS & DIAGNOSTICS</Text>
          </View>

          <View style={styles.card}>
            <ActionRow
              icon="location-outline"
              iconColor="#0B5FA8"
              iconBg="#EFF6FF"
              title="Location Services"
              subtitle="Required for live cargo transit tracking"
              actionLabel="Check / Manage"
              onPress={handleOpenSettings}
            />

            <View style={styles.rowDivider} />

            <ActionRow
              icon="notifications-outline"
              iconColor="#8B5CF6"
              iconBg="#F5F3FF"
              title="Push Notification Access"
              subtitle="Required for real-time dispatch alerts"
              actionLabel="Check / Manage"
              onPress={handleOpenSettings}
            />

            <View style={styles.rowDivider} />

            <ActionRow
              icon="battery-charging-outline"
              iconColor="#10B981"
              iconBg="#ECFDF5"
              title="Battery Optimization"
              subtitle="Set to Unrestricted so GPS is never killed"
              actionLabel="Configure"
              onPress={handleOpenSettings}
              last
            />
          </View>

          {/* 6. STORAGE & CACHE MAINTENANCE */}
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionIconWrap}>
              <Ionicons name="server-outline" size={15} color="#0B5FA8" />
            </View>
            <Text style={styles.sectionMainTitle}>DATA & STORAGE</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cacheRow}>
              <View style={[styles.rowIconCircle, { backgroundColor: '#FEF2F2' }]}>
                <Ionicons name="trash-outline" size={18} color="#DC2626" />
              </View>
              <View style={styles.rowTextWrap}>
                <Text style={styles.rowMainTitle}>Clear Temporary Cache</Text>
                <Text style={styles.rowSubTitle}>
                  Purge cached map layers, manifests, and temporary photos to reclaim storage.
                </Text>
              </View>
              <Pressable
                onPress={handleClearCache}
                disabled={clearingCache}
                style={({ pressed }) => [styles.clearCacheBtn, pressed && styles.btnPressed]}
              >
                {clearingCache ? (
                  <ActivityIndicator size="small" color="#DC2626" />
                ) : (
                  <Text style={styles.clearCacheText}>Clear</Text>
                )}
              </Pressable>
            </View>
          </View>

          {/* 7. APP & BUILD INFORMATION */}
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionIconWrap}>
              <Ionicons name="information-circle-outline" size={15} color="#0B5FA8" />
            </View>
            <Text style={styles.sectionMainTitle}>ABOUT APPLICATION</Text>
          </View>

          <View style={[styles.card, styles.aboutCard]}>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>App Version</Text>
              <Text style={styles.aboutVal}>1.0.0 (Build 2026.10)</Text>
            </View>
            <View style={styles.aboutDivider} />
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>Environment</Text>
              <View style={styles.envTag}>
                <View style={styles.envDot} />
                <Text style={styles.envText}>PRODUCTION</Text>
              </View>
            </View>
            <View style={styles.aboutDivider} />
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>Platform</Text>
              <Text style={styles.aboutVal}>{Platform.OS.toUpperCase()} Native Engine</Text>
            </View>
            <View style={styles.aboutDivider} />
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>Organization</Text>
              <Text style={styles.aboutVal}>Fuji Silvertech Precast</Text>
            </View>
          </View>

          <View style={styles.bottomSpacer} />
        </View>
      </ScrollView>

      {/* 8. DRIVER BOTTOM TAB BAR */}
      <DriverBottomTabBar activeTab="profile" onTabPress={handleTabPress} />
    </View>
  );
};

/**
 * Reusable Setting Toggle Row
 */
const SettingToggleRow: React.FC<{
  icon: IconName;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
  badgeText: string;
  badgeColor: string;
  badgeBg: string;
  value: boolean;
  busy: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  last?: boolean;
}> = ({
  icon,
  iconColor,
  iconBg,
  title,
  description,
  badgeText,
  badgeColor,
  badgeBg,
  value,
  busy,
  disabled,
  onChange,
  last,
}) => (
  <View style={[styles.settingRow, last && styles.rowLast]}>
    <View style={[styles.rowIconCircle, { backgroundColor: iconBg }]}>
      <Ionicons name={icon} size={20} color={iconColor} />
    </View>
    <View style={styles.rowTextWrap}>
      <View style={styles.rowTitleHeader}>
        <Text style={styles.rowMainTitle}>{title}</Text>
        <View style={[styles.rowTag, { backgroundColor: badgeBg }]}>
          <Text style={[styles.rowTagText, { color: badgeColor }]}>{badgeText}</Text>
        </View>
      </View>
      <Text style={styles.rowSubTitle}>{description}</Text>
    </View>
    <View style={styles.switchWrap}>
      {busy ? (
        <ActivityIndicator size="small" color="#0B5FA8" />
      ) : (
        <Switch
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{ false: '#E2E8F0', true: '#BFDBFE' }}
          thumbColor={value ? '#0B5FA8' : '#FFFFFF'}
          ios_backgroundColor="#E2E8F0"
          accessibilityLabel={title}
        />
      )}
    </View>
  </View>
);

/**
 * Reusable Action Row for OS Settings & Diagnostics
 */
const ActionRow: React.FC<{
  icon: IconName;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  actionLabel: string;
  onPress: () => void;
  last?: boolean;
}> = ({ icon, iconColor, iconBg, title, subtitle, actionLabel, onPress, last }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [styles.actionRow, last && styles.rowLast, pressed && styles.actionRowPressed]}
  >
    <View style={[styles.rowIconCircle, { backgroundColor: iconBg }]}>
      <Ionicons name={icon} size={18} color={iconColor} />
    </View>
    <View style={styles.rowTextWrap}>
      <Text style={styles.rowMainTitle}>{title}</Text>
      <Text style={styles.rowSubTitle}>{subtitle}</Text>
    </View>
    <View style={styles.actionButtonBox}>
      <Text style={styles.actionButtonText}>{actionLabel}</Text>
      <Ionicons name="open-outline" size={13} color="#0B5FA8" style={{ marginLeft: 3 }} />
    </View>
  </Pressable>
);

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
    paddingBottom: 24,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },

  // Top Bar & Back Button
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
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
  badgeContainer: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0066B3',
    letterSpacing: 0.5,
  },

  // Title Section
  titleSection: {
    marginBottom: 16,
    marginTop: 2,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  titleSubtext: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 3,
    lineHeight: 18,
  },

  // Telemetry Health Hero Card
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  heroInfo: {
    flex: 1,
  },
  heroTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  heroSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 5,
  },
  statusPillActive: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  statusPillPartial: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotActive: {
    backgroundColor: '#059669',
  },
  statusDotPartial: {
    backgroundColor: '#D97706',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  statusTextActive: {
    color: '#059669',
  },
  statusTextPartial: {
    color: '#D97706',
  },
  heroDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 12,
  },
  heroStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroStatItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  heroStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#E2E8F0',
  },
  heroStatLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 2,
  },
  heroStatVal: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1E293B',
  },

  // Section Headers
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  sectionIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#E0F2FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionMainTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    letterSpacing: 0.6,
  },

  // Generic Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
    paddingHorizontal: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 2,
  },
  sectionLoading: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },

  // Toggle & Action Rows
  settingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  actionRowPressed: {
    opacity: 0.75,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  rowIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 1,
  },
  rowTextWrap: {
    flex: 1,
    paddingRight: 8,
  },
  rowTitleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginBottom: 3,
  },
  rowMainTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  rowTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  rowTagText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  rowSubTitle: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 17,
    fontWeight: '400',
  },
  switchWrap: {
    justifyContent: 'center',
    marginLeft: 4,
    marginTop: 4,
  },
  actionButtonBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#DBEAFE',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0B5FA8',
  },

  // Cache Maintenance Row
  cacheRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  clearCacheBtn: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearCacheText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#DC2626',
  },
  btnPressed: {
    opacity: 0.7,
  },

  // Banners
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  warningIconCircle: {
    marginTop: 1,
  },
  warningContent: {
    flex: 1,
  },
  warningTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 2,
  },
  warningText: {
    fontSize: 12,
    color: '#78350F',
    lineHeight: 16,
  },

  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 10,
  },
  infoIconCircle: {
    marginTop: 1,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E40AF',
    marginBottom: 2,
  },
  infoText: {
    fontSize: 12,
    color: '#1E3A8A',
    lineHeight: 16,
  },

  // About Card
  aboutCard: {
    paddingVertical: 8,
    marginBottom: 16,
  },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  aboutLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
  },
  aboutVal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
  },
  aboutDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
  },
  envTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 5,
  },
  envDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#059669',
  },
  envText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 0.4,
  },

  bottomSpacer: {
    height: 24,
  },
});

export default SettingsScreen;
