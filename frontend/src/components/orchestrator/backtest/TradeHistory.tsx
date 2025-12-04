import { useState, useEffect, useRef } from 'react';
import { Table, Paper, Text, Badge, Button, Group, TextInput, Stack } from '@mantine/core';
import { IconSearch, IconDownload, IconArrowUp, IconArrowDown } from '@tabler/icons-react';
import { useOrchestratorStore } from '../../../stores/useOrchestratorStore';

interface Trade {
  id?: string;
  entryTime: string;
  exitTime?: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice: number;
  exitPrice?: number;
  pnl?: number;
  signalType?: string;
}

export function TradeHistory() {
  const { backtestResults, highlightedTradeId, navigateToTrade } = useOrchestratorStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<keyof Trade>('entryTime');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const _tableRef = useRef<HTMLDivElement>(null);
  const highlightedRowRef = useRef<HTMLTableRowElement>(null);

  // Scroll to highlighted trade when it changes - MUST be before any returns
  useEffect(() => {
    if (highlightedTradeId && highlightedRowRef.current) {
      highlightedRowRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [highlightedTradeId]);

  // Use completed trades from backtest results
  let trades: Trade[] = [];

  if (backtestResults?.completed_trades && backtestResults.completed_trades.length > 0) {
    trades = backtestResults.completed_trades.map((trade: any) => ({
      id: trade.id,
      entryTime: new Date(trade.entry_time).toLocaleString(),
      exitTime: new Date(trade.exit_time).toLocaleString(),
      symbol: trade.symbol,
      side: trade.side === 'long' ? 'buy' : 'sell',
      quantity: Number(trade.quantity || 0),
      entryPrice: Number(trade.entry_price || 0),
      exitPrice: trade.exit_price ? Number(trade.exit_price) : undefined,
      pnl: trade.pnl !== undefined && trade.pnl !== null ? Number(trade.pnl) : undefined,
      signalType: trade.exit_reason || 'signal',
    }));
  }

  if (trades.length === 0) {
    return (
      <Paper p="md" withBorder>
        <Text c="dimmed" ta="center">
          No trades to display
        </Text>
      </Paper>
    );
  }

  // Filter trades based on search term
  const filteredTrades = trades.filter(
    (trade) =>
      trade.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
      trade.signalType?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Sort trades
  const sortedTrades = [...filteredTrades].sort((a, b) => {
    const aValue = a[sortField];
    const bValue = b[sortField];

    if (aValue === undefined || bValue === undefined) return 0;

    let comparison = 0;
    if (aValue < bValue) comparison = -1;
    if (aValue > bValue) comparison = 1;

    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const handleSort = (field: keyof Trade) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const exportToCSV = () => {
    const headers = [
      'Entry Time',
      'Exit Time',
      'Symbol',
      'Side',
      'Quantity',
      'Entry Price',
      'Exit Price',
      'P&L',
      'Signal Type',
    ];
    const rows = sortedTrades.map((trade) => [
      trade.entryTime,
      trade.exitTime || '',
      trade.symbol,
      trade.side,
      trade.quantity || 0,
      trade.entryPrice || 0,
      trade.exitPrice || '',
      trade.pnl !== undefined ? trade.pnl : '',
      trade.signalType || '',
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest_trades_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleRowClick = (trade: Trade) => {
    if (trade.id) {
      // Navigate to chart tab and highlight the trade
      navigateToTrade(trade.id, 'chart');
    }
  };

  return (
    <Stack gap="md">
      <Paper p="md" withBorder>
        <Stack gap="md">
          <Group justify="space-between">
            <Text fw={600} size="lg">
              Trade History
            </Text>
            <Group>
              <TextInput
                placeholder="Search trades..."
                leftSection={<IconSearch size={16} />}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.currentTarget.value)}
                size="sm"
              />
              <Button
                leftSection={<IconDownload size={16} />}
                onClick={exportToCSV}
                variant="light"
                size="sm"
              >
                Export CSV
              </Button>
            </Group>
          </Group>

          <Table.ScrollContainer minWidth={800}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th onClick={() => handleSort('entryTime')} style={{ cursor: 'pointer' }}>
                    <Group gap="xs">
                      Entry Time
                      {sortField === 'entryTime' &&
                        (sortDirection === 'asc' ? (
                          <IconArrowUp size={14} />
                        ) : (
                          <IconArrowDown size={14} />
                        ))}
                    </Group>
                  </Table.Th>
                  <Table.Th>Exit Time</Table.Th>
                  <Table.Th>Symbol</Table.Th>
                  <Table.Th>Side</Table.Th>
                  <Table.Th>Quantity</Table.Th>
                  <Table.Th>Entry Price</Table.Th>
                  <Table.Th>Exit Price</Table.Th>
                  <Table.Th onClick={() => handleSort('pnl')} style={{ cursor: 'pointer' }}>
                    <Group gap="xs">
                      P&L
                      {sortField === 'pnl' &&
                        (sortDirection === 'asc' ? (
                          <IconArrowUp size={14} />
                        ) : (
                          <IconArrowDown size={14} />
                        ))}
                    </Group>
                  </Table.Th>
                  <Table.Th>Signal</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sortedTrades.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={9} ta="center">
                      <Text c="dimmed">No trades found</Text>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  sortedTrades.map((trade, index) => {
                    const isHighlighted = trade.id === highlightedTradeId;
                    return (
                      <Table.Tr
                        key={trade.id || index}
                        ref={isHighlighted ? highlightedRowRef : undefined}
                        onClick={() => handleRowClick(trade)}
                        style={{
                          cursor: trade.id ? 'pointer' : 'default',
                          backgroundColor: isHighlighted
                            ? 'var(--mantine-color-blue-light)'
                            : undefined,
                          transition: 'background-color 0.2s ease',
                        }}
                      >
                        <Table.Td>{trade.entryTime}</Table.Td>
                        <Table.Td>{trade.exitTime || '-'}</Table.Td>
                        <Table.Td>{trade.symbol}</Table.Td>
                        <Table.Td>
                          <Badge color={trade.side === 'buy' ? 'green' : 'red'} variant="light">
                            {trade.side.toUpperCase()}
                          </Badge>
                        </Table.Td>
                        <Table.Td>{Number(trade.quantity || 0).toFixed(2)}</Table.Td>
                        <Table.Td>${Number(trade.entryPrice || 0).toFixed(5)}</Table.Td>
                        <Table.Td>
                          {trade.exitPrice ? `$${Number(trade.exitPrice || 0).toFixed(5)}` : '-'}
                        </Table.Td>
                        <Table.Td>
                          {trade.pnl !== undefined ? (
                            <Text c={trade.pnl >= 0 ? 'green' : 'red'} fw={600}>
                              ${Number(trade.pnl || 0).toFixed(2)}
                            </Text>
                          ) : (
                            '-'
                          )}
                        </Table.Td>
                        <Table.Td>
                          {trade.signalType && (
                            <Badge variant="dot" size="sm">
                              {trade.signalType}
                            </Badge>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      </Paper>
    </Stack>
  );
}
