// src/App.tsx
import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MatrixLogin } from './components/MatrixLogin';
import { AppLayout } from './layouts/AppLayout';
import { TradingPage } from './pages/TradingPage';
import { BacktestPage } from './pages/BacktestPage';
import { DataIngestionPage } from './pages/DataIngestionPage';
import { BuildPage } from './pages/BuildPage';
import { SettingsPage } from './pages/SettingsPage';
import { OrdersPage } from './pages/OrdersPage';
import { MonacoIDE } from './components/MonacoIDE';
import { OrchestratorTestPage } from './pages/OrchestratorTestPage';
import { OrchestratorPage } from './pages/OrchestratorPage';
import BitcoinTest from './pages/BitcoinTest';
import './App.css';

function App() {
  const [showMatrix, setShowMatrix] = useState(true);

  if (showMatrix) {
    return <MatrixLogin onComplete={() => setShowMatrix(false)} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Navigate to="/trading" />} />
          <Route path="trading" element={<TradingPage />} />
          <Route path="backtest" element={<BacktestPage />} />
          <Route path="data" element={<DataIngestionPage />} />
          <Route path="build" element={<BuildPage />} />
          <Route path="history" element={<OrdersPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="orchestrator-test" element={<OrchestratorTestPage />} />
          <Route path="orchestrator" element={<OrchestratorPage />} />
          <Route path="bitcoin-test" element={<BitcoinTest />} />
        </Route>
        
        {/* IDE route outside AppLayout for full screen */}
        <Route path="/ide" element={<MonacoIDE />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;