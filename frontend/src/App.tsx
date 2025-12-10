// src/App.tsx
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { useAuthStore } from './stores/useAuthStore';
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

// Loading fallback
function LoadingFallback() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      backgroundColor: '#0a0a0a',
      color: '#00ff41',
      fontFamily: 'monospace',
    }}>
      Loading...
    </div>
  );
}

function App() {
  const { token, user, revalidateSession } = useAuthStore();
  const isAuthenticated = !!(token && user);

  useEffect(() => {
    revalidateSession();
  }, [revalidateSession]);

  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingFallback />}>
        <Routes>
          {/* Public routes */}
          <Route
            path="/login"
            element={isAuthenticated ? <Navigate to="/trading" replace /> : <LoginPage />}
          />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />

          {/* Protected routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/trading" />} />
            <Route path="trading" element={<TradingPage />} />
            <Route path="build" element={<BuildPage />} />
            <Route path="history" element={<OrdersPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="orchestrator" element={<OrchestratorPage />} />
            <Route path="market-data" element={<MarketDataPage />} />
          </Route>

          {/* IDE route outside AppLayout for full screen */}
          <Route
            path="/ide"
            element={
              <ProtectedRoute>
                <MonacoIDE />
              </ProtectedRoute>
            }
          />

          {/* Catch all - redirect to login or trading */}
          <Route
            path="*"
            element={<Navigate to={isAuthenticated ? '/trading' : '/login'} replace />}
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
