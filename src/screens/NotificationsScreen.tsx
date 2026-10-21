import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    AppState,
    Pressable,
    SectionList,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { notificationService } from '../services/notificationService';
import type { LiferayNotification } from '../services/notificationService';
import { colors, radius, spacing, typography } from '../theme';
import {
    cleanActionLabel,
    extractNotificationLink,
    openNotificationUrl,
} from '../utils/notificationLinkHelper';
import { getNotificationText, getNotificationTitle } from '../utils/notificationContent';
import { apiClient } from '../api/client';
import { fetchCached, peekQuery, qk, queryClient, refetchFresh } from '../query/queryClient';

interface NotificationsScreenProps {
    accessToken: string;
    refreshToken: string;
    onTokenRefresh?: (
        newAccessToken: string,
        newRefreshToken: string,
        newExpiresAt: string,
    ) => void;
    onBack?: () => void;
    /** Called whenever the unread count changes, so the header bell badge updates at once. */
    onUnreadCountChange?: (count: number) => void;
}

/**
 * Format notification time.
 */
const formatNotificationTime = (
    dateCreated?: string,
): string => {
    if (!dateCreated) return '';

    const date = new Date(dateCreated);

    if (Number.isNaN(date.getTime())) return '';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMinutes < 1) {
        return 'Just now';
    }

    if (diffMinutes < 60) {
        return `${diffMinutes} min ago`;
    }

    if (diffHours < 24) {
        return `${diffHours} hr ago`;
    }

    if (diffDays === 1) {
        return 'Yesterday';
    }

    if (diffDays < 7) {
        return `${diffDays} days ago`;
    }

    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
    });
};

// ───────────────────────────── Look & feel helpers ─────────────────────────────

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface NotificationTone {
    icon: IconName;
    bg: string;
    fg: string;
}

/** Icon + colour by what the notification is about. */
const getNotificationTone = (title: string, message: string): NotificationTone => {
    const text = `${title} ${message}`.toLowerCase();

    if (/(reject|error|fail|ncr|declin)/.test(text)) {
        return { icon: 'alert-circle-outline', bg: colors.statRedBg, fg: colors.statRedIcon };
    }
    if (/(approv|success|complet|arrived|delivered)/.test(text)) {
        return { icon: 'checkmark-circle-outline', bg: colors.statGreenBg, fg: colors.statGreenIcon };
    }
    if (/(dispatch|vehicle|trip|journey|truck)/.test(text)) {
        return { icon: 'car-outline', bg: colors.statBlueBg, fg: colors.statBlueIcon };
    }
    if (/(review|approval|checker|maker|pending|checkpoint)/.test(text)) {
        return { icon: 'clipboard-outline', bg: colors.statOrangeBg, fg: colors.statOrangeIcon };
    }
    return { icon: 'notifications-outline', bg: colors.avatarBg, fg: colors.avatarIcon };
};

type FilterKey = 'all' | 'unread' | 'read';

const FILTERS: { key: FilterKey; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: 'Unread' },
    { key: 'read', label: 'Read' },
];

const EMPTY_TEXT: Record<FilterKey, { title: string; body: string; icon: IconName }> = {
    all: {
        title: 'No notifications',
        body: "You don't have any notifications yet.",
        icon: 'notifications-off-outline',
    },
    unread: {
        title: "You're all caught up",
        body: 'There are no unread notifications.',
        icon: 'checkmark-done-circle-outline',
    },
    read: {
        title: 'Nothing read yet',
        body: 'Notifications you have opened will appear here.',
        icon: 'mail-open-outline',
    },
};

/** "Today" / "Yesterday" / "This week" / "Earlier". */
const getDateGroup = (dateCreated?: string): string => {
    if (!dateCreated) return 'Earlier';
    const date = new Date(dateCreated);
    if (Number.isNaN(date.getTime())) return 'Earlier';

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const dayMs = 86400000;
    const t = date.getTime();

    if (t >= startOfToday.getTime()) return 'Today';
    if (t >= startOfToday.getTime() - dayMs) return 'Yesterday';
    if (t >= startOfToday.getTime() - 6 * dayMs) return 'This week';
    return 'Earlier';
};

interface NotificationSection {
    title: string;
    data: LiferayNotification[];
}

const groupByDate = (items: LiferayNotification[]): NotificationSection[] => {
    const order: string[] = [];
    const map = new Map<string, LiferayNotification[]>();
    for (const item of items) {
        const group = getDateGroup(item.dateCreated);
        if (!map.has(group)) {
            map.set(group, []);
            order.push(group);
        }
        map.get(group)!.push(item);
    }
    return order.map((title) => ({ title, data: map.get(title)! }));
};

const MARK_ALL_CONCURRENCY = 4;

export const NotificationsScreen: React.FC<
    NotificationsScreenProps
> = ({
    accessToken,
    refreshToken,
    onTokenRefresh,
    onBack,
    onUnreadCountChange,
}) => {
        const insets = useSafeAreaInsets();
        const [notifications, setNotifications] = useState<LiferayNotification[]>(
            () => peekQuery<LiferayNotification[]>(qk.notifications()) ?? [],
        );
        const [filter, setFilter] = useState<FilterKey>('all');

        const [loading, setLoading] = useState(() => !peekQuery(qk.notifications()));
        const [refreshing, setRefreshing] = useState(false);
        const [error, setError] = useState<string | null>(null);

        const [markingAll, setMarkingAll] = useState(false);
        // ids currently being marked as read (shows a small spinner on that card)
        const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
        // short-lived message under the header (e.g. a mark-as-read failure)
        const [banner, setBanner] = useState<string | null>(null);
        const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

        const showBanner = useCallback((text: string) => {
            setBanner(text);
            if (bannerTimer.current) clearTimeout(bannerTimer.current);
            bannerTimer.current = setTimeout(() => setBanner(null), 3500);
        }, []);

        useEffect(() => () => {
            if (bannerTimer.current) clearTimeout(bannerTimer.current);
        }, []);

        const unreadCount = useMemo(
            () => notifications.filter((n) => !n.read).length,
            [notifications],
        );
        const readCount = notifications.length - unreadCount;

        // Keep the header bell badge (AppNavigator) in sync immediately.
        useEffect(() => {
            if (!loading) onUnreadCountChange?.(unreadCount);
        }, [unreadCount, loading, onUnreadCountChange]);

        /**
         * Load notifications from Liferay (headless list + JSONWS text).
         */
        const loadNotifications = useCallback(
            async (isRefresh = false, silent = false) => {
                if (!accessToken) {
                    console.warn('[NotificationsScreen] No access token — cannot load notifications.');
                    setLoading(false);
                    return;
                }

                try {
                    // silent = automatic background refresh: no spinner, no error banner.
                    if (!silent) {
                        if (isRefresh) {
                            setRefreshing(true);
                        } else {
                            setLoading(true);
                        }
                        setError(null);
                    }

                    const fetchList = () =>
                        notificationService.getNotifications(accessToken, refreshToken, onTokenRefresh);
                    // Shared query cache: reopened within 20 s = no request; pull-to-refresh always asks the server.
                    const result = isRefresh
                        ? await refetchFresh(qk.notifications(), fetchList)
                        : await fetchCached(qk.notifications(), fetchList, 20_000);

                    // console.log(
                        // '[NotificationsScreen] Loaded',
                        // result.length,
                        // 'notification(s). First item:',
                        // result[0] ? JSON.stringify(result[0]).slice(0, 500) : 'none',
                    // );

                    setNotifications(result);
                } catch (err: any) {
                    console.warn('[NotificationsScreen] Failed to load notifications (status:', err?.status ?? 'error', ')');
                    if (silent) return; // keep the list on screen; the next tick tries again
                    if (err?.status === 401 || (err instanceof Error && err.name === 'SessionExpiredError')) {
                        setError('Your session has expired. Please sign in again.');
                    } else {
                        setError('Unable to load notifications. Please try again.');
                    }
                } finally {
                    setLoading(false);
                    setRefreshing(false);
                }
            },
            // accessToken intentionally omitted: a silent token refresh must not reload the list.
            // eslint-disable-next-line react-hooks/exhaustive-deps
            [refreshToken, onTokenRefresh],
        );

        // Latest token without re-creating callbacks on every refresh.
        const tokenRef = useRef(accessToken);
        useEffect(() => {
            tokenRef.current = accessToken;
        }, [accessToken]);

        useEffect(() => {
            loadNotifications();
            // Load on open; pull-to-refresh reloads; the effect below keeps it fresh while open.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);

        // While this screen is open: refresh silently every 30 s and when the app returns to the foreground.
        useEffect(() => {
            const timer = setInterval(() => {
                loadNotifications(false, true);
            }, 30_000);
            const sub = AppState.addEventListener('change', (next) => {
                if (next === 'active') loadNotifications(false, true);
            });
            return () => {
                clearInterval(timer);
                sub.remove();
            };
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);

        const setReadLocally = useCallback((ids: number[], read: boolean) => {
            const idSet = new Set(ids);
            setNotifications((current) =>
                current.map((item) => (idSet.has(item.id) ? { ...item, read } : item)),
            );
            // Keep the shared cache in step, so reopening the screen never shows an old read/unread state.
            queryClient.setQueryData<LiferayNotification[]>(qk.notifications(), (cur) =>
                cur?.map((item) => (idSet.has(item.id) ? { ...item, read } : item)),
            );
        }, []);

        const setPending = useCallback((ids: number[], on: boolean) => {
            setPendingIds((current) => {
                const next = new Set(current);
                ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
                return next;
            });
        }, []);

        /**
         * Mark one notification as read (optimistic; reverted if the server refuses).
         */
        const markOneAsRead = useCallback(
            async (notification: LiferayNotification) => {
                if (notification.read || pendingIds.has(notification.id)) return;

                setReadLocally([notification.id], true);
                setPending([notification.id], true);
                try {
                    await notificationService.markAsRead(
                        notification.id,
                        tokenRef.current,
                        refreshToken,
                        onTokenRefresh,
                    );
                } catch (err) {
                    console.error('[NotificationsScreen] Failed to mark notification as read:', err);
                    setReadLocally([notification.id], false);
                    showBanner('Could not mark the notification as read. Please try again.');
                } finally {
                    setPending([notification.id], false);
                }
            },
            [pendingIds, refreshToken, onTokenRefresh, setReadLocally, setPending, showBanner],
        );

        /**
         * Mark every unread notification as read.
         */
        const markAllAsRead = useCallback(async () => {
            const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
            if (unreadIds.length === 0 || markingAll) return;

            setMarkingAll(true);
            setReadLocally(unreadIds, true);

            const failed: number[] = [];
            let next = 0;
            const worker = async () => {
                while (next < unreadIds.length) {
                    const id = unreadIds[next++];
                    try {
                        await notificationService.markAsRead(id, tokenRef.current, refreshToken, onTokenRefresh);
                    } catch (err) {
                        console.warn('[NotificationsScreen] mark-as-read failed for', id, err);
                        failed.push(id);
                    }
                }
            };
            await Promise.all(
                Array.from({ length: Math.min(MARK_ALL_CONCURRENCY, unreadIds.length) }, worker),
            );

            if (failed.length > 0) {
                setReadLocally(failed, false);
                showBanner(
                    failed.length === unreadIds.length
                        ? 'Could not mark notifications as read. Please try again.'
                        : `${failed.length} notification(s) could not be marked as read.`,
                );
            }
            setMarkingAll(false);
        }, [notifications, markingAll, refreshToken, onTokenRefresh, setReadLocally, showBanner]);

        const filtered = useMemo(() => {
            if (filter === 'unread') return notifications.filter((n) => !n.read);
            if (filter === 'read') return notifications.filter((n) => n.read);
            return notifications;
        }, [notifications, filter]);

        const sections = useMemo(() => groupByDate(filtered), [filtered]);

        const filterCount = (key: FilterKey): number =>
            key === 'unread' ? unreadCount : key === 'read' ? readCount : notifications.length;

        /**
         * Render one notification card.
         */
        const renderNotification = ({ item }: { item: LiferayNotification }) => {
            const title = getNotificationTitle(item);
            const message = getNotificationText(item);
            const tone = getNotificationTone(title, message);
            const isUnread = !item.read;
            const isPending = pendingIds.has(item.id);

            // Action link from <a> tag, payload, or HATEOAS actions
            const linkInfo = extractNotificationLink(item.message, item.payload, item.actions);
            const actionUrl = item.actionUrl || linkInfo.url;
            const actionLabel = cleanActionLabel(item.actionLabel) || linkInfo.label || 'Open';
            const hasAction = Boolean(actionUrl);

            const openAction = () => {
                if (actionUrl) openNotificationUrl(actionUrl, apiClient.baseUrl);
            };

            return (
                <Pressable
                    onPress={() => {
                        markOneAsRead(item);
                        openAction();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${isUnread ? 'Unread' : 'Read'} notification: ${title}. ${message}`}
                    style={({ pressed }) => [
                        styles.card,
                        isUnread ? styles.cardUnread : styles.cardRead,
                        pressed && styles.cardPressed,
                    ]}
                >
                    {isUnread ? <View style={styles.unreadAccent} /> : null}

                    <View
                        style={[
                            styles.iconCircle,
                            { backgroundColor: isUnread ? tone.bg : colors.concreteLighter },
                        ]}
                    >
                        <Ionicons
                            name={tone.icon}
                            size={20}
                            color={isUnread ? tone.fg : colors.neutralGray}
                        />
                    </View>

                    <View style={styles.cardBody}>
                        <View style={styles.titleRow}>
                            <Text
                                style={[styles.title, isUnread ? styles.titleUnread : styles.titleRead]}
                                numberOfLines={1}
                            >
                                {title}
                            </Text>
                            {isUnread ? <View style={styles.unreadDot} /> : null}
                        </View>

                        <Text
                            style={[styles.message, isUnread ? styles.messageUnread : styles.messageRead]}
                            numberOfLines={3}
                        >
                            {message}
                        </Text>

                        <View style={styles.metaRow}>
                            <View style={styles.metaLeft}>
                                <Ionicons
                                    name="time-outline"
                                    size={12}
                                    color={isUnread ? colors.primary : colors.neutralGray}
                                />
                                <Text style={[styles.timeText, isUnread && styles.timeTextUnread]}>
                                    {formatNotificationTime(item.dateCreated)}
                                </Text>
                            </View>

                            {isUnread ? (
                                <Pressable
                                    onPress={() => markOneAsRead(item)}
                                    disabled={isPending}
                                    hitSlop={8}
                                    accessibilityRole="button"
                                    accessibilityLabel="Mark as read"
                                    style={({ pressed }) => [styles.markReadButton, pressed && styles.chipPressed]}
                                >
                                    {isPending ? (
                                        <ActivityIndicator size="small" color={colors.primary} />
                                    ) : (
                                        <>
                                            <Ionicons name="checkmark-done" size={14} color={colors.primary} />
                                            <Text style={styles.markReadText}>Mark as read</Text>
                                        </>
                                    )}
                                </Pressable>
                            ) : (
                                <View style={styles.readTag}>
                                    <Ionicons name="checkmark-done" size={14} color={colors.statGreenIcon} />
                                    <Text style={styles.readTagText}>Read</Text>
                                </View>
                            )}
                        </View>

                        {hasAction ? (
                            <Pressable
                                onPress={() => {
                                    markOneAsRead(item);
                                    openAction();
                                }}
                                hitSlop={6}
                                accessibilityRole="link"
                                accessibilityLabel={actionLabel}
                                style={({ pressed }) => [
                                    styles.actionButton,
                                    !isUnread && styles.actionButtonRead,
                                    pressed && styles.chipPressed,
                                ]}
                            >
                                <Text style={[styles.actionText, !isUnread && styles.actionTextRead]}>
                                    {actionLabel}
                                </Text>
                                <Ionicons
                                    name="arrow-forward"
                                    size={13}
                                    color={isUnread ? colors.white : colors.primary}
                                />
                            </Pressable>
                        ) : null}
                    </View>
                </Pressable>
            );
        };

        const emptyText = EMPTY_TEXT[filter];

        return (
            <View style={[styles.root, { paddingTop: insets.top }]}>
                {/* Header */}
                <View style={styles.header}>
                    <Pressable
                        onPress={onBack}
                        hitSlop={10}
                        style={styles.backButton}
                        accessibilityRole="button"
                        accessibilityLabel="Back"
                    >
                        <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
                    </Pressable>

                    <View style={styles.headerTitleBlock}>
                        <Text style={styles.headerTitle}>Notifications</Text>
                        <Text style={styles.headerSubtitle}>
                            {loading
                                ? 'Loading…'
                                : unreadCount > 0
                                    ? `${unreadCount} unread`
                                    : 'All caught up'}
                        </Text>
                    </View>

                    <Pressable
                        onPress={markAllAsRead}
                        disabled={unreadCount === 0 || markingAll || loading}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Mark all as read"
                        style={({ pressed }) => [
                            styles.markAllButton,
                            (unreadCount === 0 || loading) && styles.markAllButtonDisabled,
                            pressed && styles.chipPressed,
                        ]}
                    >
                        {markingAll ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                            <>
                                <Ionicons
                                    name="checkmark-done"
                                    size={16}
                                    color={unreadCount === 0 || loading ? colors.disabled : colors.primary}
                                />
                                <Text
                                    style={[
                                        styles.markAllText,
                                        (unreadCount === 0 || loading) && styles.markAllTextDisabled,
                                    ]}
                                >
                                    Mark all read
                                </Text>
                            </>
                        )}
                    </Pressable>
                </View>

                {/* Filter tabs */}
                <View style={styles.filterBar}>
                    {FILTERS.map(({ key, label }) => {
                        const active = filter === key;
                        const count = filterCount(key);
                        return (
                            <Pressable
                                key={key}
                                onPress={() => setFilter(key)}
                                accessibilityRole="tab"
                                accessibilityState={{ selected: active }}
                                style={[styles.filterTab, active && styles.filterTabActive]}
                            >
                                <Text style={[styles.filterText, active && styles.filterTextActive]}>
                                    {label}
                                </Text>
                                {!loading ? (
                                    <View
                                        style={[
                                            styles.filterCount,
                                            active && styles.filterCountActive,
                                            key === 'unread' && count > 0 && !active && styles.filterCountUnread,
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.filterCountText,
                                                (active || (key === 'unread' && count > 0)) &&
                                                styles.filterCountTextActive,
                                            ]}
                                        >
                                            {count}
                                        </Text>
                                    </View>
                                ) : null}
                            </Pressable>
                        );
                    })}
                </View>

                {banner ? (
                    <View style={styles.banner}>
                        <Ionicons name="alert-circle" size={16} color={colors.error} />
                        <Text style={styles.bannerText}>{banner}</Text>
                    </View>
                ) : null}

                {loading ? (
                    <View style={styles.center}>
                        <ActivityIndicator size="large" color={colors.primary} />
                        <Text style={styles.loadingText}>Loading notifications...</Text>
                    </View>
                ) : error ? (
                    <View style={styles.center}>
                        <View style={styles.emptyIconCircle}>
                            <Ionicons name="cloud-offline-outline" size={30} color={colors.textSecondary} />
                        </View>
                        <Text style={styles.emptyTitle}>Something went wrong</Text>
                        <Text style={styles.emptyText}>{error}</Text>
                        <Pressable onPress={() => loadNotifications()} style={styles.retryButton}>
                            <Text style={styles.retryText}>Try Again</Text>
                        </Pressable>
                    </View>
                ) : (
                    <SectionList
                        sections={sections}
                        keyExtractor={(item) => String(item.id)}
                        renderItem={renderNotification}
                        renderSectionHeader={({ section }) => (
                            <Text style={styles.sectionHeader}>{section.title.toUpperCase()}</Text>
                        )}
                        stickySectionHeadersEnabled={false}
                        contentContainerStyle={[
                            styles.listContent,
                            sections.length === 0 && styles.emptyListContent,
                        ]}
                        showsVerticalScrollIndicator={false}
                        refreshing={refreshing}
                        onRefresh={() => loadNotifications(true)}
                        ListEmptyComponent={
                            <View style={styles.center}>
                                <View style={styles.emptyIconCircle}>
                                    <Ionicons name={emptyText.icon} size={30} color={colors.primary} />
                                </View>
                                <Text style={styles.emptyTitle}>{emptyText.title}</Text>
                                <Text style={styles.emptyText}>{emptyText.body}</Text>
                            </View>
                        }
                    />
                )}
            </View>
        );
    };

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: colors.concreteLighter,
    },

    // Header
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
        backgroundColor: colors.white,
    },
    backButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitleBlock: {
        flex: 1,
        marginLeft: spacing.xxs,
    },
    headerTitle: {
        ...typography.h2,
        fontSize: 20,
        color: colors.textPrimary,
    },
    headerSubtitle: {
        ...typography.caption,
        color: colors.textSecondary,
        marginTop: 1,
    },
    markAllButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minHeight: 34,
        paddingHorizontal: spacing.sm,
        borderRadius: radius.pill,
        backgroundColor: colors.statBlueBg,
    },
    markAllButtonDisabled: {
        backgroundColor: colors.concreteLighter,
    },
    markAllText: {
        ...typography.caption,
        fontWeight: '700',
        color: colors.primary,
    },
    markAllTextDisabled: {
        color: colors.disabled,
    },

    // Filter tabs
    filterBar: {
        flexDirection: 'row',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.xxs,
        paddingBottom: spacing.sm,
        backgroundColor: colors.white,
        borderBottomWidth: 1,
        borderBottomColor: colors.cardBorder,
    },
    filterTab: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        backgroundColor: colors.white,
    },
    filterTabActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },
    filterText: {
        ...typography.caption,
        fontWeight: '700',
        color: colors.darkGray,
    },
    filterTextActive: {
        color: colors.white,
    },
    filterCount: {
        minWidth: 20,
        height: 18,
        paddingHorizontal: 5,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.concreteLight,
    },
    filterCountActive: {
        backgroundColor: 'rgba(255,255,255,0.25)',
    },
    filterCountUnread: {
        backgroundColor: colors.statRedIcon,
    },
    filterCountText: {
        fontSize: 11,
        fontWeight: '700',
        color: colors.textSecondary,
    },
    filterCountTextActive: {
        color: colors.white,
    },

    // Banner
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        marginHorizontal: spacing.md,
        marginTop: spacing.sm,
        padding: spacing.sm,
        borderRadius: radius.md,
        backgroundColor: colors.errorBackground,
    },
    bannerText: {
        ...typography.bodySmall,
        color: colors.error,
        flex: 1,
    },

    // List
    listContent: {
        paddingHorizontal: spacing.md,
        paddingBottom: spacing.xl,
    },
    emptyListContent: {
        flexGrow: 1,
    },
    sectionHeader: {
        ...typography.caption,
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.8,
        color: colors.neutralGray,
        marginTop: spacing.md,
        marginBottom: spacing.xs,
    },

    // Card
    card: {
        position: 'relative',
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: spacing.sm,
        paddingLeft: spacing.sm + 2,
        marginBottom: spacing.xs,
        borderWidth: 1,
        borderRadius: radius.lg,
        overflow: 'hidden',
    },
    cardUnread: {
        backgroundColor: colors.white,
        borderColor: colors.primaryLight,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 6,
        elevation: 2,
    },
    cardRead: {
        backgroundColor: colors.white,
        borderColor: colors.cardBorder,
        opacity: 0.92,
    },
    cardPressed: {
        opacity: 0.75,
    },
    unreadAccent: {
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 4,
        backgroundColor: colors.primary,
    },
    iconCircle: {
        width: 40,
        height: 40,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: spacing.sm,
    },
    cardBody: {
        flex: 1,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {
        ...typography.label,
        flex: 1,
        fontSize: 15,
    },
    titleUnread: {
        fontWeight: '800',
        color: colors.textPrimary,
    },
    titleRead: {
        fontWeight: '600',
        color: colors.darkGray,
    },
    unreadDot: {
        width: 9,
        height: 9,
        borderRadius: 5,
        backgroundColor: colors.primary,
        marginLeft: spacing.xs,
    },
    message: {
        ...typography.bodySmall,
        marginTop: 4,
        lineHeight: 19,
    },
    messageUnread: {
        color: colors.textPrimary,
    },
    messageRead: {
        color: colors.textSecondary,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: spacing.xs,
    },
    metaLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    timeText: {
        ...typography.caption,
        color: colors.neutralGray,
    },
    timeTextUnread: {
        color: colors.primary,
        fontWeight: '700',
    },
    markReadButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minHeight: 26,
        minWidth: 26,
        paddingHorizontal: spacing.xs,
        borderRadius: radius.pill,
        backgroundColor: colors.statBlueBg,
        justifyContent: 'center',
    },
    markReadText: {
        ...typography.caption,
        fontWeight: '700',
        color: colors.primary,
    },
    readTag: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    readTagText: {
        ...typography.caption,
        fontWeight: '600',
        color: colors.statGreenIcon,
    },
    actionButton: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: spacing.xs,
        paddingVertical: 6,
        paddingHorizontal: spacing.sm,
        borderRadius: radius.pill,
        backgroundColor: colors.primary,
    },
    actionButtonRead: {
        backgroundColor: colors.statBlueBg,
    },
    actionText: {
        ...typography.caption,
        fontWeight: '700',
        color: colors.white,
    },
    actionTextRead: {
        color: colors.primary,
    },
    chipPressed: {
        opacity: 0.7,
    },

    // States
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.xl,
    },
    loadingText: {
        ...typography.body,
        color: colors.textSecondary,
        marginTop: spacing.sm,
    },
    emptyIconCircle: {
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.statBlueBg,
    },
    emptyTitle: {
        ...typography.label,
        fontSize: 17,
        fontWeight: '700',
        color: colors.textPrimary,
        marginTop: spacing.md,
    },
    emptyText: {
        ...typography.bodySmall,
        color: colors.textSecondary,
        textAlign: 'center',
        marginTop: spacing.xxs,
    },
    retryButton: {
        marginTop: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.sm,
        borderRadius: radius.md,
        backgroundColor: colors.primary,
    },
    retryText: {
        ...typography.label,
        fontWeight: '700',
        color: colors.white,
    },
});
