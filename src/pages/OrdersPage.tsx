import { Text, Card, Grid, Paper, Center, Stack } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';

export function OrdersPage() {
  // This page will eventually show trading history
  // For now, it's a placeholder since Orders IDE has been removed
  
  return (
    <div style={{ padding: '20px' }}>
      <Text size="xl" fw={700} c="white" mb="xl">Trading History</Text>
      
      {/* Summary Cards */}
      <Grid mb="xl">
        <Grid.Col span={3}>
          <Card>
            <Text size="sm" c="dimmed">Total Trades</Text>
            <Text size="xl" fw={700}>0</Text>
          </Card>
        </Grid.Col>
        <Grid.Col span={3}>
          <Card>
            <Text size="sm" c="dimmed">Win Rate</Text>
            <Text size="xl" fw={700}>-</Text>
          </Card>
        </Grid.Col>
        <Grid.Col span={3}>
          <Card>
            <Text size="sm" c="dimmed">Total P&L</Text>
            <Text size="xl" fw={700}>$0.00</Text>
          </Card>
        </Grid.Col>
        <Grid.Col span={3}>
          <Card>
            <Text size="sm" c="dimmed">Sharpe Ratio</Text>
            <Text size="xl" fw={700}>-</Text>
          </Card>
        </Grid.Col>
      </Grid>

      {/* Placeholder Message */}
      <Paper p="xl" style={{ backgroundColor: '#1a1a1a' }}>
        <Center h={400}>
          <Stack align="center" gap="md">
            <IconInfoCircle size={48} style={{ color: '#4a5568' }} />
            <Text size="lg" fw={500} c="dimmed">Trading History Coming Soon</Text>
            <Text size="sm" c="dimmed" ta="center" maw={400}>
              The Orders IDE has been removed in favor of an orchestrator architecture. 
              Trading history and analytics will be available once the orchestrator is implemented.
            </Text>
          </Stack>
        </Center>
      </Paper>
    </div>
  );
}