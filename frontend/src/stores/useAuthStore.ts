// Authentication store for SPtraderB
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createLogger } from '../utils/logger';

export interface UserProfile {
  id: string;
  github_username: string;
  github_email: string | null;
  github_avatar_url: string | null;
  display_name: string | null;
  preferences: Record<string, unknown>;
  connected_repos: Array<{
    id: number;
    name: string;
    full_name: string;
    private: boolean;
  }>;
  created_at: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  default_branch: string;
}

interface AuthState {
  // State
  token: string | null;
  user: UserProfile | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setAuth: (token: string, user: UserProfile) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  updatePreferences: (preferences: Record<string, unknown>) => void;
  updateMemory: (memory: Record<string, unknown>) => void;
  revalidateSession: () => Promise<void>;

  // Computed
  isAuthenticated: () => boolean;
}

const API_URL = import.meta.env.VITE_API_URL || 'https://sptraderb-api.fly.dev';
const authLogger = createLogger('auth');

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      token: null,
      user: null,
      isLoading: false,
      error: null,

      // Actions
      setAuth: (token, user) => {
        set({ token, user, error: null });
      },

      logout: () => {
        set({ token: null, user: null, error: null });
      },

      setLoading: (isLoading) => {
        set({ isLoading });
      },

      setError: (error) => {
        set({ error, isLoading: false });
      },

      updatePreferences: async (preferences) => {
        const { token, user } = get();
        if (!token || !user) return;

        try {
          const mergedPreferences = {
            ...(user.preferences || {}),
            ...preferences,
          };

          const response = await fetch(`${API_URL}/api/auth/preferences`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ preferences: mergedPreferences }),
          });

          if (response.ok) {
            set({ user: { ...user, preferences: mergedPreferences } });
          } else {
            authLogger.warn('Failed to update preferences', response.status);
          }
        } catch (error) {
          authLogger.error('Failed to update preferences', error);
        }
      },

      updateMemory: async (memory) => {
        const { token } = get();
        if (!token) return;

        try {
          await fetch(`${API_URL}/api/auth/memory`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ memory }),
          });
        } catch (error) {
          authLogger.error('Failed to update memory', error);
        }
      },

      revalidateSession: async () => {
        const { token, logout, setAuth } = get();
        if (!token) return;
        try {
          const user = await authApi.getMe(token);
          setAuth(token, user);
        } catch (error) {
          const status = (error as any)?.status;
          // Only force logout on explicit auth failures; keep the session on transient errors
          if (status === 401 || status === 403) {
            authLogger.warn('Session revalidation failed with auth error, logging out', {
              status,
              error,
            });
            logout();
          } else {
            authLogger.warn('Session revalidation failed; keeping session', {
              status,
              error,
            });
          }
        }
      },

      // Computed
      isAuthenticated: () => {
        const { token, user } = get();
        return !!(token && user);
      },
    }),
    {
      name: 'sptraderb-auth-storage',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
      }),
    }
  )
);

// Auth API functions
export const authApi = {
  // Exchange GitHub code for token
  exchangeCode: async (
    code: string,
    codeVerifier: string,
    state?: string
  ): Promise<{ token: string; user: UserProfile }> => {
    const response = await fetch(`${API_URL}/api/auth/callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code, code_verifier: codeVerifier, state }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Authentication failed');
    }

    return response.json();
  },

  // Get current user profile
  getMe: async (token: string): Promise<UserProfile> => {
    const response = await fetch(`${API_URL}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      let message = 'Failed to fetch user profile';
      try {
        const data = await response.json();
        if (data?.error) {
          message = data.error;
        }
      } catch {
        // Ignore parse errors; keep default message
      }
      const error: Error & { status?: number } = new Error(message);
      error.status = response.status;
      authLogger.error('authApi.getMe failed', {
        status: response.status,
        message,
      });
      throw error;
    }

    return response.json();
  },

  // List user's GitHub repos
  listRepos: async (token: string): Promise<GitHubRepo[]> => {
    const response = await fetch(`${API_URL}/api/auth/repos`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const message = await response.text();
      const error: Error & { status?: number } = new Error(
        message || 'Failed to fetch repositories'
      );
      error.status = response.status;
      throw error;
    }

    return response.json();
  },

  // Get GitHub OAuth URL with PKCE + state
  getGitHubAuthUrl: async (): Promise<string> => {
    const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID;
    const frontendUrl = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
    const redirectUri = `${frontendUrl}/auth/callback`;
    const scope = 'user:email,repo';

    if (!clientId) {
      throw new Error('GitHub Client ID is not configured');
    }

    // Generate state + PKCE code verifier
    const state = crypto.randomUUID();
    const codeVerifier = generateCodeVerifier();

    // Persist for callback validation
    sessionStorage.setItem('github_oauth_state', state);
    sessionStorage.setItem('github_code_verifier', codeVerifier);

    const codeChallenge = await generateCodeChallenge(codeVerifier);

    return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&scope=${scope}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
  },
};

// Helper to generate a high-entropy PKCE code verifier
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  // Base64url encode
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Helper to derive the S256 code challenge
async function generateCodeChallenge(verifier: string) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let str = '';
  bytes.forEach((b) => {
    str += String.fromCharCode(b);
  });

  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
