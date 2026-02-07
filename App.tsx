
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Subject, Message, Level, SubjectOption } from './types';
import { SUBJECTS } from './constants';
import { createChatInstance, connectTutorLive } from './services/geminiService';
import { supabase } from './services/supabaseClient';
import { Chat, GenerateContentResponse, LiveServerMessage } from '@google/genai';

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

const App: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);

  const [selectedLevel, setSelectedLevel] = useState<Level | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<SubjectOption | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  
  const chatRef = useRef<Chat | null>(null);
  const liveSessionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, isVoiceActive]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    setAuthSuccess(null);
    try {
      if (authMode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setAuthSuccess("Profile created! Check your email to verify.");
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    resetChat();
    setSelectedLevel(null);
  };

  const stopVoiceMode = () => {
    if (liveSessionRef.current) {
      liveSessionRef.current.then((s: any) => { try { s.close(); } catch(e) {} });
      liveSessionRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close().catch(() => {});
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close().catch(() => {});
      outputAudioContextRef.current = null;
    }
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    setIsVoiceActive(false);
    setStatusMessage(null);
  };

  const startVoiceMode = async () => {
    if (!selectedSubject) return;
    setStatusMessage("Connecting to Socratic engine...");
    setIsVoiceActive(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      await inputCtx.resume();
      await outputCtx.resume();
      
      inputAudioContextRef.current = inputCtx;
      outputAudioContextRef.current = outputCtx;

      const sessionPromise = connectTutorLive(selectedSubject.id, selectedSubject.level, {
        onopen: () => { 
          setStatusMessage(null);
          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (e) => {
            const data = e.inputBuffer.getChannelData(0);
            const int16 = new Int16Array(data.length);
            for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
            sessionPromise.then(s => s.sendRealtimeInput({
              media: {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000'
              }
            }));
          };
          source.connect(processor);
          processor.connect(inputCtx.destination);
        },
        onmessage: async (message: LiveServerMessage) => {
          const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          
          if (base64Audio && outputAudioContextRef.current) {
            const ctx = outputAudioContextRef.current;
            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
            const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);
            source.start(nextStartTimeRef.current);
            nextStartTimeRef.current += audioBuffer.duration;
            sourcesRef.current.add(source);
            source.onended = () => sourcesRef.current.delete(source);
          }

          if (message.serverContent?.interrupted) {
            sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
            sourcesRef.current.clear();
            nextStartTimeRef.current = 0;
          }
        },
        onerror: (e) => {
          console.error("Live Connection Error", e);
          stopVoiceMode();
        },
        onclose: () => {
          stopVoiceMode();
        }
      });

      liveSessionRef.current = sessionPromise;
    } catch (err) {
      console.error("Failed to initialize voice session", err);
      setIsVoiceActive(false);
      setStatusMessage("Microphone access required.");
    }
  };

  const handleSelectSubject = useCallback((option: SubjectOption) => {
    setSelectedSubject(option);
    const tutorChat = createChatInstance(option.id, option.level);
    chatRef.current = tutorChat;
    
    const greeting = `Hi there! I'm your ${option.level} ${option.id} Pocket Tutor. What topic are we tackling today?`;
    setMessages([{
      id: Date.now().toString(),
      role: 'assistant',
      content: greeting,
      timestamp: new Date()
    }]);
  }, []);

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim() || isTyping || !chatRef.current) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    try {
      const response: GenerateContentResponse = await chatRef.current.sendMessage({
        message: inputValue
      });

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.text || "I'm sorry, I couldn't process that. Let's try rephrasing.",
        timestamp: new Date(),
        groundingChunks: response.candidates?.[0]?.groundingMetadata?.groundingChunks
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Chat Error:", error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: "I encountered a small hiccup. Could you try asking that again?",
        timestamp: new Date()
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  const resetChat = () => {
    stopVoiceMode();
    setSelectedSubject(null);
    setMessages([]);
    chatRef.current = null;
    setSearchQuery('');
  };

  const saveToFile = (filename: string, content: string | Blob) => {
    const blob = typeof content === 'string' ? new Blob([content], { type: 'text/plain' }) : content;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportSession = () => {
    if (!selectedSubject || messages.length === 0) return;
    
    let content = `${selectedLevel} POCKET TUTOR SESSION LOG\n`;
    content += `Level: ${selectedLevel}\n`;
    content += `Subject: ${selectedSubject.id}\n`;
    content += `Date: ${new Date().toLocaleString()}\n`;
    content += `------------------------------------------\n\n`;
    
    messages.forEach(msg => {
      const role = msg.role === 'user' ? 'STUDENT' : 'TUTOR';
      content += `[${msg.timestamp.toLocaleTimeString()}] ${role}:\n${msg.content}\n\n`;
    });
    
    const filename = `Tutor_Session_${selectedSubject.id}_${Date.now()}.txt`;
    saveToFile(filename, content);
  };

  const saveMessage = (msg: Message) => {
    const role = msg.role === 'user' ? 'Question' : 'Answer';
    const content = `${role} from ${selectedSubject?.id} session (${new Date().toLocaleDateString()}):\n\n${msg.content}`;
    const filename = `Saved_${role}_${Date.now()}.txt`;
    saveToFile(filename, content);
  };

  const filteredSubjects = SUBJECTS.filter(s => 
    s.level === selectedLevel && 
    (searchQuery === '' || s.id.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="font-black text-slate-800 animate-pulse uppercase tracking-widest text-xs">Authenticating...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 relative overflow-hidden">
        <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-[500px] h-[500px] bg-blue-100 rounded-full blur-[120px] opacity-60"></div>
        <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-pink-100 rounded-full blur-[120px] opacity-60"></div>

        <div className="max-w-md w-full relative z-10">
          <div className="text-center mb-10">
            <h1 className="text-4xl md:text-5xl font-black mb-4 tracking-tighter leading-none bg-gradient-to-r from-blue-600 via-purple-600 to-pink-500 bg-clip-text text-transparent">
              Top 1% Achievers <br/> Portal
            </h1>
            <p className="text-slate-500 font-bold text-sm uppercase tracking-widest">NSSCO / NSSCAS Mastery Hub</p>
          </div>

          <div className="bg-white/80 backdrop-blur-xl p-8 rounded-[2.5rem] shadow-2xl border border-white/50">
            <form onSubmit={handleAuth} className="space-y-6">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-4">Student Email</label>
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 focus:ring-4 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all font-bold text-slate-700"
                  placeholder="name@school.edu.na"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-4">Mastery Key</label>
                <div className="relative group/pass">
                  <input 
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 focus:ring-4 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all font-bold text-slate-700 pr-14"
                    placeholder="••••••••"
                    required
                  />
                  <button 
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-blue-600 transition-colors"
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268-2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              
              {authError && (
                <div className="bg-red-50 text-red-600 p-4 rounded-xl text-xs font-bold border border-red-100 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {authError}
                </div>
              )}

              {authSuccess && (
                <div className="bg-emerald-50 text-emerald-600 p-4 rounded-xl text-xs font-bold border border-emerald-100 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {authSuccess}
                </div>
              )}

              <button 
                type="submit"
                disabled={authLoading}
                className="w-full bg-gradient-to-r from-blue-600 via-purple-600 to-pink-500 text-white font-black py-5 rounded-2xl shadow-xl shadow-blue-200 hover:scale-[1.02] active:scale-[0.98] transition-all uppercase tracking-widest disabled:opacity-50"
              >
                {authLoading ? 'Verifying...' : (authMode === 'signin' ? 'Unlock Academy' : 'Create Profile')}
              </button>
            </form>

            <div className="mt-8 pt-8 border-t border-slate-100 text-center">
              <button 
                onClick={() => {
                  setAuthMode(authMode === 'signin' ? 'signup' : 'signin');
                  setAuthError(null);
                  setAuthSuccess(null);
                }}
                className="text-xs font-black text-slate-500 hover:text-blue-600 uppercase tracking-widest transition-colors"
              >
                {authMode === 'signin' ? "Don't have a profile? Register" : "Already in? Sign In"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedLevel) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 relative overflow-hidden">
        <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 w-96 h-96 bg-blue-100 rounded-full blur-3xl opacity-50"></div>
        <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/2 w-96 h-96 bg-pink-100 rounded-full blur-3xl opacity-50"></div>

        <div className="max-w-4xl w-full text-center relative z-10">
          <header className="mb-14">
            <div className="flex justify-center mb-6">
              <button onClick={handleSignOut} className="bg-white px-4 py-2 rounded-full shadow-sm text-[10px] font-black text-slate-400 hover:text-red-500 transition-colors uppercase tracking-widest border border-slate-100">Logout</button>
            </div>
            <h1 className="text-5xl md:text-7xl font-black mb-6 tracking-tight leading-none bg-gradient-to-r from-blue-600 via-purple-600 to-pink-500 bg-clip-text text-transparent">
              Namibia NSSCO/NSSCAS <br/> Pocket Tutor
            </h1>
            <p className="text-xl md:text-2xl font-bold bg-gradient-to-r from-emerald-500 to-teal-700 bg-clip-text text-transparent max-w-2xl mx-auto">
              Master your syllabus with guided reasoning. <br/>
              <span className="text-slate-800">Become a Top 1% Achiever.</span>
            </p>
          </header>
          
          <div className="flex flex-col sm:flex-row gap-8 justify-center items-stretch">
            <button
              onClick={() => setSelectedLevel('NSSCAS')}
              className="group bg-white p-12 rounded-[2.5rem] shadow-xl hover:shadow-2xl border border-slate-100 hover:border-blue-400 transition-all w-full sm:w-80 flex flex-col items-center"
            >
              <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-8 group-hover:scale-110 group-hover:rotate-3 transition-transform shadow-lg shadow-blue-200">
                AS
              </div>
              <h3 className="text-3xl font-black text-slate-800 mb-2">NSSCAS</h3>
              <p className="text-slate-500 font-medium text-sm">Advanced Subsidiary<br/>Grade 12</p>
              <div className="mt-6 px-4 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-black uppercase tracking-widest">Achiever Tier</div>
            </button>
            <button
              onClick={() => setSelectedLevel('NSSCO')}
              className="group bg-white p-12 rounded-[2.5rem] shadow-xl hover:shadow-2xl border border-slate-100 hover:border-emerald-400 transition-all w-full sm:w-80 flex flex-col items-center"
            >
              <div className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-8 group-hover:scale-110 group-hover:-rotate-3 transition-transform shadow-lg shadow-emerald-200">
                O
              </div>
              <h3 className="text-3xl font-black text-slate-800 mb-2">NSSCO</h3>
              <p className="text-slate-500 font-medium text-sm">Ordinary Level<br/>Grade 10-11</p>
              <div className="mt-6 px-4 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest">Mastery Tier</div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedSubject) {
    return (
      <div className="min-h-screen p-6 bg-slate-50">
        <div className="max-w-6xl mx-auto py-12">
          <div className="flex items-center justify-between mb-8">
            <button 
              onClick={() => setSelectedLevel(null)}
              className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold transition-colors group"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 transform group-hover:-translate-x-1 transition-transform" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
              Switch Level
            </button>
            <button onClick={handleSignOut} className="text-[10px] font-black text-slate-400 hover:text-red-500 transition-colors uppercase tracking-widest">Sign Out</button>
          </div>
          
          <header className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <h2 className="text-4xl font-black text-slate-900 mb-2">{selectedLevel} Subjects</h2>
              <p className="text-slate-600 text-lg">Pick a subject to join the Top 1% Achievers.</p>
            </div>
            
            <div className="relative group w-full md:w-80">
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search subjects..."
                className="w-full bg-white border border-slate-200 rounded-2xl pl-12 pr-4 py-4 focus:ring-4 focus:ring-blue-100 outline-none font-bold text-slate-700 shadow-sm"
              />
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredSubjects.map((s, idx) => (
              <button
                key={`${s.id}-${idx}`}
                onClick={() => handleSelectSubject(s)}
                className="group bg-white p-6 rounded-3xl shadow-md hover:shadow-2xl border border-slate-100 hover:border-blue-400 transition-all text-left flex flex-col h-full relative overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300"
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                <div className={`${s.color} text-white w-12 h-12 rounded-2xl flex items-center justify-center text-2xl mb-4 group-hover:scale-110 transition-transform shadow-lg`}>
                  {s.icon}
                </div>
                <h3 className="text-xl font-black text-slate-800 mb-1">{s.id}</h3>
                <p className="text-slate-500 font-medium text-xs flex-grow leading-relaxed">{s.description}</p>
                <div className="mt-4 flex items-center text-[10px] font-black text-blue-600 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                  Begin Session &rarr;
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button 
            onClick={resetChat}
            className="text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <h2 className="text-lg font-black text-slate-800 leading-tight">
              {selectedLevel} <span className="text-blue-600">{selectedSubject.id}</span>
            </h2>
            <p className="text-xs text-slate-500 flex items-center gap-1">
              <span className={`w-2 h-2 ${isVoiceActive ? 'bg-red-500 animate-pulse' : 'bg-green-500'} rounded-full`}></span>
              {isVoiceActive ? 'Voice Session Active' : 'Pocket Tutor Online'}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end text-right max-w-[200px]">
            <span className="text-[9px] font-black uppercase tracking-tighter bg-gradient-to-r from-blue-600 via-purple-600 via-pink-500 via-orange-500 via-green-600 to-blue-600 bg-clip-text text-transparent leading-tight">
              use your device audio recorder to record and listen when offline
            </span>
          </div>

          {messages.length > 0 && (
            <button 
              onClick={exportSession}
              className="bg-white border-2 border-slate-100 hover:border-blue-200 text-slate-700 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all hover:shadow-md active:scale-95 group"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-600 group-hover:animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export Log
            </button>
          )}
        </div>
      </header>

      <main 
        ref={scrollRef}
        className="flex-grow overflow-y-auto px-4 py-8 max-w-3xl mx-auto w-full custom-scrollbar"
      >
        <div className="space-y-8">
          {statusMessage && (
             <div className="bg-blue-50 text-blue-700 px-4 py-3 rounded-2xl text-xs font-bold text-center border border-blue-100 animate-pulse">
                {statusMessage}
             </div>
          )}
          {messages.length === 0 && !isVoiceActive && (
             <div className="text-center py-20">
                <div className="bg-blue-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl shadow-inner">🎓</div>
                <h3 className="text-xl font-black text-slate-800 mb-2">Ready to Master {selectedSubject.id}?</h3>
                <p className="text-slate-500 text-sm max-w-sm mx-auto">Start a text conversation below or tap the microphone to engage in a Socratic voice session.</p>
             </div>
          )}
          {messages.map((msg) => (
            <div 
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} group`}
            >
              <div className={`
                max-w-[90%] rounded-[2rem] px-6 py-5 shadow-md relative
                ${msg.role === 'user' 
                  ? 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white rounded-tr-none' 
                  : 'bg-white text-slate-800 border border-slate-100 rounded-tl-none'}
              `}>
                <div className="prose prose-sm max-w-none font-medium leading-relaxed">
                   {msg.content.split('\n').map((line, i) => (
                     <p key={i} className={i > 0 ? 'mt-3' : ''}>{line}</p>
                   ))}
                </div>
                
                <div className="flex items-center justify-between mt-3">
                  <div className={`text-[10px] font-bold opacity-60`}>
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <button 
                    onClick={() => saveMessage(msg)}
                    className={`p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-black/5 text-[9px] font-black uppercase tracking-tighter ${msg.role === 'user' ? 'text-white/80 hover:text-white' : 'text-slate-400 hover:text-slate-800'}`}
                  >
                    Save Snippet
                  </button>
                </div>
              </div>
            </div>
          ))}
          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-100 rounded-[2rem] rounded-tl-none px-6 py-5 shadow-md">
                <div className="flex gap-2">
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></span>
                  <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                  <span className="w-2 h-2 bg-pink-500 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                </div>
              </div>
            </div>
          )}
          {isVoiceActive && !statusMessage && (
            <div className="text-center py-6 animate-in fade-in zoom-in">
              <div className="inline-flex flex-col items-center">
                 <div className="relative mb-4">
                    <div className="absolute inset-0 bg-blue-400 rounded-full animate-ping opacity-20"></div>
                    <div className="bg-blue-600 p-6 rounded-full text-white shadow-xl shadow-blue-200 relative">
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                       </svg>
                    </div>
                 </div>
                 <h4 className="font-black text-slate-800 text-sm uppercase tracking-widest">Socratic Voice Active</h4>
                 <p className="text-slate-400 text-[10px] font-bold mt-1">Speak to interact with the tutor.</p>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="bg-white border-t border-slate-200 p-6 sticky bottom-0 z-10 shadow-[0_-10px_20px_-10px_rgba(0,0,0,0.05)]">
        <div className="max-w-3xl mx-auto">
          <div className="flex gap-4 items-center">
            <button
              onClick={isVoiceActive ? stopVoiceMode : startVoiceMode}
              className={`p-5 rounded-[1.5rem] transition-all shadow-lg flex items-center justify-center ${
                isVoiceActive 
                  ? 'bg-red-500 text-white animate-pulse' 
                  : 'bg-gradient-to-br from-slate-800 to-black text-white hover:scale-105'
              }`}
            >
              {isVoiceActive ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              )}
            </button>
            
            <form onSubmit={handleSendMessage} className="relative flex-grow flex items-center">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={isVoiceActive ? "Listening..." : "How can I guide you today?"}
                className="w-full bg-slate-50 border border-slate-200 rounded-[1.5rem] pl-6 pr-16 py-5 focus:ring-4 focus:ring-blue-100 outline-none font-bold text-slate-700"
                disabled={isTyping || isVoiceActive}
              />
              <button
                type="submit"
                disabled={isTyping || isVoiceActive || !inputValue.trim()}
                className={`absolute right-3 p-3 rounded-xl transition-all ${
                  !inputValue.trim() || isTyping || isVoiceActive
                    ? 'text-slate-300' 
                    : 'bg-blue-600 text-white shadow-md active:scale-95'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                </svg>
              </button>
            </form>
          </div>
          <div className="flex justify-between items-center mt-4 px-2">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Socratic Mastery Hub
            </p>
            <p className="text-[10px] font-black bg-gradient-to-r from-blue-600 to-pink-500 bg-clip-text text-transparent uppercase tracking-widest">
              Top 1% Achiever Performance 🇳🇦
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
