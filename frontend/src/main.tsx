import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import { Notifications } from '@mantine/notifications';
import App from './App';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import 'dayjs/locale/en';

// Disable chart library logging
declare global {
  interface Window {
    __CHART_LOG_LEVEL__?: string;
  }
}
window.__CHART_LOG_LEVEL__ = 'DEBUG'; // Enable debug logging

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <MantineProvider defaultColorScheme="dark">
      <Notifications position="top-right" zIndex={10000} />
      <DatesProvider settings={{ locale: 'en' }}>
        <App />
      </DatesProvider>
    </MantineProvider>
);
