import React from 'react';
import { Container, Title, Text, Stack, Paper } from '@mantine/core';
import { AssetManager } from '../components/AssetManager';
import { IconDatabase } from '@tabler/icons-react';

export function MarketDataPage() {
  return (
    <Container size="xl" py="xl">
      <Stack spacing="xl">
        <Paper p="lg" withBorder>
          <Stack spacing="sm">
            <Title order={1} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <IconDatabase size={32} />
              Market Data Manager
            </Title>
            <Text size="lg" color="dimmed">
              Configure and manage real-time data pipelines for various assets. 
              Add forex pairs, cryptocurrencies, and stocks to start collecting market data.
            </Text>
          </Stack>
        </Paper>

        <AssetManager />
      </Stack>
    </Container>
  );
}