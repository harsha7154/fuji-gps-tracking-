import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    AppState,
    BackHandler,
    Pressable,
    SectionList,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { notificationService } from '../services/notificationService';
import { onPushReceived } from '../services/pushRegistration';
import type { LiferayNotification, NotificationPage } from '../services/notificationService';
import { colors, radius, spacing, typography } from '../theme';
import {
    cleanActionLabel,
    extractNotificationLink,
    openNotificationUrl,
} from '../utils/notificationLinkHelper';
import { getNotificationText, getNotificationTitle } from '../utils/notificationContent';
import { apiClient } from '../api/client';
import { fetchCached, peekQuery, qk, queryClient, refetchFresh } from '../query/queryClient';
import { AppHeader } from '../components/AppHeader';

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

/** Fallback silent refresh while the screen is open (a push or app-foreground refreshes at once). */
const SILENT_REFRESH_FALLBACK_MS = 2 * 60_000;

/** Starts fetching the next page when the user is this close to the bottom (screen heights). */
const LOAD_MORE_THRESHOLD = 0.5;

/** Cached first page (an older app build stored a plain array under the same key: ignore that). */
const peekFirstPage = (): NotificationPage | undefined => {
    const cached = peekQuery<unknown>(qk.notifications());
    return cached && !Array.isArray(cached) && Array.isArray((cached as NotificationPage).items)
        ? (cached as NotificationPage)
        : undefined;
};

/** Adds the items that are not on screen yet (no duplicates when new notifications shift the pages). */
const appendUnique = (current: LiferayNotification[], incoming: LiferayNotification[]): LiferayNotification[] => {
    const seen = new Set(current.map((n) => n.id));
    const extra = incoming.filter((n) => !seen.has(n.id));
    return extra.length === 0 ? current : current.concat(extra);
};

/** Fresh first page on top, older pages that were already loaded kept below it. */
const mergeFirstPage = (current: LiferayNotification[], firstPage: LiferayNotification[]): LiferayNotification[] => {
    const firstIds = new Set(firstPage.map((n) => n.id));
    return firstPage.concat(current.filter((n) => !firstIds.has(n.id)));
};

/** Newest first (used when deleted items have to be put back after a failed delete). */
const byNewest = (a: LiferayNotification, b: LiferayNotification): number =>
    (Date.parse(b.dateCreated ?? '') || 0) - (Date.parse(a.dateCreated ?? '') || 0);

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
            () => peekFirstPage()?.items ?? [],
        );
        const [filter, setFilter] = useState<FilterKey>('all');

        const [loading, setLoading] = useState(() => !peekFirstPage());

        // ── Infinite scroll (50 per page) ──
        const [hasMore, setHasMore] = useState(() => peekFirstPage()?.hasMore ?? false);
        const [totalCount, setTotalCount] = useState<number | null>(() => peekFirstPage()?.totalCount ?? null);
        const [loadingMore, setLoadingMore] = useState(false);
        const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
        const pageRef = useRef(1);                 // last page that is on screen
        const hasMoreRef = useRef(hasMore);
        const loadingMoreRef = useRef(false);      // one "next page" request at a time
        const listGenerationRef = useRef(0);       // a pull-to-refresh makes older page answers stale
        const [refreshing, setRefreshing] = useState(false);
        const [error, setError] = useState<string | null>(null);

        const [markingAll, setMarkingAll] = useState(false);
        // ids currently being marked as read (shows a small spinner on that card)
        const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
        // short-lived message under the header (e.g. a mark-as-read failure)
        const [banner, setBanner] = useState<string | null>(null);
        const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

        // ── Delete / multi-select ──
        const [selectionMode, setSelectionMode] = useState(false);
        const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
        const [deleting, setDeleting] = useState(false);
        // Deleted (or being deleted) ids: a refresh / next page answering meanwhile must not bring them back.
        const removedIdsRef = useRef<Set<number>>(new Set());
        const withoutRemoved = (items: LiferayNotification[]): LiferayNotification[] =>
            removedIdsRef.current.size === 0 ? items : items.filter((n) => !removedIdsRef.current.has(n.id));

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

        // Keep the header bell badge (AppNavigator) in sync immediately. Only when every page is loaded:
        // a partly loaded list would under-count (the badge's own 30 s check covers that case).
        useEffect(() => {
            if (!loading && !hasMore) onUnreadCountChange?.(unreadCount);
        }, [unreadCount, loading, hasMore, onUnreadCountChange]);

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

                    const fetchFirstPage = () =>
                        notificationService.getNotificationsPage(accessToken, refreshToken, onTokenRefresh, 1);
                    // Shared query cache: reopened within 20 s = no request; pull-to-refresh always asks the server.
                    const result = isRefresh
                        ? await refetchFresh(qk.notifications(), fetchFirstPage)
                        : await fetchCached(qk.notifications(), fetchFirstPage, 20_000);

                    // console.log(
                        // '[NotificationsScreen] Loaded',
                        // result.length,
                        // 'notification(s). First item:',
                        // result[0] ? JSON.stringify(result[0]).slice(0, 500) : 'none',
                    // );

                    setTotalCount(result.totalCount);
                    if (silent) {
                        // Background refresh: new notifications on top, the older pages already loaded stay.
                        setNotifications((current) => mergeFirstPage(current, withoutRemoved(result.items)));
                        if (pageRef.current === 1) {
                            hasMoreRef.current = result.hasMore;
                            setHasMore(result.hasMore);
                        }
                    } else {
                        // Open / pull-to-refresh: start again from page 1.
                        listGenerationRef.current += 1;
                        pageRef.current = 1;
                        hasMoreRef.current = result.hasMore;
                        setHasMore(result.hasMore);
                        setLoadMoreError(null);
                        setNotifications(withoutRemoved(result.items));
                    }
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

        /**
         * Next 50 (FlatList/SectionList onEndReached). One request at a time; an error keeps the list
         * and shows a retry row; answers that arrive after a pull-to-refresh are ignored.
         */
        const loadMore = useCallback(async () => {
            if (loadingMoreRef.current || !hasMoreRef.current || loading || refreshing || !tokenRef.current) return;
            loadingMoreRef.current = true;
            setLoadingMore(true);
            setLoadMoreError(null);

            const generation = listGenerationRef.current;
            const nextPage = pageRef.current + 1;
            try {
                const result = await notificationService.getNotificationsPage(
                    tokenRef.current,
                    refreshToken,
                    onTokenRefresh,
                    nextPage,
                );
                if (generation !== listGenerationRef.current) return;
                pageRef.current = nextPage;
                hasMoreRef.current = result.hasMore;
                setHasMore(result.hasMore);
                setTotalCount(result.totalCount);
                setNotifications((current) => appendUnique(current, withoutRemoved(result.items)));
            } catch (err: any) {
                console.warn('[NotificationsScreen] Failed to load more notifications (status:', err?.status ?? 'error', ')');
                if (generation === listGenerationRef.current) {
                    setLoadMoreError('Could not load more notifications.');
                }
            } finally {
                loadingMoreRef.current = false;
                setLoadingMore(false);
            }
        }, [loading, refreshing, refreshToken, onTokenRefresh]);

        // After an error the list does not retry by itself on every scroll; the user taps "Retry".
        const handleEndReached = useCallback(() => {
            if (!loadMoreError) loadMore();
        }, [loadMoreError, loadMore]);

        useEffect(() => {
            loadNotifications();
            // Load on open; pull-to-refresh reloads; the effect below keeps it fresh while open.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);

        // While this screen is open, refresh silently only when needed: a push arrives (ask the server now),
        // the app returns to the foreground, or the slow fallback timer fires (in case a push is lost).
        useEffect(() => {
            const timer = setInterval(() => {
                loadNotifications(false, true);
            }, SILENT_REFRESH_FALLBACK_MS);
            const sub = AppState.addEventListener('change', (next) => {
                if (next === 'active') loadNotifications(false, true);
            });
            const unsubPush = onPushReceived(() => loadNotifications(true, true));
            return () => {
                clearInterval(timer);
                sub.remove();
                unsubPush();
            };
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);

        const setReadLocally = useCallback((ids: number[], read: boolean) => {
            const idSet = new Set(ids);
            setNotifications((current) =>
                current.map((item) => (idSet.has(item.id) ? { ...item, read } : item)),
            );
            // Keep the shared cache in step, so reopening the screen never shows an old read/unread state.
            queryClient.setQueryData<NotificationPage>(qk.notifications(), (cur) =>
                cur && Array.isArray(cur.items)
                    ? { ...cur, items: cur.items.map((item) => (idSet.has(item.id) ? { ...item, read } : item)) }
                    : cur,
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

        // ── Delete (single + selected), optimistic: removed at once, put back if the server refuses ──

        const removeLocally = useCallback((ids: number[]) => {
            const idSet = new Set(ids);
            setNotifications((current) => current.filter((n) => !idSet.has(n.id)));
            setTotalCount((count) => (count == null ? count : Math.max(0, count - ids.length)));
            queryClient.setQueryData<NotificationPage>(qk.notifications(), (cur) =>
                cur && Array.isArray(cur.items)
                    ? {
                        ...cur,
                        items: cur.items.filter((n) => !idSet.has(n.id)),
                        totalCount: Math.max(0, (cur.totalCount ?? 0) - ids.length),
                    }
                    : cur,
            );
        }, []);

        const deleteItems = useCallback(
            async (targets: LiferayNotification[]) => {
                const items = targets.filter((n) => !removedIdsRef.current.has(n.id));
                if (items.length === 0) return;
                const ids = items.map((n) => n.id);

                ids.forEach((id) => removedIdsRef.current.add(id));
                removeLocally(ids);
                setDeleting(true);
                try {
                    await notificationService.deleteNotifications(ids, tokenRef.current, refreshToken, onTokenRefresh);
                } catch (err: any) {
                    console.warn('[NotificationsScreen] Delete failed (status:', err?.status ?? 'error', ')');
                    ids.forEach((id) => removedIdsRef.current.delete(id));
                    setNotifications((current) => appendUnique(current, items).sort(byNewest));
                    setTotalCount((count) => (count == null ? count : count + items.length));
                    // Cache no longer matches the server: the next open asks the server again.
                    queryClient.removeQueries({ queryKey: qk.notifications() });
                    showBanner(
                        items.length === 1
                            ? 'Could not delete the notification. Please try again.'
                            : 'Could not delete the selected notifications. Please try again.',
                    );
                } finally {
                    setDeleting(false);
                }
            },
            [refreshToken, onTokenRefresh, removeLocally, showBanner],
        );

        const confirmDelete = useCallback(
            (targets: LiferayNotification[], onConfirmed?: () => void) => {
                if (targets.length === 0) return;
                const one = targets.length === 1;
                Alert.alert(
                    one ? 'Delete notification?' : `Delete ${targets.length} notifications?`,
                    'This cannot be undone.',
                    [
                        { text: 'Cancel', style: 'cancel' },
                        {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => {
                                onConfirmed?.();
                                deleteItems(targets);
                            },
                        },
                    ],
                );
            },
            [deleteItems],
        );

        const exitSelection = useCallback(() => {
            setSelectionMode(false);
            setSelectedIds(new Set());
        }, []);

        const enterSelection = useCallback((id?: number) => {
            setSelectionMode(true);
            setSelectedIds(id == null ? new Set() : new Set([id]));
        }, []);

        const toggleSelected = useCallback((id: number) => {
            setSelectedIds((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
            });
        }, []);

        // Only what is on screen in the current tab counts (items removed by a refresh drop out by themselves).
        const selectedItems = useMemo(
            () => filtered.filter((n) => selectedIds.has(n.id)),
            [filtered, selectedIds],
        );
        const allSelected = filtered.length > 0 && selectedItems.length === filtered.length;

        const toggleSelectAll = useCallback(() => {
            setSelectedIds(allSelected ? new Set() : new Set(filtered.map((n) => n.id)));
        }, [allSelected, filtered]);

        // Android back button leaves selection mode first.
        useEffect(() => {
            if (!selectionMode) return;
            const sub = BackHandler.addEventListener('hardwareBackPress', () => {
                exitSelection();
                return true;
            });
            return () => sub.remove();
        }, [selectionMode, exitSelection]);

        const filterCount = (key: FilterKey): number =>
            key === 'unread'
                ? unreadCount
                : key === 'read'
                    ? readCount
                    : Math.max(notifications.length, totalCount ?? 0);

        /**
         * Render one notification card.
         */
        const renderNotification = ({ item }: { item: LiferayNotification }) => {
            const title = getNotificationTitle(item);
            const message = getNotificationText(item);
            const tone = getNotificationTone(title, message);
            const isUnread = !item.read;
            const isPending = pendingIds.has(item.id);
            const isSelected = selectionMode && selectedIds.has(item.id);

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
                        if (selectionMode) {
                            toggleSelected(item.id);
                            return;
                        }
                        markOneAsRead(item);
                        openAction();
                    }}
                    onLongPress={selectionMode ? undefined : () => enterSelection(item.id)}
                    accessibilityRole={selectionMode ? 'checkbox' : 'button'}
                    accessibilityState={selectionMode ? { checked: isSelected } : undefined}
                    accessibilityLabel={`${isUnread ? 'Unread' : 'Read'} notification: ${title}. ${message}`}
                    accessibilityHint={selectionMode ? undefined : 'Long press to select'}
                    style={({ pressed }) => [
                        styles.card,
                        isUnread ? styles.cardUnread : styles.cardRead,
                        isSelected && styles.cardSelected,
                        pressed && styles.cardPressed,
                    ]}
                >
                    {isUnread ? <View style={styles.unreadAccent} /> : null}

                    {selectionMode ? (
                        <View style={styles.iconCircle}>
                            <Ionicons
                                name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                                size={26}
                                color={isSelected ? colors.primary : colors.neutralGray}
                            />
                        </View>
                    ) : (
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
                    )}

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

                            <View style={styles.metaRight}>
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
                            {!selectionMode ? (
                                <Pressable
                                    onPress={() => confirmDelete([item])}
                                    hitSlop={8}
                                    accessibilityRole="button"
                                    accessibilityLabel="Delete notification"
                                    style={({ pressed }) => [styles.deleteButton, pressed && styles.chipPressed]}
                                >
                                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                                </Pressable>
                            ) : null}
                            </View>
                        </View>

                        {hasAction && !selectionMode ? (
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

        const renderListHeader = () => (
            <View>
                {/* 1. TOP HERO HEADER */}
                <AppHeader
                    variant="curved"
                    logoWidth={130}
                    notificationCount={unreadCount}
                    notificationBadgeColor="#0B5FA8"
                    showNotification={true}
                    avatarIcon="person"
                    avatarIconColor="#D97706"
                    avatarBackgroundColor="#FEF3D6"
                    onAvatarPress={onBack}
                    backLabel="Back"
                    onBack={onBack}
                />

                {/* Header bar */}
                {selectionMode ? (
                    <View style={styles.header}>
                        <Pressable
                            onPress={exitSelection}
                            hitSlop={10}
                            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
                            accessibilityRole="button"
                            accessibilityLabel="Cancel selection"
                        >
                            <Ionicons name="close" size={20} color="#0B5FA8" />
                        </Pressable>

                        <View style={styles.headerTitleBlock}>
                            <Text style={styles.headerTitle}>{selectedItems.length} selected</Text>
                            {hasMore ? (
                                <Text style={styles.headerSubtitle}>Of {filtered.length} loaded</Text>
                            ) : null}
                        </View>

                        <Pressable
                            onPress={toggleSelectAll}
                            disabled={filtered.length === 0}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={allSelected ? 'Deselect all' : 'Select all'}
                            style={({ pressed }) => [styles.markAllButton, pressed && styles.chipPressed]}
                        >
                            <Ionicons
                                name={allSelected ? 'square-outline' : 'checkbox-outline'}
                                size={16}
                                color={colors.primary}
                            />
                            <Text style={styles.markAllText}>{allSelected ? 'Deselect all' : 'Select all'}</Text>
                        </Pressable>

                        <Pressable
                            onPress={() => confirmDelete(selectedItems, exitSelection)}
                            disabled={selectedItems.length === 0 || deleting}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel="Delete selected"
                            style={({ pressed }) => [
                                styles.headerIconButton,
                                pressed && styles.chipPressed,
                            ]}
                        >
                            {deleting ? (
                                <ActivityIndicator size="small" color={colors.error} />
                            ) : (
                                <Ionicons
                                    name="trash-outline"
                                    size={22}
                                    color={selectedItems.length === 0 ? colors.disabled : colors.error}
                                />
                            )}
                        </Pressable>
                    </View>
                ) : (
                    <View style={styles.header}>
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

                        <Pressable
                            onPress={() => enterSelection()}
                            disabled={loading || filtered.length === 0}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel="Select notifications"
                            style={({ pressed }) => [styles.headerIconButton, pressed && styles.chipPressed]}
                        >
                            <Ionicons
                                name="checkbox-outline"
                                size={22}
                                color={loading || filtered.length === 0 ? colors.disabled : colors.primary}
                            />
                        </Pressable>
                    </View>
                )}

                {/* Filter tabs */}
                <View style={styles.filterBar}>
                    {FILTERS.map(({ key, label }) => {
                        const active = filter === key;
                        const count = filterCount(key);
                        return (
                            <Pressable
                                key={key}
                                onPress={() => {
                                    setFilter(key);
                                    setSelectedIds(new Set());
                                }}
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
            </View>
        );

        return (
            <View style={styles.root}>
                <SectionList
                    ListHeaderComponent={renderListHeader()}
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
                    onEndReached={handleEndReached}
                    onEndReachedThreshold={LOAD_MORE_THRESHOLD}
                    ListEmptyComponent={
                        loading ? (
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
                            <View style={styles.center}>
                                <View style={styles.emptyIconCircle}>
                                    <Ionicons name={emptyText.icon} size={30} color={colors.primary} />
                                </View>
                                <Text style={styles.emptyTitle}>{emptyText.title}</Text>
                                <Text style={styles.emptyText}>{emptyText.body}</Text>
                            </View>
                        )
                    }
                    ListFooterComponent={
                        loadingMore ? (
                            <View style={styles.listFooter}>
                                <ActivityIndicator size="small" color={colors.primary} />
                                <Text style={styles.listFooterText}>Loading more…</Text>
                            </View>
                        ) : loadMoreError ? (
                            <Pressable onPress={loadMore} style={styles.listFooter} hitSlop={8}>
                                <Ionicons name="refresh" size={16} color={colors.primary} />
                                <Text style={[styles.listFooterText, styles.listFooterRetry]}>
                                    {loadMoreError} Tap to retry
                                </Text>
                            </Pressable>
                        ) : !hasMore && notifications.length > 0 ? (
                            <Text style={styles.listEndText}>You're all caught up</Text>
                        ) : null
                    }
                />
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
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        backgroundColor: colors.white,
        borderBottomWidth: 1,
        borderBottomColor: '#F1F5F9',
    },
    backButton: {
        width: 38,
        height: 38,
        borderRadius: 12,
        backgroundColor: '#FFFFFF',
        borderWidth: 1.5,
        borderColor: '#E2E8F0',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: spacing.xs,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 1.5 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
        elevation: 2,
    },
    backButtonPressed: {
        opacity: 0.85,
        transform: [{ scale: 0.94 }],
        backgroundColor: '#F8FAFC',
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
    cardSelected: {
        borderColor: colors.primary,
        backgroundColor: colors.statBlueBg,
    },
    metaRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    deleteButton: {
        width: 30,
        height: 30,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.statRedBg,
    },
    headerIconButton: {
        width: 40,
        height: 40,
        marginLeft: spacing.xs,
        alignItems: 'center',
        justifyContent: 'center',
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
    listFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: spacing.md,
    },
    listFooterText: {
        ...typography.bodySmall,
        color: colors.textSecondary,
    },
    listFooterRetry: {
        color: colors.primary,
        fontWeight: '600',
    },
    listEndText: {
        ...typography.bodySmall,
        color: colors.textPlaceholder,
        textAlign: 'center',
        paddingVertical: spacing.md,
    },
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
