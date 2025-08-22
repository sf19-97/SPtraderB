import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import App from './App';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import 'dayjs/locale/en';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Failed to find root element');
}

ReactDOM.createRoot(rootElement).render(
  <MantineProvider defaultColorScheme="dark">
    <DatesProvider settings={{ locale: 'en' }}>
      <App />
    </DatesProvider>
  </MantineProvider>
);
