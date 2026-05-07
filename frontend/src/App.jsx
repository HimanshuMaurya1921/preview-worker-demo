import { useState } from 'react';
import { PreviewFrame } from './components/PreviewFrame';

export default function App() {
  const [files, setFiles] = useState({});
  const [projectId] = useState(`project-${Date.now()}`);
  const [isGenerating, setIsGenerating] = useState(false);
  const [userName, setUserName] = useState('');

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
      <div className="p-6 bg-slate-50 flex flex-col items-start gap-4">
        <h1 className="text-2xl font-bold">AI Studio Preview Demo</h1>
        <p className="text-gray-600">Enter your name and generate a personalized Next.js project.</p>
        
        <input 
          type="text"
          placeholder="Enter your name"
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          className="px-4 py-2 border rounded w-full max-w-xs focus:ring-2 focus:ring-black outline-none"
        />

        <div className="flex gap-4">
          <button 
            onClick={handleGenerateNext}
            className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800"
            disabled={isGenerating}
          >
            {isGenerating ? 'Loading...' : 'Generate Next.js Demo'}
          </button>
        </div>

        <div className="mt-auto w-full p-4 bg-white rounded border border-gray-200 text-sm">
          <div className="text-gray-500 mb-2 font-semibold">Infrastructure Status</div>
          <div className="flex justify-between">
            <span>Runtime</span>
            <span className="text-blue-600 font-bold">K8s / KIND</span>
          </div>
          <div className="flex justify-between mt-1">
            <span>User ID</span>
            <span className="text-gray-400 font-mono text-xs">{localStorage.getItem('preview_user_id') || 'Initializing...'}</span>
          </div>
        </div>
      </div>

      <div className="border-l border-gray-200">
        <PreviewFrame
          projectId={projectId}
          files={files}
          apiBase={import.meta.env.VITE_WORKER_URL || 'http://localhost:3001'}
          className="border-0"
        />
      </div>
    </div>
  );
}
