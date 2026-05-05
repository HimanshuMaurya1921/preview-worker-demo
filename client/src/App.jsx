import { useState } from 'react';
import { PreviewFrame } from './components/PreviewFrame';

export default function App() {
  const [files, setFiles] = useState({});
  const [projectId] = useState(`project-${Date.now()}`);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateNext = async () => {
    setIsGenerating(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const res = await fetch(`${apiUrl}/next-code`);
      const data = await res.json();
      setFiles(data.files || data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateReact = async () => {
    setIsGenerating(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const res = await fetch(`${apiUrl}/react-code`);
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
        <p className="text-gray-600">Click a button to generate mock code and boot it in the preview frame.</p>
        
        <div className="flex gap-4">
          <button 
            onClick={handleGenerateNext}
            className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800"
            disabled={isGenerating}
          >
            {isGenerating ? 'Loading...' : 'Generate Next.js Demo'}
          </button>
          <button 
            onClick={handleGenerateReact}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            disabled={isGenerating}
          >
            {isGenerating ? 'Loading...' : 'Generate React Demo'}
          </button>
        </div>
      </div>

      <div className="border-l border-gray-200">
        <PreviewFrame
          projectId={projectId}
          files={files}
          apiBase={import.meta.env.VITE_RUNNER_URL || 'http://localhost:3001'}
          className="border-0"
        />
      </div>
    </div>
  );
}
