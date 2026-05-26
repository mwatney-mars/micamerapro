import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Tv,
  Settings,
  Key,
  RefreshCw,
  Play,
  Trash,
  Plus,
  X,
  ShieldAlert,
  Video,
  Activity,
  Wifi,
  User,
  Globe,
  Sliders,
  HelpCircle,
  Smartphone,
  Mail,
  Info,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Lock,
  KeyRound
} from 'lucide-react';

const REGIONS = [
  { value: 'cn', label: 'China (Mainland)', flag: '🇨🇳' },
  { value: 'de', label: 'Europe (Germany)', flag: '🇪🇺' },
  { value: 'us', label: 'United States', flag: '🇺🇸' },
  { value: 'br', label: 'Brazil', flag: '🇧🇷' },
  { value: 'sg', label: 'Singapore', flag: '🇸🇬' },
  { value: 'ru', label: 'Russia', flag: '🇷🇺' },
  { value: 'i2', label: 'India', flag: '🇮🇳' },
  { value: 'ca', label: 'Canada', flag: '🇨🇦' },
  { value: 'gb', label: 'United Kingdom', flag: '🇬🇧' },
];

export default function App() {
  // Connection states
  const [streams, setStreams] = useState({});
  const [accounts, setAccounts] = useState([]);
  const [devices, setDevices] = useState([]);
  
  // Active settings
  const [selectedAccount, setSelectedAccount] = useState('');
  const [selectedRegion, setSelectedRegion] = useState('de');
  
  // UI states
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [activePlayStream, setActivePlayStream] = useState(null);
  const [notification, setNotification] = useState(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showFaq, setShowFaq] = useState(false);

  // Security / Auth states
  const [authToken, setAuthToken] = useState(localStorage.getItem('micamera_admin_token') || '');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [authLoading, setAuthRequiredLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Helper: inject Authorization headers
  const getAuthHeaders = (extraHeaders = {}) => {
    const headers = { ...extraHeaders };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    return headers;
  };

  // Custom streaming element states
  const [playerReady, setPlayerReady] = useState(false);
  const playerRef = useRef(null);

  // Login wizard state
  const [loginStep, setLoginStep] = useState('credentials'); // 'credentials', 'captcha', 'verify'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaImg, setCaptchaImg] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyLabel, setVerifyLabel] = useState('');
  const [submittingLogin, setSubmittingLogin] = useState(false);
  const [liveTime, setLiveTime] = useState('');

  // Poll intervals
  const streamsPollRef = useRef(null);

  // 1. Show notification toast
  const showToast = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  // 2. Fetch current active streams from go2rtc
  const fetchStreams = async () => {
    try {
      setLoadingStreams(true);
      const res = await fetch('/api/streams', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setStreams(data || {});
      }
    } catch (err) {
      console.error('Failed to fetch streams:', err);
    } finally {
      setLoadingStreams(false);
    }
  };

  // 3. Fetch logged-in Xiaomi accounts
  const fetchAccounts = async () => {
    try {
      const res = await fetch('/api/xiaomi', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setAccounts(data || []);
        if (data && data.length > 0 && !selectedAccount) {
          setSelectedAccount(data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    }
  };

  // 4. Load devices for an account in a region
  const loadDevices = async (accountId = selectedAccount, region = selectedRegion) => {
    if (!accountId) return;
    try {
      setLoadingDevices(true);
      
      // Map unsupported UI regions to their corresponding Xiaomi API regional servers
      const mapRegion = (reg) => {
        const mapping = {
          'br': 'us', // Brazil routes through US server
          'ca': 'us', // Canada routes through US server
          'gb': 'de', // UK routes through Europe (Germany) server
        };
        return mapping[reg] || reg;
      };
      
      const targetRegion = mapRegion(region);
      const params = new URLSearchParams({ id: accountId, region: targetRegion });
      const res = await fetch(`/api/xiaomi?${params.toString()}`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        const mappedDevices = (data?.sources || []).map(dev => {
          let did = '';
          if (dev.url) {
            const match = dev.url.match(/[?&]did=([^&]+)/);
            if (match) did = match[1];
          }
          return {
            ...dev,
            id: did || dev.name,
          };
        });
        setDevices(mappedDevices);
        showToast(`Discovered ${mappedDevices.length} cameras in region ${region.toUpperCase()}.`);
      } else {
        const errText = await res.text();
        setDevices([]);
        showToast(`Could not fetch devices: ${errText || res.statusText}`, 'error');
      }
    } catch (err) {
      console.error('Failed to fetch devices:', err);
      showToast('Network error while listing devices.', 'error');
    } finally {
      setLoadingDevices(false);
    }
  };

  // 5. Log out / Disconnect a Xiaomi account from configuration
  const handleLogout = async (accountId) => {
    if (!accountId) return;
    try {
      const res = await fetch('/api/xiaomi/logout', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: accountId })
      });
      if (res.ok) {
        showToast(`Logged out account ${accountId} successfully.`);
        // Refresh accounts list
        const response = await fetch('/api/xiaomi', { headers: getAuthHeaders() });
        if (response.ok) {
          const data = await response.json();
          setAccounts(data || []);
          if (data && data.length > 0) {
            // Pick next available account
            const nextAcc = data.find(acc => acc !== accountId) || data[0];
            setSelectedAccount(nextAcc);
          } else {
            setSelectedAccount('');
            setDevices([]);
          }
        }
      } else {
        const errText = await res.text();
        showToast(`Logout failed: ${errText || res.statusText}`, 'error');
      }
    } catch (err) {
      console.error('Failed to logout account:', err);
      showToast('Network error during logout.', 'error');
    }
  };

  // On mount: Resolve administrator security/authentication status
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const res = await fetch('/api/auth/status');
        const data = await res.json();
        
        if (data.authRequired) {
          setAuthRequired(true);
          const savedToken = localStorage.getItem('micamera_admin_token');
          if (savedToken) {
            const checkRes = await fetch('/api/auth/check', {
              headers: { 'Authorization': `Bearer ${savedToken}` }
            });
            if (checkRes.ok) {
              setAuthToken(savedToken);
              setIsAuthenticated(true);
            } else {
              localStorage.removeItem('micamera_admin_token');
            }
          }
        } else {
          setIsAuthenticated(true);
        }
      } catch (err) {
        console.error('Failed to resolve auth status:', err);
      } finally {
        setAuthRequiredLoading(false);
      }
    };
    
    initializeAuth();
  }, []);

  // Poll active feeds only when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchStreams();
      fetchAccounts();

      // Set up continuous streams polling (every 3s to keep statuses live)
      streamsPollRef.current = setInterval(fetchStreams, 3000);

      return () => {
        if (streamsPollRef.current) clearInterval(streamsPollRef.current);
      };
    }
  }, [isAuthenticated, authToken]);

  // Handle administrator dashboard verification login
  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem('micamera_admin_token', data.token);
        setAuthToken(data.token);
        setIsAuthenticated(true);
        showToast('Administrator authenticated successfully.', 'success');
      } else {
        setAuthError(data.error || 'Incorrect administrator password.');
      }
    } catch (err) {
      setAuthError('Network error during login.');
    }
  };

  // Lock session and log out
  const handleAdminLogout = () => {
    localStorage.removeItem('micamera_admin_token');
    setAuthToken('');
    setIsAuthenticated(false);
    setAdminPassword('');
    setShowPassword(false);
    showToast('Administrator session locked.');
  };

  // When accounts or region changes, load devices
  useEffect(() => {
    if (selectedAccount && selectedRegion) {
      loadDevices(selectedAccount, selectedRegion);
    } else {
      setDevices([]);
    }
  }, [selectedAccount, selectedRegion]);

  // Listen for go2rtc video-stream custom element definition
  useEffect(() => {
    if (typeof customElements !== 'undefined') {
      customElements.whenDefined('video-stream').then(() => {
        console.log('[MiCameraPro] video-stream element is fully defined and ready.');
        setPlayerReady(true);
      });
    }
  }, []);

  // Update streaming engine properties directly when activePlayStream changes
  useEffect(() => {
    if (playerReady && playerRef.current && activePlayStream) {
      const srcUrl = `${window.location.origin}/api/ws?src=${encodeURIComponent(activePlayStream)}&token=${encodeURIComponent(authToken)}`;
      console.log('[MiCameraPro] Directing stream playback for:', activePlayStream);
      console.log('[MiCameraPro] Configured WebSocket src:', srcUrl);
      
      // Directly assign JS properties to trigger web component prototype setters
      playerRef.current.background = true;
      playerRef.current.src = srcUrl;
    }
  }, [activePlayStream, playerReady, authToken]);

  // Ticking clock for CCTV digital overlay
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const pad = (num) => String(num).padStart(2, '0');
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      setLiveTime(`${dateStr} ${timeStr}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // 5. Submit Credentials (Login Step 1)
  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setSubmittingLogin(true);
    try {
      const body = new URLSearchParams();
      body.append('username', username);
      body.append('password', password);

      const res = await fetch('/api/xiaomi', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: body.toString(),
      });

      if (res.status === 401) {
        const data = await res.json();
        if (data.captcha) {
          setCaptchaImg(data.captcha);
          setLoginStep('captcha');
          showToast('Verification Captcha required.', 'info');
        } else {
          setVerifyLabel(data.verify_email || data.verify_phone || 'Two-Factor Verification');
          setLoginStep('verify');
          showToast('2FA Verification code sent.', 'info');
        }
      } else if (res.ok) {
        showToast('Successfully logged into Xiaomi Cloud!');
        await fetchAccounts();
        setShowLoginModal(false);
        resetLoginState();
      } else {
        const errText = await res.text();
        showToast(`Login failed: ${errText || 'Invalid credentials'}`, 'error');
      }
    } catch (err) {
      console.error('Login error:', err);
      showToast('Network error during login.', 'error');
    } finally {
      setSubmittingLogin(false);
    }
  };

  // 6. Submit Captcha Code
  const handleCaptchaSubmit = async (e) => {
    e.preventDefault();
    setSubmittingLogin(true);
    try {
      const body = new URLSearchParams();
      body.append('captcha', captchaCode);

      const res = await fetch('/api/xiaomi', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: body.toString(),
      });

      if (res.status === 401) {
        const data = await res.json();
        if (data.captcha) {
          setCaptchaImg(data.captcha);
          setCaptchaCode('');
          showToast('Invalid captcha. Please try again.', 'error');
        } else {
          setVerifyLabel(data.verify_email || data.verify_phone || '2FA');
          setLoginStep('verify');
          showToast('Captcha verified. 2FA Code sent.', 'info');
        }
      } else if (res.ok) {
        showToast('Successfully logged into Xiaomi!');
        await fetchAccounts();
        setShowLoginModal(false);
        resetLoginState();
      } else {
        const errText = await res.text();
        showToast(`Verification failed: ${errText}`, 'error');
      }
    } catch (err) {
      console.error('Captcha submit error:', err);
      showToast('Network error submitting captcha.', 'error');
    } finally {
      setSubmittingLogin(false);
    }
  };

  // 7. Submit 2FA Code
  const handleVerifySubmit = async (e) => {
    e.preventDefault();
    setSubmittingLogin(true);
    try {
      const body = new URLSearchParams();
      body.append('verify', verifyCode);

      const res = await fetch('/api/xiaomi', {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: body.toString(),
      });

      if (res.status === 401) {
        const data = await res.json();
        setVerifyCode('');
        showToast('Invalid verification code. Please check and try again.', 'error');
      } else if (res.ok) {
        showToast('Successfully authenticated and logged in!');
        await fetchAccounts();
        setShowLoginModal(false);
        resetLoginState();
      } else {
        const errText = await res.text();
        showToast(`Verification failed: ${errText}`, 'error');
      }
    } catch (err) {
      console.error('Verify code submit error:', err);
      showToast('Network error submitting verification code.', 'error');
    } finally {
      setSubmittingLogin(false);
    }
  };

  const resetLoginState = () => {
    setLoginStep('credentials');
    setUsername('');
    setPassword('');
    setCaptchaCode('');
    setCaptchaImg('');
    setVerifyCode('');
    setVerifyLabel('');
  };



  // 8. Auto-register and play a camera stream (Single-Click Play)
  const playCamera = async (device, isHd = true) => {
    try {
      setLoadingStreams(true);
      const cleanName = device.name.replace(/[<">]/g, '').trim();
      
      // Stop current active stream if there is one and it's different
      if (activePlayStream && activePlayStream !== cleanName) {
        try {
          const params = new URLSearchParams({ src: activePlayStream });
          await fetch(`/api/streams?${params.toString()}`, { method: 'DELETE', headers: getAuthHeaders() });
        } catch (e) {
          console.error('Failed to clean up old stream:', e);
        }
      }

      let streamUrl = device.url;
      // Adjust quality default parameter (hd/sd) based on selection
      if (device.url.includes('xiaomi://')) {
        const urlObj = new URL(device.url);
        urlObj.searchParams.set('subtype', isHd ? 'hd' : 'sd');
        streamUrl = urlObj.toString().replace('xiaomi/', 'xiaomi://');
      }

      const params = new URLSearchParams({ name: cleanName, src: streamUrl });
      const res = await fetch(`/api/streams?${params.toString()}`, {
        method: 'PUT',
        headers: getAuthHeaders()
      });

      if (res.ok) {
        showToast(`Starting live stream for "${cleanName}" (${isHd ? 'HD' : 'SD'})...`);
        setActivePlayStream(cleanName);
        fetchStreams();
      } else {
        const errText = await res.text();
        showToast(`Could not register stream: ${errText}`, 'error');
      }
    } catch (err) {
      console.error('Failed to play camera:', err);
      showToast('Network error starting stream.', 'error');
    } finally {
      setLoadingStreams(false);
    }
  };

  // 9. Stop and unregister camera stream
  const stopCamera = async (name) => {
    try {
      const params = new URLSearchParams({ src: name });
      const res = await fetch(`/api/streams?${params.toString()}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        showToast(`Stopped stream "${name}".`);
      }
      setActivePlayStream(null);
      fetchStreams();
    } catch (err) {
      console.error('Failed to stop stream:', err);
      showToast('Network error stopping stream.', 'error');
    }
  };

  // Helper: Check if a discovered camera has an active streaming stream registered
  const getActiveStreamName = (device) => {
    const keys = Object.keys(streams);
    return keys.find(key => {
      // Find stream that has matching Device ID (did) in its parameters
      const streamInfo = streams[key];
      const srcUrl = typeof streamInfo === 'string' ? streamInfo : '';
      return srcUrl.includes(`did=${device.id}`) || key === device.name;
    });
  };

  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen" style={{ background: 'radial-gradient(ellipse at top, #101524, #080a10)' }}>
        <div className="flex flex-col items-center gap-4 text-center">
          <RefreshCw className="animate-spin text-indigo-500" size={40} />
          <p className="text-sm font-semibold text-slate-400 font-outfit uppercase tracking-wider">Securing Terminal...</p>
        </div>
      </div>
    );
  }

  if (authRequired && !isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4" style={{ background: 'radial-gradient(ellipse at top, #101524, #080a10)' }}>
        <div className="relative w-full max-w-md">
          {/* Glowing ambient background backdrops */}
          <div className="absolute -top-12 -left-12 w-48 h-48 bg-indigo-600/10 rounded-full blur-[64px] pointer-events-none"></div>
          <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-purple-600/10 rounded-full blur-[64px] pointer-events-none"></div>
          
          <div className="glass-card p-8 border-white/10 flex flex-col gap-6 relative shadow-2xl overflow-hidden" style={{ background: 'rgba(12, 15, 23, 0.7)', backdropFilter: 'blur(20px)' }}>
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="p-4 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20">
                <Lock className="text-white" size={32} />
              </div>
              <div>
                <h1 className="text-2xl font-bold font-outfit text-white tracking-tight mt-1">Console Locked</h1>
                <p className="text-xs text-slate-400 mt-1">Enter the administrator password to access the CCTV Command Center</p>
              </div>
            </div>

            <form onSubmit={handleAdminLogin} className="flex flex-col gap-4 mt-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
                  <KeyRound size={13} className="text-indigo-400" /> Admin Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="••••••••"
                    className="form-input w-full pr-10"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <X size={15} /> : <KeyRound size={15} />}
                  </button>
                </div>
              </div>

              {authError && (
                <div className="text-xs text-rose-400 font-medium bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
                  ⚠️ {authError}
                </div>
              )}

              <button
                type="submit"
                className="btn-primary mt-2 py-3 w-100 font-semibold"
              >
                Unlock Terminal
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen pb-12" style={{ background: 'radial-gradient(ellipse at top, #101524, #080a10)' }}>
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-6 right-6 z-50 flex items-center gap-3 p-4 rounded-xl shadow-2xl transition-all duration-300 transform translate-y-0 ${
            notification.type === 'error'
              ? 'bg-rose-500/10 border border-rose-500/30 text-rose-200'
              : notification.type === 'info'
              ? 'bg-sky-500/10 border border-sky-500/30 text-sky-200'
              : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-200'
          }`}
          style={{
            backdropFilter: 'blur(16px)',
            animation: 'modal-fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
            minWidth: '280px',
            maxWidth: '450px'
          }}
        >
          <div className={`p-1.5 rounded-lg ${
            notification.type === 'error' ? 'bg-rose-500/20' : notification.type === 'info' ? 'bg-sky-500/20' : 'bg-emerald-500/20'
          }`}>
            <ShieldAlert size={18} />
          </div>
          <div className="flex-1 text-sm font-medium">{notification.message}</div>
          <button onClick={() => setNotification(null)} className="text-white/40 hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Elegant Header */}
      <header className="border-b border-white/5 bg-black/20 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-500 shadow-md shadow-indigo-500/20">
              <Camera className="text-white" size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold font-outfit text-white tracking-tight">MiCamera<span className="text-indigo-400">Pro</span></h1>
                <span className="text-[10px] tracking-wider uppercase bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 font-bold px-2 py-0.5 rounded-full">v1.0</span>
              </div>
              <p className="text-xs text-slate-400">Premium Stream Controller for Xiaomi C400 & Ecosystem</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowFaq(!showFaq)}
              className="btn-secondary py-2.5 px-4 text-xs font-semibold gap-1.5"
            >
              <HelpCircle size={15} /> Help & Guide
            </button>

            {authRequired && isAuthenticated && (
              <button
                onClick={handleAdminLogout}
                className="btn-secondary border-rose-500/20 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 py-2.5 px-4 text-xs font-semibold gap-1.5"
                title="Lock Console"
              >
                <Lock size={15} /> Lock Console
              </button>
            )}

            {accounts.length > 0 ? (
              <div className="flex items-center gap-3 bg-white/5 border border-white/5 rounded-xl p-1.5 pl-3">
                {accounts.length > 1 ? (
                  <div className="flex items-center gap-1.5">
                    <User size={14} className="text-indigo-400" />
                    <select
                      value={selectedAccount}
                      onChange={(e) => setSelectedAccount(e.target.value)}
                      className="bg-transparent text-xs text-slate-300 font-medium font-mono border-none outline-none cursor-pointer focus:ring-0 p-0 pr-6"
                    >
                      {accounts.map(acc => (
                        <option key={acc} value={acc} className="bg-slate-900 text-slate-300 font-mono">
                          {acc}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <User size={14} className="text-indigo-400" />
                    <span className="text-xs text-slate-300 font-medium font-mono">{selectedAccount}</span>
                  </div>
                )}
                
                <div className="flex items-center gap-1.5 border-l border-white/10 pl-2">
                  <button
                    onClick={() => setShowLoginModal(true)}
                    className="btn-primary py-1.5 px-2.5 text-[10px] rounded-lg shadow-none"
                  >
                    Add Account
                  </button>
                  <button
                    onClick={() => handleLogout(selectedAccount)}
                    className="btn-secondary py-1.5 px-2.5 text-[10px] rounded-lg border-rose-500/20 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                  >
                    Logout
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowLoginModal(true)}
                className="btn-primary py-2.5 px-5 text-sm gap-2"
              >
                <Key size={16} /> Connect Xiaomi Account
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="max-w-7xl mx-auto px-6 mt-8 flex-1 grid grid-cols-1 lg:grid-cols-12 gap-8 w-100">
        
        {/* Left Sidebar: Cameras List & Connection Status */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* Discovered Xiaomi Cameras (Sidebar Card List) */}
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold font-outfit text-white flex items-center gap-2">
                  <Camera size={18} className="text-indigo-400" /> Cameras List
                </h2>
                <p className="text-[10px] text-slate-400 mt-0.5">Scanned from cloud account</p>
              </div>
              
              {accounts.length > 0 && (
                <button
                  onClick={() => loadDevices()}
                  disabled={loadingDevices}
                  className="btn-secondary py-1.5 px-2.5 text-[10px] gap-1"
                >
                  <RefreshCw size={10} className={loadingDevices ? 'animate-spin' : ''} /> Scan
                </button>
              )}
            </div>

            {accounts.length === 0 ? (
              <div className="glass-card p-6 text-center flex flex-col items-center gap-3 bg-slate-900/5">
                <Key size={24} className="text-slate-500" />
                <div>
                  <h4 className="text-xs font-bold text-white mb-1">Account Not Linked</h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Link your account to sync your C400 and other cameras.
                  </p>
                  <button
                    onClick={() => setShowLoginModal(true)}
                    className="btn-primary py-2 px-3 text-[10px] font-semibold mt-2.5 gap-1"
                  >
                    <Plus size={11} /> Link My Account
                  </button>
                </div>
              </div>
            ) : loadingDevices ? (
              <div className="flex flex-col items-center justify-center p-8 gap-2 bg-slate-900/10 border border-white/5 rounded-xl">
                <RefreshCw size={20} className="text-indigo-400 animate-spin" />
                <p className="text-xs text-slate-400">Scanning cloud...</p>
              </div>
            ) : devices.length === 0 ? (
              <div className="glass-card p-6 text-center flex flex-col items-center gap-2.5 bg-slate-900/5">
                <Info size={20} className="text-slate-500" />
                <div>
                  <h4 className="text-xs font-bold text-white mb-0.5">No Cameras Discovered</h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    No cameras found in <strong>{selectedRegion.toUpperCase()}</strong>.
                  </p>
                  <p className="text-[10px] text-indigo-400 mt-1.5 leading-relaxed">
                    💡 Try switching the region below to CN (Mainland China) or US if your camera is registered there.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3.5">
                {devices.map((dev) => {
                  const activeStreamName = getActiveStreamName(dev);
                  const isCurrentlyPlaying = activePlayStream && activeStreamName === activePlayStream;

                  return (
                    <div
                      key={dev.id}
                      className={`glass-card p-4 transition-all duration-300 flex flex-col gap-3 border ${
                        isCurrentlyPlaying
                          ? 'border-indigo-500/40 bg-indigo-500/5 shadow-md shadow-indigo-500/5'
                          : 'border-white/5'
                      }`}
                    >
                      {/* Card Header: Title and Location Badges */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {isCurrentlyPlaying && (
                              <span className="pulse-dot" style={{ backgroundColor: '#6366f1', boxShadow: '0 0 6px #6366f1' }}></span>
                            )}
                            <h4 className="text-sm font-bold text-white truncate font-outfit" title={dev.name}>
                              {dev.name}
                            </h4>
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-[9px] tracking-wide font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/5 text-indigo-300">
                              {dev.info || 'Unknown Model'}
                            </span>
                            <span className="text-[9px] text-slate-400 font-medium px-1.5 py-0.5 rounded bg-slate-900/40 border border-white/5">
                              {dev.location || 'Default Room'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Device Meta details (subtle mono lines) */}
                      <div className="bg-black/20 p-2 rounded-lg border border-white/5 flex flex-col gap-1 text-[10px] text-slate-400 font-mono">
                        <div className="flex justify-between">
                          <span>Device ID:</span>
                          <span className="text-slate-300 truncate max-w-[130px]" title={dev.id}>{dev.id}</span>
                        </div>
                      </div>

                      {/* Card Actions: Play HD / Play SD / Stop */}
                      <div className="flex items-center justify-end gap-1.5 border-t border-white/5 pt-2.5 mt-0.5">
                        {isCurrentlyPlaying ? (
                          <button
                            onClick={() => stopCamera(activePlayStream)}
                            className="btn-danger py-1.5 px-3 text-[10px] font-semibold gap-1 shadow-none w-full"
                          >
                            <X size={11} /> Stop Feed
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => playCamera(dev, true)}
                              className="btn-primary py-1.5 px-3 text-[10px] font-semibold gap-1 shadow-none flex-1"
                            >
                              <Play size={10} fill="white" /> Play HD
                            </button>
                            <button
                              onClick={() => playCamera(dev, false)}
                              className="btn-secondary py-1.5 px-2.5 text-[10px] font-semibold shadow-none"
                              title="Play in Standard Definition (SD)"
                            >
                              SD
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Connection Overview Card */}
          <div className="glass-card p-5 flex flex-col gap-4">
            <h3 className="text-md font-bold font-outfit text-white flex items-center gap-2 border-b border-white/5 pb-3">
              <Activity size={16} className="text-indigo-400" /> Connection Status
            </h3>
            
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Local Gateway:</span>
                <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                  <span className="pulse-dot"></span> Active (Port 3000)
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">go2rtc Streaming:</span>
                <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                  <span className="pulse-dot"></span> Active (Port 1984)
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Xiaomi Cloud:</span>
                {accounts.length > 0 ? (
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    Connected ({accounts.length})
                  </span>
                ) : (
                  <span className="text-rose-400 font-semibold">Not Connected</span>
                )}
              </div>
            </div>

            {/* Region Switcher */}
            {accounts.length > 0 && (
              <div className="flex flex-col gap-2 mt-2">
                <label className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
                  <Globe size={13} className="text-indigo-400" /> Select Region Cloud
                </label>
                <select
                  value={selectedRegion}
                  onChange={(e) => setSelectedRegion(e.target.value)}
                  className="form-select text-xs py-2 bg-slate-900 border border-white/10"
                >
                  {REGIONS.map(reg => (
                    <option key={reg.value} value={reg.value}>
                      {reg.flag} {reg.label}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-500">
                  Xiaomi isolates device lists by country. Please select the region your camera is registered in.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Area: Main CCTV Stage Console */}
        <div className="lg:col-span-8 flex flex-col gap-8">
          
          {/* FAQ/Guide Widget */}
          {showFaq && (
            <div className="glass-card p-6 border-indigo-500/20 bg-indigo-500/5 relative" style={{ animation: 'modal-fade-in 0.3s ease' }}>
              <button
                onClick={() => setShowFaq(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-white"
              >
                <X size={16} />
              </button>
              <h3 className="text-lg font-bold font-outfit text-indigo-300 mb-3 flex items-center gap-2">
                <Info size={18} /> Getting Started with MiCameraPro
              </h3>
              <div className="text-xs text-slate-300 flex flex-col gap-3 leading-relaxed">
                <p>
                  Welcome to <strong>MiCameraPro</strong>. This professional dashboard interacts with an embedded <strong>go2rtc</strong> server to bypass official app limitations and deliver low-latency camera streaming directly to your web browser.
                </p>
                <ol className="list-decimal pl-5 flex flex-col gap-2">
                  <li>
                    <strong>Login to Xiaomi:</strong> Click the <strong>Connect Xiaomi Account</strong> button on the header. Fill in your official Mi Home credentials. Complete the Captcha or 2FA email/SMS code if prompted.
                  </li>
                  <li>
                    <strong>Choose Region & Discovery:</strong> Once logged in, choose the region where you registered your camera in the Xiaomi Home App (e.g. Mainland China, Europe, United States). Your camera devices will automatically load!
                  </li>
                  <li>
                    <strong>Create Live Stream:</strong> Click <strong>Add to Streams</strong> on any discovered camera. This creates a local, highly optimized stream bridge using local secure streaming.
                  </li>
                  <li>
                    <strong>Access Anywhere:</strong> Expose port <strong>3000</strong> using a service like Cloudflare Tunnel or router port-forwarding to watch your streams on the go anywhere in the world securely!
                  </li>
                </ol>
              </div>
            </div>
          )}

          {/* CCTV Live Feed Monitor (Main Stage) */}
          <div className="glass-card p-6 flex flex-col gap-5">
            <h3 className="text-lg font-bold font-outfit text-white flex flex-wrap items-center justify-between border-b border-white/5 pb-3 gap-2">
              <span className="flex items-center gap-2.5">
                <Video size={20} className="text-indigo-400" /> CCTV Security Live Feed
              </span>
              {activePlayStream && (
                <span className="rec-indicator text-[11px] text-rose-400 font-bold px-2.5 py-1">
                  <span className="pulse-dot animate-pulse" style={{ backgroundColor: '#f43f5e', boxShadow: '0 0 6px #f43f5e' }}></span>
                  LIVE BRIDGE
                </span>
              )}
            </h3>

            {activePlayStream ? (
              <div className="flex flex-col gap-5">
                <div className="overflow-hidden rounded-xl border border-white/10 bg-black shadow-2xl flex flex-col">
                  <div className="relative bg-black w-full overflow-hidden rounded-t-xl">
                    {playerReady ? (
                      <video-stream
                        key={activePlayStream}
                        ref={playerRef}
                        style={{ width: '100%', display: 'block', aspectRatio: '16/9' }}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center p-16 gap-3" style={{ aspectRatio: '16/9' }}>
                        <RefreshCw className="animate-spin text-indigo-400" size={30} />
                        <p className="text-sm text-slate-400">Loading streaming engine...</p>
                      </div>
                    )}
                  </div>

                  {/* Elegant Attached CCTV Status Bar (Outside the video DOM element to prevent control overlapping) */}
                  {playerReady && (
                    <div className="bg-slate-950 border-t border-white/5 px-4 py-3 sm:py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs select-none">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="pulse-dot shrink-0" style={{ backgroundColor: '#6366f1', boxShadow: '0 0 8px #6366f1' }}></span>
                        <span className="text-[10px] font-bold text-white/55 tracking-wider uppercase shrink-0">CCTV FEED:</span>
                        <span className="font-bold text-indigo-300 font-mono text-[13px] truncate whitespace-nowrap max-w-[200px] sm:max-w-[300px]" title={activePlayStream}>
                          {activePlayStream}
                        </span>
                      </div>
                      
                      <div className="font-mono text-emerald-400 font-bold tracking-widest text-xs bg-slate-900/60 px-2.5 py-1 rounded border border-white/5 self-start sm:self-auto">
                        {liveTime}
                      </div>

                      <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-mono font-bold bg-white/5 border border-white/5 px-2 py-1 rounded self-start sm:self-auto shrink-0">
                        <span className="text-cyan-400">1080P</span>
                        <span className="text-white/20">•</span>
                        <span>WebRTC</span>
                        <span className="text-white/20">•</span>
                        <span>H.264</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Technical Stream details underneath */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-slate-900/40 p-4 rounded-xl border border-white/5 flex flex-col gap-1.5">
                    <h5 className="text-xs font-bold text-white uppercase tracking-wider font-outfit mb-1 text-slate-400">Channel Overview</h5>
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-500">Stream Name:</span>
                      <span className="text-slate-300 font-semibold">{activePlayStream}</span>
                    </div>
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-500">Video Quality:</span>
                      <span className="text-indigo-300 font-semibold">High Definition (HD 1080p)</span>
                    </div>
                  </div>
                  
                  <div className="bg-slate-900/40 p-4 rounded-xl border border-white/5 flex flex-col gap-1.5 justify-between">
                    <div>
                      <h5 className="text-xs font-bold text-white uppercase tracking-wider font-outfit mb-1 text-slate-400">Server Connection</h5>
                      <div className="flex justify-between text-xs font-mono">
                        <span className="text-slate-500">Signaling Port:</span>
                        <span className="text-cyan-400">1984 (go2rtc)</span>
                      </div>
                    </div>
                    <button
                      onClick={() => stopCamera(activePlayStream)}
                      className="btn-danger py-2 px-4 text-xs font-bold gap-2 rounded-xl shadow-none mt-2 w-100"
                    >
                      <X size={14} /> Kill Active Stream Bridge
                    </button>
                  </div>
                </div>

              </div>
            ) : (
              <div className="radar-container p-8 text-center" style={{ minHeight: '420px' }}>
                <div className="radar-sweep"></div>
                <div className="radar-ring radar-ring-1"></div>
                <div className="radar-ring radar-ring-2"></div>
                <div className="radar-ring radar-ring-3"></div>
                <div className="radar-crosshair-h"></div>
                <div className="radar-crosshair-v"></div>
                <div className="radar-glow-dot" style={{ top: '25%', left: '32%' }}></div>
                <div className="radar-glow-dot" style={{ top: '65%', left: '78%', animationDelay: '0.8s' }}></div>
                <div className="radar-glow-dot" style={{ top: '15%', left: '70%', animationDelay: '1.4s' }}></div>
                <div className="radar-glow-dot" style={{ top: '80%', left: '25%', animationDelay: '2.0s' }}></div>
                
                <div className="z-10 flex flex-col items-center gap-3 my-auto">
                  <div className="p-4 rounded-full bg-indigo-500/10 border border-indigo-500/20 animate-pulse">
                    <Video size={36} className="text-indigo-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white font-outfit uppercase tracking-widest">CCTV SECURITY RADAR</h4>
                    <p className="text-xs text-slate-400 mt-2 max-w-sm leading-relaxed mx-auto">
                      The local H.264 stream gateway is armed and active. Select any discovered camera in the left sidebar to bridge and stream video feeds in real time.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>



      {/* Elegant Login Wizard Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div
            className="glass-card w-full max-w-md modal-content border-white/10 flex flex-col overflow-hidden"
            style={{
              background: 'rgba(12, 15, 23, 0.95)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)'
            }}
          >
            {/* Header */}
            <div className="p-5 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Key className="text-indigo-400" size={18} />
                <h3 className="text-lg font-bold text-white font-outfit">Xiaomi Mi Home Sync</h3>
              </div>
              <button
                onClick={() => {
                  setShowLoginModal(false);
                  resetLoginState();
                }}
                className="text-slate-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            {/* Login Progress Stages */}
            <div className="p-6">
              
              {/* STEP 1: Main credentials form */}
              {loginStep === 'credentials' && (
                <form onSubmit={handleLoginSubmit} className="flex flex-col gap-4">
                  <div className="text-xs text-slate-400 mb-2 leading-relaxed">
                    Sync your cameras by signing into your official Mi Home account. We securely authorize sessions directly with official servers to retrieve device list and local security stream keys.
                  </div>
                  
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
                      <Mail size={13} className="text-indigo-400" /> Username (Email / Account ID / Phone)
                    </label>
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="e.g. user@email.com or 12345678"
                      className="form-input"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
                      <Key size={13} className="text-indigo-400" /> Password
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="form-input"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submittingLogin}
                    className="btn-primary mt-3 py-3 w-100 font-semibold"
                  >
                    {submittingLogin ? (
                      <RefreshCw size={16} className="animate-spin" />
                    ) : (
                      'Sign In & Synchronize'
                    )}
                  </button>
                </form>
              )}

              {/* STEP 2: Captcha Verification form */}
              {loginStep === 'captcha' && (
                <form onSubmit={handleCaptchaSubmit} className="flex flex-col gap-4 text-center">
                  <div className="text-xs text-slate-300">
                    Xiaomi Cloud requires Captcha security verification. Please enter the characters displayed in the image.
                  </div>

                  <div className="flex justify-center p-3 bg-black/40 rounded-xl border border-white/5 my-2">
                    <img
                      id="xiaomi-captcha"
                      src={`data:image/jpeg;base64,${captchaImg}`}
                      alt="Verification Captcha"
                      className="rounded-lg max-h-16 shadow-lg border border-white/10"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5 text-left">
                    <label className="text-xs text-slate-400 font-semibold">Enter Code</label>
                    <input
                      type="text"
                      required
                      value={captchaCode}
                      onChange={(e) => setCaptchaCode(e.target.value)}
                      placeholder="Enter verification text"
                      className="form-input text-center font-bold font-mono tracking-widest text-lg"
                      maxLength={6}
                    />
                  </div>

                  <div className="flex gap-3 mt-2">
                    <button
                      type="button"
                      onClick={resetLoginState}
                      className="btn-secondary flex-1 py-2.5"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={submittingLogin}
                      className="btn-primary flex-1 py-2.5"
                    >
                      {submittingLogin ? (
                        <RefreshCw size={15} className="animate-spin" />
                      ) : (
                        'Verify Captcha'
                      )}
                    </button>
                  </div>
                </form>
              )}

              {/* STEP 3: 2FA Verification code form */}
              {loginStep === 'verify' && (
                <form onSubmit={handleVerifySubmit} className="flex flex-col gap-4 text-center">
                  <div className="text-xs text-slate-300 leading-relaxed">
                    🔒 High Security Account! A 2FA code has been dispatched to:
                    <div className="text-indigo-400 font-bold font-mono mt-1 text-sm">{verifyLabel}</div>
                  </div>

                  <div className="flex flex-col gap-1.5 text-left mt-2">
                    <label className="text-xs text-slate-400 font-semibold flex items-center gap-1.5">
                      <Smartphone size={13} className="text-indigo-400" /> Enter 2FA Verification Code
                    </label>
                    <input
                      type="text"
                      required
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value)}
                      placeholder="Code (e.g. 123456)"
                      className="form-input text-center font-bold font-mono tracking-widest text-xl"
                      maxLength={8}
                    />
                  </div>

                  <div className="flex gap-3 mt-2">
                    <button
                      type="button"
                      onClick={resetLoginState}
                      className="btn-secondary flex-1 py-2.5"
                    >
                      Restart
                    </button>
                    <button
                      type="submit"
                      disabled={submittingLogin}
                      className="btn-primary flex-1 py-2.5"
                    >
                      {submittingLogin ? (
                        <RefreshCw size={15} className="animate-spin" />
                      ) : (
                        'Verify Code'
                      )}
                    </button>
                  </div>
                </form>
              )}

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
