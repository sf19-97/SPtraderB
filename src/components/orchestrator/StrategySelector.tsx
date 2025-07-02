import { Select, Group, Text } from '@mantine/core';
import { IconFile } from '@tabler/icons-react';
import { useOrchestratorStore } from '../../stores/useOrchestratorStore';

export function StrategySelector() {
  const { strategies, selectedStrategy, setSelectedStrategy } = useOrchestratorStore();

  const handleChange = (value: string | null) => {
    if (value) {
      const strategy = strategies.find(s => s.path === value);
      if (strategy) {
        setSelectedStrategy(strategy);
      }
    } else {
      setSelectedStrategy(null);
    }
  };

  const data = strategies.map(strategy => ({
    value: strategy.path,
    label: strategy.name,
    description: strategy.description,
    version: strategy.version,
  }));

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
      renderOption={({ option }) => (
        <Group justify="space-between" flex={1}>
          <div>
            <Text size="sm">{option.label}</Text>
            {option.description && (
              <Text size="xs" c="dimmed">{option.description}</Text>
            )}
          </div>
          {option.version && (
            <Text size="xs" c="dimmed">v{option.version}</Text>
          )}
        </Group>
      )}
      maxDropdownHeight={300}
      nothingFoundMessage="No strategies found"
      size="sm"
    />
  );
}