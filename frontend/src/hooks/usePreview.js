import { useState, useEffect, useRef } from 'react';

/**
 * Deterministic stringify to prevent unnecessary re-renders when object keys change order.
 */
function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',') + '}';
}

export function usePreview({ projectId, files, apiBase = '', onReady }) {
  const [workerId, setWorkerId] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const prevFilesRef = useRef('');
  const workerIdRef = useRef(null);
  const apiBaseRef = useRef(apiBase);

  // Sync state to refs for reliable cleanup
  useEffect(() => {
    workerIdRef.current = workerId;
    apiBaseRef.current = apiBase;
  }, [workerId, apiBase]);

  useEffect(() => {
    const currentFilesStr = stableStringify(files);
    
    // Only return early if content is identical AND we have a worker pod
    if (currentFilesStr === prevFilesRef.current && workerId) {
      // Perform a quick health check to see if we need a silent re-boot.
      fetch(`${apiBase}/api/preview/proxy/${workerId}/__health`)
        .then(res => { if (!res.ok) setWorkerId(null); })
        .catch(() => setWorkerId(null));
      return;
    }
    
    // If we reach here, either the content changed OR the pod was reaped (workerId is null)
    prevFilesRef.current = currentFilesStr;

    if (Object.keys(files).length === 0) return;

    // Set loading immediately to show the overlay even during the debounce period
    setLoading(true);

    const startOrUpdate = async () => {
      try {
        // Generate/Retrieve stable userId for pod reuse
        let userId = localStorage.getItem('preview_user_id');
        if (!userId) {
          userId = `user-${Math.random().toString(36).substring(2, 11)}`;
          localStorage.setItem('preview_user_id', userId);
        }

        // Set a fail-safe timeout: if we're still booting after 60s, something is wrong
        const failSafeId = setTimeout(() => {
          if (loading || !workerId) {
            setLoading(false);
            setError('Preview boot timed out. The pod might be overloaded. Please try again.');
          }
        }, 60000);

        // Always use /start to trigger Orchestrator's reuse logic
        const res = await fetch(`${apiBase}/api/preview/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, userId, files })
        });
        
        clearTimeout(failSafeId);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        
        // Handle Self-Healing: If session expired, clear ID and re-trigger immediately
        if (data.status === 'expired') {
          console.warn('[usePreview] Session expired (Pod recycled). Re-triggering cold start...');
          setWorkerId(null);
          return; // The useEffect will re-run automatically because workerId changed
        }
        
        setWorkerId(data.workerId);
        
        // ─── Readiness Polling ───
        // Don't update the iframe URL until the worker explicitly says Next.js is ready
        let isReady = false;
        let attempts = 0;
        const maxAttempts = 30; // 30s max wait
        
        while (!isReady && attempts < maxAttempts) {
          try {
            const healthRes = await fetch(`${apiBase}/api/preview/proxy/${data.workerId}/__health`);
            const healthData = await healthRes.json();
            if (healthData.status === 'ready') {
              isReady = true;
            } else {
              attempts++;
              await new Promise(r => setTimeout(r, 1000));
            }
          } catch (e) {
            attempts++;
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        // Let the UI know if this was a warm update vs cold boot
        const isWarm = data.warm || false;
        
        let url;
        if (import.meta.env.DEV) {
          try {
            const previewOrigin = new URL(data.previewUrl);
            const baseOrigin = new URL(apiBase || window.location.origin);
            previewOrigin.hostname = baseOrigin.hostname;
            url = previewOrigin.toString();
          } catch (e) {
            url = data.previewUrl;
          }
        } else {
          url = `${apiBase}/api/preview/proxy/${data.workerId}/`;
        }
        
        // Forced Refresh: Append a version tag
        const freshUrl = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
        
        setPreviewUrl(freshUrl);
        setLoading(false);
        if (onReady) onReady(freshUrl, { warm: isWarm });
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    const timeout = setTimeout(startOrUpdate, 1200);
    return () => clearTimeout(timeout);
  }, [files, workerId, projectId, apiBase, onReady]);

  // Reliable Cleanup on Unmount
  useEffect(() => {
    return () => {
      const id = workerIdRef.current;
      const base = apiBaseRef.current;
      
      if (id && base) {
        console.log(`[usePreview] Cleaning up worker: ${id}`);
        // Use keepalive to ensure the request finishes even if the tab is closing
        fetch(`${base}/api/preview/${id}`, {
          method: 'DELETE',
          keepalive: true
        }).catch(() => {});
      }
    };
  }, []); // empty array — intentional

  return { previewUrl, loading, error };
}
