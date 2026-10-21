import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CargoManifestData } from '../../types/myTrip';

interface CargoManifestProps {
  cargo: CargoManifestData;
}

/**
 * Cargo Manifest Card matching Section 5 & design reference:
 * - Header: Cargo Manifest (Precast Elements) + Total Weight badge (18.4 TONS)
 * - Clean table with Element Code, Qty, Weight columns
 * - Footer bullets: Gross Truck Weight + Cargo Bracing spec
 * - Responsive table column layout designed for Android screen widths
 */
export const CargoManifest: React.FC<CargoManifestProps> = ({ cargo }) => {
  return (
    <View style={styles.card}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <Text style={styles.cardTitle}>Cargo Manifest (Precast Elements)</Text>
        {cargo.totalWeight ? (
          <View style={styles.badgeContainer}>
            <Text style={styles.badgeText}>{cargo.totalWeight}</Text>
          </View>
        ) : null}
      </View>

      {/* Manifest Table */}
      <View style={styles.table}>
        {/* Table Header */}
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.headerCell, styles.colElement]}>Element Code</Text>
          <Text style={[styles.headerCell, styles.colQty]}>Qty</Text>
          <Text style={[styles.headerCell, styles.colWeight]}>Weight</Text>
        </View>

        {/* Table Rows */}
        {cargo.items.length === 0 ? (
          <View style={styles.tableDataRow}>
            <Text style={[styles.dataCellCode, styles.colElement]}>
              No cargo items listed
            </Text>
            <Text style={[styles.dataCellQty, styles.colQty]}>—</Text>
            <Text style={[styles.dataCellWeight, styles.colWeight]}>—</Text>
          </View>
        ) : (
          cargo.items.map((item, index) => {
            const isLast = index === cargo.items.length - 1;

            return (
              <View
                key={item.id}
                style={[styles.tableDataRow, !isLast && styles.tableRowBorder]}
              >
                <Text style={[styles.dataCellCode, styles.colElement]} numberOfLines={2}>
                  {item.elementCode}
                </Text>
                <Text style={[styles.dataCellQty, styles.colQty]}>{item.quantity}</Text>
                <Text style={[styles.dataCellWeight, styles.colWeight]}>{item.weight}</Text>
              </View>
            );
          })
        )}
      </View>

      {/* Cargo Footer Bullet Notes */}
      {cargo.grossTruckWeight || cargo.cargoBracing ? (
        <View style={styles.footerNotes}>
          {cargo.grossTruckWeight ? (
            <Text style={styles.footerNoteLine}>
              <Text style={styles.bullet}>• </Text>
              <Text style={styles.footerLabel}>Gross Truck Weight: </Text>
              <Text style={styles.footerHighlight}>{cargo.grossTruckWeight} </Text>
              {cargo.permissibleWeight ? (
                <Text style={styles.footerParenthesis}>({cargo.permissibleWeight})</Text>
              ) : null}
            </Text>
          ) : null}

          {cargo.cargoBracing ? (
            <Text style={styles.footerNoteLine}>
              <Text style={styles.bullet}>• </Text>
              <Text style={styles.footerLabel}>Cargo Bracing: </Text>
              <Text style={styles.footerDark}>{cargo.cargoBracing}</Text>
            </Text>
          ) : null}
        </View>
      ) : null}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#172033',
    flex: 1,
    letterSpacing: -0.2,
  },
  badgeContainer: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginLeft: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0066B3',
    letterSpacing: 0.3,
  },
  table: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  tableDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: '#FFFFFF',
  },
  tableRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerCell: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4B5563',
  },
  colElement: {
    flex: 2.1,
  },
  colQty: {
    flex: 0.9,
    textAlign: 'center',
  },
  colWeight: {
    flex: 0.8,
    textAlign: 'right',
  },
  dataCellCode: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1F2937',
    lineHeight: 18,
  },
  dataCellQty: {
    fontSize: 13,
    color: '#4B5563',
    textAlign: 'center',
  },
  dataCellWeight: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1F2937',
    textAlign: 'right',
  },
  footerNotes: {
    marginTop: 12,
    gap: 4,
  },
  footerNoteLine: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  bullet: {
    color: '#6B7280',
    fontSize: 14,
  },
  footerLabel: {
    color: '#6B7280',
    fontWeight: '400',
  },
  footerHighlight: {
    color: '#172033',
    fontWeight: '700',
  },
  footerParenthesis: {
    color: '#6B7280',
    fontWeight: '400',
  },
  footerDark: {
    color: '#1F2937',
    fontWeight: '500',
  },
});
