import { Select } from '@mantine/core';
import { useTradingStore } from '../stores/useTradingStore';
import { useEffect, useMemo } from 'react';

export const PairSelector = () => {
  const { selectedPair, setPair, catalog, fetchCatalog } = useTradingStore();

  // Fetch catalog on mount (uses cache if available)
  useEffect(() => {
    fetchCatalog();
  }, [fetchCatalog]);

  // Format symbols for Select component (memoized)
  const symbols = useMemo(() => {
    return catalog.symbols
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .map((s) => ({
        value: s.symbol,
        label: s.symbol.replace(/([A-Z]{3})([A-Z]{3})/, '$1/$2'), // EURUSD -> EUR/USD
      }));
  }, [catalog.symbols]);

  const handlePairChange = (value: string | null) => {
    if (value) {
      setPair(value);
    }
  };

  return (
    <Select
      value={selectedPair}
      onChange={handlePairChange}
      data={symbols}
      searchable
      placeholder={catalog.loading ? "Loading..." : symbols.length === 0 ? "No symbols available" : "Select pair"}
      nothingFoundMessage="No matching symbols"
      disabled={catalog.loading}
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
