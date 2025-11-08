import { Select, Group, Text } from '@mantine/core';
import { IconFile } from '@tabler/icons-react';
import { useOrchestratorStore } from '../../stores/useOrchestratorStore';

export function StrategySelector() {
  const { strategies, selectedStrategy, setSelectedStrategy } = useOrchestratorStore();

  const handleChange = (value: string | null) => {
    if (value) {
      const strategy = strategies.find((s) => s.path === value);
      if (strategy) {
        setSelectedStrategy(strategy);
      }
    } else {
      setSelectedStrategy(null);
    }
  };

  const data = strategies.map((strategy) => ({
    value: strategy.path || '',
    label: strategy.name,
  }));

  // Create a map for quick lookup of strategy details
  const strategyMap = new Map(strategies.map(s => [s.path, s]));

  return (
    <Select
      label="Select Strategy"
      placeholder="Choose a strategy to run"
      value={selectedStrategy?.path || null}
      onChange={handleChange}
      data={data}
      searchable
      clearable
      leftSection={<IconFile size={16} />}
      renderOption={({ option }) => {
        const strategy = strategyMap.get(option.value);
        return (
          <Group justify="space-between" flex={1}>
            <div>
              <Text size="sm">{option.label}</Text>
              {strategy?.description && (
                <Text size="xs" c="dimmed">
                  {strategy.description}
                </Text>
              )}
            </div>
            {strategy?.version && (
              <Text size="xs" c="dimmed">
                v{strategy.version}
              </Text>
            )}
          </Group>
        );
      }}
      maxDropdownHeight={300}
      nothingFoundMessage="No strategies found"
      size="sm"
    />
  );
}
