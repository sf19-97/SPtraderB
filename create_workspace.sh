#!/bin/bash

# Create workspace directory structure
echo "Creating workspace directory structure..."

# Create core directories
mkdir -p workspace/core/indicators/momentum
mkdir -p workspace/core/indicators/trend
mkdir -p workspace/core/indicators/volatility
mkdir -p workspace/core/indicators/volume
mkdir -p workspace/core/indicators/microstructure

mkdir -p workspace/core/signals
mkdir -p workspace/core/orders/execution_algos
mkdir -p workspace/core/orders/smart_routing
mkdir -p workspace/core/orders/risk_filters
mkdir -p workspace/core/base

# Create strategies and experiments directories
mkdir -p workspace/strategies
mkdir -p workspace/experiments
mkdir -p workspace/tests/indicators
mkdir -p workspace/tests/signals
mkdir -p workspace/tests/strategies

# Create base class templates
cat > workspace/core/base/indicator.py << 'EOF'
"""
Base class for all indicators
"""
from abc import ABC, abstractmethod
from typing import Dict, Any
import pandas as pd


class Indicator(ABC):
    """Base indicator interface"""
    
    @abstractmethod
    def calculate(self, data: pd.Series) -> pd.Series:
        """Calculate indicator values"""
        pass
    
    @property
    @abstractmethod
    def metadata(self) -> Dict[str, Any]:
        """Return indicator metadata"""
        pass
EOF

cat > workspace/core/base/signal.py << 'EOF'
"""
Base class for all signals
"""
from abc import ABC, abstractmethod
from typing import List, Dict
import pandas as pd


class Signal(ABC):
    """Base signal interface"""
    
    @property
    @abstractmethod
    def required_indicators(self) -> List[str]:
        """List of required indicators"""
        pass
    
    @abstractmethod
    def evaluate(self, data: pd.DataFrame, indicators: Dict[str, pd.Series]) -> pd.Series:
        """Evaluate signal conditions"""
        pass
EOF

cat > workspace/core/base/order.py << 'EOF'
"""
Base class for all order types
"""
from abc import ABC, abstractmethod
from typing import Dict, Any


class Order(ABC):
    """Base order interface"""
    
    @abstractmethod
    def execute(self, market_state: Dict[str, Any]) -> Dict[str, Any]:
        """Execute order based on market conditions"""
        pass
EOF

cat > workspace/core/base/strategy.py << 'EOF'
"""
Base class for all strategies
"""
from abc import ABC, abstractmethod
from typing import Dict, Any
import pandas as pd


class Strategy(ABC):
    """Base strategy interface"""
    
    @abstractmethod
    def run(self, data: pd.DataFrame) -> Dict[str, Any]:
        """Run strategy on data"""
        pass
    
    @property
    @abstractmethod
    def config(self) -> Dict[str, Any]:
        """Strategy configuration"""
        pass
EOF

echo "Workspace directory structure created successfully!"
echo ""
echo "Directory structure:"
echo "workspace/"
echo "├── core/"
echo "│   ├── indicators/"
echo "│   │   ├── momentum/"
echo "│   │   ├── trend/"
echo "│   │   ├── volatility/"
echo "│   │   ├── volume/"
echo "│   │   └── microstructure/"
echo "│   ├── signals/"
echo "│   ├── orders/"
echo "│   │   ├── execution_algos/"
echo "│   │   ├── smart_routing/"
echo "│   │   └── risk_filters/"
echo "│   └── base/"
echo "├── strategies/"
echo "├── experiments/"
echo "└── tests/"
echo "    ├── indicators/"
echo "    ├── signals/"
echo "    └── strategies/"