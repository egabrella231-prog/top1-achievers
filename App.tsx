
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Message, Level, SubjectOption, AppUser, UserStatus, UserRole } from './types';
import { SUBJECTS } from './constants';
import { createChatInstance, connectTutorLive } from './services/geminiService';
import { Chat, GenerateContentResponse, LiveServerMessage } from '@google/genai';

// --- Auth Constants ---
const ADMIN_EMAIL = '+264813879841';
const ADMIN_PASSWORD = '12345!';
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxBoBi-r9aXK5STtx3Y8XFQFQKO4jxt8ikJ1aJVOZqGQm0RZrfzCrYdy5yI7IXg2O5pqD/exec";

// --- Audio Utilities ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// --- Global UI Components ---
const BackgroundBlobs = () => (
  <div className="fixed inset-0 pointer-events-none z-0">
    <div className="absolute top-[-10%] left-[-10%] w-[600px] h-[600px] bg-gradient-to-br from-blue-400/30 to-indigo-500/20 rounded-full blur-[120px] animate-pulse"></div>
    <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-gradient-to-tr from-pink-400/30 to-rose-500/20 rounded-full blur-[120px] animate-pulse delay-700"></div>
    <div className="absolute top-[20%] right-[10%] w-[400px] h-[400px] bg-gradient-to-l from-purple-400/20 to-fuchsia-400/10 rounded-full blur-[100px] animate-bounce duration-[15s]"></div>
  </div>
);

const PasswordInput = ({ value, onChange, placeholder, label, showPassword, setShowPassword }: any) => (
  <div className="space-y-3 relative">
    <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] ml-6">{label}</label>
    <div className="relative">
      <input 
        type={showPassword ? "text" : "password"} 
        value={value} 
        onChange={(e) => onChange(e.target.value)} 
        required 
        className="w-full bg-slate-50 border border-slate-200 rounded-[2rem] px-8 py-5 focus:ring-4 focus:ring-blue-100 outline-none transition-all font-black text-slate-800 shadow-sm pr-16" 
        placeholder={placeholder} 
      />
      <button 
        type="button" 
        onClick={() => setShowPassword(!showPassword)}
        className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600 transition-colors"
      >
        {showPassword ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" /></svg>
        )}
      </button>
    </div>
  </div>
);

const App: React.FC = () => {
  // --- Auth & User State ---
  const [allUsers, setAllUsers] = useState<AppUser[]>(() => {
    const saved = localStorage.getItem('pocket_tutor_users');
    return saved ? JSON.parse(saved) : [];
  });
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => {
    const saved = localStorage.getItem('pocket_tutor_session');
    return saved ? JSON.parse(saved) : null;
  });
  const [authView, setAuthView] = useState<'login' | 'signup' | 'admin_login'>('login');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  // Form Fields
  const [nameField, setNameField] = useState('');
  const [phoneField, setPhoneField] = useState('');
  const [emailField, setEmailField] = useState('');
  const [passwordField, setPasswordField] = useState('');

  // --- App Flow State ---
  const [selectedLevel, setSelectedLevel] = useState<Level | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<SubjectOption | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // --- Transcription Accumulators (for Voice Mode) ---
  const currentInputTranscriptionRef = useRef<string>('');
  const currentOutputTranscriptionRef = useRef<string>('');

  // --- Refs ---
  const chatRef = useRef<Chat | null>(null);
  const liveSessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // --- Persistence ---
  useEffect(() => { localStorage.setItem('pocket_tutor_users', JSON.stringify(allUsers)); }, [allUsers]);
  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('pocket_tutor_session', JSON.stringify(currentUser));
      if (currentUser.isAdmin) setIsAdminPanelOpen(true);
    } else {
      localStorage.removeItem('pocket_tutor_session');
    }
  }, [currentUser]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isTyping, isVoiceActive]);

  useEffect(() => {
    if (currentUser && !currentUser.isAdmin) {
      const updated = allUsers.find(u => u.phone === currentUser.phone);
      if (updated && (updated.status !== currentUser.status || updated.role !== currentUser.role)) {
        setCurrentUser(updated);
      }
    }
  }, [allUsers, currentUser]);

  // --- API Helper ---
  // Using text/plain for the body content is a common workaround to avoid 
  // CORS preflight OPTIONS requests that many Google Apps Script environments block.
  const apiCall = async (payload: any) => {
    try {
      const res = await fetch(SCRIPT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
        body: JSON.stringify(payload),
      });
      
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        if (!res.ok) throw new Error(data.error || `HTTP error! status: ${res.status}`);
        return data;
      } catch (e) {
        console.error("Non-JSON response from API:", text);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        throw new Error("Invalid response format from server.");
      }
    } catch (err) {
      console.error("apiCall failed:", err);
      throw err;
    }
  };

  const fetchUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const data = await apiCall({ action: "get_users" });
      if (data.success && Array.isArray(data.users)) {
        setAllUsers(data.users);
      }
    } catch (e) {
      console.error("Failed to fetch users", e);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    
    if (allUsers.find(u => u.phone === phoneField)) {
      setAuthError("Phone already registered.");
      return;
    }

    const trialStart = new Date().toLocaleDateString();
    const newUser: AppUser = {
      id: Date.now().toString(),
      name: nameField,
      phone: phoneField,
      password: passwordField,
      status: 'pending',
      role: 'student',
      trialStart: trialStart
    };

    try {
      // Try remote registration
      await apiCall({
        action: "register",
        name: nameField,
        cellphone: phoneField,
        password: passwordField,
        role: 'student',
        status: 'pending',
        trialStart: trialStart
      });
      setAuthSuccess("Enrollment received! Awaiting approval. Please ensure payment is completed via the methods below.");
    } catch (err) {
      // Fallback to local-only registration if script is down
      console.warn("Remote registration failed, using local fallback", err);
      setAuthSuccess("Enrollment stored locally (Offline Mode). Awaiting manual approval.");
    } finally {
      setAllUsers(prev => [...prev, newUser]);
      setAuthView('login');
      setNameField('');
      setPhoneField('');
      setPasswordField('');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    // 1. Try Remote Login First
    try {
      const data = await apiCall({
        action: "login",
        cellphone: phoneField,
        password: passwordField
      });
      
      if (data.success) {
        setCurrentUser({
          id: data.id || 'usr-' + Date.now(),
          name: data.name || 'Scholar',
          phone: phoneField,
          role: data.role || 'student',
          status: data.status || 'approved',
          password: passwordField,
          trialStart: data.trialStart || 'N/A'
        });
        setPhoneField('');
        setPasswordField('');
        return;
      }
    } catch (err) {
      console.warn("Remote login failed, checking local nodes...", err);
    }

    // 2. Fallback to Local Login
    const localUser = allUsers.find(u => u.phone === phoneField && u.password === passwordField);
    if (localUser) {
      setCurrentUser(localUser);
      setPhoneField('');
      setPasswordField('');
    } else {
      setAuthError("Invalid credentials or node not found. Ensure you have registered.");
    }
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if ((emailField === ADMIN_EMAIL || emailField === '2') && passwordField === ADMIN_PASSWORD) {
      const admin: AppUser = {
        id: '2',
        name: 'Nexus Master',
        phone: '+264813879841',
        status: 'approved',
        role: 'admin',
        password: ADMIN_PASSWORD,
        trialStart: 'PERPETUAL',
        isAdmin: true
      };
      setCurrentUser(admin);
      setIsAdminPanelOpen(true);
      fetchUsers();
    } else {
      setAuthError("Access Denied.");
    }
  };

  const [approvingPhones, setApprovingPhones] = useState<Set<string>>(new Set());

  const handleApproveUser = async (cellphone: string) => {
    setApprovingPhones(prev => new Set(prev).add(cellphone));
    try {
      const data = await apiCall({ action: "approve", cellphone });
      if (data && data.success === false) {
        console.warn("Remote approval failed:", data.error);
      }
      setAllUsers(prev => prev.map(u => u.phone === cellphone ? { ...u, status: 'approved' } : u));
      setStatusMessage("Node Authorized Successfully");
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (e) {
      console.error("Error approving user:", e);
      // Fallback to local approval anyway to allow admin to proceed
      setAllUsers(prev => prev.map(u => u.phone === cellphone ? { ...u, status: 'approved' } : u));
      setStatusMessage("Node Authorized Locally (Sync Error)");
      setTimeout(() => setStatusMessage(null), 3000);
    } finally {
      setApprovingPhones(prev => {
        const next = new Set(prev);
        next.delete(cellphone);
        return next;
      });
    }
  };

  const handleRevokeUser = async (cellphone: string) => {
    try {
      const data = await apiCall({ action: "revoke", cellphone });
      if (data && data.success === false) {
        console.warn("Remote revoke failed:", data.error);
      }
      setAllUsers(prev => prev.map(u => u.phone === cellphone ? { ...u, status: 'revoked' } : u));
      setStatusMessage("Node Access Revoked");
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (e) {
      console.error("Error revoking user:", e);
      setAllUsers(prev => prev.map(u => u.phone === cellphone ? { ...u, status: 'revoked' } : u));
      setStatusMessage("Node Revoked Locally (Sync Error)");
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

  const handleDeleteUser = async (cellphone: string) => {
    // We'll use a simple state-based confirm if possible, but for now just proceed with local delete
    // as alerts/confirms are discouraged in iframes.
    try {
      await apiCall({ action: "delete", cellphone });
      setAllUsers(prev => prev.filter(u => u.phone !== cellphone));
      setStatusMessage("Node Terminated");
      setTimeout(() => setStatusMessage(null), 3000);
    } catch (e) {
      console.error("Error deleting user:", e);
      setAllUsers(prev => prev.filter(u => u.phone !== cellphone));
      setStatusMessage("Node Deleted Locally (Sync Error)");
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

  const logout = () => { 
    setCurrentUser(null); 
    setIsAdminPanelOpen(false); 
    resetChat(); 
  };

  const stopVoiceMode = useCallback(() => {
    setIsVoiceActive(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (liveSessionRef.current) { liveSessionRef.current.then((s: any) => s.close()); liveSessionRef.current = null; }
    if (inputAudioContextRef.current) { inputAudioContextRef.current.close(); inputAudioContextRef.current = null; }
    if (outputAudioContextRef.current) { outputAudioContextRef.current.close(); outputAudioContextRef.current = null; }
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    setStatusMessage(null);
    currentInputTranscriptionRef.current = '';
    currentOutputTranscriptionRef.current = '';
  }, []);

  const startVoiceMode = async () => {
    if (!selectedSubject) return;
    setIsVoiceActive(true); setStatusMessage("Linking Neural Audio...");
    currentInputTranscriptionRef.current = '';
    currentOutputTranscriptionRef.current = '';
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        } 
      });
      streamRef.current = stream;

      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      inputAudioContextRef.current = inputCtx; outputAudioContextRef.current = outputCtx;

      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();

      const sessionPromise = connectTutorLive(selectedSubject.id, selectedSubject.level, {
        onopen: () => {
          setStatusMessage(null);
          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(2048, 1, 1);
          processor.onaudioprocess = (e) => {
            const data = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(data.length);
            for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
            sessionPromise.then(s => s.sendRealtimeInput({ audio: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } }));
          };
          source.connect(processor); processor.connect(inputCtx.destination);
        },
        onmessage: async (message: LiveServerMessage) => {
          if (message.serverContent?.interrupted) {
            sourcesRef.current.forEach(s => {
              try { s.stop(); } catch (e) {}
            });
            sourcesRef.current.clear();
            if (outputAudioContextRef.current) {
              nextStartTimeRef.current = outputAudioContextRef.current.currentTime;
            }
          }

          if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              const audio = part.inlineData?.data;
              if (audio && outputAudioContextRef.current) {
                const ctx = outputAudioContextRef.current;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
                const buf = await decodeAudioData(decode(audio), ctx, 24000, 1);
                const src = ctx.createBufferSource();
                src.buffer = buf;
                src.connect(ctx.destination);
                src.start(nextStartTimeRef.current);
                nextStartTimeRef.current += buf.duration;
                sourcesRef.current.add(src);
                src.onended = () => sourcesRef.current.delete(src);
              }
            }
          }

          if (message.serverContent?.inputTranscription) {
            currentInputTranscriptionRef.current += (message.serverContent.inputTranscription.text || '');
          }
          if (message.serverContent?.outputTranscription) {
            currentOutputTranscriptionRef.current += (message.serverContent.outputTranscription.text || '');
          }
          if (message.serverContent?.turnComplete) {
            const userInput = currentInputTranscriptionRef.current.trim();
            const tutorOutput = currentOutputTranscriptionRef.current.trim();
            if (userInput || tutorOutput) {
              setMessages(prev => {
                const updated = [...prev];
                if (userInput) updated.push({ id: 'vi' + Date.now(), role: 'user', content: userInput, timestamp: new Date() });
                if (tutorOutput) updated.push({ id: 'vo' + Date.now(), role: 'assistant', content: tutorOutput, timestamp: new Date() });
                return updated;
              });
            }
            currentInputTranscriptionRef.current = '';
            currentOutputTranscriptionRef.current = '';
          }
        },
        onerror: stopVoiceMode, onclose: stopVoiceMode
      });
      liveSessionRef.current = sessionPromise;
    } catch { stopVoiceMode(); setStatusMessage("Mic Link Error."); }
  };

  const selectSubject = (s: SubjectOption) => {
    setSelectedSubject(s);
    chatRef.current = createChatInstance(s.id, s.level);
    setMessages([{ id: 'g', role: 'assistant', content: `Greetings, Scholar ${currentUser?.name}. I am your ${s.id} specialist for the 2026 ${selectedLevel} curriculum. What shall we explore today?`, timestamp: new Date() }]);
  };

  const resetChat = () => { stopVoiceMode(); setSelectedSubject(null); setMessages([]); chatRef.current = null; };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim() || isTyping || !chatRef.current) return;
    const msg = inputValue; setInputValue('');
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: msg, timestamp: new Date() }]);
    setIsTyping(true);
    try {
      const res = await chatRef.current.sendMessage({ message: msg });
      setMessages(prev => [...prev, { 
        id: 'a'+Date.now(), 
        role: 'assistant', 
        content: res.text || "Reasoning processed. Let's continue.", 
        timestamp: new Date(),
        groundingChunks: res.candidates?.[0]?.groundingMetadata?.groundingChunks as any
      }]);
    } catch (error) {
      setMessages(prev => [...prev, { id: 'err', role: 'assistant', content: "Neural link disruption. Please retry.", timestamp: new Date() }]);
    } finally {
      setIsTyping(false);
    }
  };

  const exportSession = () => {
    if (!selectedSubject || messages.length === 0) return;
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Pocket Tutor Session Log - ${selectedSubject.id} (2026)</title>
        <style>
          body { font-family: sans-serif; padding: 50px; line-height: 1.6; max-width: 900px; margin: auto; }
          .message { margin-bottom: 30px; border-bottom: 1px solid #eee; padding-bottom: 20px; }
          .role { font-weight: bold; }
          .content { white-space: pre-wrap; margin-top: 10px; }
        </style>
      </head>
      <body>
        <h1>Session Log - ${selectedSubject.id}</h1>
        ${messages.map(msg => `
          <div class="message">
            <div class="role">${msg.role.toUpperCase()}</div>
            <div class="content">${msg.content}</div>
          </div>
        `).join('')}
      </body>
      </html>
    `;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Session_2026_${selectedSubject.id}_${Date.now()}.html`;
    link.click();
  };

  const NavBreadcrumbs = () => {
    if (!currentUser) return null;
    return (
      <div className="flex items-center gap-2 px-8 py-3 bg-white/50 backdrop-blur-md border-b border-white/20 sticky top-0 z-50 text-[10px] font-black uppercase tracking-widest text-slate-500">
        <button onClick={() => { setSelectedLevel(null); resetChat(); }} className="hover:text-blue-600 transition-all p-1.5 rounded-lg hover:bg-slate-100 flex items-center justify-center" title="Exit to Menu">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
        </button>
        {selectedLevel && (
          <>
            <span>/</span>
            <button onClick={() => resetChat()} className={`hover:text-blue-600 transition-colors ${!selectedSubject ? 'text-slate-900' : ''}`}>
              {selectedLevel} (2026)
            </button>
          </>
        )}
        {selectedSubject && (
          <>
            <span>/</span>
            <span className="text-slate-900">{selectedSubject.id}</span>
          </>
        )}
      </div>
    );
  };

  const filteredSubjects = SUBJECTS.filter(s => s.level === selectedLevel && (searchQuery === '' || s.id.toLowerCase().includes(searchQuery.toLowerCase())));

  // --- VIEWS ---

  if (currentUser?.isAdmin && isAdminPanelOpen) {
    return (
      <div className="min-h-screen bg-slate-950 text-white p-8 overflow-y-auto relative">
        <BackgroundBlobs />
        <div className="max-w-7xl mx-auto relative z-10">
          <header className="flex justify-between items-center mb-12">
            <div>
              <h1 className="text-4xl font-black bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">Nexus Administration</h1>
              <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.3em] mt-2">Managing the 2026 Academic Nodes</p>
            </div>
            <div className="flex gap-4">
              <button onClick={fetchUsers} className={`glass px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest ${isLoadingUsers ? 'animate-pulse' : ''}`}>
                {isLoadingUsers ? 'Syncing...' : 'Sync Nodes'}
              </button>
              <button onClick={() => setIsAdminPanelOpen(false)} className="glass px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest">Client View</button>
              <button onClick={logout} className="bg-red-500/20 text-red-500 px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest">Logout</button>
            </div>
          </header>
          {statusMessage && (
            <div className="mb-8 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-6 py-4 rounded-2xl text-xs font-black uppercase tracking-widest text-center animate-pulse">
              {statusMessage}
            </div>
          )}
          <div className="glass rounded-3xl p-4 md:p-8 border border-white/10 overflow-x-auto">
             <table className="w-full text-left">
               <thead>
                 <tr className="border-b border-white/10 text-slate-500 text-[9px] uppercase font-black">
                   <th className="py-4 px-2">Scholar</th>
                   <th className="py-4 px-2">Phone</th>
                   <th className="py-4 px-2">Key</th>
                   <th className="py-4 px-2">Role</th>
                   <th className="py-4 px-2">Status</th>
                   <th className="py-4 px-2">Joined</th>
                   <th className="py-4 px-2 text-right">Actions</th>
                 </tr>
               </thead>
               <tbody>
                 {allUsers.length === 0 ? (
                   <tr><td colSpan={7} className="py-12 text-center text-slate-500 font-bold uppercase tracking-widest">No nodes registered</td></tr>
                 ) : (
                   allUsers.map(u => (
                    <tr key={u.id || u.phone} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                      <td className="py-4 px-2 font-bold text-sm">{u.name}</td>
                      <td className="py-4 px-2 text-slate-400 font-mono text-xs">{u.phone}</td>
                      <td className="py-4 px-2 text-slate-400 font-mono text-xs">{u.password}</td>
                      <td className="py-4 px-2">
                        <span className="bg-slate-800 text-slate-300 px-2 py-0.5 rounded text-[8px] font-black uppercase">{u.role}</span>
                      </td>
                      <td className="py-4 px-2">
                         <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase ${u.status?.toLowerCase() === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : u.status?.toLowerCase() === 'revoked' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
                           {u.status}
                         </span>
                      </td>
                      <td className="py-4 px-2 text-slate-400 text-[9px] font-bold">{u.trialStart}</td>
                      <td className="py-4 px-2 text-right">
                         <div className="flex justify-end gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                           {u.status?.toLowerCase() !== 'approved' && (
                             <button 
                               onClick={() => handleApproveUser(u.phone)} 
                               disabled={approvingPhones.has(u.phone)}
                               className={`bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all hover:scale-105 active:scale-95 shadow-lg shadow-emerald-900/20 ${approvingPhones.has(u.phone) ? 'opacity-50 cursor-not-allowed animate-pulse' : ''}`}
                             >
                               {approvingPhones.has(u.phone) ? 'Syncing...' : 'Approve'}
                             </button>
                           )}
                           {u.status?.toLowerCase() === 'approved' && (
                             <button 
                               onClick={() => handleRevokeUser(u.phone)} 
                               className="bg-red-500/10 hover:bg-red-500/30 text-red-400 px-2.5 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all"
                             >
                               Revoke
                             </button>
                           )}
                           <button 
                             onClick={() => handleDeleteUser(u.phone)} 
                             className="bg-slate-900 hover:bg-red-900/40 text-slate-500 hover:text-white px-2.5 py-1.5 rounded-lg text-[8px] font-black uppercase transition-all"
                           >
                             Delete
                           </button>
                         </div>
                      </td>
                    </tr>
                   ))
                 )}
               </tbody>
             </table>
          </div>
        </div>
      </div>
    );
  }

  if (currentUser && currentUser.status !== 'approved' && !currentUser.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 relative overflow-hidden">
        <BackgroundBlobs />
        <div className="max-w-md w-full relative z-10 text-center">
           <div className="glass rounded-[2.5rem] shadow-2xl p-10 border border-white">
              <div className="w-20 h-20 bg-amber-100 text-amber-600 rounded-3xl flex items-center justify-center text-3xl mx-auto mb-8 animate-pulse">⏳</div>
              <h2 className="text-3xl font-black mb-4 text-slate-800">Enrollment Pending</h2>
              <p className="text-slate-500 text-sm font-bold leading-relaxed mb-8">
                Your academic node is registered but awaits manual authorization by the Nexus Master. 
                Please ensure your N$250 yearly access fee is processed.
              </p>
              <div className="bg-slate-950 text-white p-6 rounded-2xl mb-8 text-left">
                 <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Payment Details</p>
                 <p className="text-xs font-bold leading-relaxed">Send N$250 to +264813879841 via eWallet, EasyWallet, or Blue Wallet.</p>
              </div>
              <div className="flex flex-col gap-4">
                <button onClick={fetchUsers} className={`w-full bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-lg hover:scale-105 transition-all text-[11px] uppercase tracking-widest ${isLoadingUsers ? 'animate-pulse' : ''}`}>
                  {isLoadingUsers ? 'Syncing...' : 'Check Approval Status'}
                </button>
                <button onClick={logout} className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-red-500">Terminate Session</button>
              </div>
           </div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 relative overflow-hidden">
        <BackgroundBlobs />
        <div className={`w-full relative z-10 ${authView === 'signup' ? 'max-w-4xl' : 'max-w-md'}`}>
          <div className="text-center mb-10">
            <h1 className="text-5xl font-black mb-3 tracking-tighter bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent">Pocket Tutor</h1>
            <p className="text-slate-400 font-black text-[10px] uppercase tracking-[0.3em]">2026 Namibian NSSCO/NSSCAS Expert</p>
          </div>
          <div className={`glass rounded-[2.5rem] shadow-2xl p-10 border border-white ${authView === 'signup' ? 'flex flex-col md:flex-row gap-10 items-stretch' : ''}`}>
            
            <div className={authView === 'signup' ? 'flex-1 order-2 md:order-1' : 'w-full'}>
              {authSuccess && <div className="bg-emerald-50 text-emerald-600 p-4 rounded-2xl text-xs font-bold mb-6 text-center border border-emerald-100">{authSuccess}</div>}
              {authError && <div className="bg-rose-50 text-red-500 p-4 rounded-2xl text-xs font-bold mb-6 text-center border border-red-100">{authError}</div>}
              <form onSubmit={authView === 'login' ? handleLogin : authView === 'signup' ? handleSignUp : handleAdminLogin} className="space-y-6">
                {authView === 'signup' && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase ml-4 text-slate-400">Scholar Name</label>
                    <input type="text" value={nameField} onChange={(e) => setNameField(e.target.value)} required className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 focus:ring-4 focus:ring-indigo-100 outline-none font-bold shadow-sm" />
                  </div>
                )}
                {authView === 'admin_login' ? (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase ml-4 text-slate-400">Admin Identity</label>
                    <input type="text" value={emailField} onChange={(e) => setEmailField(e.target.value)} required className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 focus:ring-4 focus:ring-indigo-100 outline-none font-bold shadow-sm" placeholder="ID or Phone" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase ml-4 text-slate-400">Phone Node</label>
                    <input type="tel" value={phoneField} onChange={(e) => setPhoneField(e.target.value)} required className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 focus:ring-4 focus:ring-indigo-100 outline-none font-bold shadow-sm" placeholder="+264 ..." />
                  </div>
                )}
                <PasswordInput value={passwordField} onChange={setPasswordField} placeholder="••••••••" label="Mastery Key" showPassword={showPassword} setShowPassword={setShowPassword} />
                <button type="submit" className="w-full bg-slate-950 text-white font-black py-5 rounded-2xl shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all uppercase tracking-[0.2em] text-[11px]">
                  {authView === 'login' ? 'Initiate Access' : authView === 'signup' ? 'Request Enrollment' : 'Authorize Node'}
                </button>
              </form>
              <div className="mt-8 pt-8 border-t border-slate-100 flex flex-col gap-4 text-center">
                {authView === 'login' && <button onClick={() => { setAuthView('signup'); setAuthError(null); }} className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:underline">Enrollment Required?</button>}
                {(authView === 'signup' || authView === 'admin_login') && <button onClick={() => setAuthView('login')} className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:underline">Return to Portal</button>}
                {authView === 'login' && <button onClick={() => setAuthView('admin_login')} className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.3em] hover:text-slate-900 transition-colors">Nexus Master</button>}
              </div>
            </div>

            {authView === 'signup' && (
              <div className="flex-1 order-1 md:order-2 bg-slate-900/5 rounded-3xl p-8 border border-white/50 flex flex-col justify-center">
                <div className="mb-6">
                  <h3 className="text-xl font-black text-slate-800 mb-2 uppercase tracking-tight">Payment Gateways</h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Namibian Digital Wallets</p>
                </div>
                <div className="space-y-4">
                  <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 group hover:border-blue-500 transition-colors">
                    <div className="bg-blue-600 text-white w-10 h-10 rounded-xl flex items-center justify-center font-black">FNB</div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">eWallet</p>
                      <p className="font-bold text-slate-800">FNB Namibia; ewallet</p>
                    </div>
                  </div>
                  <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 group hover:border-emerald-500 transition-colors">
                    <div className="bg-emerald-600 text-white w-10 h-10 rounded-xl flex items-center justify-center font-black">BW</div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">EasyWallet</p>
                      <p className="font-bold text-slate-800">Bank Windhoek; Easy wallet</p>
                    </div>
                  </div>
                  <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4 group hover:border-blue-400 transition-colors">
                    <div className="bg-blue-400 text-white w-10 h-10 rounded-xl flex items-center justify-center font-black">SB</div>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Blue Wallet</p>
                      <p className="font-bold text-slate-800">Standard Bank Namibia; blue wallet</p>
                    </div>
                  </div>
                </div>
                <div className="mt-8 p-6 bg-slate-950 rounded-2xl text-center">
                  <p className="text-[11px] font-black text-slate-100 uppercase tracking-widest leading-relaxed">
                    use +264813879841 for enquiry and payment; N$250 yearly access
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!selectedLevel) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50 relative overflow-hidden">
        <BackgroundBlobs />
        <NavBreadcrumbs />
        <div className="flex-grow flex items-center justify-center p-6 relative z-10">
          <div className="max-w-6xl w-full text-center">
            <header className="mb-16">
              <h2 className="text-7xl font-black mb-6 tracking-tighter bg-gradient-to-r from-blue-600 to-indigo-800 bg-clip-text text-transparent">Define 2026 Mastery Level</h2>
              <p className="text-slate-400 font-bold uppercase tracking-[0.25em] text-sm">Namibian NIED/NAMCOL Curriculum Standards</p>
            </header>
            <div className="flex flex-col md:flex-row gap-10 justify-center items-stretch">
              <button onClick={() => setSelectedLevel('NSSCAS')} className="group glass p-16 rounded-[3.5rem] shadow-2xl hover:scale-105 transition-all flex flex-col items-center flex-1 border border-white">
                <div className="bg-indigo-600 text-white w-24 h-24 rounded-3xl flex items-center justify-center text-4xl font-black mb-10 shadow-xl shadow-indigo-200 group-hover:rotate-6 transition-transform">AS</div>
                <h3 className="text-4xl font-black mb-3">NSSCAS</h3>
                <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">Advanced Subsidiary (Gr 12) 2026</p>
              </button>
              <button onClick={() => setSelectedLevel('NSSCO')} className="group glass p-16 rounded-[3.5rem] shadow-2xl hover:scale-105 transition-all flex flex-col items-center flex-1 border border-white">
                <div className="bg-emerald-500 text-white w-24 h-24 rounded-3xl flex items-center justify-center text-4xl font-black mb-10 shadow-xl shadow-emerald-200 group-hover:rotate-6 transition-transform">O</div>
                <h3 className="text-4xl font-black mb-3">NSSCO</h3>
                <p className="text-slate-400 text-sm font-bold uppercase tracking-widest">Ordinary Level (Gr 11-12) 2026</p>
              </button>
            </div>
            <button onClick={logout} className="mt-20 text-[11px] font-black text-slate-300 uppercase tracking-[0.3em] hover:text-red-500 transition-colors">Terminate Node</button>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedSubject) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50 relative overflow-hidden">
        <BackgroundBlobs />
        <NavBreadcrumbs />
        <div className="flex-grow max-w-7xl mx-auto py-16 px-8 relative z-10 w-full">
          <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-8">
            <div>
              <h2 className="text-6xl font-black mb-3 tracking-tighter text-slate-900">{selectedLevel} 2026 Syllabus</h2>
              <p className="text-slate-400 font-bold uppercase tracking-widest text-sm">Syllabus-aligned tutoring with search-enabled past papers</p>
            </div>
            <div className="relative group">
               <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Filter specializations..." className="bg-white border-slate-200 border rounded-2xl pl-12 pr-6 py-4 font-bold shadow-sm focus:ring-4 focus:ring-indigo-50 outline-none transition-all w-80" />
               <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
          </header>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {filteredSubjects.map(s => (
              <button key={s.id+s.level} onClick={() => selectSubject(s)} className="group bg-white p-10 rounded-[3rem] shadow-xl hover:shadow-2xl transition-all text-left flex flex-col border border-slate-100 hover:-translate-y-2">
                <div className={`${s.color} text-white w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mb-8 shadow-lg group-hover:scale-110 transition-transform`}>{s.icon}</div>
                <h3 className="text-2xl font-black mb-3 group-hover:text-indigo-600 transition-colors">{s.id}</h3>
                <p className="text-slate-400 text-[12px] font-bold leading-relaxed uppercase tracking-widest flex-grow">{s.description}</p>
                <div className="mt-8 flex items-center gap-2 text-[10px] font-black uppercase text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity">Launch 2026 Node →</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 relative overflow-hidden">
      <BackgroundBlobs />
      <NavBreadcrumbs />
      <header className="glass px-8 py-6 flex items-center justify-between border-b border-white z-20 shadow-xl">
        <div className="flex items-center gap-8">
           <button onClick={resetChat} className="p-4 bg-white rounded-2xl shadow-md border border-slate-100 text-slate-400 hover:text-indigo-600 transition-all hover:scale-110 active:scale-95 group">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 group-hover:-translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
           </button>
           <div>
             <h2 className="text-3xl font-black text-slate-900 leading-none">{selectedSubject.id} 2026 SPECIALIST</h2>
             <p className="text-[11px] font-black text-slate-400 mt-2 uppercase tracking-widest flex items-center gap-2">
               <span className={`w-2 h-2 rounded-full ${isVoiceActive ? 'bg-rose-500 animate-ping' : 'bg-emerald-500'}`}></span>
               {isVoiceActive ? 'Neural Voice Link' : '2026 Syllabus Sync Active'}
             </p>
           </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          {messages.length > 0 && (
            <button onClick={exportSession} className="bg-slate-950 text-white px-8 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest flex items-center gap-4 shadow-xl hover:scale-105 active:scale-95 transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Archive Mastery Log
            </button>
          )}
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Logged in as: {currentUser?.name}
          </p>
        </div>
      </header>

      <main ref={scrollRef} className="flex-grow overflow-y-auto px-10 py-16 max-w-6xl mx-auto w-full custom-scrollbar relative z-10">
        <div className="space-y-12 pb-24">
          {statusMessage && <div className="bg-indigo-600 text-white px-10 py-5 rounded-[2.5rem] text-[11px] font-black uppercase text-center animate-pulse mx-auto max-w-sm shadow-xl">{statusMessage}</div>}
          {messages.map(msg => (
            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-6 duration-500`}>
              <div className={`max-w-[95%] rounded-[3rem] px-10 py-8 shadow-2xl relative border ${msg.role === 'user' ? 'bg-indigo-600 text-white border-indigo-500 rounded-tr-none' : 'bg-white text-slate-800 border-white rounded-tl-none'}`}>
                <div className="text-[17px] font-bold leading-relaxed whitespace-pre-wrap font-sans tracking-wide">{msg.content}</div>
                {msg.groundingChunks && msg.groundingChunks.length > 0 && (
                  <div className="mt-6 pt-6 border-t border-slate-100 flex flex-wrap gap-3">
                    {msg.groundingChunks.map((chunk, i) => chunk.web && (
                      <a key={i} href={chunk.web.uri} target="_blank" rel="noopener noreferrer" className="text-[10px] font-black bg-slate-50 text-slate-500 px-4 py-2 rounded-xl border border-slate-100 hover:bg-indigo-50 hover:text-indigo-600 transition-all flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        {chunk.web.title || 'Official Resource'}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {isTyping && <div className="flex justify-start"><div className="bg-white px-10 py-5 rounded-[2.5rem] shadow-xl border border-white flex gap-3"><span className="w-3 h-3 bg-indigo-500 rounded-full animate-bounce"></span><span className="w-3 h-3 bg-indigo-500 rounded-full animate-bounce delay-100"></span><span className="w-3 h-3 bg-indigo-500 rounded-full animate-bounce delay-200"></span></div></div>}
        </div>
      </main>

      <footer className="glass border-t border-white px-10 py-10 z-20 shadow-[0_-15px_50px_rgba(0,0,0,0.04)]">
        <div className="max-w-6xl mx-auto flex gap-8 items-center">
          <button onClick={isVoiceActive ? stopVoiceMode : startVoiceMode} className={`p-7 rounded-[2.5rem] transition-all shadow-2xl hover:scale-110 active:scale-95 ${isVoiceActive ? 'bg-rose-500 text-white animate-pulse' : 'bg-slate-950 text-white'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
          </button>
          <form onSubmit={handleSendMessage} className="relative flex-grow flex items-center">
            <input 
              type="text" 
              value={inputValue} 
              onChange={(e) => setInputValue(e.target.value)} 
              placeholder={isVoiceActive ? "Voice mode enabled..." : "Ask your question..."} 
              className="w-full bg-white border-slate-200 border rounded-[2.5rem] pl-10 pr-20 py-6 font-bold text-lg shadow-xl focus:ring-[16px] focus:ring-indigo-50 outline-none transition-all" 
            />
            <button type="submit" className="absolute right-4 p-4 bg-indigo-600 text-white rounded-2xl shadow-lg hover:scale-110 active:scale-95 transition-all">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
};

export default App;