import React, { useEffect, useState, useRef } from 'react';
import { Box, Text, Group } from '@mantine/core';
import { consoleInterceptor } from '../utils/consoleInterceptor';

export const ResolutionTracker: React.FC = () => {
  const [currentResolution, setCurrentResolution] = useState<string>('1h');
  const [timeframeChanged, setTimeframeChanged] = useState(false);
  const prevResolutionRef = useRef<string>('1h');

  useEffect(() => {
    // Start intercepting console logs
    consoleInterceptor.start();
    
    // Subscribe to timeframe changes
    const unsubscribe = consoleInterceptor.subscribe((timeframe) => {
      if (timeframe !== prevResolutionRef.current) {
        setCurrentResolution(timeframe);
        setTimeframeChanged(true);
        prevResolutionRef.current = timeframe;
        
        // Reset the glow effect after animation (match chart's 550ms total)
        setTimeout(() => setTimeframeChanged(false), 550);
      }
    });

    // Cleanup
    return () => {
      unsubscribe();
      // Note: We don't stop the interceptor here because other components might be using it
    };
  }, []);

  return (
    <>
      <style>
        {`
          @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
          }
          
          @keyframes fadeOut {
            0% { 
              opacity: 0;
            }
            10% { 
              opacity: 1;
            }
            100% { 
              opacity: 0;
            }
          }
        `}
      </style>
      
      <Box
        style={{
          background: 'linear-gradient(145deg, #1a1a1a, #0a0a0a)',
          border: '1px solid #333',
          borderRadius: '20px',
          padding: '4px 12px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <Group gap="xs">
          <Box
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#00ff88',
              animation: 'pulse 2s infinite',
            }}
          />
          <Text size="sm" fw={500} c="white">
            {currentResolution.toUpperCase()}
          </Text>
        </Group>
        
        {/* Glow effect on change */}
        {timeframeChanged && (
          <Box
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 255, 136, 0.1)',
              animation: 'fadeOut 550ms ease-in-out forwards',
              animationDelay: '250ms',
            }}
          />
        )}
      </Box>
    </>
  );
};