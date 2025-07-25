import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useBrokerStore } from '../stores/useBrokerStore';
import {
  TextInput,
  Button,
  Select,
  Card,
  Text,
  Badge,
  Group,
  Stack,
  Loader,
  Alert,
  Table,
  ActionIcon,
  Box,
  Paper,
  Title,
  Grid,
  Progress,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { 
  IconSearch, 
  IconPlus, 
  IconRefresh, 
  IconTrash,
  IconAlertCircle,
  IconCheck,
  IconDatabase,
  IconActivity,
  IconCloudDownload,
  IconPlugConnected,
  IconPlugOff
} from '@tabler/icons-react';

interface AssetSearchResult {
  symbol: string;
  name: string;
  asset_class: string;
  available_sources: string[];
  is_available: boolean;
}

interface PipelineStatus {
  symbol: string;
  status: string;
  connected: boolean;
  last_tick: string | null;
  source: string;
}

export function AssetManager() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AssetSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activePipelines, setActivePipelines] = useState<PipelineStatus[]>([]);
  const [isLoadingPipelines, setIsLoadingPipelines] = useState(false);
  const [selectedSource, setSelectedSource] = useState<Record<string, string>>({});
  
  const { getActiveProfile, profiles } = useBrokerStore();

  // Helper to get profile for a specific source
  const getProfileForSource = (source: string): BrokerProfile | null => {
    return profiles.find(p => 
      p.broker.toLowerCase() === source.toLowerCase() && p.isActive
    ) || null;
  };

  // Restore pipelines from saved config
  const restorePipelines = async () => {
    console.log('[AssetManager] Starting pipeline restore...');
    console.log('[AssetManager] Current profiles:', profiles);
    console.log('[AssetManager] Active profile:', getActiveProfile());
    
    try {
      const configFile = await invoke<{
        version: number;
        pipelines: Array<{
          symbol: string;
          source: string;
          asset_class: string;
          added_at: string;
          last_tick: string | null;
        }>;
        saved_at: string;
        clean_shutdown: boolean;
      }>('load_pipeline_config');
      
      if (configFile.pipelines.length === 0) {
        console.log('[AssetManager] No saved pipelines to restore');
        return;
      }
      
      console.log(`[AssetManager] Restoring ${configFile.pipelines.length} pipelines`);
      console.log('[AssetManager] Pipelines to restore:', configFile.pipelines);
      
      const results = await Promise.allSettled(
        configFile.pipelines.map(async (config) => {
          console.log(`[AssetManager] Processing ${config.symbol} with source ${config.source}`);
          const profile = getProfileForSource(config.source);
          
          if (!profile) {
            console.warn(`[AssetManager] No active ${config.source} profile for ${config.symbol}`);
            console.log('[AssetManager] Available profiles:', profiles.map(p => ({ broker: p.broker, isActive: p.isActive })));
            return Promise.reject({
              symbol: config.symbol,
              reason: `No active ${config.source} profile`
            });
          }
          
          try {
            await invoke('add_market_asset', {
              request: {
                symbol: config.symbol,
                source: config.source,
                account_id: profile.account,
                api_token: profile.apiKey,
              }
            });
            
            console.log(`[AssetManager] Restored ${config.symbol}`);
            return { symbol: config.symbol, success: true };
          } catch (e) {
            return Promise.reject({
              symbol: config.symbol,
              reason: e?.toString() || 'Unknown error'
            });
          }
        })
      );
      
      // Report results
      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected');
      
      if (succeeded > 0) {
        notifications.show({
          title: 'Pipelines Restored',
          message: `Restored ${succeeded} of ${configFile.pipelines.length} pipelines`,
          color: failed.length > 0 ? 'yellow' : 'green',
          icon: <IconCheck />,
        });
      }
      
      // Log failures
      failed.forEach(f => {
        if (f.status === 'rejected') {
          const reason = (f as any).reason;
          console.error(`[AssetManager] Failed to restore ${reason.symbol}: ${reason.reason}`);
        }
      });
      
    } catch (error) {
      console.error('[AssetManager] Pipeline restore failed:', error);
      notifications.show({
        title: 'Restore Failed',
        message: 'Could not restore previous pipelines',
        color: 'red',
        icon: <IconAlertCircle />,
      });
    }
  };

  // Load active pipelines on mount
  useEffect(() => {
    loadActivePipelines();
    
    // Restore saved pipelines after a short delay to ensure broker profiles are loaded
    const restoreTimer = setTimeout(() => {
      restorePipelines();
    }, 1000);
    
    // Listen for asset events
    const unlistenAdded = listen('asset-added', (event) => {
      notifications.show({
        title: 'Asset Added',
        message: `Successfully added ${event.payload}`,
        color: 'green',
        icon: <IconCheck />,
      });
      loadActivePipelines();
    });

    const unlistenProgress = listen('ingestion-progress', (event: any) => {
      // Handle progress updates if needed
      console.log('Ingestion progress:', event.payload);
    });

    return () => {
      clearTimeout(restoreTimer);
      unlistenAdded.then(fn => fn());
      unlistenProgress.then(fn => fn());
    };
  }, []);

  const loadActivePipelines = async () => {
    setIsLoadingPipelines(true);
    try {
      const pipelines = await invoke<PipelineStatus[]>('list_active_pipelines');
      setActivePipelines(pipelines);
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: `Failed to load pipelines: ${error}`,
        color: 'red',
      });
    } finally {
      setIsLoadingPipelines(false);
    }
  };

  const searchAssets = async () => {
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const results = await invoke<AssetSearchResult[]>('search_assets', {
        query: searchQuery,
      });
      setSearchResults(results);
    } catch (error) {
      notifications.show({
        title: 'Search Error',
        message: `Failed to search assets: ${error}`,
        color: 'red',
      });
    } finally {
      setIsSearching(false);
    }
  };

  const addAsset = async (symbol: string) => {
    console.log('[AssetManager] Adding asset:', symbol);
    const source = selectedSource[symbol];
    console.log('[AssetManager] Selected source:', source);
    
    if (!source) {
      notifications.show({
        title: 'Error',
        message: 'Please select a data source',
        color: 'red',
      });
      return;
    }

    // Get credentials from active broker profile
    const profile = getActiveProfile();
    console.log('[AssetManager] Active profile:', profile);
    
    let account_id: string | undefined;
    let api_token: string | undefined;
    
    // Match the source to the broker profile
    if (source.toLowerCase() === 'oanda' && profile?.broker === 'OANDA') {
      account_id = profile.account;
      api_token = profile.apiKey; // Already decrypted by getActiveProfile
      console.log('[AssetManager] Found OANDA credentials, account:', account_id);
    }

    try {
      console.log('[AssetManager] Invoking add_market_asset with:', {
        symbol,
        source,
        account_id: account_id ? 'set' : 'not set',
        api_token: api_token ? 'set' : 'not set'
      });
      
      await invoke('add_market_asset', {
        request: {
          symbol,
          source,
          account_id,
          api_token,
        },
      });
      
      console.log('[AssetManager] add_market_asset completed successfully');
    } catch (error) {
      console.error('[AssetManager] Error:', error);
      notifications.show({
        title: 'Error',
        message: `Failed to add asset: ${error}`,
        color: 'red',
      });
    }
  };

  const stopPipeline = async (symbol: string) => {
    try {
      await invoke('stop_pipeline', { symbol });
      notifications.show({
        title: 'Pipeline Stopped',
        message: `Stopped pipeline for ${symbol}`,
        color: 'blue',
      });
      loadActivePipelines();
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: `Failed to stop pipeline: ${error}`,
        color: 'red',
      });
    }
  };

  const getPipelineStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'green';
      case 'starting':
        return 'blue';
      case 'stopped':
        return 'gray';
      default:
        return 'red';
    }
  };

  const getAssetClassColor = (assetClass: string) => {
    switch (assetClass) {
      case 'forex':
        return 'blue';
      case 'crypto':
        return 'orange';
      case 'stock':
        return 'green';
      default:
        return 'gray';
    }
  };

  return (
    <Stack spacing="lg">
      {/* Search Section */}
      <Card shadow="sm" p="lg" radius="md" withBorder>
        <Stack spacing="md">
          <Title order={3}>Add New Asset</Title>
          
          <Group>
            <TextInput
              placeholder="Search for assets (e.g., EURUSD, BTCUSD, AAPL)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
              onKeyPress={(e) => e.key === 'Enter' && searchAssets()}
              style={{ flex: 1 }}
              icon={<IconSearch size={16} />}
            />
            <Button 
              onClick={searchAssets} 
              loading={isSearching}
              leftSection={<IconSearch size={16} />}
            >
              Search
            </Button>
          </Group>

          {searchResults.length > 0 && (
            <Paper p="md" withBorder>
              <Table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Data Source</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((result) => {
                    const isActive = activePipelines.some(p => p.symbol === result.symbol);
                    
                    return (
                      <tr key={result.symbol}>
                        <td>
                          <Text weight={600}>{result.symbol}</Text>
                        </td>
                        <td>{result.name}</td>
                        <td>
                          <Badge color={getAssetClassColor(result.asset_class)}>
                            {result.asset_class}
                          </Badge>
                        </td>
                        <td>
                          <Select
                            size="sm"
                            placeholder="Select source"
                            data={result.available_sources.map(s => ({
                              value: s,
                              label: s.charAt(0).toUpperCase() + s.slice(1),
                            }))}
                            value={selectedSource[result.symbol] || ''}
                            onChange={(value) => 
                              setSelectedSource(prev => ({
                                ...prev,
                                [result.symbol]: value || '',
                              }))
                            }
                            disabled={isActive}
                          />
                        </td>
                        <td>
                          {isActive ? (
                            <Badge color="green" variant="filled">
                              Active
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              leftSection={<IconPlus size={16} />}
                              onClick={() => addAsset(result.symbol)}
                              disabled={!selectedSource[result.symbol]}
                            >
                              Add
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Paper>
          )}
        </Stack>
      </Card>

      {/* Active Pipelines Section */}
      <Card shadow="sm" p="lg" radius="md" withBorder>
        <Stack spacing="md">
          <Group position="apart">
            <Title order={3}>Active Pipelines</Title>
            <Button
              variant="subtle"
              leftSection={<IconRefresh size={16} />}
              onClick={loadActivePipelines}
              loading={isLoadingPipelines}
            >
              Refresh
            </Button>
          </Group>

          {activePipelines.length === 0 ? (
            <Alert 
              icon={<IconAlertCircle size={16} />} 
              color="gray"
              variant="light"
            >
              No active pipelines. Search and add assets to start collecting data.
            </Alert>
          ) : (
            <Grid>
              {activePipelines.map((pipeline) => (
                <Grid.Col key={pipeline.symbol} span={6}>
                  <Paper p="md" withBorder>
                    <Stack spacing="sm">
                      <Group position="apart">
                        <Group>
                          <Text size="lg" weight={600}>{pipeline.symbol}</Text>
                          <Badge color={getPipelineStatusColor(pipeline.status)}>
                            {pipeline.status}
                          </Badge>
                        </Group>
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          onClick={() => stopPipeline(pipeline.symbol)}
                        >
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>

                      <Group spacing="xs">
                        <Badge
                          leftSection={
                            pipeline.connected ? 
                              <IconPlugConnected size={12} /> : 
                              <IconPlugOff size={12} />
                          }
                          color={pipeline.connected ? 'green' : 'red'}
                          variant="light"
                        >
                          {pipeline.connected ? 'Connected' : 'Disconnected'}
                        </Badge>
                        <Badge variant="light">
                          {pipeline.source}
                        </Badge>
                      </Group>

                      {pipeline.last_tick && (
                        <Text size="xs" color="dimmed">
                          Last tick: {new Date(pipeline.last_tick).toLocaleString()}
                        </Text>
                      )}
                    </Stack>
                  </Paper>
                </Grid.Col>
              ))}
            </Grid>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}