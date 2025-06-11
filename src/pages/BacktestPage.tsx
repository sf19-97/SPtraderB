// src/pages/BacktestPage.tsx
import { Container, Title, Button, Paper } from '@mantine/core';
import { useNavigate } from 'react-router-dom';

export const BacktestPage = () => {
  const navigate = useNavigate();

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#0a0a0a',
      padding: '20px'
    }}>
      <Container size="xl">
        {/* Temporary navigation */}
        <Button 
          onClick={() => navigate('/trading')}
          variant="subtle"
          mb="xl"
        >
          ← Back to Trading
        </Button>

        <Title order={1} c="white" mb="xl">
          Strategy Backtester
        </Title>

        <Paper p="xl" withBorder style={{ background: '#1a1a1a' }}>
          <Title order={3} c="white">
            Backtest page is ready! 🎉
          </Title>
        </Paper>
      </Container>
    </div>
  );
};