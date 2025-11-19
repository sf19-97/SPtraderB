import { Stack, Paper, NumberInput, Group, Text, Select, Loader } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconCalendar, IconCurrencyDollar, IconChartLine, IconClock } from '@tabler/icons-react';
import { useOrchestratorStore } from '../../../stores/useOrchestratorStore';
import { useTradingStore } from '../../../stores/useTradingStore';
import { StrategySelector } from '../StrategySelector';
import { useEffect, useMemo } from 'react';

export function BacktestConfig() {
  const { backtestConfig, updateBacktestConfig, selectedStrategy } = useOrchestratorStore();
  const { catalog, fetchCatalog } = useTradingStore();

  // Fetch catalog on mount
  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  // Format symbols and timeframes from catalog
  const symbols = useMemo(() => {
    return catalog.symbols.map((s) => ({
      value: s.symbol,
      label: s.symbol.replace(/([A-Z]{3})([A-Z]{3})/, '$1/$2'), // EURUSD -> EUR/USD
    }));
  }, [catalog.symbols]);

  const timeframes = useMemo(() => {
    return catalog.timeframes.map((tf) => ({ value: tf, label: tf }));
  }, [catalog.timeframes]);

  return (
    <Paper p="md" withBorder>
      <Stack gap="md">
        <Text fw={600} size="lg">
          Backtest Configuration
        </Text>

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
                onChange={(date) => date && updateBacktestConfig({ startDate: new Date(date) })}
                leftSection={<IconCalendar size={16} />}
                maxDate={new Date()}
                clearable={false}
              />

              <DatePickerInput
                label="End Date"
                placeholder="Select end date"
                value={backtestConfig.endDate}
                onChange={(date) => date && updateBacktestConfig({ endDate: new Date(date) })}
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
                placeholder={catalog.loading ? 'Loading symbols...' : 'Select symbol'}
                value={backtestConfig.symbol}
                onChange={(value) => value && updateBacktestConfig({ symbol: value })}
                data={symbols}
                leftSection={<IconChartLine size={16} />}
                rightSection={catalog.loading ? <Loader size="xs" /> : null}
                disabled={catalog.loading}
                searchable
              />

              <Select
                label="Timeframe"
                placeholder={catalog.loading ? 'Loading timeframes...' : 'Select timeframe'}
                value={backtestConfig.timeframe}
                onChange={(value) => value && updateBacktestConfig({ timeframe: value })}
                data={timeframes}
                leftSection={<IconClock size={16} />}
                rightSection={catalog.loading ? <Loader size="xs" /> : null}
                disabled={catalog.loading}
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
