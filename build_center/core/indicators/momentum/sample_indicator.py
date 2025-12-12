\"\"\"
Sample indicator
\"\"\"

def run(data):
    return data["close"].rolling(window=5).mean()
