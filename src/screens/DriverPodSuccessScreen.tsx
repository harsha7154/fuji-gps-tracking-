import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppHeader } from '../components/AppHeader';
import { DriverBottomTabBar, DriverBottomTabKey } from '../components/DriverBottomTabBar';
import { PrimaryButton } from '../components/PrimaryButton';
import type { PodSubmissionResult, PodTripSummary } from '../types/driverWorkflow';
import { colors, radius, spacing, typography } from '../theme';

interface DriverPodSuccessScreenProps {
  tripSummary: PodTripSummary | null;
  submissionResult: PodSubmissionResult | null;
  onViewTripHistory: () => void;
  onBackToDashboard: () => void;
  onNavigateToProfile?: () => void;
  onNavigateToNotifications?: () => void;
  onNavigateToMyTrip?: () => void;
  onNavigateToLiveGps?: () => void;
  notificationCount?: number;
}

/**
 * Simplified Truck Driver POD submission confirmation screen.
 * Shows a concise success confirmation with key dispatch reference and a simple navigation action.
 */
export const DriverPodSuccessScreen: React.FC<DriverPodSuccessScreenProps> = ({
  tripSummary,
  submissionResult,
  onViewTripHistory,
  onBackToDashboard,
  onNavigateToProfile,
  onNavigateToNotifications,
  onNavigateToMyTrip,
  onNavigateToLiveGps,
  notificationCount,
}) => {
  const [activeTab, setActiveTab] = useState<DriverBottomTabKey>('dashboard');

  const handleTabPress = useCallback(
    (tab: DriverBottomTabKey) => {
      setActiveTab(tab);
      if (tab === 'dashboard') {
        onBackToDashboard();
        return;
      }
      if (tab === 'history') {
        onViewTripHistory();
        return;
      }
      if (tab === 'profile') {
        onNavigateToProfile?.();
        return;
      }
      if (tab === 'myTrip') {
        onNavigateToMyTrip?.();
        return;
      }
      if (tab === 'liveGps') {
        onNavigateToLiveGps?.();
        return;
      }
    },
    [onBackToDashboard, onNavigateToProfile, onViewTripHistory, onNavigateToMyTrip, onNavigateToLiveGps]
  );

  const dispatchRef =
    submissionResult?.dispatchId || tripSummary?.tripId || '—';
  const siteRef =
    tripSummary?.siteName || tripSummary?.siteCode || '';
  const photosCount = submissionResult?.photosCount ?? 1;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <AppHeader
          logoWidth={100}
          notificationCount={notificationCount ?? 0}
          onNotificationPress={onNavigateToNotifications}
          avatarIconColor={colors.statOrangeIcon}
          avatarBackgroundColor={colors.statOrangeBg}
          onAvatarPress={onNavigateToProfile}
        />

        <View style={styles.content}>
          <View style={styles.titleRow}>
            <View style={styles.headerTitleBlock}>
              <Text style={styles.title}>Proof of Delivery</Text>
              <Text style={styles.titleSubtext}>Submission Confirmed</Text>
            </View>
            <View style={styles.moduleBadge}>
              <Text style={styles.moduleBadgeText}>DELIVERED</Text>
            </View>
          </View>

          <View style={[styles.card, styles.successCard]}>
            <View style={styles.successIconWrap}>
              <Ionicons name="checkmark" size={36} color={colors.statGreenIcon} />
            </View>

            <Text style={styles.successHeadline}>
              Proof of Delivery submitted successfully
            </Text>

            <View style={styles.infoPill}>
              <Text style={styles.infoPillLabel}>Dispatch</Text>
              <Text style={styles.infoPillValue}>{dispatchRef}</Text>
            </View>

            {siteRef ? (
              <View style={styles.metaRow}>
                <Ionicons name="location-outline" size={15} color={colors.textSecondary} />
                <Text style={styles.metaText} numberOfLines={1}>
                  {siteRef}
                </Text>
              </View>
            ) : null}

            <View style={styles.metaRow}>
              <Ionicons name="camera-outline" size={15} color={colors.statGreenIcon} />
              <Text style={styles.metaTextGreen}>
                {photosCount} photo evidence attached & verified
              </Text>
            </View>
          </View>

          <View style={styles.bottomSpacer} />
        </View>
      </ScrollView>

      <View style={styles.stickyActions}>
        <Pressable style={styles.historyButton} onPress={onViewTripHistory}>
          <Text style={styles.historyButtonText}>Trip History</Text>
        </Pressable>
        <PrimaryButton
          label="Back to Dashboard"
          onPress={onBackToDashboard}
          style={styles.dashboardButton}
        />
      </View>

      <DriverBottomTabBar activeTab={activeTab} onTabPress={handleTabPress} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { paddingHorizontal: spacing.md },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  headerTitleBlock: { flex: 1 },
  title: { ...typography.h2, fontSize: 20, color: colors.textPrimary },
  titleSubtext: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  moduleBadge: {
    backgroundColor: colors.statGreenBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
  },
  moduleBadgeText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: colors.statGreenIcon,
    letterSpacing: 0.3,
  },

  card: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
  },
  successCard: {
    alignItems: 'center',
    padding: spacing.xl,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  successIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: colors.statGreenBg,
    borderWidth: 2,
    borderColor: colors.statGreenIcon,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  successHeadline: {
    ...typography.h2,
    fontSize: 18,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },

  infoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.statBlueBg,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  infoPillLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  infoPillValue: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.primary,
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xxs,
  },
  metaText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  metaTextGreen: {
    ...typography.bodySmall,
    color: colors.statGreenIcon,
    fontWeight: '600',
  },

  bottomSpacer: { height: spacing.xl },

  stickyActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.white,
  },
  historyButton: {
    flex: 1,
    height: 48,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyButtonText: { ...typography.button, color: colors.textPrimary },
  dashboardButton: { flex: 1.8 },
});
