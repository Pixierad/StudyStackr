// Local admin login.
//
// Change these values when you want to update the easy local/admin login.
// This bypass is handled in the app and does not create a Supabase user.
import { Platform } from 'react-native';

export const LOCAL_ADMIN_USERNAME = 'test';
export const LOCAL_ADMIN_PASSWORD = 'admin123';

export const LOCAL_ADMIN_SESSION_STORAGE_KEY = '@schoolapp:localAdminSession:v1';
export const LOCAL_ADMIN_ALLOWED_HOSTS = ['v.dev'];

export function isLocalAdminAccessAllowed() {
  if (Platform.OS !== 'web') return __DEV__;

  const hostname = globalThis?.location?.hostname;
  return LOCAL_ADMIN_ALLOWED_HOSTS.includes(String(hostname || '').toLowerCase());
}

export function isLocalAdminCredentials(username, password) {
  return (
    isLocalAdminAccessAllowed() &&
    String(username || '').trim().toLowerCase() === LOCAL_ADMIN_USERNAME.toLowerCase() &&
    String(password || '') === LOCAL_ADMIN_PASSWORD
  );
}

export function createLocalAdminSession() {
  return {
    access_token: 'local-admin',
    token_type: 'local',
    user: {
      id: 'local-admin',
      email: LOCAL_ADMIN_USERNAME,
      app_metadata: { local_admin: true },
      user_metadata: { role: 'admin' },
    },
  };
}

export function isLocalAdminSession(session) {
  return session?.user?.app_metadata?.local_admin === true;
}
