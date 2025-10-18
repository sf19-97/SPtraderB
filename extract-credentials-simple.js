// Simple credential extraction script
// Run this in the SPTrader app's developer console

// Method 1: Try to get from localStorage
const stored1 = localStorage.getItem('brokerAccounts');
const stored2 = localStorage.getItem('broker-profiles');

if (stored1) {
    console.log('Found in brokerAccounts:', stored1);
}

if (stored2) {
    console.log('Found in broker-profiles:', stored2);
}

// Method 2: Get all localStorage keys
console.log('\n=== All localStorage keys ===');
for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    console.log(key);
}

// Method 3: Look for Zustand stores
console.log('\n=== Checking for Zustand stores ===');
const keys = Object.keys(localStorage).filter(k => 
    k.includes('broker') || 
    k.includes('account') || 
    k.includes('api') ||
    k.includes('profile')
);

keys.forEach(key => {
    const value = localStorage.getItem(key);
    console.log(`\nKey: ${key}`);
    console.log('Value:', value);
    
    // Try to parse and decrypt
    try {
        const parsed = JSON.parse(value);
        if (parsed.state && parsed.state.profiles) {
            console.log('Found profiles:', parsed.state.profiles.length);
            parsed.state.profiles.forEach((p, i) => {
                console.log(`\nProfile ${i + 1}:`, {
                    name: p.name,
                    broker: p.broker,
                    account: p.account,
                    apiKey: atob(p.apiKey), // decrypt
                    apiSecret: p.apiSecret ? atob(p.apiSecret) : 'N/A'
                });
            });
        }
    } catch (e) {
        // Not JSON or failed to parse
    }
});