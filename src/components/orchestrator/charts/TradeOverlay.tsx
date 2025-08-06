import { useEffect, useRef } from 'react';

interface Trade {
  id: string;
  symbol: string;
  entryTime: string;
  exitTime?: string;
  entryPrice: number;
  exitPrice?: number;
  size: number;
  side: 'long' | 'short';
  pnl?: number;
  pnlPercent?: number;
  stopLoss?: number;
  takeProfit?: number;
}

interface TradeOverlayProps {
  trades: Trade[];
  times: string[];
  prices: {
    high: number[];
    low: number[];
  };
  dimensions: {
    width: number;
    height: number;
    padding: {
      left: number;
      right: number;
      top: number;
      bottom: number;
    };
  };
  priceScale: {
    min: number;
    max: number;
  };
  currentPrice?: number;
  isFullscreen?: boolean;
}

export const TradeOverlay = ({
  trades,
  times,
  prices,
  dimensions,
  priceScale,
  currentPrice,
  isFullscreen = false,
}: TradeOverlayProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || trades.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    // Clear canvas (transparent)
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate chart area
    const chartWidth = dimensions.width - dimensions.padding.left - dimensions.padding.right;
    const chartHeight = dimensions.height - dimensions.padding.top - dimensions.padding.bottom;

    // Scale functions
    const xScale = (time: string) => {
      const index = times.indexOf(time);
      if (index === -1) return -1;
      return dimensions.padding.left + (index / (times.length - 1)) * chartWidth;
    };

    const yScale = (price: number) => {
      const range = priceScale.max - priceScale.min;
      const normalized = (price - priceScale.min) / range;
      return dimensions.padding.top + (1 - normalized) * chartHeight;
    };

    // Draw trades
    trades.forEach((trade) => {
      const entryX = xScale(trade.entryTime);
      if (entryX === -1) return;

      const entryY = yScale(trade.entryPrice);
      const isLong = trade.side === 'long';

      // Draw entry marker
      ctx.save();

      // Entry arrow
      ctx.fillStyle = isLong ? '#00ff88' : '#ff4976';
      ctx.strokeStyle = isLong ? '#00ff88' : '#ff4976';
      ctx.lineWidth = 2;

      // Draw arrow pointing up for long, down for short
      const arrowSize = 8;
      ctx.beginPath();
      if (isLong) {
        // Up arrow
        ctx.moveTo(entryX, entryY - arrowSize);
        ctx.lineTo(entryX - arrowSize / 2, entryY);
        ctx.lineTo(entryX + arrowSize / 2, entryY);
      } else {
        // Down arrow
        ctx.moveTo(entryX, entryY + arrowSize);
        ctx.lineTo(entryX - arrowSize / 2, entryY);
        ctx.lineTo(entryX + arrowSize / 2, entryY);
      }
      ctx.closePath();
      ctx.fill();

      // Draw entry line
      ctx.strokeStyle = isLong ? 'rgba(0, 255, 136, 0.5)' : 'rgba(255, 73, 118, 0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(entryX, dimensions.padding.top);
      ctx.lineTo(entryX, dimensions.height - dimensions.padding.bottom);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw stop loss and take profit lines if position is open
      if (!trade.exitTime && trade.stopLoss && trade.takeProfit) {
        // Stop loss line
        const slY = yScale(trade.stopLoss);
        ctx.strokeStyle = 'rgba(255, 73, 118, 0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(entryX, slY);
        ctx.lineTo(dimensions.width - dimensions.padding.right, slY);
        ctx.stroke();

        // Take profit line
        const tpY = yScale(trade.takeProfit);
        ctx.strokeStyle = 'rgba(0, 255, 136, 0.7)';
        ctx.beginPath();
        ctx.moveTo(entryX, tpY);
        ctx.lineTo(dimensions.width - dimensions.padding.right, tpY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Labels for SL and TP
        if (isFullscreen) {
          ctx.font = '10px monospace';
          ctx.fillStyle = '#ff4976';
          ctx.textAlign = 'left';
          ctx.fillText(
            `SL: ${trade.stopLoss.toFixed(5)}`,
            dimensions.width - dimensions.padding.right + 5,
            slY + 3
          );

          ctx.fillStyle = '#00ff88';
          ctx.fillText(
            `TP: ${trade.takeProfit.toFixed(5)}`,
            dimensions.width - dimensions.padding.right + 5,
            tpY + 3
          );
        }
      }

      // Draw exit if trade is closed
      if (trade.exitTime && trade.exitPrice) {
        const exitX = xScale(trade.exitTime);
        if (exitX !== -1) {
          const exitY = yScale(trade.exitPrice);

          // Draw exit marker (X)
          ctx.strokeStyle = trade.pnl && trade.pnl >= 0 ? '#00ff88' : '#ff4976';
          ctx.lineWidth = 2;
          const xSize = 6;
          ctx.beginPath();
          ctx.moveTo(exitX - xSize, exitY - xSize);
          ctx.lineTo(exitX + xSize, exitY + xSize);
          ctx.moveTo(exitX - xSize, exitY + xSize);
          ctx.lineTo(exitX + xSize, exitY - xSize);
          ctx.stroke();

          // Draw connecting line between entry and exit
          ctx.strokeStyle =
            trade.pnl && trade.pnl >= 0 ? 'rgba(0, 255, 136, 0.3)' : 'rgba(255, 73, 118, 0.3)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(entryX, entryY);
          ctx.lineTo(exitX, exitY);
          ctx.stroke();

          // Draw P&L label
          if (trade.pnl !== undefined && (isFullscreen || Math.abs(exitX - entryX) > 50)) {
            const midX = (entryX + exitX) / 2;
            const midY = (entryY + exitY) / 2;

            // Background for label
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            const text = `${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}`;
            ctx.font = 'bold 11px monospace';
            const metrics = ctx.measureText(text);
            const padding = 4;
            ctx.fillRect(
              midX - metrics.width / 2 - padding,
              midY - 10 - padding,
              metrics.width + padding * 2,
              16 + padding
            );

            // P&L text
            ctx.fillStyle = trade.pnl >= 0 ? '#00ff88' : '#ff4976';
            ctx.textAlign = 'center';
            ctx.fillText(text, midX, midY);
          }
        }
      }

      ctx.restore();
    });

    // Draw trade summary in corner if in fullscreen
    if (isFullscreen && trades.length > 0) {
      const closedTrades = trades.filter((t) => t.pnl !== undefined);
      const winningTrades = closedTrades.filter((t) => t.pnl! >= 0);
      const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

      ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.fillRect(10, 10, 150, 80);

      ctx.strokeStyle = '#444';
      ctx.lineWidth = 1;
      ctx.strokeRect(10, 10, 150, 80);

      ctx.fillStyle = '#ccc';
      ctx.font = '12px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('Trade Summary', 20, 30);

      ctx.font = '10px monospace';
      ctx.fillStyle = '#888';
      ctx.fillText(`Total: ${closedTrades.length}`, 20, 50);
      ctx.fillText(
        `Win Rate: ${closedTrades.length > 0 ? ((winningTrades.length / closedTrades.length) * 100).toFixed(0) : 0}%`,
        20,
        65
      );

      ctx.fillStyle = totalPnl >= 0 ? '#00ff88' : '#ff4976';
      ctx.fillText(`P&L: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`, 20, 80);
    }
  }, [trades, times, prices, dimensions, priceScale, currentPrice, isFullscreen]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: dimensions.width,
        height: dimensions.height,
        pointerEvents: 'none',
      }}
    />
  );
};
