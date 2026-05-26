import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Inject go2rtc live streaming engine web component dynamically at runtime
// This prevents build-time Rollup resolution errors while maintaining proxy compatibility
const script = document.createElement('script');
script.src = '/video-stream.js';
script.type = 'module';
document.head.appendChild(script);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
