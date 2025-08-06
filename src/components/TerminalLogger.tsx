import React, { useState, useEffect, useRef } from 'react';
import { Box, ActionIcon, Text, Group, Tooltip, Loader } from '@mantine/core';
import { IconTerminal2, IconTrash, IconBug, IconBugOff } from '@tabler/icons-react';

export interface LogEntry {
  id: number;
  timestamp: string;
  type:
    | 'info'
    | 'success'
    | 'warn'
    | 'error'
    | 'debug'
    | 'python'
    | 'db'
    | 'candles'
    | 'perf'
    | 'user';
  prefix: string;
  message: string;
  color: string;
}

interface TerminalLoggerProps {
  logs: LogEntry[];
  onClearLogs: () => void;
  isProcessRunning?: boolean;
}

export const TerminalLogger: React.FC<TerminalLoggerProps> = ({
  logs,
  onClearLogs,
  isProcessRunning = false,
}) => {
  const logEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  // Auto-scroll to bottom when new logs arrive (if auto-scroll is enabled)
  useEffect(() => {
    if (autoScroll && !isUserScrolling) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isUserScrolling]);

  // Detect user scrolling
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;

    setAutoScroll(isAtBottom);
    setIsUserScrolling(!isAtBottom);
  };

  const getLogColor = (type: LogEntry['type']): string => {
    switch (type) {
      case 'info':
        return '#3b82f6'; // blue
      case 'success':
        return '#10b981'; // green
      case 'warn':
        return '#f59e0b'; // yellow
      case 'error':
        return '#ef4444'; // red
      case 'debug':
        return '#8b5cf6'; // purple
      case 'python':
        return '#06b6d4'; // cyan
      case 'db':
        return '#6366f1'; // indigo
      case 'candles':
        return '#14b8a6'; // teal
      case 'perf':
        return '#a855f7'; // purple
      case 'user':
        return '#ec4899'; // pink
      default:
        return '#9ca3af'; // gray
    }
  };

  const getPrefix = (type: LogEntry['type']): string => {
    switch (type) {
      case 'info':
        return '[INFO]';
      case 'success':
        return '[SUCCESS]';
      case 'warn':
        return '[WARN]';
      case 'error':
        return '[ERROR]';
      case 'debug':
        return '[DEBUG]';
      case 'python':
        return '[PYTHON]';
      case 'db':
        return '[DB]';
      case 'candles':
        return '[CANDLES]';
      case 'perf':
        return '[PERF]';
      case 'user':
        return '[USER]';
      default:
        return '[LOG]';
    }
  };

  return (
    <Box
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#000',
        borderLeft: '1px solid #333',
      }}
    >
      {/* Terminal Header */}
      <Box
        px="md"
        py="xs"
        style={{
          background: '#1a1a1a',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Group gap="xs">
          <IconTerminal2 size={16} color="#10b981" />
          <Text size="sm" ff="monospace" c="dimmed">
            ingestion.log
          </Text>
        </Group>
        <Group gap="xs">
          <Tooltip label={showDebug ? 'Hide debug logs' : 'Show debug logs'}>
            <ActionIcon
              size="sm"
              variant="subtle"
              color={showDebug ? 'violet' : 'gray'}
              onClick={() => setShowDebug(!showDebug)}
            >
              {showDebug ? <IconBug size={16} /> : <IconBugOff size={16} />}
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Clear logs">
            <ActionIcon size="sm" variant="subtle" color="gray" onClick={onClearLogs}>
              <IconTrash size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Box>

      {/* Terminal Body */}
      <Box
        ref={scrollContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          fontFamily: 'monospace',
          fontSize: '13px',
          padding: '12px',
          lineHeight: 1.5,
        }}
      >
        {logs
          .filter((log) => showDebug || log.type !== 'debug')
          .map((log) => (
            <Box key={log.id} style={{ display: 'flex', gap: '8px', marginBottom: '2px' }}>
              <Text span size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {log.timestamp}
              </Text>
              <Text span style={{ color: getLogColor(log.type), whiteSpace: 'nowrap' }}>
                {log.prefix || getPrefix(log.type)}
              </Text>
              <Text span c="gray.3" style={{ wordBreak: 'break-word' }}>
                {log.message}
              </Text>
            </Box>
          ))}
        <div ref={logEndRef} />
      </Box>

      {/* Terminal Status Bar */}
      <Box
        px="md"
        py={4}
        style={{
          background: '#1a1a1a',
          borderTop: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px',
        }}
      >
        <Group gap="xl">
          <Text c="dimmed">
            Lines: {logs.filter((log) => showDebug || log.type !== 'debug').length}
          </Text>
          <Text c="dimmed">UTF-8</Text>
        </Group>
        <Group gap="md">
          {autoScroll && (
            <Text c="green" size="xs">
              AUTO
            </Text>
          )}
          {isProcessRunning && (
            <Group gap="xs">
              <Loader size="xs" color="green" />
              <Text c="green" size="xs">
                RUNNING
              </Text>
            </Group>
          )}
        </Group>
      </Box>
    </Box>
  );
};
