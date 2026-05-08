import React from 'react';
import { usePreview } from '../hooks/usePreview';

export const PreviewFrame = ({ projectId, files, onReady, className }) => {
  const { previewUrl, loading, error, status, reset } = usePreview({ projectId, files, onReady });

  if (error) {
    return (
      <div className={`p-6 bg-red-50 text-red-600 flex flex-col items-center justify-center h-full ${className || ''}`}>
        <p className="font-bold mb-4">Preview Error: {error}</p>
        <button 
          onClick={reset}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Reset Environment
        </button>
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full flex flex-col bg-white overflow-hidden rounded-lg shadow-md border border-gray-200 ${className || ''}`}>
      {/* Browser-like Address Bar */}
      <div className="w-full bg-gray-50 border-b border-gray-200 px-4 py-2 flex items-center z-20">
        <div className="flex space-x-2 mr-4 hidden sm:flex">
          <div className="w-3 h-3 rounded-full bg-red-400"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
          <div className="w-3 h-3 rounded-full bg-green-400"></div>
        </div>
        <div className="flex-1 bg-white rounded-md px-3 py-1.5 text-xs text-gray-500 truncate border border-gray-200 flex items-center cursor-text select-all">
          <span className="text-gray-400 mr-2">🔒</span>
          {previewUrl || 'about:blank'}
        </div>
        <button 
          onClick={reset}
          className="ml-4 text-[10px] text-gray-400 hover:text-red-500 transition-colors uppercase tracking-wider font-bold"
          title="Reset the environment"
        >
          Reset
        </button>
      </div>

      {/* Iframe / Content Container */}
      <div className="relative flex-1 w-full bg-gray-50">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90 backdrop-blur-sm transition-opacity duration-300">
            <div className="w-8 h-8 border-4 border-black border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-black font-bold uppercase tracking-widest text-[10px]">{status}</p>
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
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs font-mono uppercase tracking-widest">
            Ready to generate
          </div>
        )}
      </div>
    </div>
  );
};
