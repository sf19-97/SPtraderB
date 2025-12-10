// OAuth callback page - handles GitHub redirect
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Loader, Stack, Text } from '@mantine/core';
import { useAuthStore, authApi } from '../stores/useAuthStore';

export function AuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setAuth, setError, logout } = useAuthStore();
  const [status, setStatus] = useState<'loading' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const resetAuthState = (message: string) => {
    setStatus('error');
    setErrorMessage(message);
    setError(message);
    logout();
    sessionStorage.removeItem('github_oauth_state');
    sessionStorage.removeItem('github_code_verifier');
  };

  useEffect(() => {
    const code = searchParams.get('code');
    const returnedState = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    const storedState = sessionStorage.getItem('github_oauth_state');
    const codeVerifier = sessionStorage.getItem('github_code_verifier');

    if (error) {
      resetAuthState(errorDescription || error);
      return;
    }

    if (!code) {
      resetAuthState('No authorization code received');
      return;
    }

    if (!returnedState || !storedState || returnedState !== storedState) {
      resetAuthState('Invalid OAuth state. Please try again.');
      return;
    }

    if (!codeVerifier) {
      resetAuthState('Missing PKCE verifier. Please start the login again.');
      return;
    }

    // Exchange code for token
    const authenticate = async () => {
      try {
        const { token, user } = await authApi.exchangeCode(code, codeVerifier, returnedState);
        setAuth(token, user);
        // Clean up PKCE artifacts
        sessionStorage.removeItem('github_oauth_state');
        sessionStorage.removeItem('github_code_verifier');
        navigate('/trading', { replace: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Authentication failed';
        resetAuthState(message);
      }
    };

    authenticate();
  }, [searchParams, navigate, setAuth, setError]);

  return (
    <Box
      style={{
        minHeight: '100vh',
        background: '#0a0a0a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Stack align="center" gap="lg">
        {status === 'loading' ? (
          <>
            <Loader color="green" size="lg" type="dots" />
            <Text c="green" size="lg" style={{ fontFamily: 'monospace' }}>
              Authenticating with GitHub...
            </Text>
          </>
        ) : (
          <>
            <Text c="red" size="lg" fw={600}>
              Authentication Failed
            </Text>
            <Text c="dimmed" size="sm" maw={400} ta="center">
              {errorMessage}
            </Text>
            <Text
              c="green"
              size="sm"
              style={{ cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => navigate('/login')}
            >
              Return to login
            </Text>
          </>
        )}
      </Stack>
    </Box>
  );
}
