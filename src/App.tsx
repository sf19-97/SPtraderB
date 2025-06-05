import { AdaptiveChart } from './components/AdaptiveChart';
import './App.css';

function App() {
  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      margin: 0, 
      padding: 0, 
      overflow: 'hidden',
      background: '#0a0a0a' 
    }}>
      <AdaptiveChart />
    </div>
  );
}

export default App;