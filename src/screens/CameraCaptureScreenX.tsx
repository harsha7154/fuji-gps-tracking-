import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';

export interface CapturedPhoto {
  id: string;
  uri: string;
  coords: string;
  timestamp: string;
  stage?: string;
  title?: string;
  base64?: string;
  latitude?: number;
  longitude?: number;
  capturedAt?: number;
  mimeType?: string;
  fileName?: string;
}

export interface CameraCaptureScreenProps {
  siteCode?: string;
  siteName?: string;
  engineerName?: string;
  engineerId?: string;
  activityLabel?: string;
  frameHintText?: string;
  onCancel?: () => void;
  onPhotoCaptured?: (photo: CapturedPhoto) => void;
}

export default function CameraCaptureScreen({
  siteCode = '',
  siteName = '',
  engineerName = '',
  engineerId = '',
  activityLabel = '',
  frameHintText = 'Align the subject in the frame',
  onCancel,
  onPhotoCaptured,
}: CameraCaptureScreenProps) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [locationError, setLocationError] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);

  useEffect(() => {
    if (!permission) {
      requestPermission();
    } else if (!permission.granted) {
      requestPermission();
    }
  }, [permission]);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationError(true);
        return;
      }
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setLocation(loc);
      } catch (e) {
        console.log('[CameraCapture] location error:', e);
        setLocationError(true);
      }
    })();
  }, []);

  const coordsText = location
    ? `${location.coords.latitude.toFixed(5)}° N, ${location.coords.longitude.toFixed(5)}° E`
    : locationError
    ? 'GPS unavailable'
    : 'Acquiring GPS…';

  const accuracyText = location?.coords.accuracy
    ? `±${Math.round(location.coords.accuracy)}m`
    : '±—';

  const handleCapture = async () => {
    console.log('[CameraCapture] shutter tapped');
    if (!cameraRef.current) {
      console.log('[CameraCapture] camera ref not ready');
      return;
    }
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: true,
      });
      console.log('[CameraCapture] photo taken:', photo?.uri);
      if (!photo?.uri) return;

      const now = new Date();
      const capturedAt = now.getTime();
      const timestamp = now.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const latitude = location?.coords?.latitude;
      const longitude = location?.coords?.longitude;

      let base64 = photo.base64;
      if (!base64 && photo.uri) {
        try {
          const resp = await fetch(photo.uri);
          const blob = await resp.blob();
          base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const res = reader.result;
              if (typeof res === 'string') {
                const clean = res.replace(/^data:[a-zA-Z0-9/+-]+;base64,/, '').trim();
                resolve(clean);
              } else {
                resolve('');
              }
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (convErr) {
          console.warn('[CameraCapture] fallback base64 conversion error:', convErr);
        }
      }

      onPhotoCaptured?.({
        id: `photo_${capturedAt}`,
        uri: photo.uri,
        coords: coordsText,
        timestamp,
        stage: activityLabel,
        title: `${siteCode ? `${siteCode} ` : ''}EVIDENCE`,
        base64,
        latitude,
        longitude,
        capturedAt,
        mimeType: 'image/jpeg',
        fileName: `pod_photo_${capturedAt}.jpg`,
      });
    } catch (e) {
      console.log('[CameraCapture] takePictureAsync error:', e);
    }
  };

  if (!permission) {
    return <View style={styles.root} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.permissionWrap]}>
        <Ionicons name="camera-outline" size={40} color="#94A3B8" />
        <Text style={styles.permissionText}>Camera access is required to capture geo-tagged evidence.</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Camera Access</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onCancel} style={{ marginTop: 12 }}>
          <Text style={styles.permissionCancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      <View
        style={[
          styles.overlay,
          {
            paddingTop: Math.max(insets.top, 16),
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
            <Ionicons name="arrow-back" size={16} color="#111827" />
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>

          <View style={styles.precisionBadge}>
            <Ionicons name="disc-outline" size={14} color="#15803D" />
            <Text style={styles.precisionText}>High Precision ({accuracyText})</Text>
          </View>
        </View>

        <View style={styles.frameWrap}>
          <View style={styles.frame}>
            <Ionicons name="camera-outline" size={32} color="rgba(255,255,255,0.9)" />
            <Text style={styles.frameHint}>{frameHintText}</Text>
          </View>
        </View>

        <View style={styles.auditPanel}>
          <View style={styles.auditHeaderRow}>
            <View style={styles.auditHeaderLeft}>
              <Ionicons name="time-outline" size={13} color="#38BDF8" />
              <Text style={styles.auditHeaderText}>FUJI SILVERTECH AUDIT</Text>
            </View>
            <View style={styles.auditHeaderRight}>
              <Ionicons name="checkmark-circle" size={13} color="#4ADE80" />
              <Text style={styles.auditVerifiedText}>GPS {accuracyText} VERIFIED</Text>
            </View>
          </View>

          {siteCode || siteName ? (
            <View style={styles.auditRow}>
              <Ionicons name="location-outline" size={13} color="#94A3B8" />
              <Text style={styles.auditRowText}>
                Site: {[siteCode, siteName ? `(${siteName})` : ''].filter(Boolean).join(' ')}
              </Text>
            </View>
          ) : null}
          <View style={styles.auditRow}>
            <Ionicons name="disc-outline" size={13} color="#94A3B8" />
            <Text style={styles.auditRowText}>{coordsText}</Text>
          </View>
          {engineerName ? (
            <View style={styles.auditRow}>
              <Ionicons name="person-outline" size={13} color="#94A3B8" />
              <Text style={styles.auditRowText}>
                Engineer: {engineerName}{engineerId ? ` (${engineerId})` : ''}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.shutterWrap}>
          <TouchableOpacity style={styles.shutterOuter} onPress={handleCapture} activeOpacity={0.8}>
            <View style={styles.shutterInner}>
              <Ionicons name="camera" size={24} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
          <Text style={styles.shutterLabel}>Tap Shutter to Capture Geotagged Photo</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  permissionWrap: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  permissionText: { color: '#E2E8F0', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  permissionButton: {
    backgroundColor: '#0056A6',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  permissionButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  permissionCancelText: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },

  overlay: { flex: 1, justifyContent: 'space-between', padding: 16 },

  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(229,231,235,0.8)',
  },
  cancelButton: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cancelText: { color: '#111827', fontSize: 12.5, fontWeight: '700' },
  precisionBadge: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    backgroundColor: '#DCFCE7',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  precisionText: { color: '#15803D', fontSize: 11.5, fontWeight: '800' },

  frameWrap: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  frame: {
    width: '82%',
    height: '55%',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.75)',
    borderStyle: 'dashed',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  frameHint: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 16,
  },

  auditPanel: {
    backgroundColor: 'rgba(15,23,42,0.92)',
    borderWidth: 1,
    borderColor: '#38BDF8',
    borderRadius: 12,
    padding: 12,
    gap: 4,
  },
  auditHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(56,189,248,0.2)',
  },
  auditHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  auditHeaderText: { color: '#38BDF8', fontWeight: '800', fontSize: 10.5 },
  auditHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  auditVerifiedText: { color: '#4ADE80', fontWeight: '800', fontSize: 10.5 },
  auditRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  auditRowText: { color: '#FFFFFF', fontSize: 10.5 },

  shutterWrap: { alignItems: 'center', gap: 8, paddingBottom: 8, marginTop: 12 },
  shutterOuter: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 3.5,
    borderColor: '#0056A6',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0056A6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterLabel: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: 20,
  },
});