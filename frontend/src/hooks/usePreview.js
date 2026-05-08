import { useState, useEffect, useRef } from 'react';
import { webContainerClient } from '../lib/webcontainer-client';
import { AiOutputNormalizer } from '../lib/ai-output-normalizer';

const flattenFiles = (obj, prefix = '') => {
  let flat = {};
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = prefix ? `${prefix}/${key}` : key;
    if (typeof value === 'string') {
      flat[currentPath] = value;
    } else if (value && typeof value === 'object') {
      if (value.file && typeof value.file.contents === 'string') {
        flat[currentPath] = value.file.contents;
      } else if (value.directory) {
        Object.assign(flat, flattenFiles(value.directory, currentPath));
      } else if (typeof value.contents === 'string') {
        flat[currentPath] = value.contents;
      }
    }
  }
  return flat;
};

export function usePreview({ projectId, files, onReady }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('Initializing Runtime...');

  const normalizerRef = useRef(null);

  useEffect(() => {
    let active = true;

    const initRuntime = async () => {
      try {
        setLoading(true);
        setStatus('Booting WebContainer...');
        const wc = await webContainerClient.init();
        
        if (!normalizerRef.current) {
          normalizerRef.current = new AiOutputNormalizer(wc);
        }

        if (Object.keys(files).length > 0) {
          setStatus('Injecting Files...');
          const flatFiles = flattenFiles(files);
          await normalizerRef.current.patch(flatFiles);
          
          setStatus('Starting Next.js...');
          await webContainerClient.startDevServer((url) => {
            if (active) {
              setPreviewUrl(url);
              setLoading(false);
              if (onReady) onReady(url);
            }
          });
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error('[usePreview] Runtime Error:', err);
        if (active) {
          setError(err.message);
          setLoading(false);
        }
      }
    };

    initRuntime();

    return () => {
      active = false;
    };
  }, [files, onReady]);

  const reset = async () => {
    setLoading(true);
    setStatus('Resetting Environment...');
    await webContainerClient.reset();
    normalizerRef.current.clearCache();
    setLoading(false);
    setPreviewUrl(null);
  };

  return { previewUrl, loading, error, status, reset };
}
