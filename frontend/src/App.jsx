import { useState, useEffect } from 'react';
import { PreviewFrame } from './components/PreviewFrame';
import { webContainerClient } from './lib/webcontainer-client';

export default function App() {
  const [files, setFiles] = useState({});
  const [projectId] = useState(`project-${Date.now()}`);
  const [isGenerating, setIsGenerating] = useState(false);
  const [userName, setUserName] = useState('');

  // Proactive boot on mount
  useEffect(() => {
    webContainerClient.init();
  }, []);

  const handleGenerateNext = async () => {
    setIsGenerating(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const res = await fetch(`${apiUrl}/next-code?name=${encodeURIComponent(userName || 'Harshit')}`);
      const data = await res.json();
      setFiles(data.files || data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="grid grid-cols-2 h-screen">
      <div className="p-12 bg-white flex flex-col items-start gap-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-black uppercase tracking-tighter italic">AI Studio</h1>
          <p className="text-gray-400 text-sm font-mono uppercase tracking-widest">Next.js WebContainer Runtime</p>
        </div>

        <div className="w-full max-w-sm space-y-4">
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Project Personalization</label>
            <input 
              type="text"
              placeholder="ENTER YOUR NAME"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="px-4 py-3 bg-gray-100 border-none rounded-none w-full focus:ring-2 focus:ring-black outline-none font-bold placeholder:text-gray-300"
            />
          </div>

          <button 
            onClick={handleGenerateNext}
            className="w-full py-4 bg-black text-white rounded-none hover:bg-gray-800 transition-all font-black uppercase tracking-widest text-xs disabled:opacity-50"
            disabled={isGenerating}
          >
            {isGenerating ? 'Synthesizing...' : 'Generate Next.js Project'}
          </button>
        </div>

        <div className="mt-auto">
          <p className="text-[10px] text-gray-300 max-w-xs leading-relaxed font-medium">
            This preview runs entirely in your browser using WebContainers. 
            No server-side pods are used. Optimized for Next.js AI generation.
          </p>
        </div>
      </div>

      <div className="bg-gray-100 p-4">
        <PreviewFrame
          projectId={projectId}
          files={files}
          className="shadow-2xl h-full"
        />
      </div>
    </div>
  );
}
