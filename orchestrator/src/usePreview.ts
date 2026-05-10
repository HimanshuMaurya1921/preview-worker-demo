import { useState, useEffect, useRef } from 'react';

interface UsePreviewOptions {
  projectId: string;
  files: Record<string, any>;
  apiBase?: string;
  onReady?: (url: string) => void;
}

export function usePreview({ projectId, files, apiBase = '', onReady }: UsePreviewOptions) {
  const [workerId, setWorkerId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prevFilesRef = useRef<Record<string, any>>({});

  useEffect(() => {
    const isProjectSwitch = prevFilesRef.current.projectId && prevFilesRef.current.projectId !== projectId;
    const prevFiles = { ...prevFilesRef.current };
    delete prevFiles.projectId;

    const filesChanged = JSON.stringify(files) !== JSON.stringify(prevFiles);

    if (!filesChanged && !isProjectSwitch) {
      return;
    }

    if (isProjectSwitch) {
      setWorkerId(null);
      setPreviewUrl(null);
    }
    
    prevFilesRef.current = { ...files, projectId };

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
          const url = `${apiBase}/api/preview/proxy/${data.workerId}/`;
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
      } catch (err: any) {
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
