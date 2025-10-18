import { useEffect, useState } from 'react';
import { useBrokerStore } from '../stores/useBrokerStore';

export function CredentialExtractor() {
  const [credentials, setCredentials] = useState<any>(null);
  const profiles = useBrokerStore((state) => state.profiles);
  const decryptData = useBrokerStore((state) => state.decryptSensitiveData);

  useEffect(() => {
    // Extract all stored credentials
    const extractedCreds = profiles.map(profile => ({
      id: profile.id,
      name: profile.name,
      broker: profile.broker,
      account: profile.account,
      environment: profile.environment,
      // Decrypt the sensitive data
      apiKey: decryptData(profile.apiKey),
      apiSecret: profile.apiSecret ? decryptData(profile.apiSecret) : undefined,
    }));

    setCredentials(extractedCreds);

    // Also log to console for easy copying
    console.log('=== EXTRACTED CREDENTIALS ===');
    console.log(JSON.stringify(extractedCreds, null, 2));
    console.log('=============================');
  }, [profiles, decryptData]);

  return (
    <div style={{ padding: '20px', backgroundColor: '#1a1a1a', color: '#fff', margin: '20px' }}>
      <h2>Extracted Credentials</h2>
      <pre style={{ 
        backgroundColor: '#2a2a2a', 
        padding: '15px', 
        borderRadius: '5px',
        overflow: 'auto',
        maxHeight: '500px'
      }}>
        {JSON.stringify(credentials, null, 2)}
      </pre>
      <p style={{ marginTop: '10px', color: '#888' }}>
        Note: Credentials have been decrypted and are also logged to the browser console.
      </p>
    </div>
  );
}