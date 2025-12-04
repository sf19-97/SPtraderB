import { useEffect, useRef, useState } from 'react';
import { Box, Text, Group, SegmentedControl, Paper } from '@mantine/core';
import { PreviewChart } from '../PreviewChart';
import { InteractiveTradeOverlay } from './charts/InteractiveTradeOverlay';
import { useOrchestratorStore } from '../../stores/useOrchestratorStore';

interface Trade {
  id: string;
  symbol: string;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  size: number;
  side: 'long' | 'short';
  pnl: number;
  pnlPercent: number;
}

interface Position {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  size: number;
}

interface EquityCurve {
  timestamps: string[];
  values: number[];
}

interface OrchestratorChartProps {
  // Base chart data
  data?: {
    time: string[];
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    indicators?: {
      [key: string]: (number | null)[];
    };
    signals?: {
      crossovers: number[];
      types: string[];
    };
  };

  // Orchestrator-specific data
  trades?: Trade[];
  positions?: Position[];
  equityCurve?: EquityCurve;

  // Display options
  chartMode?: 'candles' | 'equity';
  showTrades?: boolean;
  showPositions?: boolean;

  // Layout
  height?: number;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  showModeToggle?: boolean;
}

export const OrchestratorChart = ({
  data,
  trades = [],
  positions = [],
  equityCurve,
  chartMode = 'candles',
  showTrades = true,
  showPositions: _showPositions = true,
  height = 400,
  isFullscreen = false,
  onToggleFullscreen,
  showModeToggle = true,
}: OrchestratorChartProps) => {
  const _canvasRef = useRef<HTMLCanvasElement>(null);
  const [_hoveredTrade, _setHoveredTrade] = useState<Trade | null>(null);
  const [_mousePos, _setMousePos] = useState({ x: 0, y: 0 });
  const { highlightedTradeId: _highlightedTradeId } = useOrchestratorStore();

  // For equity curve mode, transform the data
  const _chartData =
    chartMode === 'equity' && equityCurve
      ? {
          time: equityCurve.timestamps,
          open: equityCurve.values,
          high: equityCurve.values,
          low: equityCurve.values,
          close: equityCurve.values,
        }
      : data;

  // State for tracking dimensions and price scale
  const [dimensions, setDimensions] = useState({
    width: 0,
    height,
    padding: {
      left: isFullscreen ? 10 : 20,
      right: isFullscreen ? 70 : 20,
      top: 20,
      bottom: isFullscreen ? 50 : 20,
    },
  });

  const [priceScale, setPriceScale] = useState({ min: 0, max: 0 });

  // Calculate price scale from data
  useEffect(() => {
    if (data && chartMode === 'candles') {
      let minPrice = Infinity;
      let maxPrice = -Infinity;

      for (let i = 0; i < data.close.length; i++) {
        minPrice = Math.min(minPrice, data.low[i]);
        maxPrice = Math.max(maxPrice, data.high[i]);
      }

      const priceRange = maxPrice - minPrice;
      setPriceScale({
        min: minPrice - priceRange * 0.1,
        max: maxPrice + priceRange * 0.1,
      });
    }
  }, [data, chartMode]);

  // Track container dimensions
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        setDimensions((prev) => ({ ...prev, width }));
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // If in candles mode with trades, use PreviewChart as base
  if (chartMode === 'candles' && data) {
    return (
      <Paper p="md" withBorder>
        {/* Mode selector (optional) */}
        {showModeToggle && (
          <Group justify="space-between" mb="sm">
            <SegmentedControl
              value={chartMode}
              onChange={(_value) => {
                /* Handle mode change */
              }}
              data={[
                { label: 'Price Chart', value: 'candles' },
                { label: 'Equity Curve', value: 'equity' },
              ]}
              w={200}
            />

            <Group gap="xs">
              <Text size="xs" c="dimmed">
                {trades.length} trades
              </Text>
              {positions.length > 0 && (
                <Text size="xs" c="dimmed">
                  {positions.length} open positions
                </Text>
              )}
            </Group>
          </Group>
        )}

        {/* Use PreviewChart as base and overlay trades */}
        <Box ref={containerRef} style={{ position: 'relative' }}>
          <PreviewChart
            data={data}
            height={height}
            isFullscreen={isFullscreen}
            onToggleFullscreen={onToggleFullscreen}
          />

          {/* Trade overlay */}
          {showTrades && trades.length > 0 && dimensions.width > 0 && (
            <InteractiveTradeOverlay
              trades={trades}
              times={data.time}
              prices={{ high: data.high, low: data.low }}
              dimensions={dimensions}
              priceScale={priceScale}
              isFullscreen={isFullscreen}
            />
          )}
        </Box>
      </Paper>
    );
  }

  // For equity curve mode, render custom chart
  if (chartMode === 'equity' && equityCurve) {
    return (
      <Paper p="md" withBorder>
        {showModeToggle && (
          <Group justify="space-between" mb="sm">
            <SegmentedControl
              value={chartMode}
              onChange={(_value) => {
                /* Handle mode change */
              }}
              data={[
                { label: 'Price Chart', value: 'candles' },
                { label: 'Equity Curve', value: 'equity' },
              ]}
              w={200}
            />

            <Text size="sm" fw={500}>
              Portfolio Value Over Time
            </Text>
          </Group>
        )}

        <EquityChart data={equityCurve} height={height} trades={trades} showTrades={showTrades} />
      </Paper>
    );
  }

  // No data state
  return (
    <Box
      style={{
        height,
        background: '#0a0a0a',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text size="sm" c="#666">
        No chart data available
      </Text>
    </Box>
  );
};

// Separate component for equity curve rendering
const EquityChart = ({
  data,
  height,
  trades = [],
  showTrades = true,
}: {
  data: EquityCurve;
  height: number;
  trades: Trade[];
  showTrades: boolean;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height });
  const lastDrawKey = useRef<string | null>(null);

  useEffect(() => {
    const updateDimensions = () => {
      if (canvasRef.current?.parentElement) {
        const width = canvasRef.current.parentElement.clientWidth;
        if (width > 0) {
          setDimensions({ width, height });
        }
      }
    };

    // Run once after mount and whenever equity data changes
    const raf = requestAnimationFrame(updateDimensions);

    // Listen for container resizes
    let observer: ResizeObserver | null = null;
    if (canvasRef.current?.parentElement) {
      observer = new ResizeObserver(updateDimensions);
      observer.observe(canvasRef.current.parentElement);
    }

    window.addEventListener('resize', updateDimensions);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateDimensions);
      if (observer && canvasRef.current?.parentElement) {
        observer.unobserve(canvasRef.current.parentElement);
      }
    };
  }, [height, data.timestamps, data.values]);

  useEffect(() => {
    if (!canvasRef.current || !data || dimensions.width === 0 || dimensions.height === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const drawKey = `${dimensions.width}x${dimensions.height}-${data.timestamps.length}-${data.values.length}-${data.values[0]}-${data.values[data.values.length - 1]}`;
    if (lastDrawKey.current === drawKey) {
      return;
    }
    lastDrawKey.current = drawKey;

    // Set canvas size
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    // Clear canvas
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate scale
    const padding = { left: 50, right: 50, top: 20, bottom: 30 };
    const chartWidth = canvas.width - padding.left - padding.right;
    const chartHeight = canvas.height - padding.top - padding.bottom;

    const minValue = Math.min(...data.values);
    const maxValue = Math.max(...data.values);
    const rawRange = maxValue - minValue;
    const valueRange = rawRange === 0 ? Math.abs(maxValue || 1) * 0.01 || 1 : rawRange;
    const valuePadding = valueRange * 0.1;

    const xScale = (i: number) =>
      data.values.length > 1
        ? padding.left + (i / (data.values.length - 1)) * chartWidth
        : padding.left;
    const yScale = (value: number) => {
      const normalized = (value - (minValue - valuePadding)) / (valueRange + 2 * valuePadding);
      return padding.top + (1 - normalized) * chartHeight;
    };

    // Draw grid lines
    ctx.strokeStyle = '#1a2a3a';
    ctx.lineWidth = 0.5;

    // Horizontal grid lines and value labels
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (i / 4) * chartHeight;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(canvas.width - padding.right, y);
      ctx.stroke();

      // Value labels
      const value = minValue - valuePadding + (1 - i / 4) * (valueRange + 2 * valuePadding);
      ctx.fillStyle = '#888';
      ctx.font = '11px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`$${value.toFixed(0)}`, padding.left - 10, y + 4);
    }

    // Draw equity curve
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let i = 0; i < data.values.length; i++) {
      const x = xScale(i);
      const y = yScale(data.values[i]);

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Fill area under curve
    ctx.fillStyle = 'rgba(74, 158, 255, 0.1)';
    ctx.beginPath();
    ctx.moveTo(xScale(0), yScale(data.values[0]));

    for (let i = 0; i < data.values.length; i++) {
      ctx.lineTo(xScale(i), yScale(data.values[i]));
    }

    ctx.lineTo(xScale(data.values.length - 1), canvas.height - padding.bottom);
    ctx.lineTo(xScale(0), canvas.height - padding.bottom);
    ctx.closePath();
    ctx.fill();

    // Draw trade markers if enabled
    if (showTrades && trades.length > 0) {
      trades.forEach((trade) => {
        // Find the index for entry and exit times
        const entryIdx = data.timestamps.findIndex((t) => t >= trade.entryTime);
        const exitIdx = data.timestamps.findIndex((t) => t >= trade.exitTime);

        if (entryIdx >= 0 && exitIdx >= 0) {
          const entryX = xScale(entryIdx);
          const exitX = xScale(exitIdx);
          const entryY = yScale(data.values[entryIdx]);
          const exitY = yScale(data.values[exitIdx]);

          // Draw trade line
          ctx.strokeStyle = trade.pnl >= 0 ? '#00ff88' : '#ff4976';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(entryX, entryY);
          ctx.lineTo(exitX, exitY);
          ctx.stroke();
          ctx.setLineDash([]);

          // Draw entry/exit markers
          ctx.fillStyle = trade.pnl >= 0 ? '#00ff88' : '#ff4976';

          // Entry marker (circle)
          ctx.beginPath();
          ctx.arc(entryX, entryY, 4, 0, 2 * Math.PI);
          ctx.fill();

          // Exit marker (square)
          ctx.fillRect(exitX - 4, exitY - 4, 8, 8);
        }
      });
    }

    // Draw starting capital line
    const startingValue = data.values[0];
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(padding.left, yScale(startingValue));
    ctx.lineTo(canvas.width - padding.right, yScale(startingValue));
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Starting Capital', canvas.width - padding.right - 100, yScale(startingValue) - 5);
  }, [data, dimensions, trades, showTrades]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height,
        borderRadius: '4px',
        background: '#0a0a0a',
      }}
    />
  );
};
