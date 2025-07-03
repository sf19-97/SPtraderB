#!/usr/bin/env python3
"""
Test script to verify component server crash protection
"""
import subprocess
import time
import os
import signal

def find_component_server_pid():
    """Find the PID of the component_server.py process"""
    try:
        result = subprocess.run(['pgrep', '-f', 'component_server.py'], 
                              capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            return int(result.stdout.strip().split('\n')[0])
    except:
        pass
    return None

def kill_component_server():
    """Kill the component server process"""
    pid = find_component_server_pid()
    if pid:
        print(f"Found component server with PID {pid}, killing it...")
        try:
            os.kill(pid, signal.SIGTERM)
            time.sleep(0.5)  # Give it time to die
            return True
        except ProcessLookupError:
            print("Process already dead")
            return False
    else:
        print("Component server not found")
        return False

def main():
    print("Component Server Crash Protection Test")
    print("======================================")
    print("Make sure to start a backtest first to initialize the component server!")
    print()
    
    input("Press Enter when backtest is running...")
    
    # Test crash recovery with exponential backoff
    for i in range(6):  # Try to kill it 6 times (should fail after 5)
        print(f"\n--- Kill attempt {i+1} ---")
        
        if kill_component_server():
            print(f"Killed component server (attempt {i+1})")
            
            if i < 5:
                # Expected backoff times: 1s, 2s, 4s, 8s, 16s
                expected_wait = [1, 2, 4, 8, 16][i]
                print(f"Expecting ~{expected_wait}s backoff before restart...")
                
                # Wait for restart
                start_time = time.time()
                max_wait = expected_wait + 2  # Add some buffer
                
                while time.time() - start_time < max_wait:
                    if find_component_server_pid():
                        restart_time = time.time() - start_time
                        print(f"Component server restarted after {restart_time:.1f}s")
                        break
                    time.sleep(0.1)
                else:
                    print(f"Component server did not restart within {max_wait}s")
                    if i < 5:
                        print("This might indicate the protection is working!")
            else:
                print("This should be the final kill - server should NOT restart")
                time.sleep(3)
                if find_component_server_pid():
                    print("ERROR: Component server restarted after 5 failures!")
                else:
                    print("SUCCESS: Component server did not restart after 5 failures")
        else:
            print("Could not find/kill component server")
            print("It may have already exceeded restart attempts")
            break
            
        time.sleep(1)  # Brief pause between attempts
    
    print("\n--- Test Complete ---")
    print("Check the Tauri console output for detailed restart logs")
    print("Look for messages like:")
    print("  [ComponentExecutor] Component server has died, restart attempt X of 5")
    print("  [ComponentExecutor] Waiting Xms before restart...")
    print("  Component server has crashed X times, exceeded maximum restart attempts")

if __name__ == "__main__":
    main()