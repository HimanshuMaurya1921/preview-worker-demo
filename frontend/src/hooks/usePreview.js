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
    if (currentFilesStr === prevFilesRef.current) {
      return;
    }
    prevFilesRef.current = currentFilesStr;

    if (Object.keys(files).length === 0) return;

    const startOrUpdate = async () => {
      try {
        if (!workerId) {
          setLoading(true);
          const res = await fetch(`${apiBase}/api/preview/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, files })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          
          setWorkerId(data.workerId);
          
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
          
          setPreviewUrl(url);
          setLoading(false);
          if (onReady) onReady(url);
        } else {
          // Pass projectId for ownership verification on the server
          await fetch(`${apiBase}/api/preview/${workerId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files, projectId })
          });
        }
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    const timeout = setTimeout(startOrUpdate, 800); // 800ms debounce
    return () => clearTimeout(timeout);
  }, [files, workerId, projectId, apiBase, onReady]);

  // Cleanup effect — runs ONLY on unmount
  useEffect(() => {
    return () => {
      // Use refs to ensure we have the most up-to-date values for cleanup without re-subscribing
      const currentWorkerId = workerIdRef.current;
      const currentApiBase = apiBaseRef.current;
      
      if (currentWorkerId) {
        const cleanupUrl = `${currentApiBase}/api/preview/${currentWorkerId}/delete`;
        if (navigator.sendBeacon) {
          navigator.sendBeacon(cleanupUrl);
        } else {
          fetch(cleanupUrl, { method: 'POST', keepalive: true }).catch(() => {});
        }
      }
    };
  }, []); // empty array — intentional

  return { previewUrl, loading, error };
}
