require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/react-code', (req, res) => {
  res.json({
    files: {
      "index.html": {
        file: {
          contents: "<!DOCTYPE html><html><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"></head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.jsx\"></script></body></html>"
        }
      },
      "src/index.css": {
        file: {
          contents: "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Poppins:wght@300;400;500;600;700&display=swap');\n\n:root {\n  scroll-behavior: smooth;\n}\n\n.reveal { opacity: 0; transform: translateY(40px); transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1); }\n.reveal.active { opacity: 1; transform: translateY(0); }\n.reveal-left { opacity: 0; transform: translateX(-60px); transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1); }\n.reveal-left.active { opacity: 1; transform: translateX(0); }\n.reveal-right { opacity: 0; transform: translateX(60px); transition: all 0.8s cubic-bezier(0.16, 1, 0.3, 1); }\n.reveal-right.active { opacity: 1; transform: translateX(0); }\n@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }\n.float { animation: float 3s ease-in-out infinite; }\n@keyframes slideUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }\n.hero-animate { animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }\n.hero-animate-delay-1 { animation: slideUp 0.8s 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards; opacity: 0; }\n.hero-animate-delay-2 { animation: slideUp 0.8s 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; opacity: 0; }\n@keyframes gradientShift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }\n.gradient-animate { background-size: 400% 400%; animation: gradientShift 8s ease infinite; }"
        }
      },
      "src/main.jsx": {
        file: {
          contents: "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport { Provider } from 'react-redux';\nimport { store } from './store';\nimport App from './App';\nimport './index.css';\n\nReactDOM.createRoot(document.getElementById('root')).render(\n  <React.StrictMode>\n    <Provider store={store}>\n      <App />\n    </Provider>\n  </React.StrictMode>\n);"
        }
      },
      "src/store/index.js": {
        file: {
          contents: "import { configureStore } from '@reduxjs/toolkit';\n// Import slices here\n\nexport const store = configureStore({\n  reducer: {\n    // Add reducers here\n  },\n});"
        }
      },
      "src/App.jsx": {
        file: {
          contents: "import React from 'react';\nimport { HashRouter, Routes, Route } from 'react-router-dom';\nimport Navbar from './components/Navbar';\nimport Hero from './components/Hero';\n// ...\n\nconst App = () => (\n  <div className=\"min-h-screen\">\n    <Navbar />\n    <Hero />\n    {/* ... */}\n  </div>\n);\n\nexport default App;"
        }
      },
      "src/components/Navbar.jsx": {
        file: {
          contents: "import React from 'react';\n// ...\nconst Navbar = () => {\n  return (<nav>...</nav>);\n};\nexport default Navbar;"
        }
      },
      "src/components/Hero.jsx": {
        file: {
          contents: "import React from 'react';\n// ...\nconst Hero = () => {\n  return (<section>...</section>);\n};\nexport default Hero;"
        }
      }
    }
  });
});

app.get('/next-code', (req, res) => {
  const userName = req.query.name || 'Harshit';
  res.json({
    'package.json': {
      file: {
        contents: `{\n  "name": "next-webcontainer-test",\n  "private": true,\n  "scripts": {\n    "dev": "next dev"\n  },\n  "dependencies": {\n    "next": "14.2.29",\n    "react": "18.2.0",\n    "react-dom": "18.2.0"\n  }\n}`
      }
    },
    app: {
      directory: {
        'layout.js': {
          file: {
            contents: `export const metadata = {\n  title: 'Next Test',\n  description: 'Next.js running inside WebContainer',\n}\n\nexport default function RootLayout({ children }) {\n  return (\n    <html lang="en">\n      <body>{children}</body>\n    </html>\n  )\n}`
          }
        },
        'page.js': {
          file: {
            contents: `'use client'\n\nimport { useEffect, useState } from 'react'\n\nexport default function Page() {\n  const [message, setMessage] = useState('Loading backend response...')\n  const [harshitMessage, setHarshitMessage] = useState('')\n  const [loading, setLoading] = useState(false)\n\n  useEffect(() => {\n    async function load() {\n      try {\n        const res = await fetch('api/hello')\n        const data = await res.json()\n        setMessage(data.message)\n      } catch {\n        setMessage('Failed to reach backend route')\n      }\n    }\n\n    load()\n  }, [])\n\n  const fetchHarshitMessage = async () => {\n    setLoading(true)\n    try {\n      const res = await fetch('api/harshit')\n      const data = await res.json()\n      setHarshitMessage(data.message)\n    } catch {\n      setHarshitMessage('Failed to fetch message')\n    } finally {\n      setLoading(false)\n    }\n  }\n\n  return (\n    <main style={{\n      minHeight: '100vh',\n      display: 'grid',\n      placeItems: 'center',\n      background: 'linear-gradient(135deg, #0f172a, #1e293b)',\n      color: '#e2e8f0',\n      fontFamily: 'system-ui, sans-serif',\n      padding: '24px',\n    }}>\n      <div style={{\n        width: 'min(680px, 100%)',\n        padding: '32px',\n        borderRadius: '24px',\n        background: 'rgba(15, 23, 42, 0.7)',\n        border: '1px solid rgba(148, 163, 184, 0.2)',\n        boxShadow: '0 24px 80px rgba(15, 23, 42, 0.45)',\n      }}>\n        <p style={{\n          margin: 0,\n          fontSize: '12px',\n          letterSpacing: '0.24em',\n          textTransform: 'uppercase',\n          color: '#93c5fd',\n        }}>\n          WebContainer Check\n        </p>\n        <h1 style={{\n          margin: '12px 0 10px',\n          fontSize: 'clamp(32px, 5vw, 56px)',\n          lineHeight: 1,\n        }}>\n          Next.js is running\n        </h1>\n        <p style={{\n          margin: 0,\n          fontSize: '18px',\n          lineHeight: 1.6,\n          color: '#cbd5e1',\n        }}>\n          If you can see this page in the preview, the container successfully installed dependencies and started a Next dev server.\n        </p>\n        <div style={{\n          marginTop: '24px',\n          padding: '16px 18px',\n          borderRadius: '16px',\n          background: 'rgba(59, 130, 246, 0.08)',\n          border: '1px solid rgba(96, 165, 250, 0.24)',\n          color: '#bfdbfe',\n          fontSize: '16px',\n        }}>\n          <strong>API response:</strong> {message}\n        </div>\n\n        {/* New Button Section */}\n        <div style={{\n          marginTop: '24px',\n          padding: '16px 18px',\n          borderRadius: '16px',\n          background: 'rgba(168, 85, 247, 0.08)',\n          border: '1px solid rgba(168, 85, 247, 0.24)',\n        }}>\n          <button\n            onClick={fetchHarshitMessage}\n            style={{\n              padding: '10px 24px',\n              background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',\n              border: 'none',\n              borderRadius: '12px',\n              color: 'white',\n              fontFamily: 'inherit',\n              fontSize: '16px',\n              fontWeight: 500,\n              cursor: loading ? 'not-allowed' : 'pointer',\n              opacity: loading ? 0.7 : 1,\n              transition: 'transform 0.15s, opacity 0.15s',\n              marginBottom: harshitMessage ? '16px' : 0,\n            }}\n            onMouseEnter={(e) => {\n              if (!loading) e.currentTarget.style.transform = 'translateY(-2px)'\n            }}\n            onMouseLeave={(e) => {\n              e.currentTarget.style.transform = 'translateY(0)'\n            }}\n            disabled={loading}\n          >\n            {loading ? \'Loading...\' : \'Greet ${userName} 👋\'}\n          </button>\n          {harshitMessage && (\n            <div style={{\n              marginTop: '16px',\n              padding: '12px',\n              borderRadius: '12px',\n              background: 'rgba(139, 92, 246, 0.15)',\n              border: '1px solid rgba(139, 92, 246, 0.3)',\n              fontSize: '18px',\n              fontWeight: 500,\n              textAlign: 'center',\n              animation: 'fadeIn 0.3s ease',\n            }}>\n              ✨ {harshitMessage} ✨\n            </div>\n          )}\n        </div>\n      </div>\n    </main>\n  )\n}`
          }
        },
        api: {
          directory: {
            hello: {
              directory: {
                'route.js': {
                  file: {
                    contents: `export async function GET() {\n  return Response.json({\n    message: 'Hello from Next.js backend route',\n  })\n}`
                  }
                }
              }
            },
            harshit: {
              directory: {
                'route.js': {
                  file: {
                    contents: `export async function GET() {\n  return Response.json({\n    message: 'Hello ${userName} Jain! 👋 Welcome to custome preview worker'\n  })\n}`
                  }
                }
              }
            }
          }
        }
      }
    }
  });
});
app.get('/helthcheck', (req, res) => {
  res.json({
    message: 'All good'
  })
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
