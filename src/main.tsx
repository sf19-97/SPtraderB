import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { Notifications } from '@mantine/notifications';
import { getHTTPDataProvider, chartDataCoordinator } from 'sptrader-chart-lib';
import App from './App';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import 'dayjs/locale/en';

// Configure the chart library to use your ws-market-data-server
const apiUrl = import.meta.env.VITE_MARKET_DATA_API_URL || 'https://ws-market-data-server.fly.dev';

getHTTPDataProvider({
  baseUrl: apiUrl,
  timeout: 30000
});
chartDataCoordinator.enableHTTP(true);

console.log('[Chart Library] Configured to use HTTP data from:', apiUrl);

// Disable chart library logging
declare global {
  interface Window {
    __CHART_LOG_LEVEL__?: string;
  }
}
window.__CHART_LOG_LEVEL__ = 'ERROR'; // Only show errors, suppress INFO/WARN/DEBUG logs

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <MantineProvider defaultColorScheme="dark">
      <Notifications position="top-right" zIndex={10000} />
      <DatesProvider settings={{ locale: 'en' }}>
        <App />
      </DatesProvider>
    </MantineProvider>
);
