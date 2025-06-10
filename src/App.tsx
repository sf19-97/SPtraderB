import AdaptiveChart from './components/AdaptiveChart';
import { AdaptiveChartV2 } from './components/AdaptiveChartV2';
import { MatrixLogin } from './components/MatrixLogin';
import { useState } from 'react';
import './App.css';

function App() {
  const [showMatrix, setShowMatrix] = useState(true);
  const [selectedTimeframe, setSelectedTimeframe] = useState('1h');
  const [selectedPair, setSelectedPair] = useState('EURUSD');
  const [chartType, setChartType] = useState('candlestick');
  const [showIndicators, setShowIndicators] = useState(false);
  const [chartVersion, setChartVersion] = useState<'v1' | 'v2'>('v1');
  const [v2DetailLevel, setV2DetailLevel] = useState<string>('1h');

  if (showMatrix) {
    return <MatrixLogin onComplete={() => setShowMatrix(false)} />;
  }

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
        color: '#fff',
        flexShrink: 0
      }}>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>SPTrader</h1>
        
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '20px', alignItems: 'center' }}>
          <button style={{
            background: 'none',
            border: '1px solid #444',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px'
          }}>Connect</button>
          
          <button style={{
            background: 'none',
            border: '1px solid #444',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px'
          }}>Settings</button>
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ 
        flex: 1, 
        display: 'flex',
        overflow: 'hidden'
      }}>
        {/* Left Sidebar */}
        <div style={{
          width: '200px',
          background: '#151515',
          borderRight: '1px solid #333',
          padding: '20px',
          color: '#fff',
          flexShrink: 0
        }}>
          <h3 style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#888' }}>PAIRS</h3>
          {['EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CHF'].map(pair => (
            <div 
              key={pair}
              onClick={() => setSelectedPair(pair)}
              style={{
                padding: '10px',
                cursor: 'pointer',
                borderRadius: '4px',
                marginBottom: '5px',
                background: selectedPair === pair ? '#2a2a2a' : 'transparent',
                transition: 'background 0.2s'
              }}
            >
              {pair}
            </div>
          ))}
          
          <h3 style={{ margin: '30px 0 20px 0', fontSize: '14px', color: '#888' }}>INDICATORS</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <input 
              type="checkbox" 
              checked={showIndicators}
              onChange={(e) => setShowIndicators(e.target.checked)}
            />
            Moving Averages
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <input type="checkbox" />
            RSI
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input type="checkbox" />
            MACD
          </label>
        </div>

        {/* Center Chart Area */}
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
            <div style={{ display: 'flex', gap: '10px' }}>
              {chartVersion === 'v1' ? (
                // V1: Traditional timeframe buttons
                ['15m', '1h', '4h', '12h'].map(tf => (
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
                    {tf.toUpperCase()}
                  </button>
                ))
              ) : (
                // V2: Detail level display (read-only)
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
                    {v2DetailLevel.toUpperCase()}
                  </span>
                  <span style={{ fontSize: '11px', color: '#666' }}>
                    Zoom to change detail level
                  </span>
                </div>
              )}
            </div>
            
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '10px' }}>
              <select 
                value={chartType}
                onChange={(e) => setChartType(e.target.value)}
                style={{
                  background: '#2a2a2a',
                  border: '1px solid #444',
                  color: '#fff',
                  padding: '5px 10px',
                  borderRadius: '3px',
                  fontSize: '13px'
                }}
              >
                <option value="candlestick">Candlestick</option>
                <option value="line">Line</option>
                <option value="bar">Bar</option>
              </select>
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

          <button style={{
            width: '100%',
            background: '#4a9eff',
            border: 'none',
            color: '#fff',
            padding: '12px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            marginTop: '30px'
          }}>
            New Order
          </button>
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
        <span>Connected to: Demo Server</span>
        <span style={{ marginLeft: 'auto' }}>Last Update: {new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  );
}

export default App;