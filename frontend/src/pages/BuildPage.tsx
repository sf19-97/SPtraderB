// src/pages/BuildPage.tsx
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBuildStore } from '../stores/useBuildStore';
import { workspaceApi } from '../api/workspace';
import {
  Title,
  Text,
  Paper,
  Group,
  Button,
  TextInput,
  Select,
  SegmentedControl,
  Badge,
  Grid,
  Card,
  Stack,
  Box,
  ActionIcon,
  UnstyledButton,
  Tabs,
  Loader,
  Center,
  ScrollArea,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconBolt,
  IconGitBranch,
  IconClock,
  IconSearch,
  IconPlus,
  IconPlayerPlay,
  IconGitCommit,
  IconArrowRight,
  IconFileCode,
  IconBox,
  IconStack3,
  IconActivity,
  IconTerminal2,
  IconChartBar,
  IconBrandGithub,
  IconAlertCircle,
  IconRefresh,
  IconChevronRight,
  IconChevronDown,
  IconFolder,
  IconFile,
} from '@tabler/icons-react';
import { useAuthStore } from '../stores/useAuthStore';
import { githubApi, FileNode as GithubFileNode, AppRepo } from '../api/github';
import { createLogger } from '../utils/logger';

interface ComponentInfo {
  name: string;
  component_type: string;
  category: string;
  path: string;
  has_metadata: boolean;
  status: string;
}

export const BuildPage = () => {
  const navigate = useNavigate();
  const buildLogger = useMemo(() => createLogger('build'), []);
  const {
    searchTerm,
    setSearchTerm,
    selectedCategory,
    setSelectedCategory,
    scrollPosition,
    setScrollPosition,
    addRecentComponent,
  } = useBuildStore();
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [realComponents, setRealComponents] = useState<ComponentInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mode, setMode] = useState<'local' | 'github'>('local');
  const { token, user, updatePreferences } = useAuthStore();
  const [githubRepos, setGithubRepos] = useState<AppRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [filePath, setFilePath] = useState('');
  const [defaultCommitMessage, setDefaultCommitMessage] = useState('');
  const [githubType, setGithubType] = useState<'indicator' | 'signal' | 'strategy'>('strategy');
  const [githubTree, setGithubTree] = useState<GithubFileNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [expandedTree, setExpandedTree] = useState<Set<string>>(new Set());
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const autoConfigAttempted = useRef(false);
  const [newRepoName, setNewRepoName] = useState('');

  const refreshRepos = useCallback(async () => {
    if (!token) {
      setGithubRepos([]);
      return;
    }

    setReposLoading(true);
    setRepoError(null);
    try {
      const repos = await githubApi.listAppRepos(token);
      setGithubRepos(repos);

      if (!selectedRepo && repos.length > 0) {
        setSelectedRepo(repos[0].full_name);
        setSelectedBranch(repos[0].default_branch);
        setRootPath(repos[0].root_path || '');
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load Kumquant repositories';
      setRepoError(message);
      buildLogger.error('Failed to load app repos', error);
    } finally {
      setReposLoading(false);
    }
  }, [token, selectedRepo, buildLogger]);

  const loadGithubTree = useCallback(async () => {
    if (!token || !selectedRepo || !selectedBranch) {
      setGithubTree([]);
      return;
    }

    setTreeLoading(true);
    setTreeError(null);
    const fetchTree = async () => {
      const tree = await githubApi.getTree(token, {
        repo: selectedRepo,
        branch: selectedBranch,
        path: rootPath || undefined,
      });
      setGithubTree(tree);
    };

    try {
      await fetchTree();
    } catch (error) {
      const status = (error as any)?.status;
      const message =
        error instanceof Error ? error.message : 'Failed to load GitHub tree';
      const displayMessage = status ? `${message} (HTTP ${status})` : message;

      // Auto-configure Build Center prefs once if missing, then retry
      if (
        status === 403 &&
        !autoConfigAttempted.current &&
        selectedRepo &&
        selectedBranch
      ) {
        autoConfigAttempted.current = true;
        try {
          await updatePreferences({
            build_center_github: {
              repo: selectedRepo,
              branch: selectedBranch,
              root_path: rootPath,
              default_path: filePath,
              default_commit_message: defaultCommitMessage,
              type: githubType,
            },
          });
          buildLogger.info('Auto-configured Build Center GitHub prefs; retrying tree');
          await fetchTree();
          return;
        } catch (prefErr) {
          buildLogger.error('Failed to auto-configure Build Center GitHub prefs', {
            error: prefErr,
          });
          buildLogger.error('Failed to auto-configure Build Center GitHub prefs', prefErr);
        }
      }

      setTreeError(displayMessage);
      buildLogger.error('Failed to load GitHub tree', {
        status,
        error,
      });
    } finally {
      setTreeLoading(false);
    }
  }, [
    token,
    selectedRepo,
    selectedBranch,
    rootPath,
    updatePreferences,
    filePath,
    defaultCommitMessage,
    githubType,
    buildLogger,
  ]);

  useEffect(() => {
    autoConfigAttempted.current = false;
  }, [selectedRepo, selectedBranch, rootPath]);

  // Load real components from workspace
  useEffect(() => {
    const loadComponents = async () => {
      try {
        const components = await workspaceApi.getComponents();
        setRealComponents(components);
      } catch (error) {
        buildLogger.error('Failed to load components', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadComponents();
  }, []);

  // Load GitHub repositories for the current user
  useEffect(() => {
    void refreshRepos();
  }, [refreshRepos]);

  useEffect(() => {
    if (mode === 'github') {
      void loadGithubTree();
    }
  }, [mode, loadGithubTree, selectedRepo, selectedBranch, rootPath]);

  // Hydrate saved Build Center GitHub config from preferences
  useEffect(() => {
    const prefs = (user?.preferences as Record<string, any>)?.build_center_github;
    if (prefs) {
      setSelectedRepo(prefs.repo || '');
      setSelectedBranch(prefs.branch || prefs.default_branch || '');
      setRootPath(prefs.root_path || '');
      setFilePath(prefs.default_path || '');
      setDefaultCommitMessage(prefs.default_commit_message || '');
      if (prefs.type) {
        setGithubType(prefs.type);
      }
      if (prefs.repo) {
        setMode('github');
      }
    }
  }, [user]);

  const repoOptions = useMemo(
    () => githubRepos.map((repo) => ({ value: repo.full_name, label: repo.full_name })),
    [githubRepos]
  );

  const handleRepoChange = (value: string | null) => {
    const repoName = value || '';
    setSelectedRepo(repoName);
    if (repoName) {
      setMode('github');
    }

    if (repoName) {
      const repo = githubRepos.find((r) => r.full_name === repoName);
      if (repo) {
        setSelectedBranch(repo.default_branch);
        setRootPath(repo.root_path || '');
      }
    }
  };

  const buildFullPath = (relativePath: string) => {
    const cleanedRoot = rootPath.trim().replace(/^\/+|\/+$/g, '');
    const cleanedRelative = relativePath.trim().replace(/^\/+/, '');

    if (cleanedRoot && cleanedRelative) {
      return `${cleanedRoot}/${cleanedRelative}`;
    }
    return cleanedRoot || cleanedRelative;
  };

  const handleSaveGithubPrefs = async () => {
    if (!selectedRepo || !selectedBranch) {
      notifications.show({
        title: 'Missing repo/branch',
        message: 'Select a repository and branch before saving.',
        color: 'red',
      });
      return;
    }

    try {
      await updatePreferences({
        build_center_github: {
          repo: selectedRepo,
          branch: selectedBranch,
          root_path: rootPath,
          default_path: filePath,
          default_commit_message: defaultCommitMessage,
          type: githubType,
        },
      });

      notifications.show({
        title: 'GitHub config saved',
        message: 'Build Center will reopen with this repo/branch by default.',
        color: 'green',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save preferences';
      notifications.show({
        title: 'Save failed',
        message,
        color: 'red',
      });
    }
  };

  const handleCreateAppRepo = async () => {
    if (!token) return;
    setRepoError(null);
    setReposLoading(true);
    try {
      const repo = await githubApi.createAppRepo(token, {
        name: newRepoName || undefined,
        private: true,
      });
      notifications.show({
        title: 'Repo created',
        message: `${repo.full_name} ready with Kumquant scaffold root.`,
        color: 'green',
      });
      setNewRepoName('');
      await refreshRepos();
      setSelectedRepo(repo.full_name);
      setSelectedBranch(repo.default_branch);
      setRootPath(repo.root_path || '');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to create repository';
      setRepoError(message);
      notifications.show({
        title: 'Create failed',
        message,
        color: 'red',
      });
      buildLogger.error('Failed to create app repo', error);
    } finally {
      setReposLoading(false);
    }
  };

  const openGithubInIDE = (isNew: boolean) => {
    if (!selectedRepo || !selectedBranch) {
      notifications.show({
        title: 'Select a repo',
        message: 'Choose a repository and branch before opening the editor.',
        color: 'red',
      });
      return;
    }

    const fullPathCheck = buildFullPath(filePath);
    const validExt =
      githubType === 'strategy'
        ? fullPathCheck.endsWith('.yaml') || fullPathCheck.endsWith('.yml')
        : fullPathCheck.endsWith('.py');
    if (!validExt) {
      notifications.show({
        title: 'Invalid path',
        message:
          githubType === 'strategy'
            ? 'Strategies must be .yaml/.yml files.'
            : 'Indicators/Signals must be .py files.',
        color: 'red',
      });
      return;
    }

    const relativePath =
      filePath.trim() ||
      `new_${githubType}.${githubType === 'strategy' ? 'yaml' : 'py'}`;
    const fullPath = buildFullPath(relativePath);

    if (!fullPath) {
      notifications.show({
        title: 'Path required',
        message: 'Provide a file path to load or create.',
        color: 'red',
      });
      return;
    }

    const params = new URLSearchParams({
      source: 'github',
      repo: selectedRepo,
      branch: selectedBranch,
      path: fullPath,
      type: githubType,
    });

    if (rootPath.trim()) {
      params.set('root', rootPath.trim());
    }
    if (defaultCommitMessage.trim()) {
      params.set('commitMessage', defaultCommitMessage.trim());
    }
    if (isNew) {
      params.set('new', '1');
    }

    // Persist latest selection but don't block navigation
    void updatePreferences({
      build_center_github: {
        repo: selectedRepo,
        branch: selectedBranch,
        root_path: rootPath,
        default_path: filePath,
        default_commit_message: defaultCommitMessage,
        type: githubType,
      },
    });

    setMode('github');
    navigate(`/ide?${params.toString()}`);
  };

  const toggleFolder = (path: string) => {
    setExpandedTree((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderGithubTree = (nodes: GithubFileNode[], depth: number = 0) =>
    nodes.map((node) => {
      const isFolder = node.type === 'folder';
      const isOpen = expandedTree.has(node.path);
      return (
        <Box key={node.path} ml={depth * 12} mb={4}>
          <Group gap={6} wrap="nowrap">
            {isFolder ? (
              <ActionIcon
                size="sm"
                variant="subtle"
                onClick={() => toggleFolder(node.path)}
                aria-label="toggle-folder"
              >
                {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              </ActionIcon>
            ) : (
              <Box w={24} />
            )}
            {isFolder ? (
              <Group gap={6} wrap="nowrap">
                <IconFolder size={16} color="#60a5fa" />
                <Text
                  size="sm"
                  c="white"
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleFolder(node.path)}
                >
                  {node.name}
                </Text>
              </Group>
            ) : (
              <Group
                gap={6}
                wrap="nowrap"
                style={{ cursor: 'pointer' }}
                onClick={() => setFilePath(node.path)}
              >
                <IconFile size={16} />
                <Text size="sm" c="white">
                  {node.name}
                </Text>
              </Group>
            )}
          </Group>
          {isFolder && isOpen && node.children && renderGithubTree(node.children, depth + 1)}
        </Box>
      );
    });

  const handleBootstrap = async () => {
    if (!token || !selectedRepo || !selectedBranch) {
      notifications.show({
        title: 'Select repo/branch',
        message: 'Choose a repository and branch before creating the structure.',
        color: 'red',
      });
      return;
    }
    setBootstrapLoading(true);
    try {
      await githubApi.bootstrap(token, {
        repo: selectedRepo,
        branch: selectedBranch,
        root_path: rootPath,
      });
      notifications.show({
        title: 'Structure created',
        message: 'Starter indicator/signal/strategy files were added to the repo.',
        color: 'green',
      });
      await loadGithubTree();
    } catch (error) {
      notifications.show({
        title: 'Bootstrap failed',
        message: error instanceof Error ? error.message : 'Failed to create structure',
        color: 'red',
      });
    } finally {
      setBootstrapLoading(false);
    }
  };

  // Transform real components into the display format
  const components = {
    indicators: realComponents
      .filter((c) => c.component_type === 'indicator')
      .map((c, idx) => ({
        id: idx + 1,
        name: c.name,
        description: c.has_metadata ? 'Component with metadata' : 'Component without metadata',
        lastModified: 'Recently',
        performance: '0.5ms',
        usage: 0,
        status: c.status || 'prototype',
        language: 'python',
        dependencies: [],
        category: c.category,
        path: c.path,
      })),
    signals: realComponents
      .filter((c) => c.component_type === 'signal')
      .map((c, idx) => ({
        id: idx + 1,
        name: c.name,
        description: c.has_metadata ? 'Signal with metadata' : 'Signal without metadata',
        lastModified: 'Recently',
        accuracy: '75%',
        triggers: 0,
        status: c.status || 'prototype',
        indicators: [],
        complexity: 'medium',
        path: c.path,
      })),
    orders: [], // Orders removed - moving to orchestrator architecture
    strategies: realComponents
      .filter((c) => c.component_type === 'strategy')
      .map((c, idx) => ({
        id: idx + 1,
        name: c.name,
        description: c.has_metadata ? 'Strategy with metadata' : 'Strategy without metadata',
        lastModified: 'Recently',
        sharpe: 1.5,
        winRate: '60%',
        status: c.has_metadata ? 'paper_trading' : 'draft',
        components: {
          indicators: 2,
          signals: 1,
        },
        path: c.path,
      })),
  };

  const stats = {
    totalComponents: realComponents.length,
    activeBacktests: 0,
    liveStrategies: 0,
    lastBuild: 'Recently',
    codeLines: '1,000+',
    gitCommits: 50,
  };

  const launchIDE = (type: string, item: any) => {
    // Store component info before navigating
    if (item) {
      addRecentComponent({
        type: type as 'indicator' | 'signal' | 'strategy',
        name: item.name,
        path: item.path || '',
        description: item.description,
        category: item.category,
        author: item.author,
        version: item.version,
      });
    }

    const params = new URLSearchParams({
      type,
      file: item ? item.name : 'new',
      path: item ? item.path || '' : '',
    });
    navigate(`/ide?${params.toString()}`);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready':
      case 'active': // Keep for backwards compatibility
      case 'live':
        return 'green';
      case 'in_progress':
      case 'testing':
      case 'paper_trading':
        return 'yellow';
      case 'prototype':
      case 'optimizing':
        return 'blue';
      default:
        return 'gray';
    }
  };

  // Filter components based on search
  const filterComponents = (items: any[]) => {
    if (!searchTerm) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  // Track and restore scroll position
  useEffect(() => {
    const scrollableElement = document.getElementById('main-content-scroll');
    if (!scrollableElement) return;

    // Restore scroll position when component mounts
    if (scrollPosition > 0) {
      // Use multiple attempts to ensure content is loaded
      const restoreScroll = () => {
        scrollableElement.scrollTop = scrollPosition;
        // Verify it was set
        if (scrollableElement.scrollTop !== scrollPosition && scrollPosition > 0) {
          // Try again if it didn't work
          setTimeout(restoreScroll, 50);
        }
      };
      requestAnimationFrame(restoreScroll);
    }

    // Continuously track scroll position while component is mounted
    let scrollTimeout: number;
    const handleScroll = () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const currentScroll = scrollableElement.scrollTop;
        setScrollPosition(currentScroll);
      }, 100); // Debounce to avoid too many updates
    };

    // Add scroll listener
    scrollableElement.addEventListener('scroll', handleScroll);

    // Cleanup
    return () => {
      scrollableElement.removeEventListener('scroll', handleScroll);
    };
  }, []); // Empty dependency array - set up once on mount

  return (
    <Box
      id="build-page-container"
      style={{ minHeight: '100vh', background: '#0a0a0a', position: 'relative' }}
    >
      {/* Animated Background */}
      <Box
        style={{
          position: 'fixed',
          inset: 0,
          overflow: 'hidden',
          pointerEvents: 'none',
          opacity: 0.3,
        }}
      >
        <Box
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(to bottom right, rgba(59, 130, 246, 0.05), rgba(147, 51, 234, 0.05), rgba(236, 72, 153, 0.05))',
          }}
        />
      </Box>

      <Box style={{ position: 'relative', zIndex: 10, padding: '2rem' }}>
        {/* Header Section */}
        <Box mb="xl">
          <Group justify="space-between" mb="xl">
            <div>
              <Title
                order={1}
                mb="xs"
                style={{
                  fontSize: '2.5rem',
                  background: 'linear-gradient(to right, #60a5fa, #a78bfa, #f472b6)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                Build Center
              </Title>
              <Text size="xl" c="dimmed">
                {mode === 'github'
                  ? 'Edit strategies directly in your GitHub repo'
                  : 'Your trading system components'}
              </Text>
            </div>
            <Stack gap="xs" align="flex-end">
              <SegmentedControl
                value={mode}
                onChange={(value) => setMode(value as 'local' | 'github')}
                data={[
                  { label: 'Local workspace', value: 'local' },
                  { label: 'GitHub repo', value: 'github' },
                ]}
              />
              <Button
                size="lg"
                leftSection={<IconTerminal2 size={20} />}
                variant="gradient"
                gradient={{ from: 'blue', to: 'cyan', deg: 90 }}
                onClick={() =>
                  mode === 'github' ? openGithubInIDE(false) : launchIDE('indicator', null)
                }
              >
                {mode === 'github' ? 'Open GitHub file' : 'Open IDE'}
              </Button>
            </Stack>
          </Group>

          {mode === 'github' && (
            <Paper
              p="md"
              mb="lg"
              style={{
                background: 'rgba(17, 24, 39, 0.85)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
              }}
            >
              <Group justify="space-between" align="flex-start" mb="md">
                <Group gap="sm">
                  <IconBrandGithub size={22} color="#60a5fa" />
                  <div>
                    <Text fw={600}>GitHub repo mode</Text>
                    <Text size="sm" c="dimmed">
                      Use your stored token to open and save Build Center files directly in GitHub.
                    </Text>
                  </div>
                </Group>
                <Button
                  variant="subtle"
                  leftSection={<IconRefresh size={16} />}
                  onClick={() => refreshRepos()}
                  loading={reposLoading}
                >
                  Refresh repos
                </Button>
              </Group>

              {repoError && (
                <Group gap={8} mb="sm">
                  <IconAlertCircle size={16} color="#f87171" />
                  <Text size="sm" c="red">
                    {repoError}
                  </Text>
                </Group>
              )}

              <Group gap="sm" mb="sm">
                <TextInput
                  placeholder="kumquant-..."
                  label="New Kumquant repo name"
                  value={newRepoName}
                  onChange={(e) => setNewRepoName(e.currentTarget.value)}
                  style={{ flex: 1 }}
                />
                <Button onClick={handleCreateAppRepo} loading={reposLoading}>
                  Create Kumquant repo
                </Button>
              </Group>

              <Grid gutter="md">
                <Grid.Col span={{ base: 12, md: 6, lg: 4 }}>
                  <Select
                    label="Repository"
                    placeholder="owner/repo"
                    data={repoOptions}
                    searchable
                    nothingFoundMessage={reposLoading ? 'Loading...' : 'No repos found'}
                    value={selectedRepo}
                    onChange={handleRepoChange}
                    leftSection={<IconBrandGithub size={16} />}
                    disabled={!token}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
                  <TextInput
                    label="Branch"
                    placeholder="main"
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.currentTarget.value)}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
                  <SegmentedControl
                    fullWidth
                    value={githubType}
                    onChange={(value) =>
                      setGithubType(value as 'indicator' | 'signal' | 'strategy')
                    }
                    data={[
                      { label: 'Indicator', value: 'indicator' },
                      { label: 'Signal', value: 'signal' },
                      { label: 'Strategy', value: 'strategy' },
                    ]}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
                  <TextInput
                    label="Root path (optional)"
                    placeholder="strategies"
                    value={rootPath}
                    onChange={(e) => setRootPath(e.currentTarget.value)}
                    description="Prefix applied to file path"
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
                  <TextInput
                    label="File path"
                    placeholder="my_strategy.yaml"
                    value={filePath}
                    onChange={(e) => setFilePath(e.currentTarget.value)}
                    description="Relative to root path"
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 6, lg: 4 }}>
                  <TextInput
                    label="Default commit message"
                    placeholder="Update strategy from Build Center"
                    value={defaultCommitMessage}
                    onChange={(e) => setDefaultCommitMessage(e.currentTarget.value)}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 12, lg: 5 }}>
                  <Text size="sm" fw={600} mb={6}>
                    Repo tree
                  </Text>
                  <Paper
                    p="sm"
                    withBorder
                    style={{ background: 'rgba(31, 41, 55, 0.4)', minHeight: 220 }}
                  >
                    {treeLoading ? (
                      <Center h={180}>
                        <Loader size="sm" />
                      </Center>
                    ) : treeError ? (
                      <Group gap={8}>
                        <IconAlertCircle size={14} color="#f87171" />
                        <Text size="sm" c="red">
                          {treeError}
                        </Text>
                      </Group>
                    ) : (
                      <ScrollArea h={220}>
                        {githubTree.length === 0 ? (
                          <Text size="sm" c="dimmed">
                            {selectedRepo ? 'No files found.' : 'Select a repo to view files.'}
                          </Text>
                        ) : (
                          renderGithubTree(githubTree)
                        )}
                      </ScrollArea>
                    )}
                  </Paper>
                  <Group justify="space-between" mt="xs">
                    <Text size="xs" c="dimmed">
                      Only files under the configured root are runnable.
                    </Text>
                    <Button size="xs" variant="subtle" onClick={handleBootstrap} loading={bootstrapLoading}>
                      Create required structure
                    </Button>
                  </Group>
                </Grid.Col>
              </Grid>

              <Group justify="space-between" mt="md">
                <Text size="sm" c="dimmed">
                  Full path:{' '}
                  <Text span fw={600} c="white">
                    {buildFullPath(
                      filePath ||
                        `new_${githubType}.${githubType === 'strategy' ? 'yaml' : 'py'}`
                    ) || '—'}
                  </Text>
                </Text>
                <Group gap="sm">
                  <Button
                    variant="outline"
                    onClick={handleSaveGithubPrefs}
                    disabled={!selectedRepo || !selectedBranch}
                  >
                    Save config
                  </Button>
                  <Button
                    variant="default"
                    onClick={() => openGithubInIDE(false)}
                    disabled={!selectedRepo || !selectedBranch || !filePath}
                  >
                    Open file
                  </Button>
                  <Button
                    onClick={() => openGithubInIDE(true)}
                    disabled={!selectedRepo || !selectedBranch}
                  >
                    New script
                  </Button>
                </Group>
              </Group>
            </Paper>
          )}

          {mode === 'local' && (
            <>
              {/* Stats Bar */}
              <Grid mb="xl">
                <Grid.Col span={{ base: 12, xs: 6, sm: 4, md: 2 }}>
                  <Paper
                    p="md"
                    style={{
                      background: 'rgba(31, 41, 55, 0.5)',
                      border: '1px solid rgba(75, 85, 99, 0.3)',
                    }}
                  >
                    <Text size="sm" c="dimmed" mb={4}>
                      Components
                    </Text>
                    <Text size="xl" fw={700}>
                      {stats.totalComponents}
                    </Text>
                  </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, xs: 6, sm: 4, md: 2 }}>
                  <Paper
                    p="md"
                    style={{
                      background: 'rgba(31, 41, 55, 0.5)',
                      border: '1px solid rgba(75, 85, 99, 0.3)',
                    }}
                  >
                    <Text size="sm" c="dimmed" mb={4}>
                      Active Tests
                    </Text>
                    <Text size="xl" fw={700} c="yellow">
                      {stats.activeBacktests}
                    </Text>
                  </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, xs: 6, sm: 4, md: 2 }}>
                  <Paper
                    p="md"
                    style={{
                      background: 'rgba(31, 41, 55, 0.5)',
                      border: '1px solid rgba(75, 85, 99, 0.3)',
                    }}
                  >
                    <Text size="sm" c="dimmed" mb={4}>
                      Live Strategies
                    </Text>
                    <Text size="xl" fw={700} c="green">
                      {stats.liveStrategies}
                    </Text>
                  </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, xs: 6, sm: 4, md: 2 }}>
                  <Paper
                    p="md"
                    style={{
                      background: 'rgba(31, 41, 55, 0.5)',
                      border: '1px solid rgba(75, 85, 99, 0.3)',
                    }}
                  >
                    <Text size="sm" c="dimmed" mb={4}>
                      Code Lines
                    </Text>
                    <Text size="xl" fw={700}>
                      {stats.codeLines}
                    </Text>
                  </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, xs: 6, sm: 4, md: 2 }}>
                  <Paper
                    p="md"
                    style={{
                      background: 'rgba(31, 41, 55, 0.5)',
                      border: '1px solid rgba(75, 85, 99, 0.3)',
                    }}
                  >
                    <Text size="sm" c="dimmed" mb={4}>
                      Git Commits
                    </Text>
                    <Text size="xl" fw={700}>
                      {stats.gitCommits}
                    </Text>
                  </Paper>
                </Grid.Col>
                <Grid.Col span={{ base: 12, xs: 6, sm: 4, md: 2 }}>
                  <Paper
                    p="md"
                    style={{
                      background: 'rgba(31, 41, 55, 0.5)',
                      border: '1px solid rgba(75, 85, 99, 0.3)',
                    }}
                  >
                    <Text size="sm" c="dimmed" mb={4}>
                      Last Build
                    </Text>
                    <Text size="sm" fw={500}>
                      {stats.lastBuild}
                    </Text>
                  </Paper>
                </Grid.Col>
              </Grid>

              {/* Search and Filters */}
              <Group gap="md">
                <TextInput
                  placeholder="Search components..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  leftSection={<IconSearch size={16} />}
                  style={{ flex: 1 }}
                  styles={{
                    input: {
                      background: 'rgba(31, 41, 55, 0.5)',
                      border: '1px solid rgba(75, 85, 99, 0.3)',
                      '&:focus': {
                        borderColor: 'rgba(59, 130, 246, 0.5)',
                      },
                    },
                  }}
                />
              </Group>
            </>
          )}
        </Box>

        {mode === 'local' && (
          <>
            {/* Tabs for categories */}
            <Tabs
              value={selectedCategory}
              onChange={(value) => setSelectedCategory(value || 'all')}
              mb="xl"
            >
              <Tabs.List>
                <Tabs.Tab value="all">All</Tabs.Tab>
                <Tabs.Tab value="indicators">📊 Indicators</Tabs.Tab>
                <Tabs.Tab value="signals">⚡ Signals</Tabs.Tab>
                <Tabs.Tab value="strategies">🎯 Strategies</Tabs.Tab>
              </Tabs.List>
            </Tabs>

            {/* Component Grid */}
            {isLoading ? (
              <Center h={400}>
                <Loader size="lg" />
              </Center>
            ) : (
              <Grid gutter="md">
                {(selectedCategory === 'all' || selectedCategory === 'indicators') && (
                  <>
                    {selectedCategory === 'all' && (
                      <Grid.Col span={12}>
                        <Group gap="xs" mb="md">
                          <Text size="xl" fw={700}>
                            📊 Indicators
                          </Text>
                          <Text size="sm" c="dimmed">
                            ({filterComponents(components.indicators).length})
                          </Text>
                        </Group>
                      </Grid.Col>
                    )}
                    {filterComponents(components.indicators).map((indicator) => (
                      <Grid.Col key={indicator.id} span={{ base: 12, sm: 6, lg: 4 }}>
                        <Card
                          p="lg"
                          withBorder
                          style={{
                            background: 'rgba(31, 41, 55, 0.5)',
                            borderColor:
                              hoveredItem === `indicator-${indicator.id}`
                                ? 'rgba(59, 130, 246, 0.5)'
                                : 'rgba(75, 85, 99, 0.3)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            transform:
                              hoveredItem === `indicator-${indicator.id}`
                                ? 'translateY(-2px)'
                                : 'translateY(0)',
                          }}
                          onMouseEnter={() => setHoveredItem(`indicator-${indicator.id}`)}
                          onMouseLeave={() => setHoveredItem(null)}
                          onClick={() => launchIDE('indicator', indicator)}
                        >
                          <Group justify="space-between" align="flex-start" mb="md">
                            <div>
                              <Group gap="xs" mb={4}>
                                <Text size="lg" fw={600}>
                                  {indicator.name}
                                </Text>
                                <Badge color={getStatusColor(indicator.status)} size="sm">
                                  {indicator.status}
                                </Badge>
                              </Group>
                              <Text size="sm" c="dimmed">
                                {indicator.description}
                              </Text>
                            </div>
                            <IconFileCode
                              size={20}
                              style={{
                                color:
                                  hoveredItem === `indicator-${indicator.id}`
                                    ? '#60a5fa'
                                    : '#6b7280',
                                transition: 'color 0.2s ease',
                              }}
                            />
                          </Group>

                          <Grid gutter="xs" mb="md">
                            <Grid.Col span={6}>
                              <Text size="xs" c="dimmed">
                                Performance:
                              </Text>
                              <Text size="sm" c="green" fw={500}>
                                {indicator.performance}
                              </Text>
                            </Grid.Col>
                            <Grid.Col span={6}>
                              <Text size="xs" c="dimmed">
                                Used in:
                              </Text>
                              <Text size="sm">{indicator.usage} signals</Text>
                            </Grid.Col>
                            <Grid.Col span={6}>
                              <Text size="xs" c="dimmed">
                                Language:
                              </Text>
                              <Text size="sm">{indicator.language}</Text>
                            </Grid.Col>
                            <Grid.Col span={6}>
                              <Text size="xs" c="dimmed">
                                Category:
                              </Text>
                              <Text size="sm">{indicator.category}</Text>
                            </Grid.Col>
                          </Grid>

                          <Group justify="space-between" align="center">
                            <Group gap={4}>
                              <IconClock size={12} style={{ color: '#6b7280' }} />
                              <Text size="xs" c="dimmed">
                                {indicator.lastModified}
                              </Text>
                            </Group>
                            <IconArrowRight
                              size={16}
                              style={{
                                color:
                                  hoveredItem === `indicator-${indicator.id}`
                                    ? '#60a5fa'
                                    : '#6b7280',
                                transform:
                                  hoveredItem === `indicator-${indicator.id}`
                                    ? 'translateX(4px)'
                                    : 'translateX(0)',
                                transition: 'all 0.2s ease',
                              }}
                            />
                          </Group>
                        </Card>
                      </Grid.Col>
                    ))}
                    <Grid.Col span={{ base: 12, sm: 6, lg: 4 }}>
                      <Card
                        p="lg"
                        withBorder
                        style={{
                          background: 'rgba(31, 41, 55, 0.3)',
                          borderColor: 'rgba(75, 85, 99, 0.5)',
                          borderStyle: 'dashed',
                          cursor: 'pointer',
                          minHeight: '200px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s ease',
                          '&:hover': {
                            borderColor: 'rgba(59, 130, 246, 0.5)',
                            background: 'rgba(31, 41, 55, 0.4)',
                          },
                        }}
                        onClick={() => launchIDE('indicator', null)}
                      >
                        <Stack align="center" gap="sm">
                          <IconPlus size={48} style={{ color: '#6b7280' }} />
                          <Text c="dimmed">Create New Indicator</Text>
                        </Stack>
                      </Card>
                    </Grid.Col>
                  </>
                )}

                {(selectedCategory === 'all' || selectedCategory === 'signals') && (
                  <>
                    {selectedCategory === 'all' && (
                      <Grid.Col span={12}>
                        <Group gap="xs" mb="md" mt="xl">
                          <Text size="xl" fw={700}>
                            ⚡ Signals
                          </Text>
                          <Text size="sm" c="dimmed">
                            ({filterComponents(components.signals).length})
                          </Text>
                        </Group>
                      </Grid.Col>
                    )}
                    {filterComponents(components.signals).map((signal) => (
                      <Grid.Col key={signal.id} span={{ base: 12, sm: 6, lg: 4 }}>
                        <Card
                          p="lg"
                          withBorder
                          style={{
                            background: 'rgba(31, 41, 55, 0.5)',
                            borderColor:
                              hoveredItem === `signal-${signal.id}`
                                ? 'rgba(251, 191, 36, 0.5)'
                                : 'rgba(75, 85, 99, 0.3)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            transform:
                              hoveredItem === `signal-${signal.id}`
                                ? 'translateY(-2px)'
                                : 'translateY(0)',
                          }}
                          onMouseEnter={() => setHoveredItem(`signal-${signal.id}`)}
                          onMouseLeave={() => setHoveredItem(null)}
                          onClick={() => launchIDE('signal', signal)}
                        >
                          <Group justify="space-between" align="flex-start" mb="md">
                            <div>
                              <Group gap="xs" mb={4}>
                                <Text size="lg" fw={600}>
                                  {signal.name}
                                </Text>
                                <Badge color={getStatusColor(signal.status)} size="sm">
                                  {signal.status}
                                </Badge>
                              </Group>
                              <Text size="sm" c="dimmed">
                                {signal.description}
                              </Text>
                            </div>
                            <IconBolt
                              size={20}
                              style={{
                                color:
                                  hoveredItem === `signal-${signal.id}` ? '#fbbf24' : '#6b7280',
                                transition: 'color 0.2s ease',
                              }}
                            />
                          </Group>

                          <Grid gutter="xs" mb="md">
                            <Grid.Col span={6}>
                              <Text size="xs" c="dimmed">
                                Accuracy:
                              </Text>
                              <Text size="sm" c="green" fw={500}>
                                {signal.accuracy}
                              </Text>
                            </Grid.Col>
                            <Grid.Col span={6}>
                              <Text size="xs" c="dimmed">
                                Triggers:
                              </Text>
                              <Text size="sm">{signal.triggers}/day</Text>
                            </Grid.Col>
                            <Grid.Col span={12}>
                              <Text size="xs" c="dimmed">
                                Uses:
                              </Text>
                              <Text size="xs">{signal.indicators.join(', ')}</Text>
                            </Grid.Col>
                          </Grid>

                          <Group justify="space-between" align="center">
                            <Group gap={4}>
                              <IconClock size={12} style={{ color: '#6b7280' }} />
                              <Text size="xs" c="dimmed">
                                {signal.lastModified}
                              </Text>
                            </Group>
                            <IconArrowRight
                              size={16}
                              style={{
                                color:
                                  hoveredItem === `signal-${signal.id}` ? '#fbbf24' : '#6b7280',
                                transform:
                                  hoveredItem === `signal-${signal.id}`
                                    ? 'translateX(4px)'
                                    : 'translateX(0)',
                                transition: 'all 0.2s ease',
                              }}
                            />
                          </Group>
                        </Card>
                      </Grid.Col>
                    ))}
                    <Grid.Col span={{ base: 12, sm: 6, lg: 4 }}>
                      <Card
                        p="lg"
                        withBorder
                        style={{
                          background: 'rgba(31, 41, 55, 0.3)',
                          borderColor: 'rgba(75, 85, 99, 0.5)',
                          borderStyle: 'dashed',
                          cursor: 'pointer',
                          minHeight: '200px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s ease',
                          '&:hover': {
                            borderColor: 'rgba(251, 191, 36, 0.5)',
                            background: 'rgba(31, 41, 55, 0.4)',
                          },
                        }}
                        onClick={() => launchIDE('signal', null)}
                      >
                        <Stack align="center" gap="sm">
                          <IconPlus size={48} style={{ color: '#6b7280' }} />
                          <Text c="dimmed">Create New Signal</Text>
                        </Stack>
                      </Card>
                    </Grid.Col>
                  </>
                )}

                {(selectedCategory === 'all' || selectedCategory === 'strategies') && (
                  <>
                    {selectedCategory === 'all' && (
                      <Grid.Col span={12}>
                        <Group gap="xs" mb="md" mt="xl">
                          <Text size="xl" fw={700}>
                            🎯 Strategies
                          </Text>
                          <Text size="sm" c="dimmed">
                            ({filterComponents(components.strategies).length})
                          </Text>
                        </Group>
                      </Grid.Col>
                    )}
                    {filterComponents(components.strategies).map((strategy) => (
                      <Grid.Col key={strategy.id} span={{ base: 12, lg: 6 }}>
                        <Card
                          p="lg"
                          withBorder
                          style={{
                            background: 'rgba(31, 41, 55, 0.5)',
                            borderColor:
                              hoveredItem === `strategy-${strategy.id}`
                                ? 'rgba(168, 85, 247, 0.5)'
                                : 'rgba(75, 85, 99, 0.3)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            transform:
                              hoveredItem === `strategy-${strategy.id}`
                                ? 'translateY(-2px)'
                                : 'translateY(0)',
                          }}
                          onMouseEnter={() => setHoveredItem(`strategy-${strategy.id}`)}
                          onMouseLeave={() => setHoveredItem(null)}
                          onClick={() => launchIDE('strategy', strategy)}
                        >
                          <Group justify="space-between" align="flex-start" mb="md">
                            <div>
                              <Group gap="xs" mb={4}>
                                <Text size="lg" fw={600}>
                                  {strategy.name}
                                </Text>
                                <Badge color={getStatusColor(strategy.status)} size="sm">
                                  {strategy.status}
                                </Badge>
                              </Group>
                              <Text size="sm" c="dimmed">
                                {strategy.description}
                              </Text>
                            </div>
                            <IconBox
                              size={20}
                              style={{
                                color:
                                  hoveredItem === `strategy-${strategy.id}` ? '#a855f7' : '#6b7280',
                                transition: 'color 0.2s ease',
                              }}
                            />
                          </Group>

                          <Grid gutter="xs" mb="md">
                            <Grid.Col span={4}>
                              <Text size="xs" c="dimmed">
                                Sharpe:
                              </Text>
                              <Text size="sm" c="green" fw={500}>
                                {strategy.sharpe}
                              </Text>
                            </Grid.Col>
                            <Grid.Col span={4}>
                              <Text size="xs" c="dimmed">
                                Win Rate:
                              </Text>
                              <Text size="sm">{strategy.winRate}</Text>
                            </Grid.Col>
                            <Grid.Col span={4}>
                              <Text size="xs" c="dimmed">
                                Components:
                              </Text>
                              <Text size="sm">
                                {strategy.components.indicators}i {strategy.components.signals}s
                              </Text>
                            </Grid.Col>
                          </Grid>

                          <Group justify="space-between" align="center">
                            <Group gap={4}>
                              <IconClock size={12} style={{ color: '#6b7280' }} />
                              <Text size="xs" c="dimmed">
                                {strategy.lastModified}
                              </Text>
                            </Group>
                            <Group gap="xs">
                              <ActionIcon variant="subtle" size="sm" color="gray">
                                <IconPlayerPlay size={16} />
                              </ActionIcon>
                              <ActionIcon variant="subtle" size="sm" color="gray">
                                <IconChartBar size={16} />
                              </ActionIcon>
                              <IconArrowRight
                                size={16}
                                style={{
                                  color:
                                    hoveredItem === `strategy-${strategy.id}` ? '#a855f7' : '#6b7280',
                                  transform:
                                    hoveredItem === `strategy-${strategy.id}`
                                      ? 'translateX(4px)'
                                      : 'translateX(0)',
                                  transition: 'all 0.2s ease',
                                }}
                              />
                            </Group>
                          </Group>
                        </Card>
                      </Grid.Col>
                    ))}
                    <Grid.Col span={{ base: 12, lg: 6 }}>
                      <Card
                        p="lg"
                        withBorder
                        style={{
                          background: 'rgba(31, 41, 55, 0.3)',
                          borderColor: 'rgba(75, 85, 99, 0.5)',
                          borderStyle: 'dashed',
                          cursor: 'pointer',
                          minHeight: '200px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.2s ease',
                          '&:hover': {
                            borderColor: 'rgba(168, 85, 247, 0.5)',
                            background: 'rgba(31, 41, 55, 0.4)',
                          },
                        }}
                        onClick={() => launchIDE('strategy', null)}
                      >
                        <Stack align="center" gap="sm">
                          <IconPlus size={48} style={{ color: '#6b7280' }} />
                          <Text c="dimmed">Create New Strategy</Text>
                        </Stack>
                      </Card>
                    </Grid.Col>
                  </>
                )}
              </Grid>
            )}
          </>
        )}

        {mode === 'local' && (
          <Paper
            p="lg"
            mt="xl"
            style={{
              background: 'rgba(31, 41, 55, 0.5)',
              border: '1px solid rgba(75, 85, 99, 0.3)',
            }}
          >
            <Text size="lg" fw={600} mb="md">
              Quick Actions
            </Text>
            <Grid>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <UnstyledButton
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '1rem',
                    borderRadius: '0.5rem',
                    background: 'rgba(55, 65, 81, 0.5)',
                    border: '1px solid transparent',
                    textAlign: 'center',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      background: 'rgba(55, 65, 81, 0.8)',
                      borderColor: 'rgba(59, 130, 246, 0.3)',
                    },
                  }}
                >
                  <Stack align="center" gap="xs">
                    <IconGitCommit size={24} style={{ color: '#60a5fa' }} />
                    <Text size="sm">Commit Changes</Text>
                  </Stack>
                </UnstyledButton>
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <UnstyledButton
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '1rem',
                    borderRadius: '0.5rem',
                    background: 'rgba(55, 65, 81, 0.5)',
                    border: '1px solid transparent',
                    textAlign: 'center',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      background: 'rgba(55, 65, 81, 0.8)',
                      borderColor: 'rgba(34, 197, 94, 0.3)',
                    },
                  }}
                >
                  <Stack align="center" gap="xs">
                    <IconGitBranch size={24} style={{ color: '#22c55e' }} />
                    <Text size="sm">New Branch</Text>
                  </Stack>
                </UnstyledButton>
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <UnstyledButton
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '1rem',
                    borderRadius: '0.5rem',
                    background: 'rgba(55, 65, 81, 0.5)',
                    border: '1px solid transparent',
                    textAlign: 'center',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      background: 'rgba(55, 65, 81, 0.8)',
                      borderColor: 'rgba(251, 191, 36, 0.3)',
                    },
                  }}
                >
                  <Stack align="center" gap="xs">
                    <IconActivity size={24} style={{ color: '#fbbf24' }} />
                    <Text size="sm">Performance Report</Text>
                  </Stack>
                </UnstyledButton>
              </Grid.Col>
              <Grid.Col span={{ base: 6, sm: 3 }}>
                <UnstyledButton
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '1rem',
                    borderRadius: '0.5rem',
                    background: 'rgba(55, 65, 81, 0.5)',
                    border: '1px solid transparent',
                    textAlign: 'center',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      background: 'rgba(55, 65, 81, 0.8)',
                      borderColor: 'rgba(168, 85, 247, 0.3)',
                    },
                  }}
                >
                  <Stack align="center" gap="xs">
                    <IconStack3 size={24} style={{ color: '#a855f7' }} />
                    <Text size="sm">Dependency Graph</Text>
                  </Stack>
                </UnstyledButton>
              </Grid.Col>
            </Grid>
          </Paper>
        )}
      </Box>
    </Box>
  );
};
