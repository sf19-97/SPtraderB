import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { DatesProvider } from '@mantine/dates';
import App from './App';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import 'dayjs/locale/en';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <MantineProvider defaultColorScheme="dark">
    <DatesProvider settings={{ locale: 'en' }}>
      <App />
    </DatesProvider>
  </MantineProvider>
);
