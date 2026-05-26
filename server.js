import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3000;
const GO2RTC_PORT = 1984;

console.log('[MiCameraPro] Initializing secure backend server...');

// 1. Setup persistent storage directories and paths
const dataDir = process.env.DATA_DIR || process.cwd();
if (process.env.DATA_DIR && !fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`[MiCameraPro] Created custom data directory at: ${dataDir}`);
  } catch (err) {
    console.warn('[MiCameraPro] Warning: Could not create custom DATA_DIR:', err.message);
  }
}

const go2rtcPath = path.join(process.cwd(), 'go2rtc');
const configPath = path.join(dataDir, 'go2rtc.yaml');

// Ensure go2rtc binary is executable
try {
  if (fs.existsSync(go2rtcPath)) {
    fs.chmodSync(go2rtcPath, '755');
    console.log('[MiCameraPro] Validated go2rtc binary permissions.');
  } else {
    console.error('[MiCameraPro] ERROR: go2rtc binary not found at ' + go2rtcPath);
  }
} catch (err) {
  console.warn('[MiCameraPro] Warning: Could not adjust go2rtc permissions:', err.message);
}

// Write default go2rtc.yaml if it does not exist
if (!fs.existsSync(configPath)) {
  const defaultConfig = `streams: {}
`;
  try {
    fs.writeFileSync(configPath, defaultConfig);
    console.log('[MiCameraPro] Created empty default go2rtc.yaml configuration.');
  } catch (err) {
    console.error('[MiCameraPro] Could not write default go2rtc.yaml:', err);
  }
}

// On-boot credentials injection from env variables if provided
const injectEnvCredentials = () => {
  if (process.env.XIAOMI_USER && process.env.XIAOMI_TOKEN) {
    console.log('[MiCameraPro] XIAOMI_USER and XIAOMI_TOKEN detected in environment. Verifying credentials block...');
    const user = process.env.XIAOMI_USER;
    const token = process.env.XIAOMI_TOKEN;
    
    try {
      let content = fs.readFileSync(configPath, 'utf8');
      let lines = content.split('\n');
      let updatedLines = [];
      let insideXiaomi = false;
      let hasXiaomiBlock = false;
      let hasUser = false;

      for (let line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('xiaomi:')) {
          insideXiaomi = true;
          hasXiaomiBlock = true;
          updatedLines.push(line);
          continue;
        }
        if (insideXiaomi) {
          if (trimmed && !line.startsWith(' ') && !line.startsWith('\t')) {
            insideXiaomi = false;
          } else {
            if (trimmed.startsWith(`"${user}"`) || trimmed.startsWith(`'${user}'`) || trimmed.startsWith(`${user}:`)) {
              hasUser = true;
              updatedLines.push(`  "${user}": ${token}`);
              continue;
            }
          }
        }
        updatedLines.push(line);
      }

      if (!hasXiaomiBlock) {
        updatedLines.push('xiaomi:');
        updatedLines.push(`  "${user}": ${token}`);
      } else if (!hasUser) {
        const xIndex = updatedLines.findIndex(l => l.trim().startsWith('xiaomi:'));
        updatedLines.splice(xIndex + 1, 0, `  "${user}": ${token}`);
      }

      fs.writeFileSync(configPath, updatedLines.join('\n'));
      console.log('[MiCameraPro] Successfully injected environment credentials into go2rtc.yaml.');
    } catch (err) {
      console.error('[MiCameraPro] Error injecting env credentials:', err);
    }
  }
};

// Inject credentials before starting go2rtc
injectEnvCredentials();

// 2. Spawn go2rtc background process
let go2rtcProcess = null;

const spawnGo2rtc = () => {
  if (go2rtcProcess) {
    console.log('[MiCameraPro] Terminating existing go2rtc process...');
    go2rtcProcess.kill('SIGTERM');
  }

  console.log('[MiCameraPro] Spawning go2rtc child process...');
  // Pass configuration file explicitly if it is loaded from a custom data directory
  const args = dataDir !== process.cwd() ? ['-config', configPath] : [];
  
  go2rtcProcess = spawn('./go2rtc', args, {
    cwd: process.cwd(),
  });

  go2rtcProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) console.log(`[go2rtc] ${line.trim()}`);
    });
  });

  go2rtcProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) console.error(`[go2rtc-err] ${line.trim()}`);
    });
  });

  go2rtcProcess.on('close', (code) => {
    console.log(`[MiCameraPro] go2rtc process exited with code ${code}`);
  });
};

// Spawn go2rtc on boot
spawnGo2rtc();

// Graceful cleanup of child process
const cleanupAndExit = () => {
  console.log('[MiCameraPro] Shutting down Express server & terminating go2rtc...');
  if (go2rtcProcess) go2rtcProcess.kill('SIGTERM');
  process.exit();
};

process.on('SIGINT', cleanupAndExit);
process.on('SIGTERM', cleanupAndExit);

// 3. Configure API / WebSockets Proxy to go2rtc
console.log('[MiCameraPro] Setting up http-proxy-middleware proxy for go2rtc...');
const apiProxy = createProxyMiddleware({
  target: `http://127.0.0.1:${GO2RTC_PORT}`,
  changeOrigin: true,
  ws: true, // Enable WebSocket proxying
  logLevel: 'silent',
  on: {
    proxyReqWs: (proxyReq, req, socket, options, head) => {
      // Override Origin header to prevent Upgrader.CheckOrigin errors in go2rtc
      proxyReq.setHeader('Origin', `http://127.0.0.1:${GO2RTC_PORT}`);
    }
  }
});

// Configure Express body-parsing middlewares for specific non-proxied routes only
const jsonParser = express.json();
const urlencodedParser = express.urlencoded({ extended: true });

// 4. Session & Authentication Management
const activeSessions = new Set();

// Public auth check status
app.get('/api/auth/status', (req, res) => {
  return res.status(200).json({ authRequired: !!process.env.ADMIN_PASSWORD });
});

// Admin login verification
app.post('/api/auth/login', jsonParser, urlencodedParser, (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(200).json({ success: true, token: 'no_auth_configured' });
  }

  if (password === adminPassword) {
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.add(token);
    console.log('[MiCameraPro] Admin session created successfully.');
    return res.status(200).json({ success: true, token });
  } else {
    console.warn('[MiCameraPro] Failed login attempt with incorrect password.');
    return res.status(401).json({ success: false, error: 'Incorrect administrator password.' });
  }
});

// Check session validity
app.get('/api/auth/check', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1] || req.query.token;

  if (process.env.ADMIN_PASSWORD && (!token || !activeSessions.has(token))) {
    return res.status(401).json({ success: false, error: 'Session expired or unauthorized.' });
  }
  return res.status(200).json({ success: true });
});

// Authentication middleware to secure all other endpoints
const authMiddleware = (req, res, next) => {
  // Bypassed endpoints
  if (req.path === '/api/auth/status' || req.path === '/api/auth/login') {
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader?.split(' ')[1] || req.query.token;

  if (process.env.ADMIN_PASSWORD && (!token || !activeSessions.has(token))) {
    return res.status(401).json({ success: false, error: 'Unauthorized API access. Session token required.' });
  }
  next();
};

// Protect all /api endpoints
app.use('/api', authMiddleware);

// Intercept specific logout requests (removes accounts from go2rtc.yaml)
app.post('/api/xiaomi/logout', jsonParser, (req, res) => {
  const { id } = req.body;
  console.log(`[MiCameraPro] Logout requested for account ID: ${id || 'all'}`);
  
  try {
    if (fs.existsSync(configPath)) {
      let yamlContent = fs.readFileSync(configPath, 'utf8');
      const lines = yamlContent.split('\n');
      let updatedLines = [];
      let insideXiaomi = false;
      let removed = false;
      
      if (id) {
        for (let line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('xiaomi:')) {
            insideXiaomi = true;
            updatedLines.push(line);
            continue;
          }
          if (insideXiaomi) {
            if (trimmed && !line.startsWith(' ') && !line.startsWith('\t')) {
              insideXiaomi = false;
            } else if (trimmed.startsWith(`"${id}"`) || trimmed.startsWith(`'${id}'`) || trimmed.startsWith(`${id}:`)) {
              console.log(`[MiCameraPro] Removing account credentials: ${trimmed}`);
              removed = true;
              continue; // Skip this line
            }
          }
          updatedLines.push(line);
        }
      } else {
        // Clear all
        for (let line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('xiaomi:')) {
            insideXiaomi = true;
            updatedLines.push('xiaomi: {}');
            removed = true;
            continue;
          }
          if (insideXiaomi) {
            if (trimmed && !line.startsWith(' ') && !line.startsWith('\t')) {
              insideXiaomi = false;
            } else {
              continue; // Skip child indented lines
            }
          }
          updatedLines.push(line);
        }
      }
      
      fs.writeFileSync(configPath, updatedLines.join('\n'));
      console.log('[MiCameraPro] Updated go2rtc.yaml successfully.');
      
      // Hot-reload go2rtc config by restarting subprocess
      spawnGo2rtc();
      
      return res.status(200).json({ success: true, removed });
    } else {
      return res.status(404).json({ success: false, error: 'go2rtc.yaml file not found' });
    }
  } catch (err) {
    console.error('[MiCameraPro] Failed to handle logout:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Intercept PUT /api/streams requests and proxy to go2rtc, capturing the empty body YAML parser error
app.put('/api/streams', async (req, res) => {
  const { name, src } = req.query;
  console.log(`[MiCameraPro] Intercepting PUT /api/streams for stream name: "${name || ''}"`);
  
  if (!name || !src) {
    return res.status(400).json({ success: false, error: 'Missing name or src query parameters' });
  }

  try {
    const go2rtcUrl = `http://127.0.0.1:${GO2RTC_PORT}/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(src)}`;
    const upstreamRes = await fetch(go2rtcUrl, { method: 'PUT' });
    const text = await upstreamRes.text();
    
    console.log(`[MiCameraPro] upstream go2rtc responded with status: ${upstreamRes.status}, body: "${text}"`);

    if (upstreamRes.ok || (upstreamRes.status === 400 && text.includes('yaml: line 1'))) {
      console.log(`[MiCameraPro] Stream "${name}" registered successfully.`);
      return res.status(200).json({ success: true });
    } else {
      console.error(`[MiCameraPro] go2rtc failed to register stream "${name}": ${text}`);
      return res.status(upstreamRes.status).send(text);
    }
  } catch (err) {
    console.error('[MiCameraPro] Failed to proxy stream registration to go2rtc:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Restore prefixes stripped by Express mount points before forwarding to go2rtc
app.use('/api', (req, res, next) => {
  req.url = '/api' + req.url;
  apiProxy(req, res, next);
});

// Proxy go2rtc static streaming script components directly to frontend
app.use('/video-stream.js', (req, res, next) => {
  req.url = '/video-stream.js' + (req.url.startsWith('/') ? req.url.substring(1) : req.url);
  apiProxy(req, res, next);
});

app.use('/video-rtc.js', (req, res, next) => {
  req.url = '/video-rtc.js' + (req.url.startsWith('/') ? req.url.substring(1) : req.url);
  apiProxy(req, res, next);
});

// 5. Serve compiled static frontend React files
const distPath = path.join(process.cwd(), 'dist');
app.use(express.static(distPath));

// For SPA routing, serve index.html for non-API requests
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  
  const indexHtmlFile = path.join(distPath, 'index.html');
  if (fs.existsSync(indexHtmlFile)) {
    res.sendFile(indexHtmlFile);
  } else {
    res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>MiCameraPro Starting</title>
        <style>
          body { background: #0d0e12; color: #fff; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .card { text-align: center; border: 1px solid rgba(255,255,255,0.1); padding: 40px; border-radius: 12px; background: rgba(255,255,255,0.02); }
          h1 { color: #818cf8; margin-top: 0; }
          p { color: #9ca3af; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>MiCameraPro is booting up...</h1>
          <p>Please wait a moment while the frontend application builds.</p>
        </div>
      </body>
      </html>
    `);
  }
});

// 6. Start listening on single port
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[MiCameraPro] Secure application is listening on http://0.0.0.0:${PORT}`);
});

// WebSocket Upgrade handler - strictly validates tokens if ADMIN_PASSWORD is set
server.on('upgrade', (request, socket, head) => {
  console.log(`[MiCameraPro] WebSocket upgrade requested for URL: ${request.url}`);
  
  if (process.env.ADMIN_PASSWORD) {
    try {
      const urlObj = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const token = urlObj.searchParams.get('token');
      
      if (!token || !activeSessions.has(token)) {
        console.warn(`[MiCameraPro] Blocked unauthorized WebSocket upgrade from ${request.socket.remoteAddress}`);
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
    } catch (err) {
      console.error('[MiCameraPro] Error parsing WebSocket upgrade URL:', err.message);
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
  }

  apiProxy.upgrade(request, socket, head);
});
