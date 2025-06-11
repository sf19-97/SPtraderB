import { Select } from '@mantine/core';
import { useTrading } from '../contexts/TradingContext';

export const PairSelector = () => {
  const { selectedPair, setPair } = useTrading();

  return (
    <Select
      value={selectedPair}
      onChange={(value) => value && setPair(value)}
      data={[
        { value: 'EURUSD', label: 'EUR/USD' },
        { value: 'GBPUSD', label: 'GBP/USD' },
        { value: 'USDJPY', label: 'USD/JPY' },
        { value: 'AUDUSD', label: 'AUD/USD' },
        { value: 'USDCHF', label: 'USD/CHF' }
      ]}
      searchable
      styles={{
        input: {
          background: '#1a1a1a',
          border: '1px solid #333',
          fontSize: '16px',
          fontWeight: 600,
        },
      }}
    />
  );
};