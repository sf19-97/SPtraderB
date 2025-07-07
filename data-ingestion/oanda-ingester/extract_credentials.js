// This script extracts OANDA credentials from the SPtraderB app's localStorage
// Run this in the browser console while the app is open

const brokerData = localStorage.getItem('broker-profiles');
if (brokerData) {
  try {
    const parsed = JSON.parse(brokerData);
    const profiles = parsed.state?.profiles || [];
    
    const oandaProfile = profiles.find(p => p.broker === 'OANDA' || p.broker === 'oanda');
    
    if (oandaProfile) {
      // Decrypt the credentials (simple base64)
      const apiKey = atob(oandaProfile.apiKey);
      const account = oandaProfile.account;
      
      console.log('Found OANDA credentials:');
      console.log('Account ID:', account);
      console.log('API Token:', apiKey);
      console.log('\nTo use these credentials:');
      console.log(`export OANDA_ACCOUNT_ID="${account}"`);
      console.log(`export OANDA_API_TOKEN="${apiKey}"`);
    } else {
      console.log('No OANDA profile found');
      console.log('Available brokers:', profiles.map(p => p.broker));
    }
  } catch (e) {
    console.error('Error parsing broker data:', e);
  }
} else {
  console.log('No broker profiles found in localStorage');
}