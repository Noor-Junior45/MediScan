import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  X, Send, Bot, User, Sparkles, Loader2, Plus, 
  MessageSquare, ChevronLeft, Calendar, Clock, 
  History, Search, Trash2, ShieldCheck, Stethoscope,
  AlertCircle, Pill, Info, Mail, ArrowLeft, Check, CheckCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, query, where, orderBy, onSnapshot, 
  addDoc, serverTimestamp, doc, updateDoc, deleteDoc,
  getDocs, getDoc, setDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { Medicine, ChatMessage, ChatSession, AIProvider } from '../types';
import { chatWithAI, isProviderKeyMissing } from '../services/geminiService';
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

const MAIN_SESSION_ID = 'global_medical_consultation';

export const ChatView: React.FC<ChatViewProps> = ({ onClose, medicines, user, userPhoto }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [disclaimerTimeLeft, setDisclaimerTimeLeft] = useState(30);
  const [activeProvider, setActiveProvider] = useState<AIProvider>('gemini');
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

  // Fetch Messages for the single global session
  useEffect(() => {
    if (!user) return;
    
    const ensureSession = async () => {
      const sessionRef = doc(db, 'users', user.uid, 'chats', MAIN_SESSION_ID);
      const snap = await getDoc(sessionRef);
      if (!snap.exists()) {
        await setDoc(sessionRef, {
          id: MAIN_SESSION_ID,
          userId: user.uid,
          title: 'Direct AI Consultation',
          createdAt: Date.now(),
          lastMessageAt: Date.now()
        });
      }
    };
    ensureSession();

    const q = query(
      collection(db, 'users', user.uid, 'chats', MAIN_SESSION_ID, 'messages'),
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
  }, [user]);

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || input;
    if (!textToSend.trim() || isLoading || !user) return;

    const messageId = crypto.randomUUID();
    const userMsg: ChatMessage = {
      id: messageId,
      role: 'user',
      content: textToSend,
      timestamp: Date.now()
    };

    // Save user message
    await setDoc(doc(db, 'users', user.uid, 'chats', MAIN_SESSION_ID, 'messages', messageId), userMsg);
    
    // Update session timestamp
    const sessionRef = doc(db, 'users', user.uid, 'chats', MAIN_SESSION_ID);
    await updateDoc(sessionRef, { lastMessageAt: Date.now() });

    setInput('');
    setIsLoading(true);

    try {
      // Build history
      const historyContext: ChatMessage[] = messages.concat(userMsg).map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp
      }));

      const medContext = `[Patient Profile & Storage Context:
      - Inventory Check: Use this list to intelligently suggest medicines the user ALREADY has in their vault.
      - User's Stored Medicines: ${medicines.map(m => `${m.name} (${m.dosage}, ${m.form})`).join(", ")}
      - Date: ${new Date().toLocaleDateString()}
      - Task: If the user asks for a remedy or recommendation, search their 'User's Stored Medicines' first. Tell them exactly what they have that might help.]\n\n`;
      
      const lastMsgWithContext: ChatMessage = { 
        role: 'user', 
        content: messages.length === 0 ? medContext + textToSend : textToSend,
        timestamp: Date.now()
      };
      
      const promptHistory = historyContext.slice(0, -1).concat(lastMsgWithContext);

      const aiResponse = await chatWithAI(promptHistory, activeProvider);

      const aiMsgId = crypto.randomUUID();
      const aiMsg: ChatMessage = {
        id: aiMsgId,
        role: 'assistant',
        content: aiResponse,
        timestamp: Date.now(),
        provider: activeProvider
      };

      await setDoc(doc(db, 'users', user.uid, 'chats', MAIN_SESSION_ID, 'messages', aiMsgId), aiMsg);
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

  const handleClearChat = async () => {
    if (!user) return;
    if (window.confirm("This will permanently clear your consultation history. Continue?")) {
      const msgsRef = collection(db, 'users', user.uid, 'chats', MAIN_SESSION_ID, 'messages');
      const snap = await getDocs(msgsRef);
      const batch = snap.docs.map(d => deleteDoc(d.ref));
      await Promise.all(batch);
      setMessages([]);
    }
  };

  const formatMessageDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-[#0b0b0b] flex flex-col overflow-hidden"
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

      {/* Main Bar / Header */}
      <header className="flex items-center justify-between px-4 py-4 md:py-6 bg-[#121b22] border-b border-white/5 shrink-0 safe-top">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-2 text-white/60 hover:text-white transition-colors">
            <ArrowLeft size={24} />
          </button>
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 md:w-12 h-10 md:h-12 rounded-full bg-accent/20 flex items-center justify-center text-accent ring-2 ring-accent/20">
                <Bot size={24} className="md:size-28" />
              </div>
              <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-[#121b22] rounded-full" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-white text-sm md:text-base tracking-tight">DawaLens AI</span>
              <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest">Medical Assistant</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* AI Provider Toggle */}
          <div className="hidden sm:flex bg-black/40 p-1 rounded-2xl border border-white/5 scale-90">
            <button 
              onClick={() => setActiveProvider('gemini')}
              className={`py-1.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all gap-2 flex items-center ${
                activeProvider === 'gemini' ? 'bg-accent text-black' : 'text-white/40 hover:text-white'
              }`}
            >
              Gemini
              {isProviderKeyMissing('gemini') && <AlertCircle size={12} className="text-red-500" />}
            </button>
            <button 
              onClick={() => setActiveProvider('deepseek')}
              className={`py-1.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all gap-2 flex items-center ${
                activeProvider === 'deepseek' ? 'bg-accent text-black' : 'text-white/40 hover:text-white'
              }`}
            >
              DeepSeek
              {isProviderKeyMissing('deepseek') && <AlertCircle size={12} className="text-red-500" />}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleClearChat}
              className="p-2.5 bg-white/5 rounded-xl text-white/40 hover:text-red-400 hover:bg-white/10 transition-all"
              title="Clear Entire Chat"
            >
              <Trash2 size={20} />
            </button>
            <button 
              onClick={onClose}
              className="p-2.5 bg-white/5 rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition-all"
            >
              <X size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col relative bg-[#0b141a] overflow-hidden">
        {/* Aesthetic Background Pattern */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none select-none overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-accent blur-[150px] rounded-full" />
          <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-emerald-500 blur-[150px] rounded-full" />
          <div className="grid grid-cols-12 gap-px h-full">
            {Array.from({ length: 144 }).map((_, i) => (
              <div key={i} className="border border-white/[0.05]" />
            ))}
          </div>
        </div>

        {/* Messages Container */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scrollbar-hide relative z-10 w-full max-w-4xl mx-auto">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
              <Bot size={60} strokeWidth={1} />
              <p className="mt-4 text-sm font-medium">Starting conversation...</p>
            </div>
          )}

          <div className="space-y-6">
            {messages.map((msg, idx) => {
              const showDate = idx === 0 || formatMessageDate(msg.timestamp) !== formatMessageDate(messages[idx - 1].timestamp);
              
              return (
                <React.Fragment key={msg.id || idx}>
                  {showDate && (
                    <div className="flex justify-center my-10">
                      <span className="bg-[#182229] text-white/50 text-[10px] font-black px-4 py-2 rounded-xl shadow-sm uppercase tracking-[0.2em] transition-all">
                        {formatMessageDate(msg.timestamp)}
                      </span>
                    </div>
                  )}
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className={`flex items-end gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    {/* Avatar Integration */}
                    <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center overflow-hidden mb-2 ${
                      msg.role === 'user' ? 'bg-white/10' : 'bg-accent/20 text-accent'
                    }`}>
                      {msg.role === 'user' ? (
                        userPhoto ? <img src={userPhoto} alt="" className="w-full h-full object-cover" /> : <User size={16} />
                      ) : (
                        <Bot size={18} />
                      )}
                    </div>

                    <div className={`relative max-w-[85%] md:max-w-[75%] px-4 pt-3 pb-2 shadow-lg flex flex-col ${
                      msg.role === 'user' 
                        ? 'bg-[#005c4b] text-white rounded-[18px] rounded-br-[4px]' 
                        : 'bg-[#202c33] text-white rounded-[18px] rounded-bl-[4px]'
                    }`}>
                      {/* Provider Badge for AI */}
                      {msg.role === 'assistant' && (
                        <div className="flex items-center gap-2 mb-2 px-1 opacity-70">
                          <Bot size={12} className="text-accent" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-accent">
                            {msg.provider?.toUpperCase() || activeProvider.toUpperCase()}
                          </span>
                        </div>
                      )}
                      
                      <div className="prose prose-sm prose-invert max-w-none text-[15px] leading-relaxed break-words">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                      
                      <div className="flex items-center self-end gap-1.5 mt-2 ml-10">
                        <span className="text-[10px] text-white/40 font-bold tracking-tighter">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {msg.role === 'user' && (
                          <CheckCheck size={14} className="text-emerald-400 opacity-80" />
                        )}
                      </div>

                      {/* Aesthetic Tails */}
                      {msg.role === 'user' && (
                        <svg className="absolute -bottom-[2px] -right-[10px]" width="15" height="15" viewBox="0 0 15 15">
                          <path d="M0 15 C 6 15 10 15 15 15 L 15 0 C 12 4 8 10 0 15 Z" fill="#005c4b" />
                        </svg>
                      )}
                      
                      {msg.role === 'assistant' && (
                        <svg className="absolute -bottom-[2px] -left-[10px]" width="15" height="15" viewBox="0 0 15 15">
                          <path d="M15 15 C 9 15 5 15 0 15 L 0 0 C 3 4 7 10 15 15 Z" fill="#202c33" />
                        </svg>
                      )}
                    </div>
                  </motion.div>
                </React.Fragment>
              );
            })}
            {isLoading && (
              <div className="flex justify-start items-end gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent mb-2">
                  <Bot size={18} />
                </div>
                <div className="bg-[#202c33] px-5 py-4 rounded-[18px] rounded-bl-[4px] shadow-sm">
                  <div className="flex gap-2">
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.2 }} className="w-2.5 h-2.5 bg-accent/60 rounded-full" />
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.2, delay: 0.2 }} className="w-2.5 h-2.5 bg-accent/60 rounded-full" />
                    <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.2, delay: 0.4 }} className="w-2.5 h-2.5 bg-accent/60 rounded-full" />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Bar & Persistent Recommendations */}
        <div className="p-4 md:p-6 bg-[#121b22] border-t border-white/5 shrink-0 safe-bottom z-20">
          <div className="max-w-4xl mx-auto space-y-4">
            {/* Quick Actions Scroll bar */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide no-scrollbar">
              {SUGGESTED_PROMPTS.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(item.prompt)}
                  className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-white/[0.03] border border-white/5 rounded-full text-xs font-bold text-white/60 hover:bg-white/[0.08] hover:text-white transition-all whitespace-nowrap active:scale-95"
                >
                  <span className="text-accent">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Ask about medications..."
                  className="w-full bg-[#2a3942] border border-white/5 rounded-[22px] py-4 px-6 text-[15px] text-white focus:outline-none focus:ring-1 focus:ring-accent/20 placeholder:text-white/20 shadow-inner"
                />
              </div>
              <button
                onClick={() => handleSendMessage()}
                disabled={!input.trim() || isLoading}
                className={`p-4 rounded-full transition-all shadow-xl ${
                  input.trim() && !isLoading 
                    ? 'bg-[#00a884] text-white scale-100 active:scale-90 hover:shadow-emerald-500/20' 
                    : 'bg-[#2a3942] text-white/10'
                }`}
              >
                {isLoading ? <Loader2 size={24} className="animate-spin" /> : <Send size={24} />}
              </button>
            </div>
          </div>
        </div>
      </main>
    </motion.div>
  );
};
