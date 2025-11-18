import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useBrokerStore, BrokerProfile } from '../stores/useBrokerStore';
import {
  TextInput,
  Button,
  Select,
  Card,
  Text,
  Badge,
  Group,
  Stack,
  Alert,
  Table,
  ActionIcon,
  Paper,
  Title,
  Grid,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconSearch,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconAlertCircle,
  IconCheck,
  IconPlugConnected,
  IconPlugOff,
  IconRestore,
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
  const [selectedProfile, setSelectedProfile] = useState<Record<string, string>>({});
  const [isRestoring, setIsRestoring] = useState(false);

  const { getActiveProfile, profiles, decryptSensitiveData } = useBrokerStore();

  // Helper to get profile for a specific source
  const getProfileForSource = (source: string): BrokerProfile | null => {
    return (
      profiles.find((p) => p.broker.toLowerCase() === source.toLowerCase() && p.isActive) || null
    );
  };

  // Get all profiles for a specific broker/source
  const getProfilesForSource = (source: string): BrokerProfile[] => {
    return profiles.filter((p) => p.broker.toLowerCase() === source.toLowerCase());
  };

  // Restore pipelines from saved config
  const restorePipelines = async () => {
    console.log('[AssetManager] Starting pipeline restore...');
    console.log('[AssetManager] Current profiles:', profiles);
    console.log('[AssetManager] Active profile:', getActiveProfile());

    setIsRestoring(true);
    try {
      const configFile = await invoke<{
        version: number;
        pipelines: Array<{
          symbol: string;
          source: string;
          asset_class: string;
          added_at: string;
          last_tick: string | null;
          profile_id: string | null;
          profile_name: string | null;
        }>;
        saved_at: string;
        clean_shutdown: boolean;
      }>('load_pipeline_config');

      if (configFile.pipelines.length === 0) {
        console.log('[AssetManager] No saved pipelines to restore');
        // Still mark restore as completed
        try {
          await invoke('mark_restore_completed');
          console.log('[AssetManager] Marked restore as completed (no pipelines)');
        } catch (e) {
          console.error('[AssetManager] Failed to mark restore completed:', e);
        }
        return;
      }

      console.log(`[AssetManager] Restoring ${configFile.pipelines.length} pipelines`);
      console.log('[AssetManager] Clean shutdown:', configFile.clean_shutdown);
      console.log('[AssetManager] Pipelines to restore:', configFile.pipelines);

      // Check for data gaps
      const now = new Date();
      const hasDataGap = !configFile.clean_shutdown || configFile.pipelines.some((pipeline) => {
        if (!pipeline.last_tick) return true;
        const lastTick = new Date(pipeline.last_tick);
        const gapMinutes = (now.getTime() - lastTick.getTime()) / (1000 * 60);
        // Consider it a gap if more than 5 minutes have passed
        return gapMinutes > 5;
      });

      if (hasDataGap) {
        console.log('[AssetManager] Data gap detected, will need to catch up');
        notifications.show({
          title: 'Data Gap Detected',
          message: 'Restoring pipelines with historical data catchup',
          color: 'blue',
          icon: <IconAlertCircle />,
        });
      }

      const results = await Promise.allSettled(
        configFile.pipelines.map(async (config) => {
          console.log(
            `[AssetManager] Processing ${config.symbol} with source ${config.source}, profile_id ${config.profile_id}`
          );

          let profile;
          if (config.profile_id) {
            // Use the saved profile_id
            profile = profiles.find((p) => p.id === config.profile_id);
            if (!profile) {
              console.warn(
                `[AssetManager] Profile ${config.profile_id} not found for ${config.symbol}`
              );
              return Promise.reject({
                symbol: config.symbol,
                reason: `Profile ${config.profile_id} not found`,
              });
            }
          } else {
            // Fallback to active profile for backward compatibility
            profile = getProfileForSource(config.source);
            if (!profile) {
              console.warn(
                `[AssetManager] No active ${config.source} profile for ${config.symbol}`
              );
              console.log(
                '[AssetManager] Available profiles:',
                profiles.map((p) => ({ broker: p.broker, isActive: p.isActive }))
              );
              return Promise.reject({
                symbol: config.symbol,
                reason: `No active ${config.source} profile`,
              });
            }
          }

          // Calculate gap for this specific pipeline
          let catchupFrom = null;
          if (hasDataGap && config.last_tick) {
            catchupFrom = config.last_tick;
            console.log(`[AssetManager] Will catchup ${config.symbol} from ${catchupFrom}`);
          }

          try {
            await invoke('add_market_asset', {
              request: {
                symbol: config.symbol,
                source: config.source,
                account_id: profile.account,
                api_token: decryptSensitiveData(profile.apiKey),
                profile_id: profile.id,
                catchup_from: catchupFrom,
              },
            });

            console.log(`[AssetManager] Restored ${config.symbol}`);
            return { symbol: config.symbol, success: true };
          } catch (e) {
            return Promise.reject({
              symbol: config.symbol,
              reason: e?.toString() || 'Unknown error',
            });
          }
        })
      );

      // Report results
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected');

      if (succeeded > 0) {
        notifications.show({
          title: 'Pipelines Restored',
          message: `Restored ${succeeded} of ${configFile.pipelines.length} pipelines`,
          color: failed.length > 0 ? 'yellow' : 'green',
          icon: <IconCheck />,
        });

        // Only mark restore as completed if we actually restored something
        try {
          await invoke('mark_restore_completed');
          console.log('[AssetManager] Marked restore as completed');
        } catch (e) {
          console.error('[AssetManager] Failed to mark restore completed:', e);
        }
      } else if (configFile.pipelines.length > 0) {
        // Had pipelines to restore but all failed
        notifications.show({
          title: 'Restore Failed',
          message: `Failed to restore all ${configFile.pipelines.length} pipelines`,
          color: 'red',
          icon: <IconAlertCircle />,
        });
        console.error(
          '[AssetManager] All pipeline restores failed, not marking restore as completed'
        );
      }

      // Log failures
      failed.forEach((f) => {
        if (f.status === 'rejected') {
          const reason = (f as PromiseRejectedResult).reason as {
            symbol: string;
            reason: string;
          };
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
    } finally {
      setIsRestoring(false);
    }
  };

  // Load active pipelines on mount
  useEffect(() => {
    loadActivePipelines();

    // Listen for asset events (only in Tauri environment)
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      const unlistenAdded = listen('asset-added', (event) => {
        notifications.show({
          title: 'Asset Added',
          message: `Successfully added ${event.payload}`,
          color: 'green',
          icon: <IconCheck />,
        });
        loadActivePipelines();
      });

      const unlistenProgress = listen<{ symbol: string; progress: number }>(
        'ingestion-progress',
        (event) => {
          // Handle progress updates if needed
          console.log('Ingestion progress:', event.payload);
        }
      );

      const unlistenCatchup = listen<{
        symbol: string;
        gap_minutes: number;
        status: string;
        message?: string;
        error?: string;
      }>('catchup-status', (event) => {
        console.log('Catchup status:', event.payload);
        const { symbol, gap_minutes, status, message, error } = event.payload;

        switch (status) {
          case 'completed':
            notifications.show({
              title: `Catchup Complete: ${symbol}`,
              message: message || `Successfully filled ${gap_minutes} minute gap`,
              color: 'green',
              icon: <IconCheck />,
            });
            break;
          case 'failed':
            notifications.show({
              title: `Catchup Failed: ${symbol}`,
              message: error || `Failed to fill ${gap_minutes} minute gap`,
              color: 'red',
              icon: <IconAlertCircle />,
            });
            break;
          case 'skipped':
            notifications.show({
              title: `Catchup Skipped: ${symbol}`,
              message: message || `Gap too large (${gap_minutes} minutes)`,
              color: 'orange',
              icon: <IconAlertCircle />,
            });
            break;
          case 'error':
            notifications.show({
              title: `Catchup Error: ${symbol}`,
              message: error || 'Failed to run catchup process',
              color: 'red',
              icon: <IconAlertCircle />,
            });
            break;
        }
      });

      return () => {
        unlistenAdded.then((fn) => fn());
        unlistenProgress.then((fn) => fn());
        unlistenCatchup.then((fn) => fn());
      };
    }
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
    const profileId = selectedProfile[symbol];
    console.log('[AssetManager] Selected source:', source, 'profile:', profileId);

    if (!source) {
      notifications.show({
        title: 'Error',
        message: 'Please select a data source',
        color: 'red',
      });
      return;
    }

    if (!profileId) {
      notifications.show({
        title: 'Error',
        message: 'Please select a broker profile',
        color: 'red',
      });
      return;
    }

    // Get the selected profile
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) {
      notifications.show({
        title: 'Error',
        message: 'Selected profile not found',
        color: 'red',
      });
      return;
    }

    console.log('[AssetManager] Using profile:', profile);
    console.log('[AssetManager] Profile broker:', profile.broker);
    console.log('[AssetManager] Source:', source);

    let account_id: string | undefined;
    let api_token: string | undefined;

    // Get credentials from the selected profile
    if (source.toLowerCase() === 'oanda') {
      account_id = profile.account;
      api_token = decryptSensitiveData(profile.apiKey); // Decrypt the API key
      console.log('[AssetManager] Found OANDA credentials, account:', account_id);
      console.log('[AssetManager] API token length:', api_token?.length);
    }

    try {
      console.log('[AssetManager] Invoking add_market_asset with:', {
        symbol,
        source,
        profile_id: profileId,
        account_id: account_id ? 'set' : 'not set',
        api_token: api_token ? 'set' : 'not set',
      });

      await invoke('add_market_asset', {
        request: {
          symbol,
          source,
          account_id,
          api_token,
          profile_id: profileId,
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
    <Stack gap="lg">
      {/* Search Section */}
      <Card shadow="sm" p="lg" radius="md" withBorder>
        <Stack gap="md">
          <Title order={3}>Add New Asset</Title>

          <Group>
            <TextInput
              placeholder="Search for assets (e.g., EURUSD, BTCUSD, AAPL)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchAssets()}
              style={{ flex: 1 }}
              leftSection={<IconSearch size={16} />}
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
                    <th>Data Source & Profile</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((result) => {
                    const isActive = activePipelines.some((p) => p.symbol === result.symbol);

                    return (
                      <tr key={result.symbol}>
                        <td>
                          <Text fw={600}>{result.symbol}</Text>
                        </td>
                        <td>{result.name}</td>
                        <td>
                          <Badge color={getAssetClassColor(result.asset_class)}>
                            {result.asset_class}
                          </Badge>
                        </td>
                        <td>
                          <Group gap="xs">
                            <Select
                              size="sm"
                              placeholder="Select source"
                              data={result.available_sources.map((s) => ({
                                value: s,
                                label: s.charAt(0).toUpperCase() + s.slice(1),
                              }))}
                              value={selectedSource[result.symbol] || ''}
                              onChange={(value) => {
                                setSelectedSource((prev) => ({
                                  ...prev,
                                  [result.symbol]: value || '',
                                }));
                                // Clear profile selection when source changes
                                setSelectedProfile((prev) => ({
                                  ...prev,
                                  [result.symbol]: '',
                                }));
                              }}
                              disabled={isActive}
                              style={{ minWidth: 120 }}
                            />
                            {selectedSource[result.symbol] && (
                              <Select
                                size="sm"
                                placeholder="Select profile"
                                data={getProfilesForSource(selectedSource[result.symbol]).map(
                                  (p) => ({
                                    value: p.id,
                                    label: p.name,
                                  })
                                )}
                                value={selectedProfile[result.symbol] || ''}
                                onChange={(value) =>
                                  setSelectedProfile((prev) => ({
                                    ...prev,
                                    [result.symbol]: value || '',
                                  }))
                                }
                                disabled={isActive}
                                style={{ minWidth: 150 }}
                              />
                            )}
                          </Group>
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
                              disabled={
                                !selectedSource[result.symbol] || !selectedProfile[result.symbol]
                              }
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
        <Stack gap="md">
          <Group justify="space-between">
            <Title order={3}>Active Pipelines</Title>
            <Group gap="xs">
              <Button
                variant="light"
                leftSection={<IconRestore size={16} />}
                onClick={restorePipelines}
                disabled={profiles.length === 0}
                loading={isRestoring}
              >
                Restore Saved
              </Button>
              <Button
                variant="subtle"
                leftSection={<IconRefresh size={16} />}
                onClick={loadActivePipelines}
                loading={isLoadingPipelines}
              >
                Refresh
              </Button>
            </Group>
          </Group>

          {activePipelines.length === 0 ? (
            <Alert icon={<IconAlertCircle size={16} />} color="gray" variant="light">
              No active pipelines. Search and add assets to start collecting data.
            </Alert>
          ) : (
            <Grid>
              {activePipelines.map((pipeline) => (
                <Grid.Col key={pipeline.symbol} span={6}>
                  <Paper p="md" withBorder>
                    <Stack gap="sm">
                      <Group justify="space-between">
                        <Group>
                          <Text size="lg" fw={600}>
                            {pipeline.symbol}
                          </Text>
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

                      <Group gap="xs">
                        <Badge
                          leftSection={
                            pipeline.connected ? (
                              <IconPlugConnected size={12} />
                            ) : (
                              <IconPlugOff size={12} />
                            )
                          }
                          color={pipeline.connected ? 'green' : 'red'}
                          variant="light"
                        >
                          {pipeline.connected ? 'Connected' : 'Disconnected'}
                        </Badge>
                        <Badge variant="light">{pipeline.source}</Badge>
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
