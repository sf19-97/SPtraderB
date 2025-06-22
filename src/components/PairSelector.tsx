import { Select } from '@mantine/core';
import { useTradingStore } from '../stores/useTradingStore';

export const PairSelector = () => {
  const { selectedPair, setPair } = useTradingStore();

  console.log('[PairSelector] Current selectedPair:', selectedPair);

  const handlePairChange = (value: string | null) => {
    console.log('[PairSelector] onChange triggered with value:', value);
    if (value) {
      console.log('[PairSelector] Calling setPair with:', value);
      setPair(value);
    }
  };

  return (
    <Select
      value={selectedPair}
      onChange={handlePairChange}
      data={[
        { value: 'EURUSD', label: 'EUR/USD' },
        { value: 'USDJPY', label: 'USD/JPY' },
        { value: 'GBPUSD', label: 'GBP/USD' },
        { value: 'AUDUSD', label: 'AUD/USD' },
        { value: 'USDCHF', label: 'USD/CHF' }
      ]}
      searchable
      size="sm"
      styles={{
        input: {
          background: '#2a2a2a',
          border: '1px solid #444',
          fontSize: '14px',
          fontWeight: 600,
          color: 'white',
          height: '32px',
        },
        dropdown: {
          background: '#1a1a1a',
          border: '1px solid #444',
        },
      }}
    />
  );
};