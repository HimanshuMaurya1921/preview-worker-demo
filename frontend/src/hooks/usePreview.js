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
          await fetch(`${apiBase}/api/preview/${workerId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files })
          });
        }
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    const timeout = setTimeout(startOrUpdate, 600);
    return () => clearTimeout(timeout);
  }, [files, workerId, projectId, apiBase]);

  useEffect(() => {
    return () => {
      if (workerId) {
        const cleanupUrl = `${apiBase}/api/preview/${workerId}/delete`;
        if (navigator.sendBeacon) {
          // sendBeacon is more reliable on tab close
          navigator.sendBeacon(cleanupUrl);
        } else {
          fetch(cleanupUrl, { method: 'POST', keepalive: true }).catch(() => {});
        }
      }
    };
  }, [workerId, apiBase]);

  return { previewUrl, loading, error };
}
