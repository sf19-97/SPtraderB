import React, { useState, useEffect, useRef, useCallback } from 'react';
import './MatrixLogin.css';

interface MatrixLoginProps {
  onComplete: () => void;
}

interface MatrixLine {
  x: number;
  y: number;
  leadY: number;
  lastY: number;
  length: number;
  chars: Map<number, string>; // y position -> character
  leadChar: string; // Store the lead character
  asyncScrollCount: number;
  asyncScrollRate: number;
}

interface CornerChar {
  current: string;
  final: string;
  glitchChars: string[];
  startFrame: number;
  glitchDuration: number;
}

export const MatrixLogin: React.FC<MatrixLoginProps> = ({ onComplete }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [typedText, setTypedText] = useState('');
  const [showAccess, setShowAccess] = useState(false);
  const [accessText, setAccessText] = useState('');
  const [showChoice, setShowChoice] = useState(false);
  const [choiceInput, setChoiceInput] = useState('');
  const [frameCount, setFrameCount] = useState(0);
  const [cornerChars, setCornerChars] = useState<{[key: string]: string}>({});
  const [cornerGlitch, setCornerGlitch] = useState<{[key: string]: boolean}>({});
  const [cornerFlicker, setCornerFlicker] = useState<{[key: string]: number}>({});
  const [flickerTimers, setFlickerTimers] = useState<{[key: string]: number}>({});
  const [glitchTimers, setGlitchTimers] = useState<{[key: string]: number}>({});
  const linesRef = useRef<MatrixLine[]>([]);
  const availableColumnsRef = useRef<number[]>([]);
  const startTimeRef = useRef<number>(Date.now());

  // Glitch mapping for stable characters
  const glyphMap: {[key: string]: string} = {
    S: "5",
    P: "ﾎ",
    T: "ﾃ",
    R: "ﾗ",
    A: "ﾍ",
    D: "ｺ",
    E: "ﾖ",
    R2: "ﾙ"
  };

  // Matrix rain characters - exact from Python
  const KATAKANA_CHARS = [
    "ﾓ", "ｴ", "ﾔ", "ｷ", "ｵ", "ｶ", "ｹ", "ｻ", "ｽ", "ﾖ", "ﾀ",
    "ﾜ", "ﾈ", "ﾇ", "ﾅ", "ﾋ", "ﾎ", "ｱ", "ｳ", "ｾ", "ﾐ", "ﾗ",
    "ﾘ", "ﾂ", "ﾃ", "ﾆ", "ﾊ", "ｿ", "ｺ", "ｼ", "ﾏ", "ﾑ",
    "ﾒ", "ﾍ", "ｲ", "ｸ", "ﾁ", "ﾄ", "ﾉ", "ﾌ", "ﾙ", "ﾚ",
    "ﾛ", "ﾝ"
  ];

  const MATRIX_SYMBOLS = [
    "0", "1", "2", "3", "4", "5", "7", "8", "9", "Z",
    ":", ".", "=", "*", "+", "-", "<", ">", "|", "¦"
  ];

  const ALL_CHARS = [...KATAKANA_CHARS, ...MATRIX_SYMBOLS];

  // Corner text configurations matching Python timing
  const cornerTextConfig: {[key: string]: CornerChar} = {
    'S': {
      current: '',
      final: 'S',
      glitchChars: ["Z", "7", "ﾓ", "ｷ", "ﾂ", "ﾊ"],
      startFrame: 45,  // 0.75s at 60fps
      glitchDuration: 12
    },
    'P': {
      current: '',
      final: 'P', 
      glitchChars: ["9", "ﾖ", "ｻ", "ﾘ", "ｱ", "ﾒ"],
      startFrame: 57,
      glitchDuration: 12
    },
    'T': {
      current: '',
      final: 'T',
      glitchChars: ["ﾈ", "ﾋ", "ｿ", "ﾜ", "ｴ", "ﾑ", "ﾗ", "ｵ", "ﾅ"],
      startFrame: 81,
      glitchDuration: 12
    },
    'R': {
      current: '',
      final: 'R',
      glitchChars: ["ﾈ", "ﾋ", "ｿ", "ﾜ", "ｴ", "ﾑ", "ﾗ", "ｵ", "ﾅ"],
      startFrame: 91,
      glitchDuration: 12
    },
    'A': {
      current: '',
      final: 'A',
      glitchChars: ["ﾈ", "ﾋ", "ｿ", "ﾜ", "ｴ", "ﾑ", "ﾗ", "ｵ", "ﾅ"],
      startFrame: 101,
      glitchDuration: 12
    },
    'D': {
      current: '',
      final: 'D',
      glitchChars: ["ﾈ", "ﾋ", "ｿ", "ﾜ", "ｴ", "ﾑ", "ﾗ", "ｵ", "ﾅ"],
      startFrame: 111,
      glitchDuration: 12
    },
    'E': {
      current: '',
      final: 'E',
      glitchChars: ["ﾈ", "ﾋ", "ｿ", "ﾜ", "ｴ", "ﾑ", "ﾗ", "ｵ", "ﾅ"],
      startFrame: 121,
      glitchDuration: 12
    },
    'R2': {
      current: '',
      final: 'R',
      glitchChars: ["ﾈ", "ﾋ", "ｿ", "ﾜ", "ｴ", "ﾑ", "ﾗ", "ｵ", "ﾅ"],
      startFrame: 131,
      glitchDuration: 12
    }
  };

  // Update frame counter and corner text
  useEffect(() => {
    const frameInterval = setInterval(() => {
      setFrameCount(prev => {
        const newFrame = prev + 1;
        
        // Update corner characters based on frame
        const newCornerChars: {[key: string]: string} = {};
        const newCornerGlitch: {[key: string]: boolean} = {};
        const newCornerFlicker: {[key: string]: number} = {};
        const newGlitchTimers: {[key: string]: number} = {...glitchTimers};
        const newFlickerTimers: {[key: string]: number} = {...flickerTimers};
        
        Object.entries(cornerTextConfig).forEach(([key, config]) => {
          if (newFrame >= config.startFrame) {
            const framesSinceStart = newFrame - config.startFrame;
            if (framesSinceStart < config.glitchDuration) {
              // Initial glitch effect
              const glitchIndex = framesSinceStart % config.glitchChars.length;
              newCornerChars[key] = config.glitchChars[glitchIndex];
              newCornerGlitch[key] = false;
              newCornerFlicker[key] = 1;
              newGlitchTimers[key] = 0;
              newFlickerTimers[key] = 0;
            } else {
              // After stable, handle glitch timing
              if (newGlitchTimers[key] > 0) {
                // Currently glitching - maintain glitch
                newCornerChars[key] = glyphMap[key];
                newCornerGlitch[key] = true;
                newCornerFlicker[key] = 1;
                newGlitchTimers[key]--;
              } else if (Math.random() < 0.005) { // 0.5% chance to start glitch
                // Start new glitch
                newCornerChars[key] = glyphMap[key];
                newCornerGlitch[key] = true;
                newCornerFlicker[key] = 1;
                newGlitchTimers[key] = Math.floor(Math.random() * 6) + 6; // 6-12 frames
              } else {
                // Normal state - but check for flicker
                newCornerChars[key] = config.final;
                newCornerGlitch[key] = false;
                
                // Handle flickering
                if (newFlickerTimers[key] > 0) {
                  // Currently flickering
                  newCornerFlicker[key] = Math.random() * 0.5 + 0.3; // 0.3-0.8 opacity
                  newFlickerTimers[key]--;
                } else if (Math.random() < 0.003) { // 0.3% chance to start flicker (was 2%)
                  // Start new flicker
                  newCornerFlicker[key] = Math.random() * 0.5 + 0.3;
                  newFlickerTimers[key] = Math.floor(Math.random() * 3) + 2; // 2-5 frames
                } else {
                  newCornerFlicker[key] = 1; // Full opacity
                }
              }
            }
          }
        });
        
        setCornerChars(newCornerChars);
        setCornerGlitch(newCornerGlitch);
        setCornerFlicker(newCornerFlicker);
        setGlitchTimers(newGlitchTimers);
        setFlickerTimers(newFlickerTimers);
        return newFrame;
      });
    }, 16.67); // ~60fps

    return () => clearInterval(frameInterval);
  }, [glitchTimers, flickerTimers]);

  // Handle keyboard input (invisible, like Python version)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (showAccess || showChoice) return;

      if (e.key === 'Enter') {
        if (typedText.toLowerCase() === 'redpill') {
          setShowAccess(true);
          
          // ACCESS GRANTED reveal with Python timing
          const text = 'ACCESS GRANTED';
          let index = 0;
          const interval = setInterval(() => {
            setAccessText(text.slice(0, index + 1));
            index++;
            if (index >= text.length) {
              clearInterval(interval);
              setTimeout(() => {
                setShowAccess(false);
                setShowChoice(true);
              }, 2000);
            }
          }, 65); // 30% slower than 50ms
        }
        setTypedText('');
      } else if (e.key === 'Backspace') {
        setTypedText(prev => prev.slice(0, -1));
      } else if (e.key.length === 1) {
        setTypedText(prev => (prev + e.key).slice(-20));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [typedText, showAccess, showChoice]);

  // Initialize Matrix rain - Python style
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const charSize = 16;
    const cols = Math.floor(canvas.width / charSize);
    
    // Initialize available columns
    availableColumnsRef.current = Array.from({length: cols}, (_, i) => i);
    linesRef.current = [];

    let animationId: number;
    let frameCounter = 0;
    const frameDelay = 3; // Run at ~20fps instead of 60fps

    const draw = () => {
      // Clear screen completely - no fade effect
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.font = `${charSize}px monospace`;

      // Only update positions every 3rd frame to match Python's ~18fps
      if (frameCounter % frameDelay === 0) {
        // Add new lines (matching Python's add_lines logic)
        if (availableColumnsRef.current.length > 3 && linesRef.current.length < cols - 1) {
          // Add up to 2 new lines per update
          for (let i = 0; i < 2 && availableColumnsRef.current.length > 0; i++) {
            const colIndex = Math.floor(Math.random() * availableColumnsRef.current.length);
            const x = availableColumnsRef.current[colIndex];
            availableColumnsRef.current.splice(colIndex, 1);
            
            const length = Math.floor(Math.random() * (canvas.height / charSize - 6)) + 3;
            
            linesRef.current.push({
              x: x * charSize,
              y: -1,
              leadY: 0,
              lastY: -length,
              length: length,
              chars: new Map(),
              leadChar: ALL_CHARS[Math.floor(Math.random() * ALL_CHARS.length)],
              asyncScrollCount: 0,
              asyncScrollRate: Math.floor(Math.random() * 5) // 0-4 like Python
            });
          }
        }

        // Update line positions
        const toRemove: number[] = [];
        
        linesRef.current.forEach((line, index) => {
          // Check if it's time to move this line (async scrolling)
          if (line.asyncScrollCount === line.asyncScrollRate) {
            line.asyncScrollCount = 0;
            
            // Move positions down
            line.y += 1;
            line.leadY += 1;
            line.lastY += 1;
            
            // Update lead character when line moves
            line.leadChar = ALL_CHARS[Math.floor(Math.random() * ALL_CHARS.length)];

            // Delete last character
            if (line.lastY >= 0 && line.lastY <= canvas.height / charSize) {
              line.chars.delete(line.lastY);
            }

            // Add new character at current position
            if (line.y >= 0 && line.y <= canvas.height / charSize) {
              line.chars.set(line.y, ALL_CHARS[Math.floor(Math.random() * ALL_CHARS.length)]);
            }
          } else {
            line.asyncScrollCount += 1;
          }

          // Check if line should be removed
          if (line.lastY > canvas.height / charSize) {
            toRemove.push(index);
            // Return column to available
            availableColumnsRef.current.push(Math.floor(line.x / charSize));
          }
        });

        // Remove completed lines
        toRemove.reverse().forEach(index => {
          linesRef.current.splice(index, 1);
        });
      }

      // Always draw all lines
      linesRef.current.forEach((line) => {
        // Draw all characters in this line
        line.chars.forEach((char, y) => {
          // Randomly change character (1% chance)
          if (Math.random() < 0.01) {
            line.chars.set(y, ALL_CHARS[Math.floor(Math.random() * ALL_CHARS.length)]);
            char = line.chars.get(y)!;
          }
          
          // Calculate distance from lead for opacity
          const distanceFromLead = line.leadY - y;
          let opacity = 1;
          
          // Fade based on distance from lead
          if (distanceFromLead > 0 && distanceFromLead <= line.length) {
            opacity = Math.max(0.1, 1 - (distanceFromLead / line.length) * 0.8);
          }
          
          // Add random flicker (0.2% chance - very rare)
          if (Math.random() < 0.002) {
            opacity *= (Math.random() * 0.6 + 0.2); // Flicker to 20-80% brightness
          }
          
          // Green with variable opacity
          const greenValue = Math.floor(255 * opacity);
          ctx.fillStyle = `rgba(0, ${greenValue}, 65, ${opacity})`;
          ctx.fillText(char, line.x, y * charSize);
        });

        // Draw lead character (white) with occasional flicker
        if (line.leadY >= 0 && line.leadY <= canvas.height / charSize) {
          let leadOpacity = 1;
          // Lead character flickers less frequently (0.1% chance - extremely rare)
          if (Math.random() < 0.001) {
            leadOpacity = Math.random() * 0.5 + 0.5; // Flicker to 50-100% brightness
          }
          ctx.fillStyle = `rgba(255, 255, 255, ${leadOpacity})`;
          ctx.fillText(line.leadChar, line.x, line.leadY * charSize);
        }
      });

      frameCounter++;
      animationId = requestAnimationFrame(draw);
    };

    draw();

    // Handle resize
    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const newCols = Math.floor(canvas.width / charSize);
      availableColumnsRef.current = Array.from({length: newCols}, (_, i) => i);
      linesRef.current = [];
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // Handle choice (bluepill/redpill)
  const handleChoiceSubmit = () => {
    if (choiceInput.toLowerCase() === 'redpill') {
      onComplete();
    } else if (choiceInput.toLowerCase() === 'bluepill') {
      // Show exit messages like Python version
      alert("You chose the blue pill...\nThe story ends here.\nYou wake up in your bed and believe\nwhatever you want to believe.");
      window.close();
    }
    setChoiceInput('');
  };

  return (
    <div className="matrix-container">
      <canvas ref={canvasRef} className="matrix-canvas" />
      
      {/* S P text with proper timing */}
      <div className="corner-text top-left" style={{ fontFamily: 'monospace', fontSize: '16px', left: '120px', top: '112px' }}>
        {cornerChars['S'] && (
          <span style={{ 
            color: cornerGlitch['S'] ? '#00FF41' : '#FFF', 
            fontWeight: 'bold',
            opacity: cornerFlicker['S'] || 1,
            textShadow: cornerGlitch['S'] ? '0 0 4px #00FF41' : 'none'
          }}>{cornerChars['S']}</span>
        )}
        {cornerChars['P'] && (
          <span style={{ 
            color: cornerGlitch['P'] ? '#00FF41' : '#FFF', 
            fontWeight: 'bold', 
            marginLeft: '8px',
            opacity: cornerFlicker['P'] || 1,
            textShadow: cornerGlitch['P'] ? '0 0 4px #00FF41' : 'none'
          }}>{cornerChars['P']}</span>
        )}
      </div>
      
      {/* TRADER text with proper timing */}
      <div className="corner-text bottom-right" style={{ fontFamily: 'monospace', fontSize: '16px', right: '120px', bottom: '128px' }}>
        {cornerChars['T'] && (
          <span style={{ 
            color: cornerGlitch['T'] ? '#00FF41' : '#FFF', 
            fontWeight: 'bold',
            opacity: cornerFlicker['T'] || 1,
            textShadow: cornerGlitch['T'] ? '0 0 4px #00FF41' : 'none'
          }}>{cornerChars['T']}</span>
        )}
        {cornerChars['R'] && (
          <span style={{ 
            color: cornerGlitch['R'] ? '#00FF41' : '#FFF', 
            fontWeight: 'bold',
            opacity: cornerFlicker['R'] || 1,
            textShadow: cornerGlitch['R'] ? '0 0 4px #00FF41' : 'none'
          }}>{cornerChars['R']}</span>
        )}
        {cornerChars['A'] && (
          <span style={{ 
            color: cornerGlitch['A'] ? '#00FF41' : '#FFF', 
            fontWeight: 'bold',
            opacity: cornerFlicker['A'] || 1,
            textShadow: cornerGlitch['A'] ? '0 0 4px #00FF41' : 'none'
          }}>{cornerChars['A']}</span>
        )}
        {cornerChars['D'] && (
          <span style={{ 
            color: cornerGlitch['D'] ? '#00FF41' : '#FFF', 
            fontWeight: 'bold',
            opacity: cornerFlicker['D'] || 1,
            textShadow: cornerGlitch['D'] ? '0 0 4px #00FF41' : 'none'
          }}>{cornerChars['D']}</span>
        )}
        {cornerChars['E'] && (
          <span style={{ 
            color: cornerGlitch['E'] ? '#00FF41' : '#FFF', 
            fontWeight: 'bold',
            opacity: cornerFlicker['E'] || 1,
            textShadow: cornerGlitch['E'] ? '0 0 4px #00FF41' : 'none'
          }}>{cornerChars['E']}</span>
        )}
        {cornerChars['R2'] && (
          <span style={{ 
            color: cornerGlitch['R2'] ? '#00FF41' : '#FFF', 
            fontWeight: 'bold',
            opacity: cornerFlicker['R2'] || 1,
            textShadow: cornerGlitch['R2'] ? '0 0 4px #00FF41' : 'none'
          }}>{cornerChars['R2']}</span>
        )}
      </div>
      
      {/* ACCESS GRANTED */}
      {showAccess && (
        <div className="access-granted" style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#00FF00',
          fontSize: '24px',
          fontFamily: 'monospace',
          fontWeight: 'bold',
          letterSpacing: '8px',
          textShadow: '0 0 10px #00FF00'
        }}>
          {accessText}
        </div>
      )}
      
      {/* Choice screen */}
      {showChoice && (
        <div className="choice-screen" style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#00FF00',
          fontFamily: 'monospace',
          textAlign: 'center'
        }}>
          <h2>Choose your destiny:</h2>
          <p>Type 'bluepill' - Exit the program</p>
          <p>Type 'redpill' - Launch SPTrader</p>
          <input
            type="text"
            value={choiceInput}
            onChange={(e) => setChoiceInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleChoiceSubmit();
              }
            }}
            className="matrix-input"
            placeholder="Your choice..."
            autoFocus
            style={{
              background: 'transparent',
              border: '1px solid #00FF00',
              color: '#00FF00',
              padding: '10px',
              fontSize: '16px',
              fontFamily: 'monospace',
              outline: 'none',
              marginTop: '20px'
            }}
          />
        </div>
      )}
    </div>
  );
};