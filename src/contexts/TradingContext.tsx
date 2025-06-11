import { createContext, useContext, useState, ReactNode } from 'react';

interface TradingContextType {
  // Chart settings
  selectedPair: string;
  selectedTimeframe: string;
  chartType: 'candlestick' | 'line' | 'bar';
  chartVersion: 'v1' | 'v2';
  
  // Indicators
  indicators: {
    ma: boolean;
    rsi: boolean;
    macd: boolean;
    volume: boolean;
  };
  
  // Actions
  setPair: (pair: string) => void;
  setTimeframe: (tf: string) => void;
  setChartType: (type: 'candlestick' | 'line' | 'bar') => void;
  setChartVersion: (version: 'v1' | 'v2') => void;
  toggleIndicator: (indicator: keyof TradingContextType['indicators']) => void;
}

const TradingContext = createContext<TradingContextType | undefined>(undefined);

export const TradingProvider = ({ children }: { children: ReactNode }) => {
  const [selectedPair, setSelectedPair] = useState('EURUSD');
  const [selectedTimeframe, setSelectedTimeframe] = useState('1h');
  const [chartType, setChartType] = useState<'candlestick' | 'line' | 'bar'>('candlestick');
  const [chartVersion, setChartVersion] = useState<'v1' | 'v2'>('v1');
  const [indicators, setIndicators] = useState({
    ma: false,
    rsi: false,
    macd: false,
    volume: false,
  });

  const toggleIndicator = (indicator: keyof typeof indicators) => {
    setIndicators(prev => ({ ...prev, [indicator]: !prev[indicator] }));
  };

  return (
    <TradingContext.Provider value={{
      selectedPair,
      selectedTimeframe,
      chartType,
      chartVersion,
      indicators,
      setPair: setSelectedPair,
      setTimeframe: setSelectedTimeframe,
      setChartType,
      setChartVersion,
      toggleIndicator,
    }}>
      {children}
    </TradingContext.Provider>
  );
};

export const useTrading = () => {
  const context = useContext(TradingContext);
  if (!context) throw new Error('useTrading must be used within TradingProvider');
  return context;
};