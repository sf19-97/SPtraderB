// User profile dropdown menu
import { Avatar, Menu, Text, UnstyledButton, Group, rem, Box } from '@mantine/core';
import {
  IconLogout,
  IconSettings,
  IconBrandGithub,
  IconChevronDown,
} from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';

type UserMenuVariant = 'full' | 'compact';

interface UserMenuProps {
  variant?: UserMenuVariant;
}

export function UserMenu({ variant = 'full' }: UserMenuProps) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  if (!user) return null;

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <Menu
      width={200}
      position="bottom-end"
      transitionProps={{ transition: 'pop-top-right' }}
      withinPortal
    >
      <Menu.Target>
        <Box>
          <UnstyledButton
            style={{
              padding: variant === 'compact' ? '6px' : '4px 8px',
              borderRadius: '8px',
              transition: 'background 0.2s ease',
              width: variant === 'compact' ? '100%' : 'auto',
            }}
            styles={{
              root: {
                '&:hover': {
                  background: 'rgba(255, 255, 255, 0.05)',
                },
              },
            }}
          >
            <Group gap="xs" justify="space-between">
              <Avatar
                src={user.github_avatar_url}
                alt={user.github_username}
                radius="xl"
                size={32}
                style={{ border: '2px solid rgba(0, 255, 65, 0.3)' }}
              />
              {variant === 'full' && (
                <>
                  <div style={{ flex: 1 }}>
                    <Text size="sm" fw={500} c="gray.2">
                      {user.display_name || user.github_username}
                    </Text>
                    <Text size="xs" c="dimmed">
                      @{user.github_username}
                    </Text>
                  </div>
                  <IconChevronDown size={14} stroke={1.5} color="gray" />
                </>
              )}
            </Group>
          </UnstyledButton>
        </Box>
      </Menu.Target>

      <Menu.Dropdown
        style={{
          background: 'rgba(20, 20, 30, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <Menu.Label>Account</Menu.Label>

        <Menu.Item
          leftSection={<IconBrandGithub style={{ width: rem(14), height: rem(14) }} />}
          component="a"
          href={`https://github.com/${user.github_username}`}
          target="_blank"
        >
          GitHub Profile
        </Menu.Item>

        <Menu.Item
          leftSection={<IconSettings style={{ width: rem(14), height: rem(14) }} />}
          onClick={() => navigate('/settings')}
        >
          Settings
        </Menu.Item>

        <Menu.Divider />

        <Menu.Item
          color="red"
          leftSection={<IconLogout style={{ width: rem(14), height: rem(14) }} />}
          onClick={handleLogout}
        >
          Logout
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
