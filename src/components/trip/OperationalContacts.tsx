import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { OperationalContact } from '../../types/myTrip';

interface OperationalContactsProps {
  contacts: OperationalContact[];
  onCallPress?: (contact: OperationalContact) => void;
}

/**
 * Operational Contacts Card matching Section 6 & design reference:
 * - Card title: "Operational Contacts"
 * - Site Engineer (Rajesh Sharma) with green circular call button
 * - Plant Dispatch (Vikas Patil) with light blue circular call button
 */
export const OperationalContacts: React.FC<OperationalContactsProps> = ({
  contacts,
  onCallPress,
}) => {
  if (!contacts || contacts.length === 0) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Operational Contacts</Text>

      <View style={styles.contactList}>
        {contacts.map((contact, index) => {
          const isGreen = contact.buttonType === 'green';
          const isLast = index === contacts.length - 1;

          return (
            <View
              key={contact.id}
              style={[styles.contactBox, !isLast && styles.contactBoxSpacing]}
            >
              <View style={styles.infoCol}>
                <Text style={styles.contactName} numberOfLines={1}>
                  {contact.name}
                </Text>
                <Text style={styles.contactSubtitle} numberOfLines={1}>
                  {contact.subtitle}
                </Text>
              </View>

              <Pressable
                onPress={() => onCallPress?.(contact)}
                style={({ pressed }) => [
                  styles.callButton,
                  isGreen ? styles.callButtonGreen : styles.callButtonBlue,
                  pressed && styles.callButtonPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Call ${contact.name}`}
                hitSlop={6}
              >
                <Ionicons
                  name="call"
                  size={18}
                  color={isGreen ? '#16A34A' : '#0066B3'}
                />
              </Pressable>
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
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  contactList: {
    gap: 10,
  },
  contactBox: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
  },
  contactBoxSpacing: {
    marginBottom: 0,
  },
  infoCol: {
    flex: 1,
    marginRight: 10,
  },
  contactName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#172033',
    letterSpacing: -0.1,
  },
  contactSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 3,
  },
  callButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callButtonGreen: {
    backgroundColor: '#DCFCE7',
  },
  callButtonBlue: {
    backgroundColor: '#E0F2FE',
  },
  callButtonPressed: {
    opacity: 0.7,
  },
});
