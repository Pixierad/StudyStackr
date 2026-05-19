import * as ImagePicker from 'expo-image-picker';

export const MAX_PROFILE_IMAGE_BYTES = 1500 * 1024;

export async function pickProfileImage() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      errorTitle: 'Photos permission needed',
      errorMessage: 'Allow photo access to choose a profile picture.',
    };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.75,
    base64: true,
  });
  if (result.canceled) return null;

  const asset = result.assets?.[0];
  if (!asset?.base64) {
    return { errorMessage: 'Could not read that image.' };
  }

  const imageBytes = Math.ceil((asset.base64.length * 3) / 4);
  if (imageBytes > MAX_PROFILE_IMAGE_BYTES) {
    return { errorMessage: 'Choose an image under 1.5 MB.' };
  }

  const mimeType = asset.mimeType || 'image/jpeg';
  return { uri: `data:${mimeType};base64,${asset.base64}` };
}
