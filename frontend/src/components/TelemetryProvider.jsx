import React, { createContext, useContext, useState, useEffect } from 'react';
import { webContainerClient } from '../lib/webcontainer-client';

const TelemetryContext = createContext();

export function TelemetryProvider({ children }) {
  const [metrics, setMetrics] = useState({
    bootTime: 0,
    restoreTime: 0,
    nextStartTime: 0
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setMetrics({ ...webContainerClient.getMetrics() });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <TelemetryContext.Provider value={metrics}>
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry() {
  return useContext(TelemetryContext);
}

export function TelemetryOverlay() {
  const metrics = useTelemetry();
  
  if (!metrics.bootTime) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-black/80 backdrop-blur-md text-white p-3 rounded-lg border border-white/10 text-[10px] font-mono z-[9999] pointer-events-none">
      <div className="flex justify-between gap-4">
        <span className="opacity-50">WC Boot:</span>
        <span className="text-green-400">{metrics.bootTime.toFixed(0)}ms</span>
      </div>
      <div className="flex justify-between gap-4 mt-1">
        <span className="opacity-50">FS Restore:</span>
        <span className="text-blue-400">{metrics.restoreTime.toFixed(0)}ms</span>
      </div>
      <div className="flex justify-between gap-4 mt-1">
        <span className="opacity-50">Next Start:</span>
        <span className="text-purple-400">{metrics.nextStartTime.toFixed(0)}ms</span>
      </div>
    </div>
  );
}
