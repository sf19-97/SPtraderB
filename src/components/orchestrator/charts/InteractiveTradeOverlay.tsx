import { useEffect, useRef, useState } from 'react';
import { useOrchestratorStore } from '../../../stores/useOrchestratorStore';

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

interface InteractiveTradeOverlayProps {
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

interface TradeMarker {
  trade: Trade;
  x: number;
  y: number;
  type: 'entry' | 'exit';
}

export const InteractiveTradeOverlay = ({
  trades,
  times,
  prices,
  dimensions,
  priceScale,
  currentPrice,
  isFullscreen = false,
}: InteractiveTradeOverlayProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tradeMarkers, setTradeMarkers] = useState<TradeMarker[]>([]);
  const [hoveredTrade, setHoveredTrade] = useState<string | null>(null);
  const { navigateToTrade, highlightedTradeId } = useOrchestratorStore();

  // Normalize time format to match chart times (add milliseconds if missing)
  const normalizeTime = (time: string): string => {
    // If time already has milliseconds, return as-is
    if (time.includes('.')) return time;

    // If time ends with 'Z', insert '.000' before it
    if (time.endsWith('Z')) {
      return time.slice(0, -1) + '.000Z';
    }

    // Otherwise add '.000Z' at the end
    return time + '.000Z';
  };

  // Scale functions
  const xScale = (time: string) => {
    const normalizedTime = normalizeTime(time);
    const index = times.indexOf(normalizedTime);
    if (index === -1) return -1;
    return (
      dimensions.padding.left +
      (index / (times.length - 1)) *
        (dimensions.width - dimensions.padding.left - dimensions.padding.right)
    );
  };

  const yScale = (price: number) => {
    const range = priceScale.max - priceScale.min;
    const normalized = (price - priceScale.min) / range;
    return (
      dimensions.padding.top +
      (1 - normalized) * (dimensions.height - dimensions.padding.top - dimensions.padding.bottom)
    );
  };

  // Calculate trade marker positions
  useEffect(() => {
    const markers: TradeMarker[] = [];

    trades.forEach((trade) => {
      const entryX = xScale(trade.entryTime);
      if (entryX !== -1) {
        const entryY = yScale(trade.entryPrice);
        markers.push({
          trade,
          x: entryX,
          y: entryY,
          type: 'entry',
        });

        if (trade.exitTime && trade.exitPrice) {
          const exitX = xScale(trade.exitTime);
          if (exitX !== -1) {
            const exitY = yScale(trade.exitPrice);
            markers.push({
              trade,
              x: exitX,
              y: exitY,
              type: 'exit',
            });
          }
        }
      }
    });

    setTradeMarkers(markers);
  }, [trades, times, dimensions, priceScale]);

  // Draw the overlay
  useEffect(() => {
    if (!canvasRef.current || trades.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw trades
    trades.forEach((trade, index) => {
      const normalizedTime = normalizeTime(trade.entryTime);
      const entryX = xScale(trade.entryTime);

      if (entryX === -1) {
        return;
      }

      const entryY = yScale(trade.entryPrice);
      const isLong = trade.side === 'long';
      const isHighlighted = trade.id === highlightedTradeId;
      const isHovered = trade.id === hoveredTrade;

      // Draw entry marker
      ctx.save();

      // Highlight effect
      if (isHighlighted || isHovered) {
        ctx.shadowColor = isLong ? '#00ff88' : '#ff4976';
        ctx.shadowBlur = 10;
      }

      // Entry arrow
      ctx.fillStyle = isLong ? '#00ff88' : '#ff4976';
      ctx.strokeStyle = isLong ? '#00ff88' : '#ff4976';
      ctx.lineWidth = isHighlighted || isHovered ? 3 : 2;

      // Draw arrow pointing up for long, down for short
      const arrowSize = isHighlighted || isHovered ? 10 : 8;
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

      // Removed entry line - keeping only arrow markers

      // Removed SL/TP lines - keeping only entry/exit markers

      // Draw exit if trade is closed
      if (trade.exitTime && trade.exitPrice) {
        const exitX = xScale(trade.exitTime);
        if (exitX !== -1) {
          const exitY = yScale(trade.exitPrice);

          // Highlight effect for exit
          if (isHighlighted || isHovered) {
            ctx.shadowColor = trade.pnl && trade.pnl >= 0 ? '#00ff88' : '#ff4976';
            ctx.shadowBlur = 10;
          }

          // Draw exit marker (X)
          ctx.strokeStyle = trade.pnl && trade.pnl >= 0 ? '#00ff88' : '#ff4976';
          ctx.lineWidth = isHighlighted || isHovered ? 3 : 2;
          const xSize = isHighlighted || isHovered ? 8 : 6;
          ctx.beginPath();
          ctx.moveTo(exitX - xSize, exitY - xSize);
          ctx.lineTo(exitX + xSize, exitY + xSize);
          ctx.moveTo(exitX - xSize, exitY + xSize);
          ctx.lineTo(exitX + xSize, exitY - xSize);
          ctx.stroke();

          // Removed connecting line - keeping only markers

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
  }, [
    trades,
    times,
    prices,
    dimensions,
    priceScale,
    currentPrice,
    isFullscreen,
    hoveredTrade,
    highlightedTradeId,
  ]);

  // Handle mouse events
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if mouse is over any trade marker
    const marker = tradeMarkers.find((m) => {
      const distance = Math.sqrt(Math.pow(x - m.x, 2) + Math.pow(y - m.y, 2));
      return distance < 15; // 15px hit radius
    });

    if (marker) {
      setHoveredTrade(marker.trade.id);
      canvasRef.current!.style.cursor = 'pointer';
    } else {
      setHoveredTrade(null);
      canvasRef.current!.style.cursor = 'default';
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if click is on any trade marker
    const marker = tradeMarkers.find((m) => {
      const distance = Math.sqrt(Math.pow(x - m.x, 2) + Math.pow(y - m.y, 2));
      return distance < 15; // 15px hit radius
    });

    if (marker) {
      // Navigate to trades tab and highlight the trade
      navigateToTrade(marker.trade.id, 'trades');
    }
  };

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: dimensions.width,
        height: dimensions.height,
        cursor: 'default',
        pointerEvents: 'auto',
        backgroundColor: 'transparent',
        zIndex: 10,
      }}
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      onMouseLeave={() => setHoveredTrade(null)}
    />
  );
};
