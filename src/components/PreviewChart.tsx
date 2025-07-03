import { useEffect, useRef, useState, useCallback } from 'react';
import { Box, Text, ActionIcon, Group } from '@mantine/core';
import { IconMaximize, IconMinimize } from '@tabler/icons-react';

interface ChartData {
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
}

interface PreviewChartProps {
  data?: ChartData;
  height?: number;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const PreviewChart = ({ data, height = 200, isFullscreen = false, onToggleFullscreen }: PreviewChartProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height });
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const updateDimensions = () => {
      if (isFullscreen && containerRef.current) {
        // In fullscreen mode, use container dimensions minus padding
        const width = window.innerWidth - 40; // 20px padding on each side
        const chartHeight = window.innerHeight - 100; // Account for header and padding
        setDimensions({ width, height: chartHeight });
      } else if (canvasRef.current?.parentElement) {
        const width = canvasRef.current.parentElement.clientWidth;
        if (width > 0) {
          setDimensions({ width, height });
        }
      }
    };

    // Initial update
    updateDimensions();
    
    // Use ResizeObserver for better parent size detection
    let resizeObserver: ResizeObserver | null = null;
    if (!isFullscreen && canvasRef.current?.parentElement) {
      resizeObserver = new ResizeObserver(updateDimensions);
      resizeObserver.observe(canvasRef.current.parentElement);
    }
    
    // Fallback timeout for initial render
    const timeoutId = setTimeout(updateDimensions, 100);
    
    window.addEventListener('resize', updateDimensions);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', updateDimensions);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [height, isFullscreen]);

  useEffect(() => {
    console.log('[PreviewChart] Render check:', {
      hasCanvas: !!canvasRef.current,
      hasData: !!data,
      timeLength: data?.time?.length || 0,
      width: dimensions.width,
      indicators: data?.indicators ? Object.keys(data.indicators) : []
    });
    
    if (!canvasRef.current || !data || data.time.length === 0 || dimensions.width === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    
    console.log('[PreviewChart] Drawing canvas:', {
      width: canvas.width,
      height: canvas.height,
      dataPoints: data.time.length
    });

    // Clear canvas
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Store scale functions for hover calculation
    const leftPadding = isFullscreen ? 10 : 20;
    const rightPadding = isFullscreen ? 70 : 20; // More space for price labels in fullscreen
    const topPadding = 20;
    const bottomPadding = isFullscreen ? 50 : 20; // More space for time labels in fullscreen
    
    const chartWidth = canvas.width - leftPadding - rightPadding;
    const chartHeight = canvas.height - topPadding - bottomPadding;

    // Reuse padding and dimensions from above
    
    // Find min/max for scaling
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    
    for (let i = 0; i < data.close.length; i++) {
      minPrice = Math.min(minPrice, data.low[i]);
      maxPrice = Math.max(maxPrice, data.high[i]);
    }
    
    // Include indicator values in scale calculation
    if (data.indicators) {
      Object.values(data.indicators).forEach(values => {
        if (values && values.length > 0) {
          const validValues = values.filter(v => !isNaN(v) && isFinite(v));
          if (validValues.length > 0) {
            minPrice = Math.min(minPrice, Math.min(...validValues));
            maxPrice = Math.max(maxPrice, Math.max(...validValues));
          }
        }
      });
    }
    
    // Add padding to price range
    const priceRange = maxPrice - minPrice;
    minPrice -= priceRange * 0.1;
    maxPrice += priceRange * 0.1;
    
    // Scale functions
    const xScale = (i: number) => leftPadding + (i / (data.time.length - 1)) * chartWidth;
    const yScale = (price: number) => topPadding + (1 - (price - minPrice) / (maxPrice - minPrice)) * chartHeight;
    
    // Draw grid lines
    ctx.strokeStyle = '#1a2a3a';
    ctx.lineWidth = 0.5;
    
    // Horizontal grid lines
    for (let i = 0; i <= 4; i++) {
      const y = topPadding + (i / 4) * chartHeight;
      ctx.beginPath();
      ctx.moveTo(leftPadding, y);
      ctx.lineTo(canvas.width - rightPadding, y);
      ctx.stroke();
      
      // Price labels - only show in fullscreen mode
      if (isFullscreen) {
        const price = minPrice + (1 - i / 4) * (maxPrice - minPrice);
        ctx.fillStyle = '#888';
        ctx.font = '11px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(price.toFixed(5), canvas.width - rightPadding + 8, y + 4);
      }
    }
    
    // Draw candlesticks
    const barWidth = Math.max(1, chartWidth / data.time.length * 0.8);
    
    for (let i = 0; i < data.time.length; i++) {
      const x = xScale(i);
      const open = yScale(data.open[i]);
      const close = yScale(data.close[i]);
      const high = yScale(data.high[i]);
      const low = yScale(data.low[i]);
      
      // Candle color
      const isGreen = data.close[i] > data.open[i];
      ctx.fillStyle = isGreen ? '#00ff88' : '#ff4976';
      ctx.strokeStyle = isGreen ? '#00ff88' : '#ff4976';
      
      // Draw wick
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, high);
      ctx.lineTo(x, low);
      ctx.stroke();
      
      // Draw body
      ctx.fillRect(x - barWidth / 2, Math.min(open, close), barWidth, Math.abs(close - open));
    }
    
    // Draw indicators if present
    if (data.indicators) {
      Object.entries(data.indicators).forEach(([name, values], idx) => {
        if (!values || values.length === 0) return;
        
        // Handle case where indicator has fewer values than time series
        const startOffset = data.time.length - values.length;
        
        // Different colors for different indicators
        const colors = ['#4a9eff', '#ff9800', '#e91e63', '#00bcd4'];
        ctx.strokeStyle = colors[idx % colors.length];
        ctx.lineWidth = 1.5;
        
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < values.length; i++) {
          if (values[i] === null || values[i] === undefined || isNaN(values[i])) {
            started = false;
            continue;
          }
          
          const dataIndex = i + startOffset;
          const x = xScale(dataIndex);
          const y = yScale(values[i]);
          
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        
        // Draw indicator label
        ctx.fillStyle = colors[idx % colors.length];
        ctx.font = '12px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(name.toUpperCase(), leftPadding + 5 + idx * 60, topPadding - 5);
      });
    }
    
    // Draw signal markers if present
    if (data.signals?.crossovers) {
      console.log('[PreviewChart] Drawing signals:', data.signals);
      data.signals.crossovers.forEach((idx, i) => {
        if (idx >= 0 && idx < data.time.length) {
          const x = xScale(idx);
          const crossType = data.signals.types[i];
          
          // Removed vertical line - keeping only arrow markers
          
          // Add arrow symbol
          ctx.fillStyle = crossType === 'golden_cross' ? '#00ff88' : '#ff4976';
          ctx.font = 'bold 16px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(crossType === 'golden_cross' ? '↑' : '↓', x, topPadding - 10);
          
          // Add label in fullscreen mode
          if (isFullscreen) {
            ctx.font = '10px monospace';
            ctx.fillStyle = crossType === 'golden_cross' ? '#00ff88' : '#ff4976';
            ctx.save();
            ctx.translate(x + 10, topPadding + 20);
            ctx.rotate(Math.PI / 2);
            ctx.fillText(crossType === 'golden_cross' ? 'Golden Cross' : 'Death Cross', 0, 0);
            ctx.restore();
          }
        }
      });
    }
    
    // Draw time axis labels - only show in fullscreen mode
    if (isFullscreen) {
      ctx.fillStyle = '#888';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      
      // Draw vertical grid lines and time labels
      // Calculate optimal number of labels based on width
      const labelWidth = 80; // Approximate width of a time label
      const maxLabels = Math.floor(chartWidth / labelWidth);
      const numTimeLabels = Math.min(maxLabels, 8, data.time.length);
      
      if (numTimeLabels > 1) {
        const timeStep = Math.floor((data.time.length - 1) / (numTimeLabels - 1));
        
        for (let labelIdx = 0; labelIdx < numTimeLabels; labelIdx++) {
          const i = labelIdx === numTimeLabels - 1 ? data.time.length - 1 : labelIdx * timeStep;
          const x = xScale(i);
          
          // Draw vertical grid line
          ctx.strokeStyle = '#1a2a3a';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(x, topPadding);
          ctx.lineTo(x, canvas.height - bottomPadding);
          ctx.stroke();
          
          // Draw time label
          const date = new Date(data.time[i]);
          
          // Format based on timeframe (simplified)
          let timeStr;
          if (numTimeLabels <= 4) {
            // Show full date and time
            timeStr = date.toLocaleString('en-US', { 
              month: 'short', 
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });
          } else {
            // Show abbreviated format
            timeStr = date.toLocaleString('en-US', { 
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit'
            });
          }
          
          ctx.fillStyle = '#888';
          ctx.font = '10px monospace';
          ctx.textAlign = 'center';
          
          // Ensure labels don't go off canvas edges
          const textX = Math.max(leftPadding + 40, Math.min(x, canvas.width - rightPadding - 40));
          ctx.fillText(timeStr, textX, canvas.height - bottomPadding + 20);
        }
      }
    }
    
    // Draw hover crosshair and tooltip
    if (hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < data.time.length) {
      const x = xScale(hoveredIndex);
      
      // Vertical line
      ctx.strokeStyle = '#666';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, topPadding);
      ctx.lineTo(x, topPadding + chartHeight);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Horizontal line at mouse position
      ctx.beginPath();
      ctx.moveTo(leftPadding, mousePos.y);
      ctx.lineTo(leftPadding + chartWidth, mousePos.y);
      ctx.stroke();
      
      // Tooltip background
      const tooltipWidth = 180;
      const tooltipHeight = 100 + (data.indicators ? Object.keys(data.indicators).length * 20 : 0);
      let tooltipX = mousePos.x + 10;
      let tooltipY = mousePos.y - tooltipHeight / 2;
      
      // Keep tooltip on screen
      if (tooltipX + tooltipWidth > canvas.width - 10) {
        tooltipX = mousePos.x - tooltipWidth - 10;
      }
      if (tooltipY < 10) tooltipY = 10;
      if (tooltipY + tooltipHeight > canvas.height - 10) {
        tooltipY = canvas.height - tooltipHeight - 10;
      }
      
      // Draw tooltip background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
      ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
      ctx.strokeStyle = '#444';
      ctx.lineWidth = 1;
      ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
      
      // Tooltip content
      ctx.fillStyle = '#ccc';
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      
      const time = new Date(data.time[hoveredIndex]).toLocaleString();
      const open = data.open[hoveredIndex];
      const high = data.high[hoveredIndex];
      const low = data.low[hoveredIndex];
      const close = data.close[hoveredIndex];
      
      let yOffset = tooltipY + 20;
      ctx.fillText(time, tooltipX + 10, yOffset);
      yOffset += 20;
      
      ctx.fillStyle = '#888';
      ctx.fillText(`O: ${open.toFixed(5)}`, tooltipX + 10, yOffset);
      yOffset += 15;
      ctx.fillText(`H: ${high.toFixed(5)}`, tooltipX + 10, yOffset);
      yOffset += 15;
      ctx.fillText(`L: ${low.toFixed(5)}`, tooltipX + 10, yOffset);
      yOffset += 15;
      ctx.fillStyle = close >= open ? '#00ff88' : '#ff4976';
      ctx.fillText(`C: ${close.toFixed(5)}`, tooltipX + 10, yOffset);
      
      // Show indicator values
      if (data.indicators) {
        yOffset += 20;
        Object.entries(data.indicators).forEach(([name, values], idx) => {
          const startOffset = data.time.length - values.length;
          const valueIndex = hoveredIndex - startOffset;
          
          if (valueIndex >= 0 && valueIndex < values.length && values[valueIndex] !== null && values[valueIndex] !== undefined) {
            const colors = ['#4a9eff', '#ff9800', '#e91e63', '#00bcd4'];
            ctx.fillStyle = colors[idx % colors.length];
            const value = typeof values[valueIndex] === 'number' ? values[valueIndex].toFixed(4) : 'N/A';
            ctx.fillText(`${name}: ${value}`, tooltipX + 10, yOffset);
            yOffset += 15;
          }
        });
      }
    }
    
  }, [data, dimensions, hoveredIndex, mousePos]);
  
  // Force dimension update when data changes
  useEffect(() => {
    if (data && canvasRef.current?.parentElement) {
      const width = canvasRef.current.parentElement.clientWidth;
      if (width > 0 && width !== dimensions.width) {
        console.log('[PreviewChart] Updating dimensions after data load:', width);
        setDimensions(prev => ({ ...prev, width }));
      }
    }
  }, [data]);

  // Mouse event handlers - must be defined before any returns
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !data) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Scale mouse coordinates to canvas coordinates
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    const canvasX = x * scaleX;
    const canvasY = y * scaleY;
    
    setMousePos({ x: canvasX, y: canvasY });
    
    // Calculate hovered candle index
    const leftPadding = isFullscreen ? 10 : 20;
    const rightPadding = isFullscreen ? 70 : 20;
    const chartWidth = canvasRef.current.width - leftPadding - rightPadding;
    const relativeX = canvasX - leftPadding;
    
    if (relativeX >= 0 && relativeX <= chartWidth) {
      const index = Math.round((relativeX / chartWidth) * (data.time.length - 1));
      setHoveredIndex(Math.max(0, Math.min(data.time.length - 1, index)));
    } else {
      setHoveredIndex(null);
    }
  }, [data, isFullscreen]);
  
  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  // Early return for no data
  if (!data || data.time.length === 0) {
    return (
      <Box style={{
        height,
        background: '#0a0a0a',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <Text size="sm" c="#666">No data to display</Text>
      </Box>
    );
  }

  // Render fullscreen version
  if (isFullscreen) {
    return (
      <>
        {/* Fullscreen overlay */}
        <Box
          ref={containerRef}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: '#151515',
            zIndex: 100,
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header with close button */}
          <Group justify="space-between" mb="sm">
            <Text size="sm" fw={500} c="white">Chart Preview</Text>
            {onToggleFullscreen && (
              <ActionIcon
                onClick={onToggleFullscreen}
                variant="subtle"
                color="gray"
                size="sm"
                title="Exit fullscreen"
              >
                <IconMinimize size={16} />
              </ActionIcon>
            )}
          </Group>
          
          {/* Chart canvas */}
          <Box style={{ flex: 1, position: 'relative' }}>
            <canvas 
              ref={canvasRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              style={{
                width: dimensions.width,
                height: dimensions.height,
                borderRadius: '4px',
                background: '#0a0a0a',
                cursor: hoveredIndex !== null ? 'crosshair' : 'default'
              }}
            />
          </Box>
        </Box>
        
        {/* Dark overlay backdrop */}
        <Box
          onClick={onToggleFullscreen}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 99,
            cursor: 'pointer',
          }}
        />
      </>
    );
  }

  // Regular mode with maximize button
  return (
    <Box style={{ position: 'relative' }}>
      {/* Maximize button in top-right corner */}
      {onToggleFullscreen && (
        <ActionIcon
          onClick={onToggleFullscreen}
          variant="subtle"
          color="gray"
          size="sm"
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 20,  // Increased to be above overlay canvas
          }}
          title="Fullscreen"
        >
          <IconMaximize size={16} />
        </ActionIcon>
      )}
      
      <canvas 
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{
          width: '100%',
          height,
          borderRadius: '4px',
          background: '#0a0a0a',
          cursor: hoveredIndex !== null ? 'crosshair' : 'default'
        }}
      />
    </Box>
  );
};