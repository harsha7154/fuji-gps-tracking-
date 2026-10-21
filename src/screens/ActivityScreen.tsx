import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Dimensions,
  PixelRatio,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomTabBar, BottomTabKey } from '../components/BottomTabBar';
import { AppHeader } from '../components/AppHeader';
import { fetchActivitiesForUser, NormalizedStage } from '../services/activityService';
import { fetchCached, peekQuery, qk } from '../query/queryClient';

const { width } = Dimensions.get('window');

const responsiveFontSize = (size: number) => {
  const fontScale = PixelRatio.getFontScale();
  return size / fontScale;
};

const responsiveSize = (size: number) => {
  const scaleFactor = width / 375;
  return size * scaleFactor;
};

const colors = {
  primary: '#0056A6',
  primaryDark: '#003E78',
  primaryLight: '#4C8FCB',
  primaryTint: '#EBF3FA',
  white: '#FFFFFF',
  black: '#000000',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  borderGray: '#E2E8F0',
  borderSoft: '#F1F3F5',
  concreteLighter: '#F5F5F5',
  success: '#15803D',
  successBg: '#DCFCE7',
  warning: '#D97706',
  warningBg: '#FEF3C7',
};

const spacing = {
  xxs: responsiveSize(4),
  xs: responsiveSize(8),
  sm: responsiveSize(12),
  md: responsiveSize(16),
  lg: responsiveSize(24),
  xl: responsiveSize(32),
};

const radius = {
  sm: responsiveSize(8),
  md: responsiveSize(12),
  lg: responsiveSize(16),
  pill: 999,
};

const systemFont = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});

const typography = {
  fontFamily: systemFont,
  h1: {
    fontSize: responsiveFontSize(26),
    fontWeight: '800' as const,
    letterSpacing: -0.3,
  },
  h2: {
    fontSize: responsiveFontSize(20),
    fontWeight: '800' as const,
    letterSpacing: -0.3,
  },
  h3: {
    fontSize: responsiveFontSize(14),
    fontWeight: '800' as const,
  },
  body: {
    fontSize: responsiveFontSize(15),
    fontWeight: '400' as const,
  },
  bodySmall: {
    fontSize: responsiveFontSize(13),
    fontWeight: '400' as const,
  },
  label: {
    fontSize: responsiveFontSize(14),
    fontWeight: '600' as const,
  },
  labelSmall: {
    fontSize: responsiveFontSize(12),
    fontWeight: '600' as const,
  },
  caption: {
    fontSize: responsiveFontSize(12),
    fontWeight: '400' as const,
  },
  captionBold: {
    fontSize: responsiveFontSize(11),
    fontWeight: '700' as const,
  },
};

type ActivityStatus =
  | 'IN PROGRESS'
  | 'COMPLETED'
  | 'READY TO START'
  | 'SCHEDULED';

type CheckpointStatus = 'completed' | 'inProgress' | 'pending';

export interface Checkpoint {
  checkpointId: string;
  checkpointName: string;
  isSelected: boolean;
  checkpointStatus: string;
}

export interface Activity {
  code: string;
  name: string;
  stage: string;
  status: ActivityStatus;
  statusBg: string;
  statusColor: string;
  desc: string;
  actual: number;
  pColor: string;
  targetQty: string;
  icon: string;
  checkpoints: Checkpoint[];
}

type FilterKey =
  | 'all'
  | 'in-progress'
  | 'ready-to-start'
  | 'completed'
  | 'scheduled';

export interface ActivityScreenProps {
  projectCode?: string;
  siteCode?: string;
  siteName?: string;
  clusterLabel?: string;
  geoBoundaryLabel?: string;
  siteProgressPct?: number;

  userId: string;

  accessToken?: string;
  refreshToken?: string;

  onTokenRefresh?: (
    newAccessToken: string,
    newRefreshToken: string,
    newExpiresAt: string,
  ) => void;

  onNavigate?: (
    screen: 'PROJECT_SELECTION' | 'HIERARCHY_SELECTION' | 'SITE_DETAILS',
  ) => void;

  onLogDailyProgress?: (
    activity: Activity,
    checkpoint?: Checkpoint,
  ) => void;

  onSelectActivity?: (activity: Activity) => void;

  onBack?: () => void;

  onNavigateToProfile?: () => void;

  onBottomTabPress?: (tab: BottomTabKey) => void;

  initialSelectedCode?: string;
}

const statusToSlug = (status: ActivityStatus): FilterKey =>
  status.toLowerCase().replace(/ /g, '-') as FilterKey;

const mapApiStatusToUiStatus = (
  status?: string,
): ActivityStatus => {
  const normalized = (status || '').toLowerCase();

  if (normalized === 'completed') {
    return 'COMPLETED';
  }

  if (
    normalized === 'inprogress' ||
    normalized === 'in-progress'
  ) {
    return 'IN PROGRESS';
  }

  if (normalized === 'ready') {
    return 'READY TO START';
  }

  return 'SCHEDULED';
};

const mapCheckpointStatus = (
  status?: string,
): CheckpointStatus => {
  const normalized = (status || '').toLowerCase();

  if (normalized === 'completed') {
    return 'completed';
  }

  if (
    normalized === 'inprogress' ||
    normalized === 'in-progress'
  ) {
    return 'inProgress';
  }

  return 'pending';
};

const getStatusColors = (status: ActivityStatus) => {
  const map: Record<
    ActivityStatus,
    {
      bg: string;
      color: string;
      pColor: string;
    }
  > = {
    'IN PROGRESS': {
      bg: '#FEF3C7',
      color: '#D97706',
      pColor: '#0056A6',
    },
    COMPLETED: {
      bg: '#DCFCE7',
      color: '#15803D',
      pColor: '#15803D',
    },
    'READY TO START': {
      bg: '#EBF3FA',
      color: '#0056A6',
      pColor: '#0056A6',
    },
    SCHEDULED: {
      bg: '#F3F4F6',
      color: '#6B7280',
      pColor: '#9CA3AF',
    },
  };

  return map[status];
};

export default function ActivityScreen({
  projectCode = 'PRJ-AW-MAH',
  siteCode = '',
  siteName = '',
  clusterLabel = '',
  geoBoundaryLabel = 'Geo-Boundary Verified within ±75m',
  siteProgressPct = 68,
  userId,
  accessToken,
  refreshToken,
  onTokenRefresh,
  onNavigate,
  onLogDailyProgress,
  onSelectActivity,
  onBack,
  onNavigateToProfile,
  onBottomTabPress,
  initialSelectedCode = 'ACT-37529',
}: ActivityScreenProps) {
  const [selectedCode, setSelectedCode] =
    useState(initialSelectedCode);

  const [activeFilter, setActiveFilter] =
    useState<FilterKey>('all');

  const [query, setQuery] = useState('');

  const [activeTab, setActiveTab] =
    useState<BottomTabKey>('activities');

  // Instant paint from the cache when opened again; refreshed behind it.
  const [stages, setStages] = useState<NormalizedStage[]>(
    () => peekQuery<{ stages: NormalizedStage[] }>(qk.activities(userId))?.stages ?? [],
  );

  const [isLoading, setIsLoading] = useState(() => !peekQuery(qk.activities(userId)));

  const [loadError, setLoadError] =
    useState<string | null>(null);

  const [expandedCodes, setExpandedCodes] =
    useState<Set<string>>(new Set());

  /*
   * Load activities for the logged-in user.
   *
   * IMPORTANT:
   * Do not add accessToken to this dependency array.
   * When the access token is refreshed, onTokenRefresh
   * updates the parent session without causing this screen
   * to continuously reload.
   */
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!peekQuery(qk.activities(userId))) setIsLoading(true);
      setLoadError(null);

      try {
        // Fetch the logged-in user's
        // stages / activities / checkpoints.
        const bundle = await fetchCached(
          qk.activities(userId),
          () => fetchActivitiesForUser(userId, accessToken, refreshToken, onTokenRefresh),
          15_000,
        );

        if (cancelled) {
          return;
        }

        setStages(bundle.stages);
      } catch (err) {
        if (cancelled) {
          return;
        }

        setLoadError(
          err instanceof Error
            ? err.message
            : 'Failed to load activities',
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    if (userId) {
      load();
    } else {
      setIsLoading(false);
      setLoadError('No user ID provided.');
    }

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const toggleExpanded = useCallback(
    (code: string) => {
      setExpandedCodes((prev) => {
        const next = new Set(prev);

        if (next.has(code)) {
          next.delete(code);
        } else {
          next.add(code);
        }

        return next;
      });
    },
    [],
  );

  const activities: Activity[] = useMemo(() => {
    const list: Activity[] = [];

    stages.forEach((stage) => {
      stage.activities.forEach((act) => {
        const uiStatus = mapApiStatusToUiStatus(
          act.activityStatus || stage.stageStatus,
        );

        const statusColors =
          getStatusColors(uiStatus);

        const total = act.checkpoints.length;

        const completed =
          act.checkpoints.filter(
            (c) =>
              c.checkpointStatus.toLowerCase() ===
              'completed',
          ).length;

        const actualPct =
          total > 0
            ? Math.round((completed / total) * 100)
            : 0;

        list.push({
          code: `ACT-${act.activityId}`,
          name: act.activityName,
          stage: stage.stageName,
          status: uiStatus,
          statusBg: statusColors.bg,
          statusColor: statusColors.color,
          desc: `${total} checkpoint${
            total > 1 ? 's' : ''
          } • ${completed} completed`,
          actual: actualPct,
          pColor: statusColors.pColor,
          targetQty: `${completed} / ${total} Checkpoints`,
          icon: '📋',
          checkpoints: act.checkpoints,
        });
      });
    });

    return list;
  }, [stages]);

  const filterCounts: Record<
    FilterKey,
    number
  > = useMemo(
    () => ({
      all: activities.length,

      'in-progress': activities.filter(
        (a) =>
          statusToSlug(a.status) === 'in-progress',
      ).length,

      'ready-to-start': activities.filter(
        (a) =>
          statusToSlug(a.status) ===
          'ready-to-start',
      ).length,

      completed: activities.filter(
        (a) =>
          statusToSlug(a.status) === 'completed',
      ).length,

      scheduled: activities.filter(
        (a) =>
          statusToSlug(a.status) === 'scheduled',
      ).length,
    }),
    [activities],
  );

  const FILTERS: {
    key: FilterKey;
    label: string;
  }[] = [
    {
      key: 'all',
      label: `All Tasks (${filterCounts.all})`,
    },
    {
      key: 'in-progress',
      label: `In Progress (${filterCounts['in-progress']})`,
    },
    {
      key: 'ready-to-start',
      label: `Ready Next (${filterCounts['ready-to-start']})`,
    },
    {
      key: 'completed',
      label: `Completed (${filterCounts.completed})`,
    },
    {
      key: 'scheduled',
      label: `Scheduled (${filterCounts.scheduled})`,
    },
  ];

  const visibleActivities = useMemo(() => {
    const q = query.trim().toLowerCase();

    return activities.filter((a) => {
      const matchesFilter =
        activeFilter === 'all' ||
        statusToSlug(a.status) === activeFilter;

      const matchesQuery =
        !q ||
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q);

      return matchesFilter && matchesQuery;
    });
  }, [
    activities,
    activeFilter,
    query,
  ]);

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (onNavigate) {
      onNavigate('SITE_DETAILS');
    }
  };

  const handleCheckpointTap = (
    activity: Activity,
    checkpoint: Checkpoint,
  ) => {
    setSelectedCode(activity.code);

    if (onLogDailyProgress) {
      onLogDailyProgress(
        activity,
        checkpoint,
      );
    }
  };

  const getStatusBadge = (
    status: ActivityStatus,
  ) => {
    const statusMap: {
      [key: string]: {
        bg: string;
        color: string;
      };
    } = {
      'IN PROGRESS': {
        bg: '#FEF3C7',
        color: '#D97706',
      },

      COMPLETED: {
        bg: '#DCFCE7',
        color: '#15803D',
      },

      'READY TO START': {
        bg: '#EBF3FA',
        color: '#0056A6',
      },

      SCHEDULED: {
        bg: '#F3F4F6',
        color: '#6B7280',
      },
    };

    return (
      statusMap[status] || {
        bg: '#F3F4F6',
        color: '#6B7280',
      }
    );
  };

  const handleTabPress = useCallback(
    (tab: BottomTabKey) => {
      setActiveTab(tab);
      onBottomTabPress?.(tab);
    },
    [onBottomTabPress],
  );

  const handleNotificationsPress =
    useCallback(() => {}, []);

  const handleAvatarPress = useCallback(() => {
    onNavigateToProfile?.();
  }, [onNavigateToProfile]);

  return (
    <View style={styles.safeArea}>
      <View style={styles.root}>
        <ScrollView
          style={styles.mainScrollView}
          contentContainerStyle={
            styles.mainScrollContent
          }
          showsVerticalScrollIndicator={true}
        >
          <AppHeader
            notificationCount={3}
            onNotificationPress={
              handleNotificationsPress
            }
            avatarIconColor="#0056A6"
            avatarBackgroundColor="#EBF3FA"
            onAvatarPress={handleAvatarPress}
          />

          <View style={styles.subHeader}>
            <View style={styles.subHeaderLeft}>
              <View style={styles.pageTitleRow}>
                <TouchableOpacity
                  onPress={handleBack}
                  hitSlop={8}
                  style={styles.pageBackButton}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                >
                  <Ionicons
                    name="chevron-back"
                    size={22}
                    color={colors.textPrimary}
                  />
                </TouchableOpacity>

                <Text style={styles.pageTitle}>
                  Select Activity
                </Text>
              </View>

              <Text style={styles.pageSub}>
                Select task to log daily progress &
                geo-evidence
              </Text>
            </View>

            <View style={styles.progressBadge}>
              <Text style={styles.progressLabel}>
                Site Progress
              </Text>

              <Text style={styles.progressValue}>
                {siteProgressPct}%
              </Text>
            </View>
          </View>

          <View style={styles.geoContainer}>
            <View style={styles.geoLeft}>
              <Ionicons
                name="location-outline"
                size={16}
                color={colors.success}
              />

              <Text style={styles.geoText}>
                {clusterLabel}
              </Text>
            </View>

            <Text style={styles.geoBadge}>
              {geoBoundaryLabel}
            </Text>

            <Text style={styles.activityCount}>
              {activities.length} ACTIVITIES
            </Text>
          </View>

          <View style={styles.searchContainer}>
            <View style={styles.searchBar}>
              <Ionicons
                name="search-outline"
                size={18}
                color={colors.textMuted}
              />

              <TextInput
                style={styles.searchInput}
                placeholder="Search"
                placeholderTextColor={
                  colors.textMuted
                }
                value={query}
                onChangeText={setQuery}
              />
            </View>

            <TouchableOpacity
              style={styles.filterButton}
            >
              <Ionicons
                name="options-outline"
                size={20}
                color={colors.white}
              />
            </TouchableOpacity>
          </View>

          <View
            style={styles.filterChipsWrapper}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.filterChipsContainer}
              contentContainerStyle={
                styles.filterChipsContent
              }
            >
              {FILTERS.map((f) => {
                const isActive =
                  activeFilter === f.key;

                return (
                  <TouchableOpacity
                    key={f.key}
                    style={[
                      styles.filterChip,
                      isActive &&
                        styles.filterChipActive,
                    ]}
                    onPress={() =>
                      setActiveFilter(f.key)
                    }
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        isActive &&
                          styles.filterChipTextActive,
                      ]}
                    >
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.activitiesContainer}>
            {isLoading && (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  Loading activities…
                </Text>
              </View>
            )}

            {!isLoading && loadError && (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  {loadError}
                </Text>
              </View>
            )}

            {!isLoading && !loadError && (
              <>
                {visibleActivities.map(
                  (activity) => {
                    const isSelected =
                      selectedCode ===
                      activity.code;

                    const statusBadge =
                      getStatusBadge(
                        activity.status,
                      );

                    const isExpanded =
                      expandedCodes.has(
                        activity.code,
                      );

                    return (
                      <View
                        key={activity.code}
                        style={[
                          styles.activityCard,
                          isSelected &&
                            styles.activityCardSelected,
                        ]}
                      >
                        <View
                          style={styles.cardTop}
                        >
                          <View
                            style={
                              styles.cardTopLeft
                            }
                          >
                            <Text
                              style={
                                styles.activityCode
                              }
                            >
                              {activity.code}
                            </Text>

                            <Text
                              style={
                                styles.activityStage
                              }
                            >
                              {activity.stage}
                            </Text>
                          </View>

                          <View
                            style={[
                              styles.statusBadge,
                              {
                                backgroundColor:
                                  statusBadge.bg,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.statusBadgeText,
                                {
                                  color:
                                    statusBadge.color,
                                },
                              ]}
                            >
                              {activity.status}
                            </Text>
                          </View>
                        </View>

                        <TouchableOpacity
                          style={styles.activityInfo}
                          activeOpacity={0.7}
                          onPress={() =>
                            toggleExpanded(
                              activity.code,
                            )
                          }
                          accessibilityRole="button"
                          accessibilityLabel={`${
                            isExpanded
                              ? 'Collapse'
                              : 'Expand'
                          } checkpoints for ${
                            activity.name
                          }`}
                        >
                          <View
                            style={
                              styles.activityIconBox
                            }
                          >
                            <Text
                              style={
                                styles.activityIcon
                              }
                            >
                              {activity.icon}
                            </Text>
                          </View>

                          <View
                            style={
                              styles.activityDetails
                            }
                          >
                            <Text
                              style={
                                styles.activityName
                              }
                            >
                              {activity.name}
                            </Text>

                            <Text
                              style={
                                styles.activityDesc
                              }
                            >
                              {activity.desc}
                            </Text>
                          </View>

                          <Ionicons
                            name={
                              isExpanded
                                ? 'chevron-up'
                                : 'chevron-down'
                            }
                            size={18}
                            color={
                              colors.textMuted
                            }
                          />
                        </TouchableOpacity>

                        {activity.checkpoints
                          .length > 0 &&
                          isExpanded && (
                            <View
                              style={
                                styles.checkpointsSection
                              }
                            >
                              <View
                                style={
                                  styles.checkpointsHeader
                                }
                              >
                                <Ionicons
                                  name="list-outline"
                                  size={13}
                                  color={
                                    colors.textSecondary
                                  }
                                />

                                <Text
                                  style={
                                    styles.checkpointsHeaderText
                                  }
                                >
                                  CHECKPOINTS (
                                  {
                                    activity
                                      .checkpoints
                                      .length
                                  }
                                  )
                                </Text>
                              </View>

                              {activity.checkpoints.map(
                                (cp) => {
                                  const cpStatus =
                                    mapCheckpointStatus(
                                      cp.checkpointStatus,
                                    );

                                  const iconName =
                                    cpStatus ===
                                    'completed'
                                      ? 'checkmark-circle'
                                      : cpStatus ===
                                          'inProgress'
                                        ? 'time-outline'
                                        : 'ellipse-outline';

                                  const iconColor =
                                    cpStatus ===
                                    'completed'
                                      ? colors.success
                                      : cpStatus ===
                                          'inProgress'
                                        ? colors.warning
                                        : colors.textMuted;

                                  const statusLabel =
                                    cpStatus ===
                                    'completed'
                                      ? 'Completed'
                                      : cpStatus ===
                                          'inProgress'
                                        ? 'In Progress'
                                        : 'Pending';

                                  const statusLabelColor =
                                    cpStatus ===
                                    'completed'
                                      ? colors.success
                                      : cpStatus ===
                                          'inProgress'
                                        ? colors.warning
                                        : colors.textMuted;

                                  const statusLabelBg =
                                    cpStatus ===
                                    'completed'
                                      ? colors.successBg
                                      : cpStatus ===
                                          'inProgress'
                                        ? colors.warningBg
                                        : '#F3F4F6';

                                  return (
                                    <TouchableOpacity
                                      key={
                                        cp.checkpointId
                                      }
                                      style={
                                        styles.checkpointCard
                                      }
                                      onPress={() =>
                                        handleCheckpointTap(
                                          activity,
                                          cp,
                                        )
                                      }
                                      activeOpacity={0.7}
                                      accessibilityRole="button"
                                      accessibilityLabel={`Log progress for ${cp.checkpointName}`}
                                    >
                                      <Ionicons
                                        name={
                                          iconName
                                        }
                                        size={18}
                                        color={
                                          iconColor
                                        }
                                      />

                                      <View
                                        style={
                                          styles.checkpointContent
                                        }
                                      >
                                        <Text
                                          style={
                                            styles.checkpointName
                                          }
                                        >
                                          {
                                            cp.checkpointName
                                          }
                                        </Text>

                                        <View
                                          style={
                                            styles.checkpointBottomRow
                                          }
                                        >
                                          <View
                                            style={[
                                              styles.checkpointStatusBadge,
                                              {
                                                backgroundColor:
                                                  statusLabelBg,
                                              },
                                            ]}
                                          >
                                            <Text
                                              style={[
                                                styles.checkpointStatusText,
                                                {
                                                  color:
                                                    statusLabelColor,
                                                },
                                              ]}
                                            >
                                              {
                                                statusLabel
                                              }
                                            </Text>
                                          </View>

                                          <View
                                            style={
                                              styles.checkpointArrow
                                            }
                                          >
                                            <Text
                                              style={
                                                styles.checkpointArrowText
                                              }
                                            >
                                              Log
                                            </Text>

                                            <Ionicons
                                              name="chevron-forward"
                                              size={14}
                                              color={
                                                colors.primary
                                              }
                                            />
                                          </View>
                                        </View>
                                      </View>
                                    </TouchableOpacity>
                                  );
                                },
                              )}
                            </View>
                          )}
                      </View>
                    );
                  },
                )}

                {visibleActivities.length ===
                  0 && (
                  <View
                    style={
                      styles.emptyContainer
                    }
                  >
                    <Text
                      style={styles.emptyText}
                    >
                      No activities match your
                      search or filter.
                    </Text>
                  </View>
                )}
              </>
            )}
          </View>

          <View style={styles.bottomSpacer} />
        </ScrollView>

        <BottomTabBar
          activeTab={activeTab}
          notificationCount={3}
          onTabPress={handleTabPress}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.white,
  },

  root: {
    flex: 1,
    backgroundColor: colors.concreteLighter,
  },

  mainScrollView: {
    flex: 1,
  },

  mainScrollContent: {
    paddingBottom: spacing.md,
  },

  subHeader: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: -20,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },

  subHeaderLeft: {
    flex: 1,
  },

  pageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },

  pageBackButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.concreteLighter,
    borderWidth: 1,
    borderColor: colors.borderGray,
    alignItems: 'center',
    justifyContent: 'center',
  },

  pageTitle: {
    ...typography.h2,
    color: colors.textPrimary,
  },

  pageSub: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
  },

  progressBadge: {
    backgroundColor: colors.concreteLighter,
    borderWidth: 1,
    borderColor: colors.borderGray,
    borderRadius: radius.sm,
    padding: spacing.xs,
    alignItems: 'center',
    minWidth: 60,
  },

  progressLabel: {
    ...typography.captionBold,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },

  progressValue: {
    ...typography.h2,
    color: colors.primary,
    fontSize: responsiveFontSize(16),
  },

  geoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    flexWrap: 'wrap',
  },

  geoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },

  geoText: {
    ...typography.labelSmall,
    color: colors.textPrimary,
  },

  geoBadge: {
    ...typography.captionBold,
    color: colors.success,
    backgroundColor: colors.successBg,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },

  activityCount: {
    ...typography.captionBold,
    color: colors.primary,
    backgroundColor: colors.primaryTint,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    gap: spacing.sm,
  },

  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.concreteLighter,
    borderWidth: 1,
    borderColor: colors.borderGray,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    height: 38,
  },

  searchInput: {
    flex: 1,
    ...typography.bodySmall,
    color: colors.textPrimary,
    marginLeft: spacing.xs,
    padding: 0,
    height: 38,
  },

  filterButton: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  filterChipsWrapper: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    paddingVertical: spacing.xxs,
  },

  filterChipsContainer: {
    flexGrow: 0,
  },

  filterChipsContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
    height: 32,
    alignItems: 'center',
  },

  filterChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderGray,
    backgroundColor: colors.white,
    marginRight: spacing.xs,
    height: 28,
    justifyContent: 'center',
  },

  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  filterChipText: {
    ...typography.captionBold,
    fontSize: responsiveFontSize(10),
    color: colors.textSecondary,
  },

  filterChipTextActive: {
    color: colors.white,
  },

  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.concreteLighter,
  },

  listTitle: {
    ...typography.label,
    fontSize: responsiveFontSize(13),
    color: colors.textPrimary,
  },

  listSub: {
    ...typography.caption,
    fontSize: responsiveFontSize(10),
    color: colors.textSecondary,
  },

  activitiesContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    marginTop: 0,
  },

  activityCard: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.borderGray,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },

  activityCardSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    shadowColor: colors.primary,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },

  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xxs,
  },

  cardTopLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },

  activityCode: {
    ...typography.captionBold,
    fontSize: responsiveFontSize(9),
    color: colors.primary,
    backgroundColor: colors.primaryTint,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },

  activityStage: {
    ...typography.caption,
    fontSize: responsiveFontSize(9),
    color: colors.textSecondary,
  },

  statusBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },

  statusBadgeText: {
    ...typography.captionBold,
    fontSize: responsiveFontSize(8),
  },

  activityInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },

  activityIconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.concreteLighter,
    alignItems: 'center',
    justifyContent: 'center',
  },

  activityIcon: {
    fontSize: responsiveFontSize(18),
  },

  activityDetails: {
    flex: 1,
  },

  activityName: {
    ...typography.label,
    fontSize: responsiveFontSize(13),
    color: colors.textPrimary,
  },

  activityDesc: {
    ...typography.caption,
    fontSize: responsiveFontSize(10),
    color: colors.textSecondary,
    marginTop: 1,
  },

  checkpointsSection: {
    gap: 8,
  },

  checkpointsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    marginBottom: 2,
  },

  checkpointsHeaderText: {
    ...typography.captionBold,
    fontSize: responsiveFontSize(9),
    color: colors.textSecondary,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  checkpointCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.sm,
    padding: 10,
  },

  checkpointContent: {
    flex: 1,
  },

  checkpointName: {
    ...typography.bodySmall,
    fontSize: responsiveFontSize(11.5),
    color: colors.textPrimary,
    lineHeight: 16,
  },

  checkpointBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },

  checkpointStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },

  checkpointStatusText: {
    fontSize: responsiveFontSize(9),
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  checkpointArrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },

  checkpointArrowText: {
    ...typography.captionBold,
    fontSize: responsiveFontSize(10),
    color: colors.primary,
  },

  emptyContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },

  emptyText: {
    ...typography.caption,
    color: colors.textMuted,
  },

  bottomSpacer: {
    height: spacing.lg,
  },
});