# SPTrader - Adaptive Timeframe Trading Platform

A high-performance desktop trading application built with Tauri v2 that features an innovative adaptive timeframe chart. The chart automatically switches between timeframes based on zoom level, providing seamless detail transitions similar to map applications.

## 🚀 Features

### ✨ Adaptive Timeframe Switching
- **Automatic detail adjustment**: Zooming in reveals finer timeframes (1h → 15m)
- **Smooth transitions**: Maintains view position and visual continuity
- **Intelligent thresholds**: Based on bar spacing, not pixel widths
- **Bidirectional**: Works both zooming in and out

### 📊 Trading Interface
- Real-time candlestick charts with TradingView Lightweight Charts v5
- Multiple currency pairs (EUR/USD, GBP/USD, USD/JPY, etc.)
- Indicator support (Moving Averages, RSI, MACD)
- Professional dark theme with high contrast
- Matrix-style login animation

## 🛠️ Technology Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Charts**: TradingView Lightweight Charts v5
- **Desktop**: Tauri v2 (Rust backend)
- **Database**: PostgreSQL 17 with TimescaleDB
- **Data Pipeline**: Rust data aggregation from tick data
- **Styling**: Inline styles with dark theme

## 📈 Current Status

### ✅ Working Features
- Adaptive timeframe switching (1h ↔ 15m)
- 5 months of historical data (Jan-May 2024)
- Smooth zoom and pan interactions
- Real-time data updates
- Multiple chart types (Candlestick, Line, Bar)
- Timeframe state persistence
- Professional trading UI layout

### 🎯 Recent Fixes
- **React Closure Bug**: Fixed stale state in setInterval causing timeframe switching failures
- **Bar Spacing Calculations**: Now using bar spacing instead of pixel widths for consistency
- **State Management**: Added useRef pattern for interval-based logic

## 🏗️ Architecture

### Frontend Component Structure
```
src/
├── components/
│   ├── AdaptiveChart.tsx    # Main chart with auto-switching
│   ├── AdaptiveChartV2.tsx  # Experimental hierarchical engine
│   ├── MatrixLogin.tsx      # Matrix rain login screen
│   └── App.tsx              # Main application layout
```

### Adaptive Switching Logic
```typescript
// Thresholds for automatic switching
const SWITCH_TO_15M_BAR_SPACING = 25;  // When 1h bars spread wide
const SWITCH_TO_1H_BAR_SPACING = 6;    // When 15m bars squeezed tight
```

### Database Schema (TimescaleDB)
```sql
-- Continuous aggregates for each timeframe
CREATE MATERIALIZED VIEW forex_candles_15m
WITH (timescaledb.continuous) AS
SELECT 
    time_bucket('15 minutes', time) AS time,
    symbol,
    FIRST(bid, time) AS open,
    MAX(bid) AS high,
    MIN(bid) AS low,
    LAST(bid, time) AS close,
    COUNT(*) AS tick_count
FROM forex_ticks
GROUP BY time_bucket('15 minutes', time), symbol;
```

## 🐛 Known React Patterns & Solutions

### React Closure in setInterval
**Problem**: State values in interval callbacks become stale due to closure capture.

**Solution**: Use `useRef` to maintain current values:
```typescript
const currentTimeframeRef = useRef(timeframe);

// In interval callback
if (currentTimeframeRef.current === '1h') {
  // Always sees current value
}
```

[See full documentation](./docs/react-closure-bug.md)

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- Rust (latest stable)
- PostgreSQL 17 with TimescaleDB
- Tauri CLI

### Installation
```bash
# Clone the repository
git clone https://github.com/yourusername/SPTrader.git
cd SPTrader

# Install dependencies
npm install

# Set up the database
psql -U postgres -f schema/setup.sql

# Run in development mode
npm run tauri dev
```

### Building for Production
```bash
npm run tauri build
```

## 🎮 Usage

### Navigation
- **Mouse Wheel** - Zoom in/out
- **Click & Drag** - Pan across time
- **Timeframe Buttons** - Manual timeframe selection

### Automatic Zoom Behavior
- **Zoom In**: When 1h candles spread beyond 25px spacing → switches to 15m
- **Zoom Out**: When 15m candles compress below 6px spacing → switches to 1h

## 🔧 Configuration

### Chart Settings
Located in `AdaptiveChart.tsx`:
```typescript
const chart = createChart(container, {
  layout: {
    background: { color: '#0a0a0a' },
    textColor: '#ffffff',
  },
  crosshair: {
    mode: 0, // Normal mode
    vertLine: { /* ... */ },
    horzLine: { /* ... */ },
  },
});
```

## 📊 Performance Considerations

- **Data Limits**: 5m timeframe limited to 7-day windows
- **Render Optimization**: Only visible range + buffer loaded
- **Memory Management**: Proper cleanup on unmount
- **Canvas Performance**: Hardware accelerated on Windows/macOS

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- TradingView for Lightweight Charts library
- Tauri team for the excellent framework
- Claude for helping debug the tricky React closure issue

---

**Note**: This is a beta version. Use at your own risk for actual trading.