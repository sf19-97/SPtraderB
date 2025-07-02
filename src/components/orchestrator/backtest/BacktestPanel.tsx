import { Grid, Stack } from '@mantine/core';
import { BacktestConfig } from './BacktestConfig';
import { BacktestRunner } from './BacktestRunner';
import { BacktestResults } from './BacktestResults';

export function BacktestPanel() {

  return (
    <Grid gutter="md">
      {/* Left Column - Configuration */}
      <Grid.Col span={{ base: 12, lg: 5 }}>
        <Stack gap="md">
          <BacktestConfig />
          <BacktestRunner />
        </Stack>
      </Grid.Col>

      {/* Right Column - Results */}
      <Grid.Col span={{ base: 12, lg: 7 }}>
        <BacktestResults />
      </Grid.Col>
    </Grid>
  );
}