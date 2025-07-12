import { useState, useEffect } from 'react';
import { Box, Indicator } from '@mantine/core';
import { BitcoinMarketDataBar } from '../components/BitcoinMarketDataBar';
import { TradingRightSidebar } from '../components/TradingRightSidebar';
import BitcoinTestChart from '../components/BitcoinTestChart';
import { invoke } from '@tauri-apps/api/core';

interface DatabaseStatus {
  connected: boolean;
  database_name: string;
  host: string;
  error?: string;
}

const BitcoinTest = () => {
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);
  const [currentTimeframe, setCurrentTimeframe] = useState('1h');
  const [dbStatus, setDbStatus] = useState<DatabaseStatus>({
    connected: false,
    database_name: 'forex_trading',
    host: 'localhost',
  });

  // Check database connection every 5 seconds
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const status = await invoke<DatabaseStatus>('check_database_connection');
        setDbStatus(status);
      } catch (error) {
        setDbStatus({
          connected: false,
          database_name: 'forex_trading',
          host: 'localhost',
          error: error as string,
        });
      }
    };

    // Check immediately
    checkConnection();

    // Then check every 5 seconds
    const interval = setInterval(checkConnection, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <Box style={{ display: 'flex', height: '100vh', width: '100%' }}>
      {/* Main content area */}
      <Box style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Market Data Bar at top */}
        <BitcoinMarketDataBar currentTimeframe={currentTimeframe} />

        {/* Chart area */}
        <Box style={{ flex: 1, background: '#0a0a0a', position: 'relative' }}>
          <BitcoinTestChart 
            symbol="BTCUSD"
            timeframe={currentTimeframe}
            onTimeframeChange={setCurrentTimeframe}
            isFullscreen={isChartFullscreen}
            onToggleFullscreen={() => setIsChartFullscreen(!isChartFullscreen)}
          />
        </Box>

        {/* Bottom status bar */}
        <Box style={{
          height: '30px',
          background: '#1a1a1a',
          borderTop: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          fontSize: '12px',
          color: '#888'
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Indicator
              inline
              size={8}
              offset={0}
              position="middle-center"
              color={dbStatus.connected ? 'green' : 'red'}
              processing={dbStatus.connected}
            />
            {dbStatus.connected ? 'Connected' : 'Disconnected'}
          </span>
          <span style={{ marginLeft: '20px' }}>Last Update: {new Date().toLocaleTimeString()}</span>
        </Box>
      </Box>

      {/* Right sidebar - collapsible */}
      <TradingRightSidebar 
        collapsed={rightCollapsed}
        onToggle={() => setRightCollapsed(!rightCollapsed)}
      />
    </Box>
  );
};

export default BitcoinTest;