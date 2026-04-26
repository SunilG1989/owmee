import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Dev: point to local Docker backend
// Prod: swap to https://api.owmee.in
const BASE_URL = __DEV__
  ? 'http://10.0.2.2:8000'   // Android emulator → host
  : 'https://api.owmee.in';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach access token on every request
api.interceptors.request.use(async (config) => {
  const token = await AsyncStorage.getItem('access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refresh = await AsyncStorage.getItem('refresh_token');
        if (!refresh) throw new Error('no_refresh');
        const res = await axios.post(`${BASE_URL}/v1/auth/token/refresh`, {
          refresh_token: refresh,
        });
        const { access_token, refresh_token } = res.data;
        await AsyncStorage.setItem('access_token', access_token);
        await AsyncStorage.setItem('refresh_token', refresh_token);
        original.headers.Authorization = `Bearer ${access_token}`;
        return api(original);
      } catch {
        await AsyncStorage.multiRemove(['access_token', 'refresh_token', 'user']);
        // Navigation to auth handled by root navigator
      }
    }
    return Promise.reject(error);
  }
);
