import React from 'react';
import { usePreview } from './usePreview';

interface PreviewFrameProps {
  projectId: string;
  files: Record<string, any>;
  apiBase?: string;
  onReady?: (url: string) => void;
  className?: string;
}

export const PreviewFrame: React.FC<PreviewFrameProps> = ({ projectId, files, apiBase, onReady, className }) => {
  const { previewUrl, loading, error } = usePreview({ projectId, files, apiBase, onReady });

  if (error) {
    return <div className={`p-4 bg-red-50 text-red-600 ${className || ''}`}>Preview Error: {error}</div>;
  }

  return (
    <div className={`relative w-full h-full bg-white ${className || ''}`}>
      {loading && !previewUrl && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-gray-600 font-medium">Booting Next.js Environment...</p>
        </div>
      )}
      {previewUrl && (
        <iframe
          key={projectId}
          src={previewUrl}
          className="w-full h-full border-0"
          title="Live Preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      )}
      {!previewUrl && !loading && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400">
          Waiting for files...
        </div>
      )}
    </div>
  );
};
