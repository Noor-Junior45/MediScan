import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  X, Send, Bot, User, Sparkles, Loader2, Plus, 
  MessageSquare, ChevronLeft, Calendar, Clock, 
  History, Search, Trash2, ShieldCheck, Stethoscope,
  AlertCircle, Pill, Info, Mail
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, query, where, orderBy, onSnapshot, 
  addDoc, serverTimestamp, doc, updateDoc, deleteDoc,
  getDocs, getDoc, setDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { Medicine, ChatMessage, ChatSession } from '../types';
import { chatWithGemini } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';

interface ChatViewProps {
  onClose: () => void;
  medicines: Medicine[];
  user: any;
  userPhoto?: string | null;
}

const SUGGESTED_PROMPTS = [
  { icon: <ShieldCheck size={16} />, label: "Check drug interactions", prompt: "Please check my medicine list for any potential dangerous interactions." },
  { icon: <Info size={16} />, label: "Explain side effects", prompt: "Explain the common side effects of the medicines I'm currently taking." },
  { icon: <Clock size={16} />, label: "Dosing advice", prompt: "Provide general advice on how to correctly space my doses throughout the day." },
  { icon: <AlertCircle size={16} />, label: "Missed dose help", prompt: "What is the general protocol if I miss a dose of my medication?" }
];

export const ChatView: React.FC<ChatViewProps> = ({ onClose, medicines, user, userPhoto }) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [disclaimerTimeLeft, setDisclaimerTimeLeft] = useState(30);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const lastShow = localStorage.getItem('last_medical_disclaimer_date');
    const today = new Date().toDateString();
    
    if (lastShow !== today) {
      setShowDisclaimer(true);
      localStorage.setItem('last_medical_disclaimer_date', today);
    }
  }, []);

  useEffect(() => {
    let timer: any;
    if (showDisclaimer && disclaimerTimeLeft > 0) {
      timer = setInterval(() => {
        setDisclaimerTimeLeft(prev => {
          if (prev <= 1) {
            setShowDisclaimer(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [showDisclaimer, disclaimerTimeLeft]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Fetch Sessions
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'users', user.uid, 'chats'),
      orderBy('lastMessageAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sessionData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ChatSession[];
      setSessions(sessionData);
    });
    return unsubscribe;
  }, [user]);

  // Fetch Messages for current session
  useEffect(() => {
    if (!user || !currentSessionId) {
      setMessages([]);
      return;
    }
    const q = query(
      collection(db, 'users', user.uid, 'chats', currentSessionId, 'messages'),
      orderBy('timestamp', 'asc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ChatMessage[];
      setMessages(msgData);
    });
    return unsubscribe;
  }, [user, currentSessionId]);

  const handleCreateNewSession = async () => {
    if (!user) return;
    const sessionId = crypto.randomUUID();
    const newSession: Partial<ChatSession> = {
      id: sessionId,
      userId: user.uid,
      title: 'New Consultation',
      createdAt: Date.now(),
      lastMessageAt: Date.now()
    };
    await setDoc(doc(db, 'users', user.uid, 'chats', sessionId), newSession);
    setCurrentSessionId(sessionId);
    setInput('');
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || input;
    if (!textToSend.trim() || isLoading || !user) return;

    let sessionId = currentSessionId;
    if (!sessionId) {
      // Auto-create session if none active
      sessionId = crypto.randomUUID();
      const newSession: Partial<ChatSession> = {
        id: sessionId,
        userId: user.uid,
        title: textToSend.slice(0, 30) + (textToSend.length > 30 ? '...' : ''),
        createdAt: Date.now(),
        lastMessageAt: Date.now()
      };
      await setDoc(doc(db, 'users', user.uid, 'chats', sessionId), newSession);
      setCurrentSessionId(sessionId);
    }

    const messageId = crypto.randomUUID();
    const userMsg: ChatMessage = {
      id: messageId,
      role: 'user',
      content: textToSend,
      timestamp: Date.now()
    };

    // Save user message
    await setDoc(doc(db, 'users', user.uid, 'chats', sessionId, 'messages', messageId), userMsg);
    
    // Update session title if it was default
    const sessionRef = doc(db, 'users', user.uid, 'chats', sessionId);
    const sessionSnap = await getDoc(sessionRef);
    if (sessionSnap.exists() && sessionSnap.data().title === 'New Consultation') {
      await updateDoc(sessionRef, { 
        title: textToSend.slice(0, 40) + (textToSend.length > 40 ? '...' : ''),
        lastMessageAt: Date.now()
      });
    } else {
      await updateDoc(sessionRef, { lastMessageAt: Date.now() });
    }

    setInput('');
    setIsLoading(true);

    try {
      // Build history for Gemini
      const historyContext: ChatMessage[] = messages.concat(userMsg).map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp
      }));

      // Add medication context if it's a new or related conversation
      const medContext = `[Patient Profile Context:
      - Current Medications: ${medicines.map(m => `${m.name} (${m.dosage}, ${m.form})`).join(", ")}
      - Date: ${new Date().toLocaleDateString()}
      - Goal: Provide safe, empathetic medical guidance based on these specific medicines and the conversation history.]\n\n`;
      
      const lastMsgWithContext: ChatMessage = { 
        role: 'user', 
        content: messages.length === 0 ? medContext + textToSend : textToSend,
        timestamp: Date.now()
      };
      
      const promptHistory = historyContext.slice(0, -1).concat(lastMsgWithContext);

      const aiResponse = await chatWithGemini(promptHistory);

      const aiMsgId = crypto.randomUUID();
      const aiMsg: ChatMessage = {
        id: aiMsgId,
        role: 'assistant',
        content: aiResponse,
        timestamp: Date.now()
      };

      await setDoc(doc(db, 'users', user.uid, 'chats', sessionId, 'messages', aiMsgId), aiMsg);
      await updateDoc(sessionRef, { lastMessageAt: Date.now() });
    } catch (error) {
      console.error("Chat Error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendEmailReport = async () => {
    if (!user || messages.length === 0) return;
    
    setIsLoading(true);
    try {
      const reportContent = messages.map(m => `${m.role === 'user' ? 'Patient' : 'Doctor'}: ${m.content}`).join('\n\n');
      const medList = medicines.map(m => `- ${m.name} (${m.dosage})`).join('\n');
      
      const emailDoc = {
        to: user.email,
        message: {
          subject: `DawaLens AI Consultation Report - ${new Date().toLocaleDateString()}`,
          text: `Here is your medical consultation summary from DawaLens AI.\n\nYour Current Medications:\n${medList}\n\nChat History:\n${reportContent}\n\nDisclaimer: This report is for informational purposes only.`,
          html: `<h3>DawaLens AI Consultation Report</h3><p>Date: ${new Date().toLocaleDateString()}</p><h4>Current Medications:</h4><ul>${medicines.map(m => `<li>${m.name} (${m.dosage})</li>`).join('')}</ul><h4>Consultation Summary:</h4><pre>${reportContent}</pre><p><i>Disclaimer: This report was generated by AI and is for informational purposes only. Please consult your doctor for medical decisions.</i></p>`
        },
        timestamp: serverTimestamp()
      };
      
      await addDoc(collection(db, 'mail'), emailDoc);
      alert(`Report simulation complete. If you have the 'Trigger Email' extension enabled in your Firebase Console, an email has been sent to ${user.email}.`);
    } catch (err) {
      console.error("Mail Error:", err);
      alert("Mail service failed. Ensure the 'mail' collection exists and you have permissions.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!user) return;
    if (window.confirm("Are you sure you want to delete this consultation history?")) {
      await deleteDoc(doc(db, 'users', user.uid, 'chats', id));
      if (currentSessionId === id) {
        setCurrentSessionId(null);
      }
    }
  };

  const filteredSessions = sessions.filter(s => 
    s.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-[#0f0f0f] flex flex-col md:flex-row overflow-hidden"
    >
      {/* Daily Disclaimer Modal */}
      <AnimatePresence>
        {showDisclaimer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-md flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="w-full max-w-lg bg-[#1a1a1a] border border-white/10 rounded-[40px] p-8 md:p-12 shadow-2xl relative overflow-hidden"
            >
              {/* Progress Bar Background */}
              <div className="absolute top-0 left-0 w-full h-1 bg-white/5">
                <motion.div 
                  initial={{ width: '100%' }}
                  animate={{ width: '0%' }}
                  transition={{ duration: 30, ease: 'linear' }}
                  className="h-full bg-accent"
                />
              </div>

              <div className="flex flex-col items-center text-center space-y-6">
                <div className="w-20 h-20 rounded-3xl bg-red-500/10 flex items-center justify-center text-red-500 mb-2">
                  <ShieldCheck size={40} />
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-white tracking-tight uppercase">Medical Disclaimer</h3>
                  <p className="text-sm text-white/40 font-bold uppercase tracking-widest">Important Safety Notice</p>
                </div>

                <div className="bg-white/5 rounded-3xl p-6 text-sm text-white/70 leading-relaxed text-left border border-white/5">
                  <p className="mb-4">
                    The information provided by DawaLens AI is for <span className="text-white font-bold">informational and educational purposes only</span>. It is not a substitute for professional medical advice, diagnosis, or treatment.
                  </p>
                  <ul className="space-y-2 list-disc pl-4 text-white/50">
                    <li>Always follow your physician's specific instructions.</li>
                    <li>In case of a medical emergency, contact local emergency services immediately.</li>
                    <li>Do not ignore or delay seeking professional advice due to information from this app.</li>
                  </ul>
                </div>

                <div className="w-full flex flex-col gap-4">
                  <button
                    onClick={() => setShowDisclaimer(false)}
                    className="w-full py-4 bg-white text-black rounded-2xl font-black uppercase tracking-widest hover:bg-white/90 transition-all active:scale-95"
                  >
                    I Understand & Consent
                  </button>
                  <p className="text-[10px] text-white/20 font-bold uppercase tracking-[0.2em]">
                    Dismissing automatically in {disclaimerTimeLeft} seconds
                  </p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Top Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-white/5 border-b border-white/5 shrink-0">
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 text-white/60">
          <History size={20} />
        </button>
        <div className="flex items-center gap-2">
          <Bot className="text-accent" size={20} />
          <span className="font-bold text-white text-sm">Consultation</span>
        </div>
        <button onClick={onClose} className="p-2 text-white/60">
          <X size={20} />
        </button>
      </div>

      {/* Sidebar - Chat History */}
      <motion.aside
        initial={false}
        animate={{ 
          width: isSidebarOpen ? (isMobile ? '100%' : '320px') : '0px',
          x: isSidebarOpen ? 0 : -320
        }}
        className={`bg-[#141414] border-r border-white/5 flex flex-col z-50 absolute md:relative inset-y-0 left-0 overflow-hidden shadow-2xl md:shadow-none`}
      >
        <div className="p-6 shrink-0 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <History size={18} className="text-accent" />
              History
            </h2>
            <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 text-white/40">
              <X size={20} />
            </button>
          </div>

          <button 
            onClick={handleCreateNewSession}
            className="w-full bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl py-3 px-4 flex items-center justify-center gap-2 text-sm font-bold text-white transition-all active:scale-95"
          >
            <Plus size={18} />
            New Consultation
          </button>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" size={16} />
            <input 
              type="text" 
              placeholder="Search history..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/5 rounded-xl py-2.5 pl-10 pr-4 text-xs text-white focus:outline-none focus:border-white/20 transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-hide">
          {filteredSessions.length > 0 ? (
            filteredSessions.map(session => (
              <div
                key={session.id}
                onClick={() => {
                  setCurrentSessionId(session.id);
                  if (window.innerWidth < 768) setIsSidebarOpen(false);
                }}
                className={`w-full group text-left p-3 rounded-2xl transition-all flex items-center justify-between cursor-pointer ${
                  currentSessionId === session.id 
                    ? 'bg-accent/10 border border-accent/20 text-accent' 
                    : 'hover:bg-white/5 text-white/60 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <MessageSquare size={16} className={currentSessionId === session.id ? 'text-accent' : 'text-white/20'} />
                  <div className="flex flex-col overflow-hidden">
                    <span className="text-sm font-medium truncate">{session.title}</span>
                    <span className="text-[10px] opacity-40">{new Date(session.lastMessageAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteSession(e, session.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-white/20 hover:text-red-400 transition-all"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6">
              <Bot size={32} className="text-white/10 mb-3" />
              <p className="text-xs text-white/30">No consultations found. Start a new chat to get medical advice.</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent">
              {userPhoto ? <img src={userPhoto} alt="" className="w-full h-full object-cover rounded-full" /> : <User size={16} />}
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-white truncate max-w-[150px]">{user?.email || 'Patient'}</span>
              <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Verified Profile</span>
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative bg-[#0f0f0f]">
        {/* Desktop Header */}
        <header className="hidden md:flex items-center justify-between p-6 border-b border-white/5 shrink-0 bg-[#0f0f0f]">
          <div className="flex items-center gap-4">
            {!isSidebarOpen && (
              <button 
                onClick={() => setIsSidebarOpen(true)}
                className="p-2 bg-white/5 rounded-xl text-white/60 hover:text-white"
              >
                <History size={20} />
              </button>
            )}
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-accent/10 flex items-center justify-center text-accent shadow-lg shadow-accent/5">
                <Bot size={28} />
              </div>
              <div>
                <h1 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                  DawaLens AI Consultant
                  <Sparkles size={16} className="text-accent animate-pulse" />
                </h1>
                <p className="text-[11px] text-white/40 font-bold uppercase tracking-[0.2em] flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live Medical Guidance
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {messages.length > 0 && (
              <button
                onClick={handleSendEmailReport}
                className="flex items-center gap-2 px-4 py-2.5 bg-accent/10 border border-accent/20 rounded-xl text-accent hover:bg-accent/20 transition-all text-xs font-bold"
                title="Send Chat Report to Email"
              >
                <Mail size={16} />
                <span className="hidden sm:inline">Send Report</span>
              </button>
            )}
            <button 
              onClick={onClose}
              className="p-3 bg-white/5 rounded-2xl text-white/40 hover:text-white hover:bg-white/10 transition-all active:scale-90"
            >
              <X size={24} />
            </button>
          </div>
        </header>

        {/* Messages Container */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 scrollbar-hide">
          {messages.length === 0 ? (
            <div className="max-w-2xl mx-auto h-full flex flex-col items-center justify-center text-center">
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-20 h-20 rounded-3xl bg-accent/20 flex items-center justify-center text-accent mb-8 shadow-2xl shadow-accent/10 ring-1 ring-accent/20"
              >
                <Bot size={40} />
              </motion.div>
              <h2 className="text-2xl md:text-3xl font-black text-white mb-3 tracking-tight">How can I assist you today?</h2>
              <p className="text-sm text-white/40 mb-10 max-w-md leading-relaxed">
                I'm your dedicated AI Medical Assistant. I can help with dosing, safety checks, or explaining your medications.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                {SUGGESTED_PROMPTS.map((item, idx) => (
                  <motion.button
                    key={idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    onClick={() => handleSendMessage(item.prompt)}
                    className="p-5 bg-white/[0.03] border border-white/5 rounded-[22px] text-left hover:bg-accent/5 hover:border-accent/20 transition-all group"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/40 group-hover:bg-accent/20 group-hover:text-accent transition-colors mb-4">
                      {item.icon}
                    </div>
                    <span className="text-sm font-bold text-white group-hover:text-accent transition-colors">{item.label}</span>
                    <p className="text-xs text-white/30 mt-1 line-clamp-2 leading-relaxed">"{item.prompt}"</p>
                  </motion.button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-8">
              {messages.map((msg, idx) => (
                <motion.div
                  key={msg.id || idx}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex gap-4 md:gap-6 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <div className={`w-10 h-10 shrink-0 rounded-2xl flex items-center justify-center overflow-hidden shadow-lg ${
                    msg.role === 'user' ? 'bg-white/5 ring-1 ring-white/10' : 'bg-accent text-black ring-4 ring-accent/10'
                  }`}>
                    {msg.role === 'user' ? (
                      userPhoto ? <img src={userPhoto} alt="" className="w-full h-full object-cover" /> : <User size={20} />
                    ) : (
                      <Bot size={22} strokeWidth={2.5} />
                    )}
                  </div>
                  <div className={`flex flex-col max-w-[85%] md:max-w-[75%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`p-4 md:p-6 rounded-[28px] text-[15px] leading-relaxed shadow-xl prose prose-invert max-w-none ${
                      msg.role === 'user' 
                        ? 'bg-[#1a1a1a] text-white border border-white/10 rounded-tr-none' 
                        : 'bg-white/[0.02] text-white/90 border border-white/5 rounded-tl-none backdrop-blur-xl'
                    }`}>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                    <div className="flex items-center gap-2 mt-2 px-1">
                      <span className="text-[10px] text-white/20 font-bold uppercase tracking-widest">
                        {msg.role === 'user' ? 'Patient' : 'Dr. DawaLens AI'}
                      </span>
                      <span className="w-1 h-1 rounded-full bg-white/10" />
                      <span className="text-[10px] text-white/20 font-medium">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </motion.div>
              ))}
              {isLoading && (
                <div className="flex gap-4 md:gap-6">
                  <div className="w-10 h-10 shrink-0 rounded-2xl bg-accent text-black flex items-center justify-center shadow-lg ring-4 ring-accent/10">
                    <Bot size={22} strokeWidth={2.5} />
                  </div>
                  <div className="bg-white/[0.02] p-4 md:p-6 rounded-[28px] rounded-tl-none border border-white/5 flex items-center justify-center">
                    <div className="flex gap-1.5">
                      <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 bg-accent/40 rounded-full" />
                      <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-accent/60 rounded-full" />
                      <motion.div animate={{ scale: [1, 1.5, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-accent rounded-full" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="p-4 md:p-8 bg-gradient-to-t from-[#0f0f0f] via-[#0f0f0f] to-transparent shrink-0">
          <div className="max-w-3xl mx-auto">
            <div className="relative group">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Message Dr. DawaLens AI..."
                className="w-full bg-[#1a1a1a] border border-white/10 rounded-[28px] py-4 md:py-6 pl-6 pr-20 text-[15px] text-white focus:outline-none focus:border-accent/40 group-focus-within:ring-4 ring-accent/5 transition-all shadow-2xl"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button
                  onClick={() => handleSendMessage()}
                  disabled={!input.trim() || isLoading}
                  className={`p-3 md:p-4 rounded-2xl transition-all ${
                    input.trim() && !isLoading 
                      ? 'bg-accent text-black scale-100 hover:scale-105 active:scale-95 shadow-lg shadow-accent/20' 
                      : 'bg-white/5 text-white/20'
                  }`}
                >
                  {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                </button>
              </div>
            </div>
            <p className="mt-4 text-center text-[10px] text-white/20 font-medium">
              Medical guidance provided for informational purposes only. Please consult your personal doctor for medical decisions.
            </p>
          </div>
        </div>
      </main>
    </motion.div>
  );
};
