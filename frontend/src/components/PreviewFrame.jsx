import React from 'react';
import { usePreview } from '../hooks/usePreview';

export const PreviewFrame = ({ projectId, files, apiBase, onReady, className }) => {
  const { previewUrl, loading, error } = usePreview({ projectId, files, apiBase, onReady });

  if (error) {
    return <div className={`p-4 bg-red-50 text-red-600 ${className || ''}`}>Preview Error: {error}</div>;
  }

  return (
    <div className={`relative w-full h-full flex flex-col bg-white overflow-hidden rounded-lg shadow-md border border-gray-200 ${className || ''}`}>
      {/* Browser-like Address Bar */}
      {previewUrl && (
        <div className="w-full bg-gray-50 border-b border-gray-200 px-4 py-2 flex items-center z-20">
          <div className="flex space-x-2 mr-4 hidden sm:flex">
            <div className="w-3 h-3 rounded-full bg-red-400"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
            <div className="w-3 h-3 rounded-full bg-green-400"></div>
          </div>
          <div className="flex-1 bg-white rounded-md px-3 py-1.5 text-xs text-gray-500 truncate border border-gray-200 flex items-center cursor-text select-all">
            <span className="text-gray-400 mr-2">🔒</span>
            {previewUrl}
          </div>
          <a 
            href={previewUrl} 
            target="_blank" 
            rel="noopener noreferrer" 
            className="ml-4 text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors flex items-center"
            title="Open in new tab"
          >
            Open App
            <svg className="w-3.5 h-3.5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path>
            </svg>
          </a>
        </div>
      )}

      {/* Iframe / Content Container */}
      <div className="relative flex-1 w-full bg-gray-50">
        {loading && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/80 backdrop-blur-md transition-all duration-500">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4 shadow-sm"></div>
            <p className="text-gray-800 font-semibold tracking-tight">Syncing changes...</p>
            <p className="text-gray-500 text-xs mt-1">Preparing your Next.js environment</p>
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
    </div>
  );
};
