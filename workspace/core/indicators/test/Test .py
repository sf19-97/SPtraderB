""
Indicator: New Indicator
"""

__metadata_version__ = 1
__metadata__ = {
    'name': 'new_indicator',
    'category': 'momentum',
    'version': '0.1.0',
    'description': 'TODO: Add description',
    'inputs': ['close'],
    'outputs': ['value']
}

class NewIndicator:
    def __init__(self, period=14):
        self.period = period
        
    def calculate(self, data):
        # TODO: Implement calculation
        pass
