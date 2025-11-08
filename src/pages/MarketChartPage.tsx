// Wrapper to pass the timeframe prop from our store to prevent auto-switching issues
import { MarketChartPage as ChartPage } from 'sptrader-chart-lib';
import { useTradingStore } from '../stores/useTradingStore';

export const MarketChartPage = () => {
  const { selectedPair, selectedTimeframe } = useTradingStore();

  return (
    <ChartPage
      symbol={selectedPair}
      timeframe={selectedTimeframe}
      enableTimeframeAutoSwitch={true} // Re-enabled - initial load issues are fixed
    />
  );
};
