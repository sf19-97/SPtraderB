// src/pages/TradingPage.tsx
import AdaptiveChart from '../components/AdaptiveChart';
import { AdaptiveChartV2 } from '../components/AdaptiveChartV2';
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Indicator, Button } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';

interface DatabaseStatus {
  connected: boolean;
  database_name: string;
  host: string;
  error?: string;
}

export const TradingPage = () => {
  const [selectedTimeframe, setSelectedTimeframe] = useState('1h');
  const [selectedPair, setSelectedPair] = useState('EURUSD');
  const [showIndicators, setShowIndicators] = useState(false);
  const [chartVersion, setChartVersion] = useState<'v1' | 'v2'>('v1');
  const [v2DetailLevel, setV2DetailLevel] = useState<string>('1h');
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
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      margin: 0, 
      padding: 0, 
      overflow: 'hidden',
      background: '#0a0a0a',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Top Navigation Bar */}
      <div style={{
        height: '50px',
        background: '#1a1a1a',
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        paddingLeft: '80px', // Add padding to account for collapsed sidebar
        color: '#fff',
        flexShrink: 0
      }}>
        <h1 className="sp-trader-logo" style={{ margin: 0, fontSize: '18px' }}>SPTrader</h1>
      </div>

      {/* Main Content Area */}
      <div style={{ 
        flex: 1, 
        display: 'flex',
        overflow: 'hidden'
      }}>
        {/* Center Chart Area - Now takes full width minus right sidebar */}
        <div style={{ 
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: '#0f0f0f'
        }}>
          {/* Chart Controls */}
          <div style={{
            height: '40px',
            background: '#1a1a1a',
            borderBottom: '1px solid #333',
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px',
            gap: '20px'
          }}>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', width: '100%' }}>
              {chartVersion === 'v1' ? (
                // V1: Traditional timeframe buttons
                <>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    {['15m', '1h', '4h', '12h'].map(tf => (
                      <button
                        key={tf}
                        onClick={() => setSelectedTimeframe(tf)}
                        style={{
                          background: selectedTimeframe === tf ? '#3a3a3a' : 'transparent',
                          border: 'none',
                          color: selectedTimeframe === tf ? '#4a9eff' : '#888',
                          padding: '5px 10px',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          fontSize: '13px'
                        }}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button
                      onClick={() => setShowIndicators(!showIndicators)}
                      style={{
                        background: showIndicators ? '#3a3a3a' : 'transparent',
                        border: '1px solid #444',
                        color: showIndicators ? '#4a9eff' : '#888',
                        padding: '5px 10px',
                        borderRadius: '3px',
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      Indicators
                    </button>
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <select 
                        value={selectedPair}
                        onChange={(e) => setSelectedPair(e.target.value)}
                        style={{
                          background: '#2a2a2a',
                          border: '1px solid #444',
                          color: '#fff',
                          padding: '5px 30px 5px 10px',
                          borderRadius: '3px',
                          fontSize: '13px',
                          cursor: 'pointer',
                          outline: 'none',
                          WebkitAppearance: 'none',
                          MozAppearance: 'none',
                          appearance: 'none'
                        }}
                      >
                        {['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF'].map(pair => (
                          <option key={pair} value={pair}>{pair}</option>
                        ))}
                      </select>
                      <span style={{
                        position: 'absolute',
                        right: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        pointerEvents: 'none',
                        color: '#888',
                        fontSize: '10px'
                      }}>▼</span>
                    </div>
                  </div>
                </>
              ) : (
                // V2: Detail level display (read-only)
                <>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '10px',
                    color: '#888',
                    fontSize: '13px'
                  }}>
                    <span>Auto Detail:</span>
                    <span style={{ 
                      background: '#2a2a2a',
                      padding: '5px 10px',
                      borderRadius: '3px',
                      color: '#00ff88',
                      fontFamily: 'monospace'
                    }}>
                      {v2DetailLevel}
                    </span>
                    <span style={{ fontSize: '11px', color: '#666' }}>
                      Zoom to change detail level
                    </span>
                  </div>
                  <div style={{ marginLeft: 'auto', position: 'relative', display: 'inline-block' }}>
                    <select 
                      value={selectedPair}
                      onChange={(e) => setSelectedPair(e.target.value)}
                      style={{
                        background: '#2a2a2a',
                        border: '1px solid #444',
                        color: '#fff',
                        padding: '5px 30px 5px 10px',
                        borderRadius: '3px',
                        fontSize: '13px',
                        cursor: 'pointer',
                        outline: 'none',
                        WebkitAppearance: 'none',
                        MozAppearance: 'none',
                        appearance: 'none'
                      }}
                    >
                      {['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF'].map(pair => (
                        <option key={pair} value={pair}>{pair}</option>
                      ))}
                    </select>
                    <span style={{
                      position: 'absolute',
                      right: '10px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      pointerEvents: 'none',
                      color: '#888',
                      fontSize: '10px'
                    }}>▼</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Chart Version Tabs */}
          <div style={{
            height: '35px',
            background: '#131313',
            borderBottom: '1px solid #333',
            display: 'flex',
            alignItems: 'center',
            padding: '0 20px'
          }}>
            <button 
              onClick={() => setChartVersion('v1')}
              style={{ 
                background: chartVersion === 'v1' ? '#333' : 'transparent',
                color: chartVersion === 'v1' ? '#fff' : '#888',
                border: 'none',
                padding: '8px 16px',
                cursor: 'pointer',
                fontSize: '12px',
                borderRadius: '3px',
                marginRight: '5px'
              }}
            >
              Classic
            </button>
            <button 
              onClick={() => setChartVersion('v2')}
              style={{ 
                background: chartVersion === 'v2' ? '#333' : 'transparent',
                color: chartVersion === 'v2' ? '#00ff88' : '#888',
                border: 'none',
                padding: '8px 16px',
                cursor: 'pointer',
                fontSize: '12px',
                borderRadius: '3px'
              }}
            >
              V2 (Beta)
            </button>
            <span style={{ 
              marginLeft: '20px', 
              fontSize: '11px', 
              color: '#666' 
            }}>
              {chartVersion === 'v2' ? 'Hierarchical Data Engine' : 'Traditional Timeframe Switching'}
            </span>
          </div>

          {/* Chart Container */}
          <div style={{ 
            flex: 1,
            padding: '10px',
            display: 'flex',
            overflow: 'hidden'
          }}>
            <div style={{
              width: '100%',
              height: '100%',
              background: '#0a0a0a',
              borderRadius: '8px',
              border: '1px solid #222',
              overflow: 'hidden'
            }}>
              {chartVersion === 'v1' ? (
                <AdaptiveChart 
                  symbol={selectedPair.replace('/', '')}
                  timeframe={selectedTimeframe}
                  onTimeframeChange={setSelectedTimeframe}
                />
              ) : (
                <AdaptiveChartV2 
                  symbol={selectedPair.replace('/', '')}
                  timeframe={selectedTimeframe}
                  onTimeframeChange={setSelectedTimeframe}
                  onDetailLevelChange={setV2DetailLevel}
                />
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div style={{
          width: '250px',
          background: '#151515',
          borderLeft: '1px solid #333',
          padding: '20px',
          color: '#fff',
          flexShrink: 0
        }}>
          <h3 style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#888' }}>MARKET INFO</h3>
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{selectedPair}</div>
            <div style={{ fontSize: '20px', color: '#4a9eff' }}>1.0856</div>
            <div style={{ fontSize: '14px', color: '#4caf50' }}>+0.0012 (+0.11%)</div>
          </div>
          
          <div style={{ borderTop: '1px solid #333', paddingTop: '20px' }}>
            <div style={{ marginBottom: '15px' }}>
              <div style={{ fontSize: '12px', color: '#888' }}>Bid</div>
              <div style={{ fontSize: '16px' }}>1.0855</div>
            </div>
            <div style={{ marginBottom: '15px' }}>
              <div style={{ fontSize: '12px', color: '#888' }}>Ask</div>
              <div style={{ fontSize: '16px' }}>1.0857</div>
            </div>
            <div style={{ marginBottom: '15px' }}>
              <div style={{ fontSize: '12px', color: '#888' }}>Spread</div>
              <div style={{ fontSize: '16px' }}>2.0</div>
            </div>
          </div>

          <Button
            fullWidth
            leftSection={<IconPlus size={16} />}
            mt="xl"
            size="md"
            variant="gradient"
            gradient={{ from: 'blue', to: 'cyan', deg: 45 }}
          >
            New Order
          </Button>
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div style={{
        height: '30px',
        background: '#1a1a1a',
        borderTop: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        color: '#888',
        fontSize: '12px',
        flexShrink: 0
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
        <button style={{
          marginLeft: 'auto',
          background: 'none',
          border: '1px solid #444',
          color: '#fff',
          padding: '4px 10px',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px'
        }}>Settings</button>
      </div>
    </div>
  );
};