import { useState, useEffect } from 'react';
import {
  Stack,
  Paper,
  Text,
  Group,
  Badge,
  Loader,
  Center,
  Tabs,
  ScrollArea,
  Button,
} from '@mantine/core';
import { IconCode, IconSettings, IconShieldCheck, IconRefresh } from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';
import { useOrchestratorStore } from '../../stores/useOrchestratorStore';
import Editor from '@monaco-editor/react';

export function StrategyDetails() {
  const { selectedStrategy } = useOrchestratorStore();
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsedStrategy, setParsedStrategy] = useState<any>(null);

  useEffect(() => {
    if (selectedStrategy) {
      loadStrategyContent();
    }
  }, [selectedStrategy]);

  const loadStrategyContent = async () => {
    if (!selectedStrategy) return;

    setLoading(true);
    setError(null);

    try {
      const strategyContent = await invoke<string>('read_component_file', {
        filePath: selectedStrategy.path,
      });
      setContent(strategyContent);

      // Try to parse YAML to extract structured data
      parseStrategyYaml(strategyContent);
    } catch (err) {
      console.error('Failed to load strategy content:', err);
      setError('Failed to load strategy content');
    } finally {
      setLoading(false);
    }
  };

  const parseStrategyYaml = (yamlContent: string) => {
    try {
      // Basic parsing to extract key sections
      const parsed: any = {
        signals: [],
        parameters: {},
        entryRules: [],
        exitRules: [],
        riskManagement: {},
      };

      // Extract signals
      const signalsMatch = yamlContent.match(/signals:\s*\n((?: {2}- .+\n?)+)/);
      if (signalsMatch) {
        parsed.signals = signalsMatch[1]
          .split('\n')
          .filter((line) => line.trim().startsWith('-'))
          .map((line) => line.trim().substring(2));
      }

      // Extract parameters
      const paramsMatch = yamlContent.match(/parameters:\s*\n((?: {2}.+: .+\n?)+)/);
      if (paramsMatch) {
        paramsMatch[1].split('\n').forEach((line) => {
          const [key, value] = line
            .trim()
            .split(':')
            .map((s) => s.trim());
          if (key && value) {
            parsed.parameters[key] = value;
          }
        });
      }

      // Extract entry rules
      const entryMatch = yamlContent.match(/entry_rules:\s*\n((?: {2}- [\s\S]+?)+?)(?=\n\w|$)/);
      if (entryMatch) {
        parsed.entryRules = entryMatch[1]
          .split(/\n {2}- /)
          .filter((rule) => rule.trim())
          .map((rule) => rule.trim());
      }

      // Extract risk management
      const riskMatch = yamlContent.match(/risk_management:\s*\n((?: {2}.+: .+\n?)+)/);
      if (riskMatch) {
        riskMatch[1].split('\n').forEach((line) => {
          const [key, value] = line
            .trim()
            .split(':')
            .map((s) => s.trim());
          if (key && value) {
            parsed.riskManagement[key] = value;
          }
        });
      }

      setParsedStrategy(parsed);
    } catch (err) {
      console.error('Failed to parse strategy YAML:', err);
      setParsedStrategy(null);
    }
  };

  if (!selectedStrategy) {
    return (
      <Center h={400}>
        <Text c="dimmed">Select a strategy to view details</Text>
      </Center>
    );
  }

  if (loading) {
    return (
      <Center h={400}>
        <Loader size="sm" />
      </Center>
    );
  }

  if (error) {
    return (
      <Center h={400}>
        <Stack align="center" gap="md">
          <Text c="red">{error}</Text>
          <Button onClick={loadStrategyContent} leftSection={<IconRefresh size={16} />}>
            Retry
          </Button>
        </Stack>
      </Center>
    );
  }

  return (
    <Stack gap="md" h="100%">
      <Paper p="md" withBorder>
        <Group justify="space-between" mb="md">
          <Stack gap="xs">
            <Group gap="xs">
              <Text size="lg" fw={700}>
                {selectedStrategy.name}
              </Text>
              {selectedStrategy.version && (
                <Badge size="sm" variant="light">
                  v{selectedStrategy.version}
                </Badge>
              )}
            </Group>
            {selectedStrategy.description && (
              <Text size="sm" c="dimmed">
                {selectedStrategy.description}
              </Text>
            )}
            {selectedStrategy.author && (
              <Text size="xs" c="dimmed">
                Author: {selectedStrategy.author}
              </Text>
            )}
          </Stack>
        </Group>

        <Tabs defaultValue="overview">
          <Tabs.List>
            <Tabs.Tab value="overview" leftSection={<IconSettings size={16} />}>
              Overview
            </Tabs.Tab>
            <Tabs.Tab value="yaml" leftSection={<IconCode size={16} />}>
              YAML Source
            </Tabs.Tab>
            <Tabs.Tab value="risk" leftSection={<IconShieldCheck size={16} />}>
              Risk Settings
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="overview" pt="md">
            <ScrollArea h={300}>
              <Stack gap="md">
                {parsedStrategy && (
                  <>
                    {/* Signals */}
                    {parsedStrategy.signals.length > 0 && (
                      <div>
                        <Text fw={600} size="sm" mb="xs">
                          Signals
                        </Text>
                        <Group gap="xs">
                          {parsedStrategy.signals.map((signal: string, idx: number) => (
                            <Badge key={idx} variant="light" size="sm">
                              {signal}
                            </Badge>
                          ))}
                        </Group>
                      </div>
                    )}

                    {/* Parameters */}
                    {Object.keys(parsedStrategy.parameters).length > 0 && (
                      <div>
                        <Text fw={600} size="sm" mb="xs">
                          Parameters
                        </Text>
                        <Stack gap="xs">
                          {Object.entries(parsedStrategy.parameters).map(([key, value]) => (
                            <Group key={key} justify="space-between">
                              <Text size="sm" c="dimmed">
                                {key}:
                              </Text>
                              <Text size="sm">{String(value)}</Text>
                            </Group>
                          ))}
                        </Stack>
                      </div>
                    )}

                    {/* Entry Rules */}
                    {parsedStrategy.entryRules.length > 0 && (
                      <div>
                        <Text fw={600} size="sm" mb="xs">
                          Entry Rules
                        </Text>
                        <Stack gap="xs">
                          {parsedStrategy.entryRules.map((rule: string, idx: number) => (
                            <Paper key={idx} p="xs" withBorder>
                              <Text size="xs">{rule}</Text>
                            </Paper>
                          ))}
                        </Stack>
                      </div>
                    )}
                  </>
                )}
              </Stack>
            </ScrollArea>
          </Tabs.Panel>

          <Tabs.Panel value="yaml" pt="md">
            <Editor
              height="300px"
              language="yaml"
              theme="vs-dark"
              value={content}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12,
              }}
            />
          </Tabs.Panel>

          <Tabs.Panel value="risk" pt="md">
            <ScrollArea h={300}>
              {parsedStrategy && Object.keys(parsedStrategy.riskManagement).length > 0 ? (
                <Stack gap="md">
                  {Object.entries(parsedStrategy.riskManagement).map(([key, value]) => (
                    <Group key={key} justify="space-between">
                      <Text size="sm" c="dimmed">
                        {key.replace(/_/g, ' ')}:
                      </Text>
                      <Text size="sm" fw={600}>
                        {String(value)}
                      </Text>
                    </Group>
                  ))}
                </Stack>
              ) : (
                <Text c="dimmed" size="sm" ta="center">
                  No risk management settings found
                </Text>
              )}
            </ScrollArea>
          </Tabs.Panel>
        </Tabs>
      </Paper>
    </Stack>
  );
}
