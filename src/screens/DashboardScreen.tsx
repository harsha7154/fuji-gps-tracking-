import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppHeader } from '../components/AppHeader';
import { BottomTabBar, BottomTabKey } from '../components/BottomTabBar';
import { CircularProgress } from '../components/CircularProgress';
import { QuickActionCard } from '../components/QuickActionCard';
import { StatCard } from '../components/StatCard';
import { dashboardService } from '../services/dashboardService';
import type { UserProfile } from '../types/auth';
import { ROLE_LABELS } from '../types/auth';
import type { DashboardData, QuickActionKey } from '../types/dashboard';
import { colors, radius, spacing, typography } from '../theme';

interface DashboardScreenProps {
  user: UserProfile;
  onLogout: () => void;
  onNavigateToActivity?: () => void;
  onNavigateToProfile?: () => void;
  onNavigateToProductSelection?: () => void;
  onNavigateToUpdateProgress?: () => void;
  onBottomTabPress?: (tab: BottomTabKey) => void;
}

const QUICK_ACTION_ICONS: Record<
  QuickActionKey,
  { icon: React.ComponentProps<typeof Ionicons>['name'] }
> = {
  myActivities: { icon: 'clipboard-outline' },
  updateProgress: { icon: 'camera-outline' },
  materialReceipt: { icon: 'cube-outline' },
  dispatchTrip: { icon: 'car-outline' },
  liveTracking: { icon: 'location-outline' },
  scanQrElement: { icon: 'qr-code-outline' },
};

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  user,
  onLogout,
  onNavigateToActivity,
  onNavigateToProfile,
  onNavigateToProductSelection,
  onNavigateToUpdateProgress,
  onBottomTabPress,
}) => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [activeTab, setActiveTab] = useState<BottomTabKey>('home');

  useEffect(() => {
    let isMounted = true;
    dashboardService.getDashboard().then((result) => {
      if (isMounted) setData(result);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleTabPress = useCallback(
    (tab: BottomTabKey) => {
      setActiveTab(tab);
      onBottomTabPress?.(tab);
    },
    [onBottomTabPress]
  );

  const handleChangeSite = useCallback(() => {
    onNavigateToProductSelection?.();
  }, [onNavigateToProductSelection]);

  const handleViewAllSummary = useCallback(() => {
    console.log('[DashboardScreen] View All (summary) pressed — not yet implemented.');
  }, []);

  const handleProgressPeriodPress = useCallback(() => {
    console.log('[DashboardScreen] Progress period selector pressed — not yet implemented.');
  }, []);

  const handleQuickAction = useCallback(
  (key: QuickActionKey) => {
    if (key === 'myActivities') {
      onNavigateToActivity?.();
      return;
    }

    if (key === 'updateProgress') {
      onNavigateToUpdateProgress?.();
      return;
    }

    console.log(`[DashboardScreen] Quick action "${key}" pressed — not yet implemented.`);
  },
  [onNavigateToActivity, onNavigateToUpdateProgress]
);

  const handleNotificationsPress = useCallback(() => {
    setActiveTab('notifications');
    console.log('[DashboardScreen] Notifications pressed — not yet implemented.');
  }, []);

  const handleAvatarPress = useCallback(() => {
    onNavigateToProfile?.();
  }, [onNavigateToProfile]);

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
          notificationCount={data?.notificationCount ?? 1}
          notificationBadgeColor="#0B5FA8"
          onNotificationPress={handleNotificationsPress}
          avatarIcon="person"
          avatarIconColor="#D97706"
          avatarBackgroundColor="#FEF3D6"
          onAvatarPress={handleAvatarPress}
        />

        <View style={styles.content}>
          <Text style={styles.greeting}>
            Good Morning, <Text style={styles.greetingName}>{user.firstName}</Text>
          </Text>
          <Text style={styles.roleText}>{ROLE_LABELS[user.role]}</Text>

          <View style={[styles.card, styles.siteCard]}>
            <View style={styles.siteIconBadge}>
              <Ionicons name="location" size={20} color={colors.avatarIcon} />
            </View>
            <View style={styles.siteInfo}>
              <Text style={styles.siteLabel}>Current Site</Text>
              <Text style={styles.siteValue} numberOfLines={1}>
                {data ? `${data.currentSite.code} ${data.currentSite.name}` : '—'}
              </Text>
            </View>
            <Pressable onPress={handleChangeSite} hitSlop={8} style={styles.changeSiteButton}>
              <Text style={styles.changeSiteText}>Change Site</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.primary} />
            </Pressable>
          </View>

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeading}>Today's Summary</Text>
            <Pressable onPress={handleViewAllSummary} hitSlop={8}>
              <Text style={styles.linkText}>View All</Text>
            </Pressable>
          </View>

          <View style={styles.statsRow}>
            <StatCard
              icon="clipboard-outline"
              iconBackground={colors.statBlueBg}
              iconColor={colors.statBlueIcon}
              value={data?.summary.activitiesPlanned ?? '—'}
              label="Activities Planned"
            />
            <StatCard
              icon="checkmark-circle"
              iconBackground={colors.statGreenBg}
              iconColor={colors.statGreenIcon}
              value={data?.summary.activitiesCompleted ?? '—'}
              valueColor={colors.statGreenIcon}
              label="Activities Completed"
            />
            <StatCard
              icon="time"
              iconBackground={colors.statOrangeBg}
              iconColor={colors.statOrangeIcon}
              value={data?.summary.activitiesInProgress ?? '—'}
              valueColor={colors.statOrangeIcon}
              label="In Progress Activities"
            />
            <StatCard
              icon="alert-circle"
              iconBackground={colors.statRedBg}
              iconColor={colors.statRedIcon}
              value={data?.summary.pendingApprovals ?? '—'}
              valueColor={colors.statRedIcon}
              label="Pending Approvals"
            />
          </View>

          <Text style={[styles.sectionHeading, styles.quickActionsHeading]}>Quick Actions</Text>

          <View style={styles.quickActionsGrid}>
            {(data?.quickActions ?? []).map((action) => (
              <QuickActionCard
                key={action.key}
                icon={QUICK_ACTION_ICONS[action.key].icon}
                iconFamily="ionicons"
                label={action.label}
                onPress={() => handleQuickAction(action.key)}
              />
            ))}
          </View>

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionHeading}>My Progress</Text>
            <Pressable
              onPress={handleProgressPeriodPress}
              hitSlop={8}
              style={styles.periodSelector}
            >
              <Text style={styles.linkText}>{data?.progress.periodLabel ?? 'This Week'}</Text>
              <Ionicons name="chevron-down" size={16} color={colors.primary} />
            </Pressable>
          </View>

          <View style={[styles.card, styles.progressCard]}>
            <View style={styles.progressInfo}>
              <Text style={styles.progressLabel}>Overall Progress</Text>
              <Text style={styles.progressPercent}>
                {data?.progress.overallProgressPercent ?? 0}
                <Text style={styles.progressPercentSign}>%</Text>
              </Text>
              <Text style={styles.progressCheckpoints}>
                {data
                  ? `${data.progress.completedCheckpoints} / ${data.progress.totalCheckpoints} Checkpoints`
                  : '—'}
              </Text>
            </View>

            <CircularProgress
              progress={data?.progress.overallProgressPercent ?? 0}
              size={76}
              strokeWidth={7}
            >
              <Ionicons name="stats-chart" size={26} color={colors.primary} />
            </CircularProgress>
          </View>

          <View style={styles.bottomSpacer} />
        </View>
      </ScrollView>

      <BottomTabBar
        activeTab={activeTab}
        notificationCount={data?.notificationCount ?? 0}
        onTabPress={handleTabPress}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  content: {
    paddingHorizontal: spacing.md,
    marginTop: -spacing.lg,
  },

  greeting: { ...typography.h1, color: colors.textPrimary },
  greetingName: { color: colors.primary },
  roleText: {
    ...typography.body,
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

  siteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  siteIconBadge: {
    width: 44, height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.avatarBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  siteInfo: { flex: 1 },
  siteLabel: { ...typography.bodySmall, color: colors.textSecondary },
  siteValue: {
    ...typography.label,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: 2,
  },
  changeSiteButton: { flexDirection: 'row', alignItems: 'center' },
  changeSiteText: {
    ...typography.label,
    color: colors.primary,
    marginRight: 2,
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    paddingTop: spacing.lg,
  },

  sectionHeading: {
    ...typography.h2,
    fontSize: 18,
    color: colors.textPrimary,
  },
  quickActionsHeading: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  linkText: { ...typography.label, color: colors.primary },
  periodSelector: { flexDirection: 'row', alignItems: 'center' },

  statsRow: { flexDirection: 'row', gap: spacing.xs },

  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  progressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  progressInfo: { flex: 1 },
  progressLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.xxs,
  },
  progressPercent: {
    ...typography.h1,
    fontSize: 32,
    color: colors.primary,
  },
  progressPercentSign: { fontSize: 20 },
  progressCheckpoints: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },

  bottomSpacer: { height: spacing.lg },
});