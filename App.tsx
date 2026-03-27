import React, { useState, useEffect, useRef } from 'react';
import { Message, Level, SubjectOption, AppUser } from './types';
import { SUBJECTS } from './constants';

// --- Auth Constants ---
const ADMIN_EMAIL = '+264813879841';
const ADMIN_PASSWORD = '12345!';

const BackgroundBlobs = () => (
  <div className="fixed inset-0 pointer-events-none z-0">
    <div className="absolute top-[-10%] left-[-10%] w-[600px] h-[600px] bg-gradient-to-br from-blue-400/30 to-indigo-500/20 rounded-full blur-[120px] animate-pulse"></div>
    <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-gradient-to-tr from-pink-400/30 to-rose-500/20 rounded-full blur-[120px] animate-pulse delay-700"></div>
  </div>
);

const App: React.FC = () => {
  const [allUsers, setAllUsers] = useState<AppUser[]>(() => {
    const saved = localStorage.getItem('pocket_tutor_users');
    return saved ? JSON.parse(saved) : [];
  });
  const [currentUser, setCurrentUser] = useState<AppUser | null>(() => {
    const saved = localStorage.getItem('pocket_tutor_session');
    return saved ? JSON.parse(saved) : null;
  });
  const [phoneField, setPhoneField] = useState('');
  const [passwordField, setPasswordField] = useState('');
  const [selectedSubject, setSelectedSubject] = useState<SubjectOption | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isTyping]);

  const logout = () => { setCurrentUser(null); setMessages([]); setSelectedSubject(null); };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputValue.trim() || isTyping || !selectedSubject) return;

    const userText = inputValue;
    setInputValue('');
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: userText, timestamp: new Date() }]);
    setIsTyping(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, subject: selectedSubject.id, level: selectedSubject.level }),
      });

      const data = await response.json();
      setMessages(prev => [...prev, { id: 'ai-' + Date.now(), role: 'assistant', content: data.text || "Analyzed. Let's continue.", timestamp: new Date() }]);
    } catch (error) {
      setMessages(prev => [...prev, { id: 'err', role: 'assistant', content: "Connection error. Ensure GOOGLE_API_KEY is set in Vercel.", timestamp: new Date() }]);
    } finally { setIsTyping(false); }
  };

  const selectSubject = (s: SubjectOption) => {
    setSelectedSubject(s);
    setMessages([{ id: 'g', role: 'assistant', content: `Greetings, Scholar ${currentUser?.name}. I am your ${s.id} specialist for the 2026 ${s.level} curriculum.`, timestamp: new Date() }]);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (phoneField === ADMIN_EMAIL && passwordField === ADMIN_PASSWORD) {
        setCurrentUser({ id: 'admin', name: 'Nexus Master', phone: ADMIN_EMAIL, role: 'admin', status: 'approved', password: ADMIN_PASSWORD, trialStart: 'Perpetual' });
    } else {
      const user = allUsers.find(u => u.phone === phoneField && u.password === passwordField);
      if (user) setCurrentUser(user);
    }
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 relative overflow-hidden">
        <BackgroundBlobs />
        <div className="max-w-md w-full glass p-10 rounded-[2.5rem] shadow-2xl relative z-10 border border-white">
          <h2 className="text-3xl font-black text-center mb-8 text-slate-800">Pocket Tutor</h2>
          <form onSubmit={handleLogin} className="space-y-6">
            <input type="text" placeholder="Phone" className="w-full p-4 rounded-2xl border" value={phoneField} onChange={(e) => setPhoneField(e.target.value)} />
            <input type="password" placeholder="Password" className="w-full p-4 rounded-2xl border" value={passwordField} onChange={(e) => setPasswordField(e.target.value)} />
            <button type="submit" className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl">INITIATE ACCESS</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col relative overflow-hidden">
      <BackgroundBlobs />
      <header className="p-6 flex justify-between items-center relative z-10">
        <h1 className="text-2xl font-black text-slate-800 uppercase">{selectedSubject ? `${selectedSubject.id} 2026` : "Neural Menu"}</h1>
        <button onClick={logout} className="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase">Logout</button>
      </header>
      {!selectedSubject ? (
        <div className="flex-1 p-6 grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10">
          {SUBJECTS.map(s => (
            <button key={s.id} onClick={() => selectSubject(s)} className="glass p-8 rounded-[2rem] text-left border border-white">
              <h3 className="text-xl font-black text-slate-800">{s.id}</h3>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{s.level}</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col relative z-10 max-w-4xl mx-auto w-full p-4">
          <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 mb-4">
            {messages.map(m => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] p-4 rounded-2xl font-bold text-sm ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-800 shadow-sm'}`}>{m.content}</div>
              </div>
            ))}
          </div>
          <form onSubmit={handleSendMessage} className="relative mb-4">
            <input value={inputValue} onChange={(e) => setInputValue(e.target.value)} placeholder="Ask a question..." className="w-full bg-white/80 p-6 rounded-[2rem] shadow-xl outline-none font-bold" />
            <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 bg-indigo-600 text-white p-4 rounded-full">SEND</button>
          </form>
        </div>
      )}
    </div>
  );
};

export default App;

