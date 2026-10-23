import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppHeader } from '../components/AppHeader';
import { BottomTabBar, BottomTabKey } from '../components/BottomTabBar';
import type { UserProfile } from '../types/auth';
import { colors, radius, spacing, typography } from '../theme';

interface OperationalAction {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBackground: string;
}

const OPERATIONAL_ACTIONS: OperationalAction[] = [
  {
    key: 'liferaySync',
    label: 'Liferay Sync Center & Queue',
    icon: 'sync-outline',
    iconColor: colors.statBlueIcon,
    iconBackground: colors.statBlueBg,
  },
  {
    key: 'offlineHub',
    label: 'Offline Operations Hub',
    icon: 'flash-outline',
    iconColor: colors.statOrangeIcon,
    iconBackground: colors.statOrangeBg,
  },
  {
    key: 'hardwareAudit',
    label: 'Hardware Security & Sensor Audit',
    icon: 'shield-checkmark-outline',
    iconColor: colors.statGreenIcon,
    iconBackground: colors.statGreenBg,
  },
  {
    key: 'support',
    label: 'Help & Engineering Support',
    icon: 'call-outline',
    iconColor: colors.statBlueIcon,
    iconBackground: colors.statBlueBg,
  },
];

interface EngineerProfileScreenProps {
  user: UserProfile;
  onBack: () => void;
  onLogout: () => void;
  onBottomTabPress?: (tab: BottomTabKey) => void;
}

export const EngineerProfileScreen: React.FC<EngineerProfileScreenProps> = ({
  user,
  onBack,
  onLogout,
  onBottomTabPress,
}) => {
  const [activeTab, setActiveTab] = useState<BottomTabKey>('more');

  const handleTabPress = useCallback(
    (tab: BottomTabKey) => {
      if (tab === 'more') {
        setActiveTab('more');
        return;
      }
      if (onBottomTabPress) {
        onBottomTabPress(tab);
        return;
      }
      if (tab === 'home') {
        onBack();
        return;
      }
      setActiveTab(tab);
    },
    [onBack, onBottomTabPress]
  );

  const handleActionPress = useCallback((key: string) => {
    console.log(`[EngineerProfileScreen] Operational action "${key}" pressed — not yet implemented.`);
  }, []);

  const displayName = user.fullName || user.alternateName || '';
  const roleLineText = `${user.jobTitle || 'SITE ENGINEER'} • ID: ${user.id}`;
  const contactLineText = [user.email, user.alternateName ? `@${user.alternateName}` : '']
    .filter(Boolean)
    .join(' • ');

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
          notificationCount={0}
          notificationBadgeColor="#0B5FA8"
          onNotificationPress={() => console.log('[EngineerProfileScreen] Notifications pressed.')}
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

          <Text style={styles.title}>Field Engineer Profile</Text>
          <Text style={styles.titleSubtext}>Account identity & device status</Text>

          <View style={[styles.card, styles.identityCard]}>
            <View style={styles.avatar}>
              <Ionicons name="person" size={30} color={colors.avatarIcon} />
            </View>
            <Text style={styles.name}>{displayName}</Text>
            <Text style={styles.roleLine}>{roleLineText}</Text>
            <Text style={styles.contactLine}>{contactLineText}</Text>
          </View>

          <View style={[styles.card, styles.infoCard]}>
            <Text style={styles.cardHeading}>Liferay User Account</Text>
            <InfoRow label="Email" value={user.email || 'N/A'} />
            <InfoRow label="Username" value={user.alternateName || 'N/A'} />
            <InfoRow label="Account Status" value={user.status || 'Active'} />
            <InfoRow label="External Ref Code" value={user.externalReferenceCode || 'N/A'} last />
          </View>

          <View style={[styles.card, styles.actionsCard]}>
            <Text style={styles.actionsHeading}>OPERATIONAL ACTIONS & DIAGNOSTICS</Text>
            {OPERATIONAL_ACTIONS.map((action, index) => (
              <Pressable
                key={action.key}
                onPress={() => handleActionPress(action.key)}
                style={({ pressed }) => [
                  styles.actionRow,
                  index === OPERATIONAL_ACTIONS.length - 1 && styles.actionRowLast,
                  pressed && styles.actionRowPressed,
                ]}
              >
                <View style={[styles.actionIconWrapper, { backgroundColor: action.iconBackground }]}>
                  <Ionicons name={action.icon} size={18} color={action.iconColor} />
                </View>
                <Text style={styles.actionLabel}>{action.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.tabInactive} />
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={onLogout}
            accessibilityRole="button"
            accessibilityLabel="Logout / Lock Terminal"
            style={({ pressed }) => [styles.logoutButton, pressed && styles.logoutButtonPressed]}
          >
            <Ionicons name="lock-closed-outline" size={18} color={colors.error} />
            <Text style={styles.logoutText}>Logout / Lock Terminal</Text>
          </Pressable>

          <View style={styles.bottomSpacer} />
        </View>
      </ScrollView>

      <BottomTabBar activeTab={activeTab} onTabPress={handleTabPress} />
    </View>
  );
};

const InfoRow: React.FC<{ label: string; value: string; last?: boolean }> = ({
  label,
  value,
  last,
}) => (
  <View style={[infoRowStyles.row, last && infoRowStyles.rowLast]}>
    <Text style={infoRowStyles.label}>{label}</Text>
    <Text style={infoRowStyles.value} numberOfLines={2}>
      {value}
    </Text>
  </View>
);

const infoRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  rowLast: { marginBottom: 0 },
  label: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  value: {
    ...typography.label,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1.2,
    textAlign: 'right',
  },
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { paddingHorizontal: spacing.md },

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

  title: { ...typography.h2, fontSize: 20, color: colors.textPrimary },
  titleSubtext: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: spacing.md,
  },

  card: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
  },

  identityCard: { alignItems: 'center', padding: spacing.lg, marginBottom: spacing.md },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.avatarBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  name: { ...typography.h2, fontSize: 17, color: colors.textPrimary, textAlign: 'center' },
  roleLine: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 2,
    textAlign: 'center',
  },
  contactLine: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },

  infoCard: { padding: spacing.md, marginBottom: spacing.md },
  cardHeading: { ...typography.label, fontWeight: '700', color: colors.textPrimary },

  actionsCard: { padding: spacing.md, marginBottom: spacing.lg },
  actionsHeading: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  actionRowLast: { borderBottomWidth: 0 },
  actionRowPressed: { backgroundColor: colors.concreteLighter },
  actionIconWrapper: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  actionLabel: { ...typography.label, fontWeight: '600', color: colors.textPrimary, flex: 1 },

  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.errorBackground,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
  },
  logoutButtonPressed: { opacity: 0.8 },
  logoutText: { ...typography.button, fontSize: 14, color: colors.error, marginLeft: spacing.xs },

  bottomSpacer: { height: spacing.lg },
});

export default EngineerProfileScreen;