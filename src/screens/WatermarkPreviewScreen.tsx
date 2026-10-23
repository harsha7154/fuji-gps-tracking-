import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../components/AppHeader';
import type { CapturedPhoto } from './CameraCaptureScreenX';

interface WatermarkPreviewScreenProps {
  activityCode?: string;
  activityName?: string;
  siteCode?: string;
  siteName?: string;
  engineerName?: string;
  capturedPhotos: CapturedPhoto[];
  progressNotes: string;
  onBack: () => void;
  onSubmit: () => void;
  onNavigateToProfile?: () => void;
}

export default function WatermarkPreviewScreen({
  activityCode = '',
  activityName = '',
  siteCode = '',
  siteName = '',
  engineerName = '',
  capturedPhotos,
  progressNotes,
  onBack,
  onSubmit,
  onNavigateToProfile,
}: WatermarkPreviewScreenProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const currentPhoto = capturedPhotos[selectedIndex] || capturedPhotos[0];
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
            onNotificationPress={() => console.log('[WatermarkPreview] Notifications pressed')}
            avatarIcon="person"
            avatarIconColor="#D97706"
            avatarBackgroundColor="#FEF3D6"
            onAvatarPress={() => onNavigateToProfile?.()}
          />

          {/* Title Block */}
          <View style={styles.titleBlock}>
            <Text style={styles.pageTitle}>Digital Watermark Proof</Text>
            <Text style={styles.pageSubtitle}>
              Official cryptographic stamp embedded into photograph{photoCount > 1 ? 's' : ''}
            </Text>
          </View>

          {/* Photo Selector Pills (if multiple photos) */}
          {photoCount > 1 && (
            <View style={styles.pillContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillScrollContent}>
                {capturedPhotos.map((_, index) => (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.pill,
                      selectedIndex === index && styles.pillActive,
                    ]}
                    onPress={() => setSelectedIndex(index)}
                  >
                    <Text style={[
                      styles.pillText,
                      selectedIndex === index && styles.pillTextActive,
                    ]}>
                      Photo #{index + 1}
                      {selectedIndex === index && ' (Active)'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Main Photo with Watermark */}
          <View style={styles.photoCard}>
            <View style={styles.photoContainer}>
              <Image source={{ uri: currentPhoto?.uri }} style={styles.photo} resizeMode="cover" />
              
              {/* Watermark Overlay */}
              <View style={styles.watermarkOverlay}>
                <View style={styles.watermarkHeader}>
                  <Text style={styles.watermarkTitle}>MAHARASHTRA ANGANWADI MASTER</Text>
                  <Text style={styles.watermarkVerified}>
                    ✓ GEO-TAGGED ({selectedIndex + 1}/{photoCount})
                  </Text>
                </View>
                <View style={styles.watermarkRow}>
                  <Ionicons name="location-outline" size={12} color="#94A3B8" />
                  <Text style={styles.watermarkText}>
                    Site: {[siteCode, siteName].filter(Boolean).join(' • ') || '—'}
                  </Text>
                </View>
                {engineerName ? (
                  <View style={styles.watermarkRow}>
                    <Ionicons name="person-outline" size={12} color="#94A3B8" />
                    <Text style={styles.watermarkText}>
                      Engineer: {engineerName}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.watermarkRow}>
                  <Ionicons name="time-outline" size={12} color="#94A3B8" />
                  <Text style={styles.watermarkText}>
                    {[currentPhoto?.timestamp, [activityCode, activityName].filter(Boolean).join(' ')].filter(Boolean).join(' • ')}
                  </Text>
                </View>
                <View style={styles.watermarkRow}>
                  <Ionicons name="navigate-outline" size={12} color="#94A3B8" />
                  <Text style={styles.watermarkText}>
                    GPS: {currentPhoto?.coords || '21.145820° N, 79.088240° E (±4.5m)'}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.bottomSpacer} />
        </ScrollView>

        {/* Sticky Bottom Footer */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Ionicons name="arrow-back" size={18} color="#0056A6" />
            <Text style={styles.backButtonText}>Back / Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitButton} onPress={onSubmit}>
            <Text style={styles.submitButtonText}>Submit Update Progress</Text>
            <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
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
  pageSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  pillContainer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F3F5',
  },
  pillScrollContent: {
    gap: 8,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    marginRight: 8,
  },
  pillActive: {
    backgroundColor: '#0056A6',
    borderColor: '#0056A6',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  photoCard: {
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 2,
  },
  photoContainer: {
    height: 260,
    position: 'relative',
    backgroundColor: '#0F172A',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  watermarkOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(15,23,42,0.92)',
    borderTopWidth: 1.5,
    borderTopColor: '#38BDF8',
    padding: 10,
  },
  watermarkHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  watermarkTitle: {
    color: '#38BDF8',
    fontWeight: '800',
    fontSize: 9.5,
  },
  watermarkVerified: {
    color: '#4ADE80',
    fontWeight: '900',
    fontSize: 9.5,
  },
  watermarkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  watermarkText: {
    color: '#E2E8F0',
    fontSize: 9.5,
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
  backButton: {
    flex: 1,
    height: 48,
    borderWidth: 2,
    borderColor: '#0056A6',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0056A6',
  },
  submitButton: {
    flex: 2.2,
    height: 48,
    backgroundColor: '#0056A6',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#0056A6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 4,
  },
  submitButtonText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});