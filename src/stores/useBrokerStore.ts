import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface BrokerProfile {
  id: string;
  name: string;
  broker: string;
  apiKey: string;
  account: string;
  isActive: boolean;
  // Additional fields for future use
  apiSecret?: string;
  environment?: 'live' | 'paper' | 'demo';
  baseUrl?: string;
}

interface BrokerStore {
  profiles: BrokerProfile[];
  activeProfileId: string | null;

  // Actions
  addProfile: (profile: Omit<BrokerProfile, 'id' | 'isActive'>) => void;
  updateProfile: (id: string, updates: Partial<BrokerProfile>) => void;
  deleteProfile: (id: string) => void;
  activateProfile: (id: string) => void;
  getActiveProfile: () => BrokerProfile | null;

  // Encryption helpers (basic - can be enhanced)
  encryptSensitiveData: (data: string) => string;
  decryptSensitiveData: (data: string) => string;
}

// Basic encryption (you should use a proper encryption library in production)
const simpleEncrypt = (text: string): string => {
  // This is just a basic example - use proper encryption in production!
  return btoa(text);
};

const simpleDecrypt = (text: string): string => {
  try {
    return atob(text);
  } catch {
    return text;
  }
};

export const useBrokerStore = create<BrokerStore>()(
  persist(
    (set, get) => ({
      profiles: [],
      activeProfileId: null,

      addProfile: (profileData) => {
        const newProfile: BrokerProfile = {
          ...profileData,
          id: Date.now().toString(),
          isActive: false,
          // Encrypt sensitive data
          apiKey: simpleEncrypt(profileData.apiKey),
          apiSecret: profileData.apiSecret ? simpleEncrypt(profileData.apiSecret) : undefined,
        };

        set((state) => ({
          profiles: [...state.profiles, newProfile],
          // If it's the first profile, make it active
          activeProfileId: state.profiles.length === 0 ? newProfile.id : state.activeProfileId,
        }));

        // Also update isActive flag if it's the first profile
        if (get().profiles.length === 1) {
          get().activateProfile(newProfile.id);
        }
      },

      updateProfile: (id, updates) => {
        set((state) => ({
          profiles: state.profiles.map((p) => {
            if (p.id === id) {
              const updated = { ...p, ...updates };
              // Re-encrypt if API key or secret changed
              if (updates.apiKey) {
                updated.apiKey = simpleEncrypt(updates.apiKey);
              }
              if (updates.apiSecret) {
                updated.apiSecret = simpleEncrypt(updates.apiSecret);
              }
              return updated;
            }
            return p;
          }),
        }));
      },

      deleteProfile: (id) => {
        set((state) => {
          const newProfiles = state.profiles.filter((p) => p.id !== id);
          // If we deleted the active profile, activate the first remaining one
          const newActiveId =
            state.activeProfileId === id
              ? newProfiles.length > 0
                ? newProfiles[0].id
                : null
              : state.activeProfileId;

          return {
            profiles: newProfiles,
            activeProfileId: newActiveId,
          };
        });

        // Update isActive flags
        const newActiveId = get().activeProfileId;
        if (newActiveId) {
          get().activateProfile(newActiveId);
        }
      },

      activateProfile: (id) => {
        set((state) => ({
          activeProfileId: id,
          profiles: state.profiles.map((p) => ({
            ...p,
            isActive: p.id === id,
          })),
        }));
      },

      getActiveProfile: () => {
        const state = get();
        const profile = state.profiles.find((p) => p.id === state.activeProfileId);
        if (!profile) return null;

        // Return decrypted version
        return {
          ...profile,
          apiKey: simpleDecrypt(profile.apiKey),
          apiSecret: profile.apiSecret ? simpleDecrypt(profile.apiSecret) : undefined,
        };
      },

      encryptSensitiveData: simpleEncrypt,
      decryptSensitiveData: simpleDecrypt,
    }),
    {
      name: 'broker-profiles',
      // Custom storage to handle encryption
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (str) {
            try {
              return JSON.parse(str);
            } catch {
              return null;
            }
          }
          return null;
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          localStorage.removeItem(name);
        },
      },
    }
  )
);
