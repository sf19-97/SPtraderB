// src/pages/BuildPage.tsx
import { useState } from 'react';
import { 
  Container, 
  Title, 
  Text, 
  Paper, 
  Group, 
  Button, 
  TextInput,
  Badge,
  Grid,
  Card,
  Stack,
  Box,
  ActionIcon,
  UnstyledButton,
  Tabs
} from '@mantine/core';
import { 
  IconCode, 
  IconBolt, 
  IconTrendingUp, 
  IconGitBranch, 
  IconClock, 
  IconSearch, 
  IconPlus, 
  IconPlayerPlay,
  IconGitCommit,
  IconCircleCheck,
  IconArrowRight,
  IconFileCode,
  IconBox,
  IconStack3,
  IconActivity,
  IconTerminal2,
  IconChartBar
} from '@tabler/icons-react';

export const BuildPage = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  // Your mock data
  const components = {
    indicators: [
      { 
        id: 1, 
        name: 'adaptive_rsi', 
        description: 'RSI that adjusts period based on volatility',
        lastModified: '2 hours ago',
        performance: '0.23ms',
        usage: 12,
        status: 'active',
        language: 'python',
        dependencies: ['numpy', 'pandas'],
        category: 'momentum'
      },
      { 
        id: 2, 
        name: 'microstructure_flow', 
        description: 'Order flow imbalance detector',
        lastModified: '1 day ago',
        performance: '1.2ms',
        usage: 8,
        status: 'testing',
        language: 'rust',
        dependencies: ['tokio', 'rayon'],
        category: 'microstructure'
      },
      { 
        id: 3, 
        name: 'garch_volatility', 
        description: 'GARCH(1,1) volatility forecast',
        lastModified: '3 days ago',
        performance: '5.4ms',
        usage: 4,
        status: 'active',
        language: 'python',
        dependencies: ['scipy', 'statsmodels'],
        category: 'volatility'
      }
    ],
    signals: [
      {
        id: 1,
        name: 'momentum_confluence',
        description: 'Multi-timeframe momentum alignment',
        lastModified: '5 hours ago',
        accuracy: '72%',
        triggers: 156,
        status: 'active',
        indicators: ['adaptive_rsi', 'macd_histogram'],
        complexity: 'medium'
      },
      {
        id: 2,
        name: 'liquidity_sweep',
        description: 'Detects stop-loss hunting patterns',
        lastModified: '2 days ago',
        accuracy: '84%',
        triggers: 43,
        status: 'optimizing',
        indicators: ['microstructure_flow', 'volume_profile'],
        complexity: 'high'
      }
    ],
    orders: [
      {
        id: 1,
        name: 'iceberg_enhanced',
        description: 'Iceberg with anti-detection randomization',
        lastModified: '1 day ago',
        avgFillTime: '2.3s',
        slippage: '0.02%',
        status: 'active',
        venues: ['Binance', 'Coinbase'],
        type: 'passive'
      },
      {
        id: 2,
        name: 'liquidity_sniper',
        description: 'ML-powered entry timing',
        lastModified: '4 days ago',
        avgFillTime: '0.8s',
        slippage: '0.05%',
        status: 'testing',
        venues: ['All'],
        type: 'aggressive'
      }
    ],
    strategies: [
      {
        id: 1,
        name: 'Momentum Hunter v3',
        description: 'Trend following with dynamic position sizing',
        lastModified: '3 hours ago',
        sharpe: 1.84,
        winRate: '64%',
        status: 'paper_trading',
        components: {
          indicators: 4,
          signals: 2,
          orders: 1
        }
      },
      {
        id: 2,
        name: 'Mean Reversion Pro',
        description: 'Statistical arbitrage on correlated pairs',
        lastModified: '1 week ago',
        sharpe: 2.12,
        winRate: '71%',
        status: 'live',
        components: {
          indicators: 6,
          signals: 3,
          orders: 2
        }
      }
    ]
  };

  const stats = {
    totalComponents: 12,
    activeBacktests: 3,
    liveStrategies: 2,
    lastBuild: '2 hours ago',
    codeLines: '14,832',
    gitCommits: 234
  };

  const launchIDE = (type: string, item: any) => {
    console.log(`Launching IDE for ${type}:`, item);
    // This would navigate to the Monaco IDE with the file loaded
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'active':
      case 'live':
        return 'green';
      case 'testing':
      case 'paper_trading':
        return 'yellow';
      case 'optimizing':
        return 'blue';
      default:
        return 'gray';
    }
  };

  // Filter components based on search
  const filterComponents = (items: any[]) => {
    if (!searchTerm) return items;
    return items.filter(item => 
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
  };

  return (
    <Box style={{ minHeight: '100vh', background: '#0a0a0a', position: 'relative', overflowY: 'auto' }}>
      {/* Animated Background */}
      <Box 
        style={{ 
          position: 'fixed', 
          inset: 0, 
          overflow: 'hidden', 
          pointerEvents: 'none',
          opacity: 0.3
        }}
      >
        <Box style={{ 
          position: 'absolute', 
          inset: 0, 
          background: 'linear-gradient(to bottom right, rgba(59, 130, 246, 0.05), rgba(147, 51, 234, 0.05), rgba(236, 72, 153, 0.05))' 
        }} />
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
                  WebkitTextFillColor: 'transparent'
                }}
              >
                Build Center
              </Title>
              <Text size="xl" c="dimmed">Your trading system components</Text>
            </div>
            <Button 
              size="lg" 
              leftSection={<IconTerminal2 size={20} />}
              variant="gradient"
              gradient={{ from: 'blue', to: 'cyan', deg: 90 }}
            >
              Open IDE
            </Button>
          </Group>

          {/* Stats Bar */}
          <Grid mb="xl">
            <Grid.Col span={{ base: 12, xs: 6, sm: 4, md: 2 }}>
              <Paper p="md" style={{ background: 'rgba(31, 41, 55, 0.5)', border: '1px solid rgba(75, 85, 99, 0.3)' }}>
                <Text size="sm" c="dimmed" mb={4}>Components</Text>
                <Text size="xl" fw={700}>{stats.totalComponents}</Text>
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6, sm: 4, md: 2 }}>
              <Paper p="md" style={{ background: 'rgba(31, 41, 55, 0.5)', border: '1px solid rgba(75, 85, 99, 0.3)' }}>
                <Text size="sm" c="dimmed" mb={4}>Active Tests</Text>
                <Text size="xl" fw={700} c="yellow">{stats.activeBacktests}</Text>
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6, sm: 4, md: 2 }}>
              <Paper p="md" style={{ background: 'rgba(31, 41, 55, 0.5)', border: '1px solid rgba(75, 85, 99, 0.3)' }}>
                <Text size="sm" c="dimmed" mb={4}>Live Strategies</Text>
                <Text size="xl" fw={700} c="green">{stats.liveStrategies}</Text>
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6, sm: 4, md: 2 }}>
              <Paper p="md" style={{ background: 'rgba(31, 41, 55, 0.5)', border: '1px solid rgba(75, 85, 99, 0.3)' }}>
                <Text size="sm" c="dimmed" mb={4}>Code Lines</Text>
                <Text size="xl" fw={700}>{stats.codeLines}</Text>
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6, sm: 4, md: 2 }}>
              <Paper p="md" style={{ background: 'rgba(31, 41, 55, 0.5)', border: '1px solid rgba(75, 85, 99, 0.3)' }}>
                <Text size="sm" c="dimmed" mb={4}>Git Commits</Text>
                <Text size="xl" fw={700}>{stats.gitCommits}</Text>
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, xs: 6, sm: 4, md: 2 }}>
              <Paper p="md" style={{ background: 'rgba(31, 41, 55, 0.5)', border: '1px solid rgba(75, 85, 99, 0.3)' }}>
                <Text size="sm" c="dimmed" mb={4}>Last Build</Text>
                <Text size="sm" fw={500}>{stats.lastBuild}</Text>
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
                    borderColor: 'rgba(59, 130, 246, 0.5)'
                  }
                }
              }}
            />
          </Group>
        </Box>

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
            <Tabs.Tab value="orders">📈 Orders</Tabs.Tab>
            <Tabs.Tab value="strategies">🎯 Strategies</Tabs.Tab>
          </Tabs.List>
        </Tabs>

        {/* Component Grid */}
        <Grid gutter="md">
          {/* Indicators */}
          {(selectedCategory === 'all' || selectedCategory === 'indicators') && (
            <>
              {selectedCategory === 'all' && (
                <Grid.Col span={12}>
                  <Group gap="xs" mb="md">
                    <Text size="xl" fw={700}>📊 Indicators</Text>
                    <Text size="sm" c="dimmed">({filterComponents(components.indicators).length})</Text>
                  </Group>
                </Grid.Col>
              )}
              {filterComponents(components.indicators).map(indicator => (
                <Grid.Col key={indicator.id} span={{ base: 12, sm: 6, lg: 4 }}>
                  <Card
                    p="lg"
                    withBorder
                    style={{ 
                      background: 'rgba(31, 41, 55, 0.5)', 
                      borderColor: hoveredItem === `indicator-${indicator.id}` ? 'rgba(59, 130, 246, 0.5)' : 'rgba(75, 85, 99, 0.3)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      transform: hoveredItem === `indicator-${indicator.id}` ? 'translateY(-2px)' : 'translateY(0)'
                    }}
                    onMouseEnter={() => setHoveredItem(`indicator-${indicator.id}`)}
                    onMouseLeave={() => setHoveredItem(null)}
                    onClick={() => launchIDE('indicator', indicator)}
                  >
                    <Group justify="space-between" align="flex-start" mb="md">
                      <div>
                        <Group gap="xs" mb={4}>
                          <Text size="lg" fw={600}>{indicator.name}</Text>
                          <Badge color={getStatusColor(indicator.status)} size="sm">
                            {indicator.status}
                          </Badge>
                        </Group>
                        <Text size="sm" c="dimmed">{indicator.description}</Text>
                      </div>
                      <IconFileCode 
                        size={20} 
                        style={{ 
                          color: hoveredItem === `indicator-${indicator.id}` ? '#60a5fa' : '#6b7280',
                          transition: 'color 0.2s ease'
                        }} 
                      />
                    </Group>
                    
                    <Grid gutter="xs" mb="md">
                      <Grid.Col span={6}>
                        <Text size="xs" c="dimmed">Performance:</Text>
                        <Text size="sm" c="green" fw={500}>{indicator.performance}</Text>
                      </Grid.Col>
                      <Grid.Col span={6}>
                        <Text size="xs" c="dimmed">Used in:</Text>
                        <Text size="sm">{indicator.usage} signals</Text>
                      </Grid.Col>
                      <Grid.Col span={6}>
                        <Text size="xs" c="dimmed">Language:</Text>
                        <Text size="sm">{indicator.language}</Text>
                      </Grid.Col>
                      <Grid.Col span={6}>
                        <Text size="xs" c="dimmed">Category:</Text>
                        <Text size="sm">{indicator.category}</Text>
                      </Grid.Col>
                    </Grid>
                    
                    <Group justify="space-between" align="center">
                      <Group gap={4}>
                        <IconClock size={12} style={{ color: '#6b7280' }} />
                        <Text size="xs" c="dimmed">{indicator.lastModified}</Text>
                      </Group>
                      <IconArrowRight 
                        size={16} 
                        style={{ 
                          color: hoveredItem === `indicator-${indicator.id}` ? '#60a5fa' : '#6b7280',
                          transform: hoveredItem === `indicator-${indicator.id}` ? 'translateX(4px)' : 'translateX(0)',
                          transition: 'all 0.2s ease'
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
                      background: 'rgba(31, 41, 55, 0.4)'
                    }
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

          {/* Signals */}
          {(selectedCategory === 'all' || selectedCategory === 'signals') && (
            <>
              {selectedCategory === 'all' && (
                <Grid.Col span={12}>
                  <Group gap="xs" mb="md" mt="xl">
                    <Text size="xl" fw={700}>⚡ Signals</Text>
                    <Text size="sm" c="dimmed">({filterComponents(components.signals).length})</Text>
                  </Group>
                </Grid.Col>
              )}
              {filterComponents(components.signals).map(signal => (
                <Grid.Col key={signal.id} span={{ base: 12, sm: 6, lg: 4 }}>
                  <Card
                    p="lg"
                    withBorder
                    style={{ 
                      background: 'rgba(31, 41, 55, 0.5)', 
                      borderColor: hoveredItem === `signal-${signal.id}` ? 'rgba(251, 191, 36, 0.5)' : 'rgba(75, 85, 99, 0.3)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      transform: hoveredItem === `signal-${signal.id}` ? 'translateY(-2px)' : 'translateY(0)'
                    }}
                    onMouseEnter={() => setHoveredItem(`signal-${signal.id}`)}
                    onMouseLeave={() => setHoveredItem(null)}
                    onClick={() => launchIDE('signal', signal)}
                  >
                    <Group justify="space-between" align="flex-start" mb="md">
                      <div>
                        <Group gap="xs" mb={4}>
                          <Text size="lg" fw={600}>{signal.name}</Text>
                          <Badge color={getStatusColor(signal.status)} size="sm">
                            {signal.status}
                          </Badge>
                        </Group>
                        <Text size="sm" c="dimmed">{signal.description}</Text>
                      </div>
                      <IconBolt 
                        size={20} 
                        style={{ 
                          color: hoveredItem === `signal-${signal.id}` ? '#fbbf24' : '#6b7280',
                          transition: 'color 0.2s ease'
                        }} 
                      />
                    </Group>
                    
                    <Grid gutter="xs" mb="md">
                      <Grid.Col span={6}>
                        <Text size="xs" c="dimmed">Accuracy:</Text>
                        <Text size="sm" c="green" fw={500}>{signal.accuracy}</Text>
                      </Grid.Col>
                      <Grid.Col span={6}>
                        <Text size="xs" c="dimmed">Triggers:</Text>
                        <Text size="sm">{signal.triggers}/day</Text>
                      </Grid.Col>
                      <Grid.Col span={12}>
                        <Text size="xs" c="dimmed">Uses:</Text>
                        <Text size="xs">{signal.indicators.join(', ')}</Text>
                      </Grid.Col>
                    </Grid>
                    
                    <Group justify="space-between" align="center">
                      <Group gap={4}>
                        <IconClock size={12} style={{ color: '#6b7280' }} />
                        <Text size="xs" c="dimmed">{signal.lastModified}</Text>
                      </Group>
                      <IconArrowRight 
                        size={16} 
                        style={{ 
                          color: hoveredItem === `signal-${signal.id}` ? '#fbbf24' : '#6b7280',
                          transform: hoveredItem === `signal-${signal.id}` ? 'translateX(4px)' : 'translateX(0)',
                          transition: 'all 0.2s ease'
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
                      background: 'rgba(31, 41, 55, 0.4)'
                    }
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

          {/* Order Types */}
          {(selectedCategory === 'all' || selectedCategory === 'orders') && (
            <>
              {selectedCategory === 'all' && (
                <Grid.Col span={12}>
                  <Group gap="xs" mb="md" mt="xl">
                    <Text size="xl" fw={700}>📈 Order Execution</Text>
                    <Text size="sm" c="dimmed">({filterComponents(components.orders).length})</Text>
                  </Group>
                </Grid.Col>
              )}
              {filterComponents(components.orders).map(order => (
                <Grid.Col key={order.id} span={{ base: 12, sm: 6, lg: 4 }}>
                  <Card
                    p="lg"
                    withBorder
                    style={{ 
                      background: 'rgba(31, 41, 55, 0.5)', 
                      borderColor: hoveredItem === `order-${order.id}` ? 'rgba(34, 197, 94, 0.5)' : 'rgba(75, 85, 99, 0.3)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      transform: hoveredItem === `order-${order.id}` ? 'translateY(-2px)' : 'translateY(0)'
                    }}
                    onMouseEnter={() => setHoveredItem(`order-${order.id}`)}
                    onMouseLeave={() => setHoveredItem(null)}
                    onClick={() => launchIDE('order', order)}
                  >
                    <Group justify="space-between" align="flex-start" mb="md">
                      <div>
                        <Group gap="xs" mb={4}>
                          <Text size="lg" fw={600}>{order.name}</Text>
                          <Badge color={getStatusColor(order.status)} size="sm">
                            {order.status}
                          </Badge>
                        </Group>
                        <Text size="sm" c="dimmed">{order.description}</Text>
                      </div>
                      <IconTrendingUp 
                        size={20} 
                        style={{ 
                          color: hoveredItem === `order-${order.id}` ? '#22c55e' : '#6b7280',
                          transition: 'color 0.2s ease'
                        }} 
                      />
                    </Group>
                    
                    <Grid gutter="xs" mb="md">
                      <Grid.Col span={6}>
                        <Text size="xs" c="dimmed">Avg Fill:</Text>
                        <Text size="sm" c="green" fw={500}>{order.avgFillTime}</Text>
                      </Grid.Col>
                      <Grid.Col span={6}>
                        <Text size="xs" c="dimmed">Slippage:</Text>
                        <Text size="sm">{order.slippage}</Text>
                      </Grid.Col>
                      <Grid.Col span={6}>
                        <Text size="xs" c="dimmed">Type:</Text>
                        <Text size="sm">{order.type}</Text>
                      </Grid.Col>
                      <Grid.Col span={6}>
                        <Text size="xs" c="dimmed">Venues:</Text>
                        <Text size="xs">{order.venues.join(', ')}</Text>
                      </Grid.Col>
                    </Grid>
                    
                    <Group justify="space-between" align="center">
                      <Group gap={4}>
                        <IconClock size={12} style={{ color: '#6b7280' }} />
                        <Text size="xs" c="dimmed">{order.lastModified}</Text>
                      </Group>
                      <IconArrowRight 
                        size={16} 
                        style={{ 
                          color: hoveredItem === `order-${order.id}` ? '#22c55e' : '#6b7280',
                          transform: hoveredItem === `order-${order.id}` ? 'translateX(4px)' : 'translateX(0)',
                          transition: 'all 0.2s ease'
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
                      borderColor: 'rgba(34, 197, 94, 0.5)',
                      background: 'rgba(31, 41, 55, 0.4)'
                    }
                  }}
                  onClick={() => launchIDE('order', null)}
                >
                  <Stack align="center" gap="sm">
                    <IconPlus size={48} style={{ color: '#6b7280' }} />
                    <Text c="dimmed">Create New Order Type</Text>
                  </Stack>
                </Card>
              </Grid.Col>
            </>
          )}

          {/* Strategies */}
          {(selectedCategory === 'all' || selectedCategory === 'strategies') && (
            <>
              {selectedCategory === 'all' && (
                <Grid.Col span={12}>
                  <Group gap="xs" mb="md" mt="xl">
                    <Text size="xl" fw={700}>🎯 Strategies</Text>
                    <Text size="sm" c="dimmed">({filterComponents(components.strategies).length})</Text>
                  </Group>
                </Grid.Col>
              )}
              {filterComponents(components.strategies).map(strategy => (
                <Grid.Col key={strategy.id} span={{ base: 12, lg: 6 }}>
                  <Card
                    p="lg"
                    withBorder
                    style={{ 
                      background: 'rgba(31, 41, 55, 0.5)', 
                      borderColor: hoveredItem === `strategy-${strategy.id}` ? 'rgba(168, 85, 247, 0.5)' : 'rgba(75, 85, 99, 0.3)',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      transform: hoveredItem === `strategy-${strategy.id}` ? 'translateY(-2px)' : 'translateY(0)'
                    }}
                    onMouseEnter={() => setHoveredItem(`strategy-${strategy.id}`)}
                    onMouseLeave={() => setHoveredItem(null)}
                    onClick={() => launchIDE('strategy', strategy)}
                  >
                    <Group justify="space-between" align="flex-start" mb="md">
                      <div>
                        <Group gap="xs" mb={4}>
                          <Text size="lg" fw={600}>{strategy.name}</Text>
                          <Badge color={getStatusColor(strategy.status)} size="sm">
                            {strategy.status}
                          </Badge>
                        </Group>
                        <Text size="sm" c="dimmed">{strategy.description}</Text>
                      </div>
                      <IconBox 
                        size={20} 
                        style={{ 
                          color: hoveredItem === `strategy-${strategy.id}` ? '#a855f7' : '#6b7280',
                          transition: 'color 0.2s ease'
                        }} 
                      />
                    </Group>
                    
                    <Grid gutter="xs" mb="md">
                      <Grid.Col span={4}>
                        <Text size="xs" c="dimmed">Sharpe:</Text>
                        <Text size="sm" c="green" fw={500}>{strategy.sharpe}</Text>
                      </Grid.Col>
                      <Grid.Col span={4}>
                        <Text size="xs" c="dimmed">Win Rate:</Text>
                        <Text size="sm">{strategy.winRate}</Text>
                      </Grid.Col>
                      <Grid.Col span={4}>
                        <Text size="xs" c="dimmed">Components:</Text>
                        <Text size="sm">
                          {strategy.components.indicators}i {strategy.components.signals}s {strategy.components.orders}o
                        </Text>
                      </Grid.Col>
                    </Grid>
                    
                    <Group justify="space-between" align="center">
                      <Group gap={4}>
                        <IconClock size={12} style={{ color: '#6b7280' }} />
                        <Text size="xs" c="dimmed">{strategy.lastModified}</Text>
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
                            color: hoveredItem === `strategy-${strategy.id}` ? '#a855f7' : '#6b7280',
                            transform: hoveredItem === `strategy-${strategy.id}` ? 'translateX(4px)' : 'translateX(0)',
                            transition: 'all 0.2s ease'
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
                      background: 'rgba(31, 41, 55, 0.4)'
                    }
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

        {/* Quick Actions Bar */}
        <Paper p="lg" mt="xl" style={{ background: 'rgba(31, 41, 55, 0.5)', border: '1px solid rgba(75, 85, 99, 0.3)' }}>
          <Text size="lg" fw={600} mb="md">Quick Actions</Text>
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
                    borderColor: 'rgba(59, 130, 246, 0.3)'
                  }
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
                    borderColor: 'rgba(34, 197, 94, 0.3)'
                  }
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
                    borderColor: 'rgba(251, 191, 36, 0.3)'
                  }
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
                    borderColor: 'rgba(168, 85, 247, 0.3)'
                  }
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
      </Box>
    </Box>
  );
};