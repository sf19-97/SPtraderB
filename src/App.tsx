// src/App.tsx
import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MatrixLogin } from './components/MatrixLogin';
import { AppLayout } from './layouts/AppLayout';
import { TradingPage } from './pages/TradingPage';
import { BacktestPage } from './pages/BacktestPage';
import { TradingProvider } from './contexts/TradingContext';
import { BuildProvider } from './contexts/BuildContext';
import { DataIngestionPage } from './pages/DataIngestionPage';
import { BuildPage } from './pages/BuildPage';
import { MonacoIDE } from './components/MonacoIDE';
import './App.css';

function App() {
  const [showMatrix, setShowMatrix] = useState(true);

  if (showMatrix) {
    return <MatrixLogin onComplete={() => setShowMatrix(false)} />;
  }

  return (
    <TradingProvider>
      <BuildProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<AppLayout />}>
              <Route index element={<Navigate to="/trading" />} />
              <Route path="trading" element={<TradingPage />} />
              <Route path="backtest" element={<BacktestPage />} />
              <Route path="data" element={<DataIngestionPage />} />
              <Route path="build" element={<BuildPage />} />
              <Route path="history" element={<div style={{ color: 'white', padding: '80px' }}>History Page (Coming Soon)</div>} />
              <Route path="settings" element={<div style={{ color: 'white', padding: '80px' }}>Settings Page (Coming Soon)</div>} />
            </Route>
            
            {/* IDE route outside AppLayout for full screen */}
            <Route path="/ide" element={<MonacoIDE />} />
          </Routes>
        </BrowserRouter>
      </BuildProvider>
    </TradingProvider>
  );
}

export default App;