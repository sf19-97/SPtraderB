// src/layouts/AppLayout.tsx
import { NavLink, Group, Text, UnstyledButton, ActionIcon, Stack, Tooltip, Box } from '@mantine/core';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { 
  IconChartLine, 
  IconTestPipe, 
  IconBrain, 
  IconHistory, 
  IconSettings,
  IconChevronLeft,
  IconChevronRight 
} from '@tabler/icons-react';

export const AppLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(true); // Start collapsed

  const navItems = [
    { path: '/trading', label: 'Trading', icon: IconChartLine },
    { path: '/backtest', label: 'Backtest', icon: IconTestPipe },
    { path: '/screener', label: 'Screener', icon: IconBrain },
    { path: '/history', label: 'History', icon: IconHistory },
  ];

  return (
    <Box style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* Main Content - Always full width */}
      <Box style={{ width: '100%', height: '100%' }}>
        <Outlet />
      </Box>

      {/* Overlay Sidebar */}
      <Box
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          height: '100vh',
          width: collapsed ? '60px' : '200px',
          backgroundColor: '#151515',
          borderRight: '1px solid #333',
          transition: 'width 200ms ease',
          zIndex: 100,
          boxShadow: collapsed ? 'none' : '4px 0 10px rgba(0,0,0,0.5)',
        }}
      >
        <Stack h="100%" p="md" justify="space-between" gap={0}>
          {/* Top Section */}
          <div>
            {/* Logo and Collapse Button */}
            <Group justify="space-between" mb="xl">
              {!collapsed && (
                <Text 
                  className="sp-trader-logo" 
                  size="lg" 
                  fw={700}
                  c="white"
                >
                  SPTrader
                </Text>
              )}
              
              <ActionIcon
                onClick={() => setCollapsed(!collapsed)}
                variant="subtle"
                color="gray"
                size={collapsed ? "md" : "sm"}
                style={{ marginLeft: collapsed ? 'auto' : 0 }}
              >
                {collapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
              </ActionIcon>
            </Group>

            {/* Navigation Items */}
            <Stack gap="xs">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                
                if (collapsed) {
                  return (
                    <Tooltip 
                      key={item.path}
                      label={item.label} 
                      position="right"
                      withArrow
                    >
                      <ActionIcon
                        variant={isActive ? 'light' : 'subtle'}
                        color={isActive ? 'cyan' : 'gray'}
                        size="lg"
                        onClick={() => navigate(item.path)}
                        style={{ width: '100%' }}
                      >
                        <Icon size={20} />
                      </ActionIcon>
                    </Tooltip>
                  );
                }

                return (
                  <NavLink
                    key={item.path}
                    active={isActive}
                    label={item.label}
                    leftSection={<Icon size={20} />}
                    onClick={() => navigate(item.path)}
                    color="cyan"
                    variant="subtle"
                    styles={{
                      root: {
                        borderRadius: '4px',
                        '&:hover': {
                          backgroundColor: '#2a2a2a',
                        },
                      },
                      label: {
                        fontSize: '14px',
                      },
                    }}
                  />
                );
              })}
            </Stack>
          </div>

          {/* Bottom Section */}
          <div>
            {collapsed ? (
              <Tooltip label="Settings" position="right" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="lg"
                  style={{ width: '100%' }}
                >
                  <IconSettings size={20} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <NavLink
                label="Settings"
                leftSection={<IconSettings size={20} />}
                onClick={() => navigate('/settings')}
                variant="subtle"
                styles={{
                  root: {
                    borderRadius: '4px',
                    '&:hover': {
                      backgroundColor: '#2a2a2a',
                    },
                  },
                  label: {
                    fontSize: '14px',
                  },
                }}
              />
            )}
          </div>
        </Stack>
      </Box>

      {/* Optional: Dark overlay when sidebar is expanded */}
      {!collapsed && (
        <Box
          onClick={() => setCollapsed(true)}
          style={{
            position: 'fixed',
            top: 0,
            left: '200px',
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 99,
            cursor: 'pointer',
          }}
        />
      )}
    </Box>
  );
};