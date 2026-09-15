import React from 'react';
import { View } from 'react-native';

export default function ReceiptPopover({ children, details, open }) {
  return <View>{children}{open ? details : null}</View>;
}
