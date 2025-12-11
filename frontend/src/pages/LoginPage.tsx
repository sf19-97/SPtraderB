// Login page with GitHub OAuth
import { Box, Button, Container, Paper, Stack, Text, Title } from '@mantine/core';
import { IconBrandGithub } from '@tabler/icons-react';
import { authApi } from '../stores/useAuthStore';

export function LoginPage() {
  const allowedOrigin = import.meta.env.VITE_FRONTEND_URL || window.location.origin;
  const isOriginAllowed = window.location.origin === allowedOrigin;

  const handleGitHubLogin = async () => {
    if (!isOriginAllowed) return;
    const url = await authApi.getGitHubAuthUrl();
    window.location.href = url;
  };

  return (
    <Box
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0a0a0a 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Container size="xs">
        <Paper
          p="xl"
          radius="lg"
          style={{
            background: 'rgba(20, 20, 30, 0.9)',
            border: '1px solid rgba(0, 255, 65, 0.2)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <Stack align="center" gap="lg">
            {/* Logo / Title */}
            <Box ta="center">
              <Title
                order={1}
                style={{
                  color: '#00ff41',
                  fontFamily: 'monospace',
                  fontSize: '2.5rem',
                  textShadow: '0 0 20px rgba(0, 255, 65, 0.5)',
                }}
              >
                SPtraderB
              </Title>
              <Text c="dimmed" size="sm" mt="xs">
                AI-Powered Trading Platform
              </Text>
            </Box>

            {/* Description */}
            <Text c="gray.5" ta="center" size="sm" maw={300}>
              Connect your GitHub account to access your trading strategies, datasets, and personalized workspace.
            </Text>

            {/* GitHub Login Button */}
            <Button
              size="lg"
              fullWidth
              leftSection={<IconBrandGithub size={24} />}
              onClick={handleGitHubLogin}
              disabled={!isOriginAllowed}
              style={{
                background: '#24292e',
                border: '1px solid #444',
                transition: 'all 0.2s ease',
              }}
              styles={{
                root: {
                  '&:hover': {
                    background: '#2d3339',
                    transform: 'translateY(-2px)',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
                  },
                },
              }}
            >
              Continue with GitHub
            </Button>

            {!isOriginAllowed && (
              <Text c="red" size="sm" ta="center">
                Login is disabled on this preview host. Please use {allowedOrigin}.
              </Text>
            )}

            {/* Features list */}
            <Stack gap="xs" mt="md">
              <FeatureItem text="Sync strategies from your repos" />
              <FeatureItem text="Import custom datasets" />
              <FeatureItem text="Save preferences & memory" />
              <FeatureItem text="Collaborate on strategies" />
            </Stack>

            {/* Footer */}
            <Text c="dimmed" size="xs" ta="center" mt="lg">
              By continuing, you agree to grant SPtraderB access to your GitHub profile and repositories.
            </Text>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}

function FeatureItem({ text }: { text: string }) {
  return (
    <Text size="sm" c="gray.5">
      <Text span c="green" mr="xs">
        +
      </Text>
      {text}
    </Text>
  );
}
