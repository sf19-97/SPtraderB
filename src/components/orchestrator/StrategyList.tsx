import { useState, useEffect } from 'react';
import { Stack, TextInput, ScrollArea, Paper, Text, Group, Badge, Loader, Center } from '@mantine/core';
import { IconSearch, IconFile } from '@tabler/icons-react';
import { invoke } from '@tauri-apps/api/core';
import { useOrchestratorStore } from '../../stores/useOrchestratorStore';

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileNode[];
}

export function StrategyList() {
  const { strategies, setStrategies, selectedStrategy, setSelectedStrategy } = useOrchestratorStore();
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Load strategies on mount
  useEffect(() => {
    loadStrategies();
  }, []);

  const loadStrategies = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Get workspace tree to find strategy YAML files
      const tree = await invoke<FileNode[]>('get_workspace_tree');
      
      // Find the strategies folder
      const strategiesNode = tree.find(node => node.name === 'strategies');
      if (!strategiesNode) {
        throw new Error('Strategies folder not found');
      }
      
      const strategyFiles = extractYamlFiles(strategiesNode, 'strategies');
      
      // Load each strategy's content to get metadata
      const loadedStrategies = await Promise.all(
        strategyFiles.map(async (file) => {
          try {
            const content = await invoke<string>('read_component_file', { filePath: file.path });
            const metadata = parseStrategyMetadata(content);
            return {
              name: file.name.replace('.yaml', ''),
              path: file.path,
              description: metadata.description,
              version: metadata.version,
              author: metadata.author,
            };
          } catch (err) {
            console.error(`Failed to load strategy ${file.name}:`, err);
            return {
              name: file.name.replace('.yaml', ''),
              path: file.path,
            };
          }
        })
      );
      
      setStrategies(loadedStrategies);
    } catch (err) {
      console.error('Failed to load strategies:', err);
      setError('Failed to load strategies');
    } finally {
      setLoading(false);
    }
  };

  // Extract YAML files from file tree
  const extractYamlFiles = (node: FileNode | undefined, basePath: string): FileNode[] => {
    if (!node) return [];
    
    const files: FileNode[] = [];
    
    if (!node.is_dir && node.name && node.name.endsWith('.yaml')) {
      files.push(node);
    }
    
    if (node.children) {
      for (const child of node.children) {
        files.push(...extractYamlFiles(child, `${basePath}/${node.name}`));
      }
    }
    
    return files;
  };

  // Parse basic metadata from YAML content
  const parseStrategyMetadata = (content: string) => {
    const metadata: any = {};
    
    // Simple regex parsing for common fields
    const descMatch = content.match(/description:\s*["|'](.+?)["|']/);
    const versionMatch = content.match(/version:\s*["|'](.+?)["|']/);
    const authorMatch = content.match(/author:\s*["|'](.+?)["|']/);
    
    if (descMatch) metadata.description = descMatch[1];
    if (versionMatch) metadata.version = versionMatch[1];
    if (authorMatch) metadata.author = authorMatch[1];
    
    return metadata;
  };

  // Filter strategies based on search term
  const filteredStrategies = strategies.filter(strategy =>
    strategy.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (strategy.description && strategy.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  if (loading) {
    return (
      <Center h={200}>
        <Loader size="sm" />
      </Center>
    );
  }

  if (error) {
    return (
      <Center h={200}>
        <Text c="red" size="sm">{error}</Text>
      </Center>
    );
  }

  return (
    <Stack gap="md" h="100%">
      <TextInput
        placeholder="Search strategies..."
        leftSection={<IconSearch size={16} />}
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.currentTarget.value)}
        size="sm"
      />
      
      <ScrollArea flex={1}>
        <Stack gap="xs">
          {filteredStrategies.length === 0 ? (
            <Text c="dimmed" size="sm" ta="center" mt="xl">
              No strategies found
            </Text>
          ) : (
            filteredStrategies.map((strategy) => (
              <Paper
                key={strategy.path}
                p="sm"
                withBorder
                style={{
                  cursor: 'pointer',
                  backgroundColor: selectedStrategy?.path === strategy.path ? 'var(--mantine-color-dark-6)' : undefined,
                  borderColor: selectedStrategy?.path === strategy.path ? 'var(--mantine-color-blue-6)' : undefined,
                }}
                onClick={() => setSelectedStrategy(strategy)}
              >
                <Stack gap="xs">
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="xs">
                      <IconFile size={16} />
                      <Text size="sm" fw={600}>{strategy.name}</Text>
                    </Group>
                    {strategy.version && (
                      <Badge size="xs" variant="light">v{strategy.version}</Badge>
                    )}
                  </Group>
                  
                  {strategy.description && (
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {strategy.description}
                    </Text>
                  )}
                  
                  {strategy.author && (
                    <Text size="xs" c="dimmed">
                      by {strategy.author}
                    </Text>
                  )}
                </Stack>
              </Paper>
            ))
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}