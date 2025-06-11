// src/App.tsx
import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MatrixLogin } from './components/MatrixLogin';
import { AppLayout } from './layouts/AppLayout';
import { TradingPage } from './pages/TradingPage';
import { BacktestPage } from './pages/BacktestPage';
import { TradingProvider } from './contexts/TradingContext';
import './App.css';

function App() {
  const [showMatrix, setShowMatrix] = useState(true);

  if (showMatrix) {
    return <MatrixLogin onComplete={() => setShowMatrix(false)} />;
  }

  return (
    <TradingProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Navigate to="/trading" />} />
            <Route path="trading" element={<TradingPage />} />
            <Route path="backtest" element={<BacktestPage />} />
            <Route path="screener" element={<div style={{ color: 'white', padding: '80px' }}>Screener Page (Coming Soon)</div>} />
            <Route path="history" element={<div style={{ color: 'white', padding: '80px' }}>History Page (Coming Soon)</div>} />
            <Route path="settings" element={<div style={{ color: 'white', padding: '80px' }}>Settings Page (Coming Soon)</div>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TradingProvider>
  );
}

export default App;