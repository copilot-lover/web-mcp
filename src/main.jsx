import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Register WebMCP tools
import './webmcp/registerTools.js';
// Expose the read-only store snapshot + tool executor to a companion window.
import { installCompanionBridge } from './webmcp/companionBridge.js';

installCompanionBridge();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
