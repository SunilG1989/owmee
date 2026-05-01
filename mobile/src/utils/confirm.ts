/**
 * Promise-based Alert.alert wrapper for destructive-action confirmations.
 *
 * Replaces the inline-callback pattern that's easy to forget and easy to
 * implement inconsistently. Resolves to true if the user confirmed,
 * false if they cancelled.
 *
 * Usage:
 *   if (await confirmDestructive('Withdraw offer?', 'You can\'t undo this.')) {
 *     await Offers.withdraw(id);
 *   }
 */
import { Alert } from 'react-native';

export function confirmDestructive(
  title: string,
  body?: string,
  confirmLabel: string = 'Yes',
  cancelLabel: string = 'Cancel',
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      body,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

export function confirm(
  title: string,
  body?: string,
  confirmLabel: string = 'OK',
  cancelLabel: string = 'Cancel',
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      body,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
