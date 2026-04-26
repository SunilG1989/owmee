import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

interface User {
  user_id: string;
  tier: 'basic' | 'verified';
  kyc_status: string;
  phone_verified: boolean;
}

interface AuthStore {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  // Actions
  setTokens: (access: string, refresh: string) => Promise<void>;
  setUser: (user: User) => void;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  accessToken: null,
  isLoading: true,

  setTokens: async (access, refresh) => {
    await AsyncStorage.setItem('access_token', access);
    await AsyncStorage.setItem('refresh_token', refresh);
    set({ accessToken: access });
  },

  setUser: (user) => {
    AsyncStorage.setItem('user', JSON.stringify(user));
    set({ user });
  },

  logout: async () => {
    await AsyncStorage.multiRemove(['access_token', 'refresh_token', 'user']);
    set({ user: null, accessToken: null });
  },

  loadFromStorage: async () => {
    try {
      const [token, userStr] = await AsyncStorage.multiGet(['access_token', 'user']);
      const accessToken = token[1] ?? null;
      const user = userStr[1] ? JSON.parse(userStr[1]) : null;
      set({ accessToken, user, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },
}));
