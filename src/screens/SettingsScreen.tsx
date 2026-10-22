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
    { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => { }) },
  ]);
}

/**
 * Settings (driver): two device settings, saved on the phone.
 *   - Background Notifications: system notifications while the app is in the background / closed.
 *   - Background GPS Tracking: location pings while the app is minimised / closed.
 * In-app notifications and in-app (foreground) GPS tracking keep working either way.
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
    // 15-minute background check + this phone's push token on the server.
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
    // Saved first: BackgroundGpsController follows the setting (starts the service for a trip
    // in transit when ON; when OFF tracking continues in the app and stops once it is hidden).
    await setAppSetting('backgroundGps', enabled);
    await registerBackgroundNotificationCheck(); // GPS watchdog shares the background job
    if (enabled && Platform.OS !== 'web') {
      // "Allow all the time" keeps tracking alive with the screen off; explains how if refused.
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

  return (
    <View style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <AppHeader
          logoWidth={100}
          notificationCount={notificationCount ?? 0}
          onNotificationPress={onNavigateToNotifications}
          avatarIconColor={colors.statOrangeIcon}
          avatarBackgroundColor={colors.statOrangeBg}
          onAvatarPress={onBack}
        />

        <View style={styles.content}>
          <Pressable onPress={onBack} hitSlop={8} style={styles.backLink}>
            <Ionicons name="chevron-back" size={16} color={colors.primary} />
            <Text style={styles.backLinkText}>Back to Profile</Text>
          </Pressable>

          <Text style={styles.title}>Settings</Text>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="options-outline" size={16} color={colors.primary} />
              <Text style={styles.sectionTitle}>Background</Text>
            </View>

            {settings === null ? (
              <View style={styles.sectionLoading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <>
                <ToggleRow
                  icon="notifications-outline"
                  title="Background Notifications"
                  description="Alerts while the app is closed or in the background. In-app notifications always stay on."
                  value={settings.backgroundNotifications}
                  busy={busy === 'backgroundNotifications'}
                  disabled={busy !== null}
                  onChange={(v) => onToggle('backgroundNotifications', v)}
                />
                <ToggleRow
                  icon="navigate-outline"
                  title="Background GPS Tracking"
                  description="Keeps sharing your trip location while the app is closed or in the background. Tracking inside the app always stays on."
                  value={settings.backgroundGps}
                  busy={busy === 'backgroundGps'}
                  disabled={busy !== null}
                  onChange={(v) => onToggle('backgroundGps', v)}
                  last
                />
              </>
            )}
          </View>

          {settings && !settings.backgroundGps ? (
            <View style={styles.note}>
              <Ionicons name="information-circle-outline" size={16} color={colors.statOrangeIcon} />
              <Text style={styles.noteText}>
                While a trip is in transit, keep the app open so your location keeps updating.
              </Text>
            </View>
          ) : null}

          <View style={styles.bottomSpacer} />
        </View>
      </ScrollView>

      <DriverBottomTabBar activeTab="profile" onTabPress={handleTabPress} />
    </View>
  );
};

const ToggleRow: React.FC<{
  icon: IconName;
  title: string;
  description: string;
  value: boolean;
  busy: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  last?: boolean;
}> = ({ icon, title, description, value, busy, disabled, onChange, last }) => (
  <View style={[styles.row, last && styles.rowLast]}>
    <View style={[styles.rowIcon, value ? styles.rowIconOn : styles.rowIconOff]}>
      <Ionicons name={icon} size={18} color={value ? colors.primary : colors.neutralGray} />
    </View>
    <View style={styles.rowText}>
      <Text style={styles.rowTitle}>{title}</Text>
      <Text style={styles.rowDescription}>{description}</Text>
      <Text style={[styles.rowState, value ? styles.rowStateOn : styles.rowStateOff]}>{value ? 'ON' : 'OFF'}</Text>
    </View>
    {busy ? (
      <ActivityIndicator size="small" color={colors.primary} style={styles.rowSwitch} />
    ) : (
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.concreteLight, true: colors.statBlueBg }}
        thumbColor={value ? colors.primary : colors.white}
        ios_backgroundColor={colors.concreteLight}
        accessibilityLabel={title}
        style={styles.rowSwitch}
      />
    )}
  </View>
);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.concreteLighter },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { paddingHorizontal: spacing.md },

  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: -spacing.sm,
    marginBottom: spacing.sm,
  },
  backLinkText: { ...typography.label, color: colors.primary, marginLeft: 2 },
  title: { ...typography.h2, fontSize: 20, color: colors.textPrimary, marginBottom: spacing.sm },

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

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.concreteLight,
  },
  rowLast: { borderBottomWidth: 0 },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  rowIconOn: { backgroundColor: colors.statBlueBg },
  rowIconOff: { backgroundColor: colors.concreteLighter },
  rowText: { flex: 1, paddingRight: spacing.xs },
  rowTitle: { ...typography.label, fontWeight: '700', color: colors.textPrimary },
  rowDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  rowState: { ...typography.caption, fontWeight: '800', marginTop: 4, letterSpacing: 0.4 },
  rowStateOn: { color: colors.statGreenIcon },
  rowStateOff: { color: colors.neutralGray },
  rowSwitch: { marginLeft: spacing.xs },

  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: colors.statOrangeBg,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  noteText: { ...typography.bodySmall, color: colors.textPrimary, flex: 1 },

  bottomSpacer: { height: spacing.lg },
});

export default SettingsScreen;
