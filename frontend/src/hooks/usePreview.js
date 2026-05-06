import { useState, useEffect, useRef } from 'react';

export function usePreview({ projectId, files, apiBase = '', onReady }) {
  const [workerId, setWorkerId] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const prevFilesRef = useRef({});

  useEffect(() => {
    if (JSON.stringify(files) === JSON.stringify(prevFilesRef.current)) {
      return;
    }
    prevFilesRef.current = files;

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
            // Dev: Use direct worker URL for local testing to avoid path proxy asset issues.
            // Rewrite the returned localhost URL to use the apiBase hostname (in case of a remote worker).
            try {
              const previewOrigin = new URL(data.previewUrl);
              const baseOrigin = new URL(apiBase || window.location.origin);
              previewOrigin.hostname = baseOrigin.hostname;
              url = previewOrigin.toString();
            } catch (e) {
              url = data.previewUrl;
            }
          } else {
            // Prod: Use AWS API Gateway / CloudFront path proxy
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
        fetch(`${apiBase}/api/preview/${workerId}`, { method: 'DELETE' }).catch(console.error);
      }
    };
  }, [workerId, apiBase]);

  return { previewUrl, loading, error };
}
