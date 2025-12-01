import { Container, Title, Text, Stack, Paper, Button, Group } from '@mantine/core';
import { AssetManager } from '../components/AssetManager';
import { IconDatabase, IconChartLine } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';

export function MarketDataPage() {
  const navigate = useNavigate();

  return (
    <Container size="xl" py="xl">
      <Stack gap="xl">
        <Paper p="lg" withBorder>
          <Group justify="space-between" align="flex-start">
            <Stack gap="sm" style={{ flex: 1 }}>
              <Title order={1} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <IconDatabase size={32} />
                Market Data Manager
              </Title>
              <Text size="lg" c="dimmed">
                Configure and manage real-time data pipelines for various assets. Add forex pairs,
                cryptocurrencies, and stocks to start collecting market data.
              </Text>
            </Stack>
            <Button
              size="lg"
              leftSection={<IconChartLine size={20} />}
              onClick={() => navigate('/')}
              variant="gradient"
              gradient={{ from: 'blue', to: 'cyan' }}
            >
              View Charts
            </Button>
          </Group>
        </Paper>

        <AssetManager />
      </Stack>
    </Container>
  );
}
