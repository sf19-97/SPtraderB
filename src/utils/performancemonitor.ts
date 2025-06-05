export class PerformanceMonitor {
  private frameCount = 0;
  private lastTime = performance.now();
  private fpsCallback?: (fps: number) => void;

  startMonitoring(callback: (fps: number) => void) {
    this.fpsCallback = callback;
    this.tick();
  }

  private tick = () => {
    this.frameCount++;
    const currentTime = performance.now();
    
    if (currentTime - this.lastTime >= 1000) {
      const fps = Math.round((this.frameCount * 1000) / (currentTime - this.lastTime));
      this.fpsCallback?.(fps);
      this.frameCount = 0;
      this.lastTime = currentTime;
    }
    
    requestAnimationFrame(this.tick);
  };
}