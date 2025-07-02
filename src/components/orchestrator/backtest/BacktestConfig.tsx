import { Stack, Paper, NumberInput, Group, Text, Select } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconCalendar, IconCurrencyDollar, IconChartLine, IconClock } from '@tabler/icons-react';
import { useOrchestratorStore } from '../../../stores/useOrchestratorStore';
import { StrategySelector } from '../StrategySelector';

export function BacktestConfig() {
  const { backtestConfig, updateBacktestConfig, selectedStrategy } = useOrchestratorStore();

  return (
    <Paper p="md" withBorder>
      <Stack gap="md">
        <Text fw={600} size="lg">Backtest Configuration</Text>
        
        {/* Strategy Selection */}
        <StrategySelector />
        
        {selectedStrategy && (
          <>
            {/* Date Range */}
            <Group grow>
              <DatePickerInput
                label="Start Date"
                placeholder="Select start date"
                value={backtestConfig.startDate}
                onChange={(date) => date && updateBacktestConfig({ startDate: date })}
                leftSection={<IconCalendar size={16} />}
                maxDate={new Date()}
                clearable={false}
              />
              
              <DatePickerInput
                label="End Date"
                placeholder="Select end date"
                value={backtestConfig.endDate}
                onChange={(date) => date && updateBacktestConfig({ endDate: date })}
                leftSection={<IconCalendar size={16} />}
                maxDate={new Date()}
                minDate={backtestConfig.startDate}
                clearable={false}
              />
            </Group>

            {/* Symbol and Timeframe Selection */}
            <Group grow>
              <Select
                label="Symbol"
                placeholder="Select symbol"
                value={backtestConfig.symbol}
                onChange={(value) => value && updateBacktestConfig({ symbol: value })}
                data={['EURUSD', 'USDJPY', 'GBPUSD', 'AUDUSD']}
                leftSection={<IconChartLine size={16} />}
              />
              
              <Select
                label="Timeframe"
                placeholder="Select timeframe"
                value={backtestConfig.timeframe}
                onChange={(value) => value && updateBacktestConfig({ timeframe: value })}
                data={[
                  { value: '5m', label: '5 minutes' },
                  { value: '15m', label: '15 minutes' },
                  { value: '1h', label: '1 hour' },
                  { value: '4h', label: '4 hours' },
                  { value: '12h', label: '12 hours' }
                ]}
                leftSection={<IconClock size={16} />}
              />
            </Group>

            {/* Initial Capital */}
            <NumberInput
              label="Initial Capital"
              placeholder="Enter initial capital"
              value={backtestConfig.initialCapital}
              onChange={(value) => updateBacktestConfig({ initialCapital: Number(value) || 10000 })}
              leftSection={<IconCurrencyDollar size={16} />}
              thousandSeparator=","
              min={1000}
              step={1000}
            />

            {/* Optional: Slippage and Commission */}
            <Group grow>
              <NumberInput
                label="Slippage (%)"
                placeholder="0.01"
                defaultValue={0.01}
                decimalScale={4}
                step={0.01}
                min={0}
                max={1}
              />
              
              <NumberInput
                label="Commission ($)"
                placeholder="0"
                defaultValue={0}
                decimalScale={2}
                step={0.1}
                min={0}
              />
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}