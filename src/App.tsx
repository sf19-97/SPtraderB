// src/App.tsx
import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MatrixLogin } from './components/MatrixLogin';
import { AppLayout } from './layouts/AppLayout';
import { getHTTPDataProvider, chartDataCoordinator } from 'sptrader-chart-lib';
import './App.css';

// Initialize chart library synchronously at module load time
// This MUST happen before any components that use the chart library are loaded
const apiUrl = import.meta.env.VITE_MARKET_DATA_API_URL || 'https://ws-market-data-server.fly.dev';

// Initialize the HTTP data provider immediately
getHTTPDataProvider({
  baseUrl: apiUrl,
  timeout: 60000  // 60s to handle Fly.io cold starts
});
chartDataCoordinator.enableHTTP(true);

console.log('[App] Chart library initialized synchronously with:', apiUrl);

// NOW we can safely lazy load pages that depend on the chart library
const TradingPage = lazy(() => import('./pages/TradingPage').then(m => ({ default: m.TradingPage })));
const BuildPage = lazy(() => import('./pages/BuildPage').then(m => ({ default: m.BuildPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const OrdersPage = lazy(() => import('./pages/OrdersPage').then(m => ({ default: m.OrdersPage })));
const MonacoIDE = lazy(() => import('./components/MonacoIDE').then(m => ({ default: m.MonacoIDE })));
const OrchestratorPage = lazy(() => import('./pages/OrchestratorPage').then(m => ({ default: m.OrchestratorPage })));
const MarketDataPage = lazy(() => import('./pages/MarketDataPage').then(m => ({ default: m.MarketDataPage })));
const MarketChartPage = lazy(() => import('./pages/MarketChartPage').then(m => ({ default: m.MarketChartPage })));

function App() {
  const [showMatrix, setShowMatrix] = useState(true);
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    // Preload critical components while Matrix is showing
    const preloadComponents = async () => {
      try {
        // Start loading the most likely first page
        await import('./pages/MarketChartPage');

        // Preload other critical components in parallel
        await Promise.all([
          import('./pages/TradingPage'),
          import('./layouts/AppLayout'),
        ]);

        setAppReady(true);
      } catch (error) {
        console.error('Failed to preload components:', error);
        setAppReady(true); // Continue anyway
      }
    };

    // Start preloading immediately
    preloadComponents();

    // Optional: Initialize any other data connections or APIs here
    // This would be a good place to establish WebSocket connections,
    // fetch initial configuration, or warm up API caches

    // Example (uncomment if you have these services):
    // initializeWebSocketConnection();
    // prefetchMarketData();
    // loadUserPreferences();
  }, []);

  const handleMatrixComplete = () => {
    // Small delay to ensure smooth transition
    setTimeout(() => {
      setShowMatrix(false);
    }, 300);
  };

  return (
    <BrowserRouter>
      {/* Matrix Login Overlay - renders on top but doesn't block app initialization */}
      {showMatrix && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 9999,
            backgroundColor: '#000',
          }}
        >
          <MatrixLogin onComplete={handleMatrixComplete} />
        </div>
      )}

      {/* Main App - renders in background, hidden while Matrix is shown */}
      <div
        style={{
          opacity: showMatrix ? 0 : 1,
          visibility: showMatrix ? 'hidden' : 'visible',
          transition: 'opacity 0.5s ease-in-out',
          height: '100%',
        }}
      >
        <Suspense
          fallback={
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100vh',
              backgroundColor: '#0a0a0a',
              color: '#00ff41',
              fontFamily: 'monospace',
            }}>
              {appReady ? 'Loading...' : 'Initializing systems...'}
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<AppLayout />}>
              <Route index element={<Navigate to="/market-chart" />} />
              <Route path="trading" element={<TradingPage />} />
              <Route path="build" element={<BuildPage />} />
              <Route path="history" element={<OrdersPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="orchestrator" element={<OrchestratorPage />} />
              <Route path="market-data" element={<MarketDataPage />} />
              <Route path="market-chart" element={<MarketChartPage />} />
            </Route>

            {/* IDE route outside AppLayout for full screen */}
            <Route path="/ide" element={<MonacoIDE />} />
          </Routes>
        </Suspense>
      </div>
    </BrowserRouter>
  );
}

export default App;
