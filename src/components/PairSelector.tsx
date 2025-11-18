import { Select } from '@mantine/core';
import { useTradingStore } from '../stores/useTradingStore';
import { useState, useEffect } from 'react';

interface CatalogSymbol {
  symbol: string;
  earliest: number;
  latest: number;
  tick_count: number;
}

export const PairSelector = () => {
  const { selectedPair, setPair } = useTradingStore();
  const [isLoading, setIsLoading] = useState(true);
  const [symbols, setSymbols] = useState<{ value: string; label: string }[]>([]);

  useEffect(() => {
    const loadSymbols = async () => {
      try {
        setIsLoading(true);
        const marketDataUrl = import.meta.env.VITE_MARKET_DATA_API_URL || 'https://ws-market-data-server.fly.dev';
        const response = await fetch(`${marketDataUrl}/api/metadata`);

        if (!response.ok) {
          console.error('[PairSelector] Failed to fetch catalog:', response.status);
          setSymbols([]);
          return;
        }

        const catalog = await response.json();
        console.log('[PairSelector] Fetched catalog:', catalog);

        if (!catalog.symbols || !Array.isArray(catalog.symbols)) {
          console.error('[PairSelector] Invalid catalog response:', catalog);
          setSymbols([]);
          return;
        }

        // Sort alphabetically
        const sorted = catalog.symbols.sort((a: CatalogSymbol, b: CatalogSymbol) =>
          a.symbol.localeCompare(b.symbol)
        );

        // Format for Select component
        const items = sorted.map((s: CatalogSymbol) => ({
          value: s.symbol,
          label: s.symbol.replace(/([A-Z]{3})([A-Z]{3})/, '$1/$2'), // EURUSD -> EUR/USD
        }));

        setSymbols(items);
      } catch (error) {
        console.error('[PairSelector] Error loading symbols:', error);
        setSymbols([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadSymbols();
  }, []);

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
      placeholder={symbols.length === 0 ? "No symbols available" : "Select pair"}
      nothingFoundMessage="No matching symbols"
      disabled={isLoading}
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
