import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TripMilestone } from '../../types/myTrip';

interface RouteTimelineProps {
  milestones: TripMilestone[];
}

/**
 * Route Corridors & Milestones vertical timeline card matching Section 4:
 * - Origin: Blue dot, loaded & dispatched info
 * - Destination: Green dot, ETA & crane readiness
 * - Vertical connector line linking all milestones
 * (The "current location" milestone is intentionally not shown.)
 */
export const RouteTimeline: React.FC<RouteTimelineProps> = ({ milestones }) => {
  const visibleMilestones = (milestones ?? []).filter(
    (m) => !(m.isCurrent || m.statusType === 'current')
  );

  if (visibleMilestones.length === 0) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Route Corridors & Milestones</Text>

      <View style={styles.timelineContainer}>
        {visibleMilestones.map((item, index) => {
          const isLast = index === visibleMilestones.length - 1;
          const isCurrent = item.isCurrent || item.statusType === 'current';

          return (
            <View key={item.id} style={styles.milestoneRow}>
              {/* Indicator column (Dot + Connector line) */}
              <View style={styles.indicatorCol}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: item.dotColor },
                    isCurrent && styles.currentDotShadow,
                  ]}
                />
                {!isLast && <View style={styles.connectorLine} />}
              </View>

              {/* Text content column */}
              <View style={[styles.contentCol, !isLast && styles.contentColWithSpacing]}>
                <Text
                  style={[
                    styles.milestoneTitle,
                    isCurrent ? styles.currentMilestoneTitle : styles.defaultMilestoneTitle,
                  ]}
                >
                  {item.title}
                </Text>
                <Text style={styles.milestoneDetails}>{item.details}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#172033',
    marginBottom: 16,
    letterSpacing: -0.2,
  },
  timelineContainer: {
    paddingLeft: 4,
  },
  milestoneRow: {
    flexDirection: 'row',
  },
  indicatorCol: {
    alignItems: 'center',
    width: 20,
    marginRight: 10,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 3,
  },
  currentDotShadow: {
    shadowColor: '#0D9488',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  connectorLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#CBD5E1',
    marginVertical: 4,
  },
  contentCol: {
    flex: 1,
  },
  contentColWithSpacing: {
    paddingBottom: 22,
  },
  milestoneTitle: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  defaultMilestoneTitle: {
    color: '#172033',
  },
  currentMilestoneTitle: {
    color: '#0D9488',
  },
  milestoneDetails: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 3,
    lineHeight: 17,
  },
});
