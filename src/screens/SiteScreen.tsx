import React, { useMemo, useState } from 'react';
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
import { colors, radius, spacing, typography } from '../theme';

export interface SelectedProduct {
  id: string;
  code: string;
  name: string;
}

export interface Site {
  id: string;
  code: string;
  name: string;
  district: string;
  cluster: string;
  status: 'IN PROGRESS' | 'NOT STARTED' | 'COMPLETED';
  progress: number;
}

interface SiteScreenProps {
  project: SelectedProduct;
  onBack: () => void;
  notificationCount?: number;
  onLogout?: () => void;
  onSiteSelect?: (site: Site) => void;
  onBottomTabPress?: (tab: BottomTabKey) => void;
  onNavigateToProfile?: () => void;
}

const DISTRICTS = [
  { name: 'All Districts', count: null },
  { name: 'Nagpur', count: 8 },
  { name: 'Pune', count: 5 },
  { name: 'Nashik', count: 4 },
];

const CLUSTERS = [
  'All Clusters',
  'Cluster 01 – Hingna',
  'Cluster 02 – Digdoh',
  'Cluster 03 – Haveli',
];

const SITES: Site[] = [
  {
    id: '1',
    code: 'AW-NGP-001',
    name: 'Digdoh Anganwadi Center',
    district: 'Nagpur',
    cluster: 'Cluster 02 – Digdoh',
    status: 'IN PROGRESS',
    progress: 68,
  },
  {
    id: '2',
    code: 'AW-NGP-002',
    name: 'Hingna Phase-1 Center',
    district: 'Nagpur',
    cluster: 'Cluster 01 – Hingna',
    status: 'IN PROGRESS',
    progress: 45,
  },
  {
    id: '3',
    code: 'AW-NGP-003',
    name: 'Beltarodi Model Center',
    district: 'Nagpur',
    cluster: 'Cluster 02 – Digdoh',
    status: 'NOT STARTED',
    progress: 0,
  },
  {
    id: '4',
    code: 'AW-NGP-004',
    name: 'Wathoda Rural Center',
    district: 'Nagpur',
    cluster: 'Cluster 01 – Hingna',
    status: 'COMPLETED',
    progress: 100,
  },
  {
    id: '5',
    code: 'AW-PUN-001',
    name: 'Haveli Anganwadi Site',
    district: 'Pune',
    cluster: 'Cluster 03 – Haveli',
    status: 'IN PROGRESS',
    progress: 28,
  },
  {
    id: '6',
    code: 'AW-PUN-002',
    name: 'Pune Rural Center',
    district: 'Pune',
    cluster: 'Cluster 03 – Haveli',
    status: 'NOT STARTED',
    progress: 0,
  },
  {
    id: '7',
    code: 'AW-NAS-001',
    name: 'Nashik Rural Center',
    district: 'Nashik',
    cluster: 'Cluster 01 – Hingna',
    status: 'IN PROGRESS',
    progress: 52,
  },
];

const SiteScreen: React.FC<SiteScreenProps> = ({
  project,
  onBack,
  notificationCount = 3,
  onLogout,
  onSiteSelect,
  onBottomTabPress,
  onNavigateToProfile,
}) => {
  const [selectedDistrict, setSelectedDistrict] = useState('All Districts');
  const [selectedCluster, setSelectedCluster] = useState('All Clusters');
  const [activeTab, setActiveTab] = useState<BottomTabKey>('sites');

  const filteredSites = useMemo(() => {
    return SITES.filter((site) => {
      const districtMatches =
        selectedDistrict === 'All Districts' ||
        site.district === selectedDistrict;

      const clusterMatches =
        selectedCluster === 'All Clusters' ||
        site.cluster === selectedCluster;

      return districtMatches && clusterMatches;
    });
  }, [selectedDistrict, selectedCluster]);

  const handleTabPress = (tab: BottomTabKey) => {
    setActiveTab(tab);
    onBottomTabPress?.(tab);
  };

  const getStatusStyle = (status: Site['status']) => {
    if (status === 'COMPLETED') {
      return {
        container: styles.completedBadge,
        text: styles.completedBadgeText,
        progress: colors.success,
      };
    }

    if (status === 'NOT STARTED') {
      return {
        container: styles.notStartedBadge,
        text: styles.notStartedBadgeText,
        progress: colors.borderGray,
      };
    }

    return {
      container: styles.inProgressBadge,
      text: styles.inProgressBadgeText,
      progress: colors.warning,
    };
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.mainScrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <AppHeader
          logoWidth={145}
          notificationCount={notificationCount}
          onNotificationPress={() =>
            console.log('Notifications pressed')
          }
          onAvatarPress={() => onNavigateToProfile?.()}
        />

        {/* TITLE */}
        <View style={styles.titleSection}>
          <Pressable
            onPress={onBack}
            hitSlop={8}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons
              name="chevron-back"
              size={24}
              color={colors.textPrimary}
            />
          </Pressable>

          <View style={styles.titleContainer}>
            <Text style={styles.title}>Select Site</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {project.name}
            </Text>
          </View>
        </View>

        {/* DISTRICT FILTER */}
        <View style={styles.filterSection}>
          <Text style={styles.filterLabel}>FILTER BY DISTRICT</Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContent}
          >
            {DISTRICTS.map((district) => {
              const isSelected = selectedDistrict === district.name;

              return (
                <Pressable
                  key={district.name}
                  onPress={() => setSelectedDistrict(district.name)}
                  style={[
                    styles.filterChip,
                    isSelected && styles.selectedFilterChip,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      isSelected && styles.selectedFilterChipText,
                    ]}
                  >
                    {district.name}
                    {district.count !== null ? ` (${district.count})` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* CLUSTER FILTER */}
        <View style={styles.clusterSection}>
          <Text style={styles.filterLabel}>CLUSTER</Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContent}
          >
            {CLUSTERS.map((cluster) => {
              const isSelected = selectedCluster === cluster;

              return (
                <Pressable
                  key={cluster}
                  onPress={() => setSelectedCluster(cluster)}
                  style={[
                    styles.filterChip,
                    isSelected && styles.selectedFilterChip,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      isSelected && styles.selectedFilterChipText,
                    ]}
                  >
                    {cluster}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {/* SITES */}
        <View style={styles.sitesHeader}>
          <Text style={styles.sitesTitle}>Sites in this Project</Text>
          <Text style={styles.sitesCount}>
            {filteredSites.length === SITES.length
              ? '17 sites total'
              : `${filteredSites.length} sites`}
          </Text>
        </View>

        {filteredSites.map((site) => {
          const statusStyle = getStatusStyle(site.status);

          return (
            <Pressable
              key={site.id}
              onPress={() => onSiteSelect?.(site)}
              style={styles.siteCard}
            >
              <View style={styles.siteIconBox}>
                <Ionicons
                  name="briefcase-outline"
                  size={28}
                  color={colors.primary}
                />
              </View>

              <View style={styles.siteMain}>
                <View style={styles.siteTopRow}>
                  <View style={styles.siteNameBlock}>
                    <Text style={styles.siteCode}>{site.code}</Text>
                    <Text style={styles.siteName} numberOfLines={2}>
                      {site.name}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.statusBadge,
                      statusStyle.container,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        statusStyle.text,
                      ]}
                      numberOfLines={1}
                    >
                      {site.status}
                    </Text>
                  </View>
                </View>

                <View style={styles.locationRow}>
                  <Ionicons
                    name="location-outline"
                    size={14}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.locationText} numberOfLines={1}>
                    {site.district} • {site.cluster}
                  </Text>
                </View>

                <View style={styles.progressHeader}>
                  <Text style={styles.progressLabel}>Progress</Text>
                  <Text
                    style={[
                      styles.progressPercent,
                      site.progress > 0 &&
                      site.status !== 'NOT STARTED' && {
                        color: statusStyle.progress,
                      },
                    ]}
                  >
                    {site.progress}%
                  </Text>
                </View>

                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${site.progress}%`,
                        backgroundColor: statusStyle.progress,
                      },
                    ]}
                  />
                </View>
              </View>

              <View style={styles.siteArrow}>
                <Ionicons
                  name="chevron-forward"
                  size={21}
                  color={colors.primary}
                />
              </View>
            </Pressable>
          );
        })}

        {filteredSites.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons
              name="location-outline"
              size={42}
              color={colors.textSecondary}
            />
            <Text style={styles.emptyTitle}>No sites found</Text>
            <Text style={styles.emptyText}>
              Try another district or cluster.
            </Text>
          </View>
        )}
      </ScrollView>

      <BottomTabBar activeTab={activeTab} onTabPress={handleTabPress} />
    </View>
  );
};

export default SiteScreen;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
  },

  mainScrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingBottom: spacing.xxxl,
  },

  titleSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },

  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.concreteLighter,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },

  titleContainer: {
    flex: 1,
    minWidth: 0,
  },

  title: {
    ...typography.h2,
    fontSize: 22,
    lineHeight: 27,
    color: colors.textPrimary,
  },

  subtitle: {
    ...typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: 2,
  },

  filterSection: {
    paddingTop: spacing.sm,
  },

  clusterSection: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
  },

  filterLabel: {
    paddingHorizontal: spacing.md,
    marginBottom: 8,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.4,
  },

  chipsContent: {
    paddingHorizontal: spacing.md,
    paddingRight: spacing.lg,
    gap: spacing.xs,
  },

  filterChip: {
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },

  selectedFilterChip: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  filterChipText: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },

  selectedFilterChipText: {
    color: colors.white,
  },

  sitesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 10,
    backgroundColor: colors.concreteLighter,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },

  sitesTitle: {
    ...typography.h2,
    fontSize: 17,
    lineHeight: 22,
    color: colors.textPrimary,
    flex: 1,
  },

  sitesCount: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
    flexShrink: 0,
  },

  siteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    minHeight: 118,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  siteIconBox: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.concreteLighter,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
    flexShrink: 0,
  },

  siteMain: {
    flex: 1,
    minWidth: 0,
  },

  siteTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },

  siteNameBlock: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },

  siteCode: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },

  siteName: {
    marginTop: 2,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    color: '#394150',
  },

  statusBadge: {
    minHeight: 24,
    paddingHorizontal: 7,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  statusBadgeText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
  },

  inProgressBadge: {
    backgroundColor: '#FFF1C7',
  },

  inProgressBadgeText: {
    color: '#E8920C',
  },

  notStartedBadge: {
    backgroundColor: colors.concreteLighter,
  },

  notStartedBadgeText: {
    color: colors.textSecondary,
  },

  completedBadge: {
    backgroundColor: '#DDF6E6',
  },

  completedBadgeText: {
    color: colors.success,
  },

  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },

  locationText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 4,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
  },

  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },

  progressLabel: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.textSecondary,
  },

  progressPercent: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    color: colors.textSecondary,
  },

  progressTrack: {
    height: 5,
    marginTop: spacing.xxs,
    borderRadius: radius.pill,
    backgroundColor: colors.borderGray,
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
  },

  siteArrow: {
    width: 34,
    height: 34,
    marginLeft: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.concreteLighter,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  emptyState: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },

  emptyTitle: {
    ...typography.h2,
    fontSize: 18,
    marginTop: spacing.sm,
    color: colors.textPrimary,
  },

  emptyText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
});