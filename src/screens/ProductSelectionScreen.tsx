import React, { useMemo, useState } from 'react';
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { AppHeader } from '../components/AppHeader';
import { BottomTabBar, BottomTabKey } from '../components/BottomTabBar';

import { colors, radius, spacing, typography } from '../theme';

export interface Product {
    id: string;
    code: string;
    name: string;
    organization: string;
    status: 'Assigned' | 'Recent' | 'Nearby';
    sites: number;
    districts: number;
    completion: number;
    startDate: string;
    targetEndDate: string;
}

interface ProductSelectionScreenProps {
    onBack: () => void;
    onProductSelect: (product: Product) => void;
    notificationCount?: number;
    onLogout?: () => void;
    onBottomTabPress?: (tab: BottomTabKey) => void;
    onNavigateToProfile?: () => void;
}

const PRODUCTS: Product[] = [
    {
        id: '1',
        code: 'PRJ-AW-MAH-2026',
        name: 'Maharashtra Anganwadi Precast Master',
        organization:
            'Women & Child Development Dept., Govt. of Maharashtra',
        status: 'Assigned',
        sites: 470,
        districts: 5,
        completion: 72,
        startDate: '01 Jan 2026',
        targetEndDate: '31 Dec 2026',
    },
    {
        id: '2',
        code: 'PRJ-AW-NGP-PH2',
        name: 'Nagpur Rural Model Precast Anganwadis (Phase 2)',
        organization:
            'Women & Child Development Dept., Govt. of Maharashtra',
        status: 'Assigned',
        sites: 120,
        districts: 1,
        completion: 68,
        startDate: '15 Feb 2026',
        targetEndDate: '30 Nov 2026',
    },
    {
        id: '3',
        code: 'PRJ-AW-PUN-PH1',
        name: 'Pune District Pilot Precast Modular Buildings',
        organization:
            'Women & Child Development Dept., Govt. of Maharashtra',
        status: 'Recent',
        sites: 95,
        districts: 1,
        completion: 100,
        startDate: '01 Jan 2026',
        targetEndDate: '30 Jun 2026',
    },
    {
        id: '4',
        code: 'PRJ-AW-NAS-2026',
        name: 'Nashik Anganwadi Rural Phase 1',
        organization:
            'Women & Child Development Dept., Govt. of Maharashtra',
        status: 'Nearby',
        sites: 88,
        districts: 2,
        completion: 41,
        startDate: '01 Mar 2026',
        targetEndDate: '31 Dec 2026',
    },
    {
        id: '5',
        code: 'PRJ-AW-GUJ-2026',
        name: 'Gujarat Anganwadi Precast Expansion',
        organization:
            'Women & Child Development Dept., Govt. of Gujarat',
        status: 'Assigned',
        sites: 150,
        districts: 4,
        completion: 55,
        startDate: '01 Feb 2026',
        targetEndDate: '31 Dec 2026',
    },
];

const FILTERS = [
    { key: 'all', label: 'All Products (5)' },
    { key: 'assigned', label: 'Assigned (3)' },
    { key: 'recent', label: 'Recent (2)' },
    { key: 'nearby', label: 'Nearby (1)' },
];

export const ProductSelectionScreen: React.FC<
    ProductSelectionScreenProps
> = ({
    onBack,
    onProductSelect,
    notificationCount = 3,
    onBottomTabPress,
    onNavigateToProfile,
}) => {
    const [search, setSearch] = useState('');
    const [activeFilter, setActiveFilter] = useState('all');

    const filteredProducts = useMemo(() => {
        let result = PRODUCTS;

        if (activeFilter !== 'all') {
            const statusMap: Record<string, Product['status']> = {
                assigned: 'Assigned',
                recent: 'Recent',
                nearby: 'Nearby',
            };

            result = result.filter(
                product => product.status === statusMap[activeFilter],
            );
        }

        const query = search.trim().toLowerCase();

        if (query) {
            result = result.filter(product => {
                return (
                    product.name.toLowerCase().includes(query) ||
                    product.code.toLowerCase().includes(query)
                );
            });
        }

        return result;
    }, [activeFilter, search]);

    const renderProductCard = (item: Product) => {
        return (
            <Pressable
                key={item.id}
                onPress={() => onProductSelect(item)}
                style={styles.productCard}
            >
                <View style={styles.productHeader}>
                    <View style={styles.productTitleContainer}>
                        <Text style={styles.productCode}>
                            {item.code}
                        </Text>
                        <Text style={styles.productName}>
                            {item.name}
                        </Text>
                    </View>

                    <View style={styles.productHeaderRight}>
                        <View
                            style={[
                                styles.statusBadge,
                                item.status === 'Assigned' &&
                                    styles.assignedBadge,
                            ]}
                        >
                            <Ionicons
                                name={
                                    item.status === 'Assigned'
                                        ? 'person'
                                        : item.status === 'Recent'
                                          ? 'time-outline'
                                          : 'location-outline'
                                }
                                size={14}
                                color={
                                    item.status === 'Assigned'
                                        ? colors.success
                                        : item.status === 'Recent'
                                          ? colors.textSecondary
                                          : '#D85C8A'
                                }
                            />
                            <Text
                                style={[
                                    styles.statusText,
                                    item.status === 'Recent' &&
                                        styles.recentStatusText,
                                    item.status === 'Nearby' &&
                                        styles.nearbyStatusText,
                                ]}
                            >
                                {item.status}
                            </Text>
                        </View>

                        <View style={styles.arrowButton}>
                            <Ionicons
                                name="chevron-forward"
                                size={25}
                                color={colors.primary}
                            />
                        </View>
                    </View>
                </View>

                <View style={styles.organizationRow}>
                    <Ionicons
                        name="business-outline"
                        size={21}
                        color={colors.textSecondary}
                    />
                    <Text
                        style={styles.organizationText}
                        numberOfLines={2}
                    >
                        {item.organization}
                    </Text>
                </View>

                <View style={styles.statsContainer}>
                    <View style={styles.productStat}>
                        <Text style={styles.productStatValue}>
                            {item.sites}
                        </Text>
                        <Text style={styles.productStatLabel}>
                            Sites
                        </Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.productStat}>
                        <Text style={styles.productStatValue}>
                            {item.districts}
                        </Text>
                        <Text style={styles.productStatLabel}>
                            Districts
                        </Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.productStat}>
                        <Text
                            style={[
                                styles.productStatValue,
                                {
                                    color:
                                        item.completion < 50
                                            ? colors.warning
                                            : colors.success,
                                },
                            ]}
                        >
                            {item.completion}%
                        </Text>
                        <Text style={styles.productStatLabel}>
                            Complete
                        </Text>
                    </View>
                </View>

                <View style={styles.completionSection}>
                    <View style={styles.completionHeader}>
                        <Text style={styles.completionLabel}>
                            Overall Completion
                        </Text>
                        <Text
                            style={[
                                styles.completionPercent,
                                {
                                    color:
                                        item.completion < 50
                                            ? colors.warning
                                            : colors.success,
                                },
                            ]}
                        >
                            {item.completion}%
                        </Text>
                    </View>

                    <View style={styles.progressBackground}>
                        <View
                            style={[
                                styles.progressFill,
                                {
                                    width: `${item.completion}%`,
                                    backgroundColor:
                                        item.completion < 50
                                            ? colors.warning
                                            : colors.success,
                                },
                            ]}
                        />
                    </View>
                </View>

                <View style={styles.dateRow}>
                    <View style={styles.dateItem}>
                        <Ionicons
                            name="calendar-outline"
                            size={20}
                            color={colors.textSecondary}
                        />
                        <Text
                            style={styles.dateText}
                            numberOfLines={1}
                        >
                            Start: {item.startDate}
                        </Text>
                    </View>
                    <View style={styles.dateItem}>
                        <Ionicons
                            name="calendar-outline"
                            size={20}
                            color={colors.textSecondary}
                        />
                        <Text
                            style={styles.dateText}
                            numberOfLines={1}
                        >
                            Target End: {item.targetEndDate}
                        </Text>
                    </View>
                </View>
            </Pressable>
        );
    };

    return (
        <View style={styles.root}>
            <ScrollView
                style={styles.mainScrollView}
                contentContainerStyle={styles.mainScrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                <AppHeader
                    logoWidth={145}
                    notificationCount={notificationCount}
                    onNotificationPress={() =>
                        console.log('Notifications pressed')
                    }
                    onAvatarPress={() => onNavigateToProfile?.()}
                />

                <View style={styles.paddedSection}>
                    <View style={styles.titleRow}>
                        <Pressable
                            onPress={onBack}
                            hitSlop={8}
                            style={styles.backButton}
                        >
                            <Ionicons
                                name="chevron-back"
                                size={30}
                                color={colors.textPrimary}
                            />
                        </Pressable>

                        <View style={styles.titleContainer}>
                            <Text style={styles.title}>
                                Select Product
                            </Text>
                            <Text style={styles.subtitle}>
                                Choose a product to view its sites
                            </Text>
                        </View>
                    </View>

                    <View style={styles.searchRow}>
                        <View style={styles.searchContainer}>
                            <Ionicons
                                name="search-outline"
                                size={28}
                                color={colors.textSecondary}
                            />
                            <TextInput
                                value={search}
                                onChangeText={setSearch}
                                placeholder="Search by product name or code..."
                                placeholderTextColor={
                                    colors.textPlaceholder
                                }
                                style={styles.searchInput}
                                numberOfLines={1}
                            />
                        </View>

                        <Pressable
                            style={styles.filterButton}
                            onPress={() =>
                                console.log('Filter pressed')
                            }
                        >
                            <Ionicons
                                name="options-outline"
                                size={28}
                                color={colors.white}
                            />
                        </Pressable>
                    </View>
                </View>

                <View style={styles.paddedSection}>
                    <View style={styles.filterChipsWrapper}>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.filterList}
                        >
                            {FILTERS.map(item => {
                                const active =
                                    activeFilter === item.key;

                                return (
                                    <Pressable
                                        key={item.key}
                                        onPress={() =>
                                            setActiveFilter(item.key)
                                        }
                                        style={[
                                            styles.filterChip,
                                            active &&
                                                styles.filterChipActive,
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.filterChipText,
                                                active &&
                                                    styles.filterChipTextActive,
                                            ]}
                                        >
                                            {item.label}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                    </View>
                </View>

                {/* ✅ Available header + cards with their own padding */}
                <View style={styles.paddedSection}>
                    <View style={styles.availableHeader}>
                        <Text style={styles.availableTitle}>
                            Available Products
                        </Text>
                        <Text style={styles.availableCount}>
                            {filteredProducts.length} of{' '}
                            {PRODUCTS.length} shown
                        </Text>
                    </View>

                    {filteredProducts.map(item =>
                        renderProductCard(item),
                    )}

                    {filteredProducts.length === 0 && (
                        <View style={styles.emptyContainer}>
                            <Ionicons
                                name="folder-open-outline"
                                size={44}
                                color={colors.textSecondary}
                            />
                            <Text style={styles.emptyTitle}>
                                No products found
                            </Text>
                            <Text style={styles.emptyText}>
                                Try a different product name or code.
                            </Text>
                        </View>
                    )}
                </View>
            </ScrollView>

            <BottomTabBar
                activeTab="sites"
                onTabPress={(tab) => {
                    onBottomTabPress?.(tab);
                }}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: colors.white,
    },

    mainScrollView: {
        flex: 1,
    },

    mainScrollContent: {
        paddingBottom: 110,
    },

    paddedSection: {
        paddingHorizontal: spacing.md,
    },

    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: spacing.lg,
        paddingBottom: spacing.md,
    },

    backButton: {
        width: 48,
        height: 48,
        borderRadius: radius.md,
        backgroundColor: colors.concreteLighter,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: spacing.sm,
        flexShrink: 0,
    },

    titleContainer: {
        flex: 1,
        minWidth: 0,
    },

    title: {
        ...typography.h2,
        fontSize: 23,
        lineHeight: 28,
        color: colors.textPrimary,
    },

    subtitle: {
        ...typography.body,
        fontSize: 14,
        lineHeight: 19,
        color: colors.textSecondary,
        marginTop: 1,
    },

    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginBottom: spacing.xs,
    },

    searchContainer: {
        flex: 1,
        minWidth: 0,
        height: 52,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 13,
        borderRadius: radius.md,
        backgroundColor: colors.concreteLighter,
        borderWidth: 1,
        borderColor: colors.cardBorder,
    },

    searchInput: {
        flex: 1,
        minWidth: 0,
        marginLeft: 7,
        paddingVertical: 0,
        fontSize: 14,
        color: colors.textPrimary,
    },

    filterButton: {
        width: 52,
        height: 52,
        flexShrink: 0,
        borderRadius: radius.md,
        backgroundColor: colors.primary,
        alignItems: 'center',
        justifyContent: 'center',
    },

    filterChipsWrapper: {
        flexGrow: 0,
    },

    filterList: {
        paddingTop: spacing.xs,
        paddingBottom: spacing.md,
        paddingRight: spacing.lg,
        gap: spacing.sm,
    },

    filterChip: {
        height: 40,
        paddingHorizontal: 18,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        backgroundColor: colors.white,
        alignItems: 'center',
        justifyContent: 'center',
    },

    filterChipActive: {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
    },

    filterChipText: {
        ...typography.label,
        fontSize: 14,
        color: colors.textSecondary,
        includeFontPadding: false,
    },

    filterChipTextActive: {
        color: colors.white,
    },

    availableHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: spacing.xs,
        marginBottom: spacing.md,
    },

    availableTitle: {
        ...typography.h2,
        fontSize: 20,
        lineHeight: 25,
        color: colors.textPrimary,
    },

    availableCount: {
        ...typography.bodySmall,
        fontSize: 13,
        color: colors.textSecondary,
    },

    productCard: {
        borderWidth: 1,
        borderColor: colors.cardBorder,
        borderRadius: radius.lg,
        backgroundColor: colors.white,
        marginBottom: spacing.md,
        overflow: 'hidden',
    },

    productHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        paddingHorizontal: 14,
        paddingTop: 14,
    },

    productTitleContainer: {
        flex: 1,
        minWidth: 0,
        paddingRight: 8,
    },

    productCode: {
        fontSize: 14,
        lineHeight: 18,
        color: colors.primary,
        fontWeight: '700',
    },

    productName: {
        fontSize: 18,
        lineHeight: 23,
        color: colors.textPrimary,
        fontWeight: '700',
        marginTop: 3,
    },

    productHeaderRight: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
        flexShrink: 0,
    },

    statusBadge: {
        minHeight: 27,
        paddingHorizontal: 9,
        borderRadius: radius.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },

    assignedBadge: {
        backgroundColor: '#E4F4E8',
    },

    statusText: {
        fontSize: 12,
        fontWeight: '700',
        color: colors.success,
    },

    recentStatusText: {
        color: colors.textSecondary,
    },

    nearbyStatusText: {
        color: '#D85C8A',
    },

    arrowButton: {
        width: 38,
        height: 38,
        borderRadius: radius.sm,
        backgroundColor: colors.concreteLighter,
        alignItems: 'center',
        justifyContent: 'center',
    },

    organizationRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginHorizontal: 14,
        marginTop: 10,
        marginBottom: 12,
    },

    organizationText: {
        flex: 1,
        minWidth: 0,
        fontSize: 13,
        lineHeight: 18,
        color: colors.textSecondary,
        marginLeft: 6,
    },

    statsContainer: {
        flexDirection: 'row',
        marginHorizontal: 14,
        borderRadius: radius.md,
        backgroundColor: colors.concreteLighter,
        paddingVertical: 10,
    },

    productStat: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },

    productStatValue: {
        fontSize: 23,
        lineHeight: 28,
        fontWeight: '700',
        color: colors.textPrimary,
    },

    productStatLabel: {
        fontSize: 12,
        color: colors.textSecondary,
        marginTop: 2,
    },

    statDivider: {
        width: 1,
        backgroundColor: colors.cardBorder,
    },

    completionSection: {
        marginHorizontal: 14,
        paddingVertical: 10,
    },

    completionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },

    completionLabel: {
        fontSize: 13,
        color: colors.textPrimary,
        fontWeight: '500',
    },

    completionPercent: {
        fontSize: 13,
        color: colors.success,
        fontWeight: '700',
    },

    progressBackground: {
        height: 6,
        borderRadius: radius.pill,
        backgroundColor: colors.borderGray,
        overflow: 'hidden',
    },

    progressFill: {
        height: '100%',
        borderRadius: radius.pill,
        backgroundColor: colors.success,
    },

    dateRow: {
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: colors.cardBorder,
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 8,
    },

    dateItem: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
    },

    dateText: {
        flex: 1,
        minWidth: 0,
        fontSize: 11,
        lineHeight: 16,
        color: colors.textSecondary,
        marginLeft: 5,
    },

    emptyContainer: {
        alignItems: 'center',
        paddingTop: spacing.xxl,
        paddingHorizontal: spacing.md,
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