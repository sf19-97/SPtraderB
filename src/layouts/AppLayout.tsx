// src/layouts/AppLayout.tsx
import { NavLink, Group, Text, ActionIcon, Stack, Tooltip, Box } from '@mantine/core';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { IconDatabase } from '@tabler/icons-react';

import {
  IconChartLine,
  IconCode,
  IconHistory,
  IconSettings,
  IconChevronLeft,
  IconChevronRight,
  IconRobot,
  IconCurrencyBitcoin,
  IconChartCandle,
} from '@tabler/icons-react';

export const AppLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(true);

  const navItems = [
    { path: '/build', label: 'Build', icon: IconCode },
    { path: '/market-data', label: 'Market Data', icon: IconDatabase },
    { path: '/market-chart', label: 'Market Chart', icon: IconChartCandle },
    { path: '/history', label: 'History', icon: IconHistory },
    { path: '/orchestrator', label: 'Orchestrator', icon: IconRobot },
  ];

  return (
    <Box style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* Collapsed Sidebar - Takes up space */}
      <Box
        style={{
          width: '60px',
          height: '100vh',
          backgroundColor: '#151515',
          borderRight: '1px solid #333',
          flexShrink: 0,
        }}
      >
        {/* Only show icons when collapsed */}
        {collapsed && (
          <Stack h="100%" p="md" justify="space-between" gap={0}>
            <div>
              <ActionIcon
                onClick={() => setCollapsed(false)}
                variant="subtle"
                color="gray"
                size="md"
                style={{ marginBottom: '20px' }}
              >
                <IconChevronRight size={16} />
              </ActionIcon>

              <Stack gap="xs">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.path;

                  return (
                    <Tooltip key={item.path} label={item.label} position="right" withArrow>
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
                })}
              </Stack>
            </div>

            <Tooltip label="Settings" position="right" withArrow>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="lg"
                style={{ width: '100%' }}
                onClick={() => navigate('/settings')}
              >
                <IconSettings size={20} />
              </ActionIcon>
            </Tooltip>
          </Stack>
        )}
      </Box>

      {/* Expanded Sidebar - Overlays */}
      {!collapsed && (
        <>
          <Box
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              height: '100vh',
              width: '200px',
              backgroundColor: '#151515',
              borderRight: '1px solid #333',
              zIndex: 100,
              boxShadow: '4px 0 10px rgba(0,0,0,0.5)',
            }}
          >
            <Stack h="100%" p="md" justify="space-between" gap={0}>
              <div>
                <Group justify="space-between" mb="xl">
                  <Text className="sp-trader-logo" size="lg" fw={700} c="white">
                    SPTrader
                  </Text>

                  <ActionIcon
                    onClick={() => setCollapsed(true)}
                    variant="subtle"
                    color="gray"
                    size="sm"
                  >
                    <IconChevronLeft size={16} />
                  </ActionIcon>
                </Group>

                <Stack gap="xs">
                  {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = location.pathname === item.path;

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
            </Stack>
          </Box>

          {/* Dark overlay */}
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
        </>
      )}

      {/* Main Content - Fills remaining space */}
      <Box id="main-content-scroll" style={{ flex: 1, overflow: 'auto' }}>
        <Outlet />
      </Box>
    </Box>
  );
};
