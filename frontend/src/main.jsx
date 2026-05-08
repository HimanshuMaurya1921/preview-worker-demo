import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { TelemetryProvider, TelemetryOverlay } from './components/TelemetryProvider';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TelemetryProvider>
      <App />
      <TelemetryOverlay />
    </TelemetryProvider>
  </React.StrictMode>,
);
