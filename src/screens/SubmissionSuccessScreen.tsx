import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../components/AppHeader';
import type { CapturedPhoto } from './CameraCaptureScreenX';

interface SubmissionSuccessScreenProps {
  activityCode?: string;
  activityName?: string;
  siteCode?: string;
  siteName?: string;
  capturedPhotos: CapturedPhoto[];
  progressNotes: string;
  onLogAnother: () => void;
  onBackToDashboard: () => void;
  onNavigateToProfile?: () => void;
}

export default function SubmissionSuccessScreen({
  activityCode = '',
  activityName = '',
  siteCode = '',
  siteName = '',
  capturedPhotos,
  progressNotes,
  onLogAnother,
  onBackToDashboard,
  onNavigateToProfile,
}: SubmissionSuccessScreenProps) {
  const photoCount = capturedPhotos.length;

  return (
    <View style={styles.safeArea}>
      <View style={styles.root}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
        >
          {/* Header with Curve Background */}
          <AppHeader
            variant="curved"
            logoWidth={130}
            notificationCount={0}
            notificationBadgeColor="#0B5FA8"
            onNotificationPress={() => console.log('[SubmissionSuccess] Notifications pressed')}
            avatarIcon="person"
            avatarIconColor="#D97706"
            avatarBackgroundColor="#FEF3D6"
            onAvatarPress={() => onNavigateToProfile?.()}
          />

          {/* Title Block */}
          <View style={styles.titleBlock}>
            <Text style={styles.pageTitle}>Submission Confirmed</Text>
          </View>

          {/* Success Card */}
          <View style={styles.successCard}>
            {/* Success Icon */}
            <View style={styles.successIconContainer}>
              <View style={styles.successIconCircle}>
                <Ionicons name="checkmark" size={40} color="#15803D" />
              </View>
            </View>

            <Text style={styles.successTitle}>Progress Submitted Successfully!</Text>
            <Text style={styles.successSubtitle}>
              Daily milestone has been verified, encrypted, and saved to your local offline queue.
            </Text>

            {/* Reference ID Badge */}
            <View style={styles.referenceBadge}>
              <Text style={styles.referenceText}>Reference ID: TXN-2026-089-AW14</Text>
            </View>

            {/* Details Card */}
            <View style={styles.detailsCard}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Site:</Text>
                <Text style={styles.detailValue}>{[siteCode, siteName ? `(${siteName})` : ''].filter(Boolean).join(' ') || '—'}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Activity:</Text>
                <Text style={styles.detailValue}>{activityName}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Progress Update:</Text>
                <Text style={[styles.detailValue, styles.detailValueHighlight]}>Daily Shift Logged</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Evidence Captured:</Text>
                <Text style={[styles.detailValue, styles.detailValueSuccess]}>
                  ✓ {photoCount} Watermarked Photo{photoCount > 1 ? 's' : ''}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Progress Comment:</Text>
                <Text style={styles.detailValue}>Saved & Attached</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>GPS Satellite Radius:</Text>
                <Text style={[styles.detailValue, styles.detailValueSuccess]}>✓ Verified (18m, ±4.5m)</Text>
              </View>
            </View>
          </View>

          {/* Quick Actions */}
          <View style={styles.quickActions}>
            <TouchableOpacity style={styles.quickActionItem} onPress={onLogAnother}>
              <Ionicons name="document-text-outline" size={20} color="#0056A6" />
              <Text style={styles.quickActionText}>View in My Updates</Text>
              <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.quickActionItem} onPress={onBackToDashboard}>
              <Ionicons name="sync-outline" size={20} color="#0056A6" />
              <Text style={styles.quickActionText}>View in Sync Center (1 Queued)</Text>
              <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          <View style={styles.bottomSpacer} />
        </ScrollView>

        {/* Sticky Bottom Footer */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.logAnotherButton} onPress={onLogAnother}>
            <Text style={styles.logAnotherButtonText}>Log Another Activity</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dashboardButton} onPress={onBackToDashboard}>
            <Text style={styles.dashboardButtonText}>Back to Dashboard</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  root: {
    flex: 1,
    backgroundColor: '#F8F9FB',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  titleBlock: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F5',
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
  successCard: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  successIconContainer: {
    marginBottom: 14,
  },
  successIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#DCFCE7',
    borderWidth: 3,
    borderColor: '#22C55E',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 4,
  },
  successTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 4,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 17,
  },
  referenceBadge: {
    backgroundColor: '#EBF3FA',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 16,
    marginBottom: 16,
  },
  referenceText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#0056A6',
  },
  detailsCard: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 14,
    width: '100%',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F5',
  },
  detailRowLast: {
    borderBottomWidth: 0,
  },
  detailLabel: {
    fontSize: 11.5,
    color: '#6B7280',
  },
  detailValue: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
    flex: 1,
    marginLeft: 8,
  },
  detailValueHighlight: {
    color: '#0056A6',
  },
  detailValueSuccess: {
    color: '#15803D',
  },
  quickActions: {
    marginHorizontal: 16,
    marginTop: 14,
    flexDirection: 'column',
    gap: 8,
  },
  quickActionItem: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 3,
    elevation: 1,
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
    flex: 1,
    marginLeft: 8,
  },
  bottomSpacer: {
    height: 20,
  },
  footer: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: 'row',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  logAnotherButton: {
    flex: 1,
    height: 48,
    borderWidth: 2,
    borderColor: '#0056A6',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logAnotherButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0056A6',
  },
  dashboardButton: {
    flex: 1,
    height: 48,
    backgroundColor: '#0056A6',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0056A6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 4,
  },
  dashboardButtonText: {
    fontSize: 14.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});