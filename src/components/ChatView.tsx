import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  X, Send, Bot, User, Sparkles, Loader2, Plus, 
  MessageSquare, ChevronLeft, Calendar, Clock, 
  History, Search, Trash2, ShieldCheck, Stethoscope,
  AlertCircle, Pill, Info, Mail, ArrowLeft, Check, CheckCheck,
  Camera, Mic, Languages
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, query, where, orderBy, onSnapshot, 
  addDoc, serverTimestamp, doc, updateDoc, deleteDoc,
  getDocs, getDoc, setDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { Medicine, ChatMessage, ChatSession, AIProvider } from '../types';
import { chatWithAI, isProviderKeyMissing, getChatCountToday } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';
import { DoctorLogo } from './DoctorLogo';
import { sendEmailAlert, getConsultationReportEmailHTML } from '../services/emailService';
import { trackEvent } from '../utils/analytics';

interface ChatViewProps {
  onClose: () => void;
  medicines: Medicine[];
  user: any;
  userPhoto?: string | null;
}

const SUGGESTED_PROMPTS = [
  { icon: <span className="text-[14px]">🔍</span>, label: "Check drug interactions 🔍", prompt: "Can you analyze my active medicines to see if there are any dangerous drug-to-drug interactions I should be aware of?" },
  { icon: <span className="text-[14px]">⚠️</span>, label: "Explain side effects ⚠️", prompt: "What are the key side effects of the medicines currently in my inventory, and what warnings should I note?" },
  { icon: <span className="text-[14px]">📅</span>, label: "Daily schedule help 📅", prompt: "Help me organize a safe daily consumption schedule for all the medications in my list." },
  { icon: <span className="text-[14px]">⏳</span>, label: "Show expiring medicines ⏳", prompt: "Identify which of my medicines are expiring soon and advise on safe disposal practices." }
];

const MAIN_SESSION_ID = 'global_medical_consultation';

export const ChatView: React.FC<ChatViewProps> = ({ onClose, medicines, user, userPhoto }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [disclaimerTimeLeft, setDisclaimerTimeLeft] = useState(30);
  const [activeProvider] = useState<AIProvider>('gemini');
  const [isOnline, setIsOnline] = useState(true);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);
  const [keyStatus, setKeyStatus] = useState<{ hasKey: boolean; checkedAt?: string; error?: string } | null>(null);

  const [chatCount, setChatCount] = useState<number>(0);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const checkKeyStatus = async () => {
      try {
        const res = await fetch('/api/ai/key-status');
        const data = await res.json();
        setKeyStatus(data);
        if (!data.hasKey) {
          setIsOnline(false);
        }
      } catch (err) {
        console.error("Failed to check key status:", err);
        setKeyStatus({ 
          hasKey: false, 
          checkedAt: new Date().toLocaleTimeString(), 
          error: "Failed to connect to server status endpoint." 
        });
        setIsOnline(false);
      }
    };
    checkKeyStatus();
  }, []);

  useEffect(() => {
    if (chatCount >= 10) {
      setIsOnline(false);
    } else if (keyStatus && !keyStatus.hasKey) {
      setIsOnline(false);
    } else {
      setIsOnline(true);
    }
  }, [chatCount, keyStatus]);

  // Load daily chat count
  useEffect(() => {
    if (!user) return;
    const loadChatCount = async () => {
      try {
        const count = await getChatCountToday(user.uid);
        setChatCount(count);
      } catch (err) {
        console.error("Failed to load chat count:", err);
      }
    };
    loadChatCount();
  }, [user]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Removed auto-disclaimer popup for clean layout as requested

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
      const uniqueMsgs = Array.from(new Map(msgData.map(m => [m.id, m])).values());
      setMessages(uniqueMsgs);
    });
    return unsubscribe;
  }, [user]);

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || input;
    if (!textToSend.trim() || isLoading || !user) return;

    if (chatCount >= 10) {
      alert("You have reached your daily limit of 10 chats. Please come back tomorrow to continue your consultation with Dr. DawaLens!");
      return;
    }

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

      const aiResponse = await chatWithAI(promptHistory, activeProvider, user.uid, medicines);
      setIsOnline(true);
      setChatCount(prev => Math.min(10, prev + 1));
      trackEvent('chat_with_ai', { length: textToSend.length });

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
    } catch (error: any) {
      console.error("Chat Error:", error);
      
      const errorMessage = error.message || String(error);
      const errLower = errorMessage.toLowerCase();
      const isSpendCapExceeded = 
        errLower.includes("spending cap") || 
        errLower.includes("resource_exhausted") || 
        errLower.includes("monthly spending cap") ||
        errLower.includes("quota") ||
        errLower.includes("billing");
      const isLimitReached = (errorMessage.includes("limit of 10 chats") || errorMessage.includes("429")) && !isSpendCapExceeded;
      
      if (isSpendCapExceeded || isLimitReached) {
        setIsOnline(true);
      } else {
        setIsOnline(false);
      }

      if (isLimitReached) {
        setChatCount(10);
      }

      let content = `I encountered an issue connecting. Please try again. (${errorMessage})`;
      if (isSpendCapExceeded) {
        content = `⚠️ **Gemini AI Service Temporarily Paused**

The AI Pharmacist is currently online, but the project's **Google AI Studio Spending Cap** or monthly quota has been reached.

If you are the developer/owner of this project, you can easily resolve this by managing your billing plan and spending limits in Google AI Studio:
👉 **[Open Google AI Studio Spend Settings](https://ai.studio/spend)**

Otherwise, please try again once the billing plan or quota is refreshed. Thank you for your patience!`;
      } else if (isLimitReached) {
        content = `⚠️ **Daily Consultation Limit Reached**\n\nYou have reached your daily limit of 10 consultations today. To keep your healthcare safe and well-monitored, Dr. DawaLens is limited to 10 chats per day. Please return tomorrow, and I will be delighted to assist you further!`;
      }

      const aiMsgId = crypto.randomUUID();
      const aiMsg: ChatMessage = {
        id: aiMsgId,
        role: 'assistant',
        content,
        timestamp: Date.now(),
        provider: activeProvider
      };
      await setDoc(doc(db, 'users', user.uid, 'chats', MAIN_SESSION_ID, 'messages', aiMsgId), aiMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendEmailReport = async () => {
    if (!user || messages.length === 0) return;
    
    setIsLoading(true);
    try {
      const reportContent = messages.map(m => `${m.role === 'user' ? 'Patient' : 'DawaLens AI'}: ${m.content}`).join('\n\n');
      const medList = medicines.map(m => `- ${m.name} (${m.dosage || 'N/A'})`).join('\n');
      
      const subject = `Consultation Report: DawaLens AI - ${new Date().toLocaleDateString()}`;
      const text = `Here is your medical consultation summary from DawaLens AI.\n\nYour Current Medications:\n${medList}\n\nChat History:\n${reportContent}\n\nDisclaimer: This report is for informational purposes only.`;
      
      const chatHtmlBubbles = messages.map(m => {
        const sender = m.role === 'user' ? 'Patient' : 'DawaLens AI';
        const color = m.role === 'user' ? '#1e40af' : '#047857';
        const bg = m.role === 'user' ? '#eff6ff' : '#ecfdf5';
        return `
          <div style="margin-bottom: 16px; padding: 12px 16px; background-color: ${bg}; border-radius: 8px; border-left: 4px solid ${color};">
            <strong style="color: ${color}; font-size: 12px; text-transform: uppercase; font-family: sans-serif;">${sender}</strong>
            <p style="margin: 4px 0 0 0; font-size: 14px; color: #1f2937; font-family: sans-serif; line-height: 1.5;">${m.content.replace(/\n/g, '<br/>')}</p>
          </div>
        `;
      }).join('');

      const html = getConsultationReportEmailHTML(
        medicines.map(m => ({ name: m.name, dosage: m.dosage })),
        chatHtmlBubbles,
        new Date().toLocaleDateString()
      );
      
      await sendEmailAlert({
        to: user.email,
        subject,
        text,
        html
      });
      trackEvent('send_email_report', { message_count: messages.length });
      alert(`Consultation report email sent successfully to ${user.email}!`);
    } catch (err: any) {
      console.error("Mail Error:", err);
      alert(`Mail service failed: ${err.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearChat = () => {
    if (!user) return;
    setShowDeleteConfirm(true);
  };

  const confirmClearChat = async () => {
    if (!user) return;
    try {
      const msgsRef = collection(db, 'users', user.uid, 'chats', MAIN_SESSION_ID, 'messages');
      const snap = await getDocs(msgsRef);
      const batch = snap.docs.map(d => deleteDoc(d.ref));
      await Promise.all(batch);
      setMessages([]);
    } catch (err) {
      console.error("Error clearing chat messages:", err);
    } finally {
      setShowDeleteConfirm(false);
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

  const lastAssistantMessage = useMemo(() => {
    const assistants = messages.filter(m => m.role === 'assistant');
    return assistants[assistants.length - 1];
  }, [messages]);

  const handleSpeakText = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const cleanText = text.replace(/[*#_`~]/g, '');
      const utterance = new SpeechSynthesisUtterance(cleanText);
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatMessageDateString = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
  };

  const [showSuggestions, setShowSuggestions] = useState(true);

  return (
    <>
      {/* Dimmed backdrop to focus on the chat pop up and allow click-outside to close */}
      <div 
        onClick={onClose} 
        className="fixed inset-0 bg-black/35 backdrop-blur-[2px] z-[99] cursor-default transition-all" 
      />

      <motion.div 
        initial={isMobile ? { y: '100%' } : { opacity: 0, y: 40, scale: 0.98 }}
        animate={isMobile ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }}
        exit={isMobile ? { y: '100%' } : { opacity: 0, y: 40, scale: 0.98 }}
        transition={{ type: 'spring', damping: 26, stiffness: 220 }}
        className="fixed z-[100] flex flex-col overflow-hidden font-sans bg-[#fdfbf7] border border-slate-200/80 shadow-[0_24px_64px_rgba(0,0,0,0.18)]
          top-[14vh] bottom-0 left-0 right-0 rounded-t-[32px] 
          md:top-auto md:bottom-6 md:right-6 md:left-auto md:w-[460px] md:h-[680px] md:max-h-[82vh] md:rounded-[30px]"
      >
        {/* Drag handle for mobile to represent bottom sheet */}
        <div className="md:hidden flex justify-center py-2 shrink-0 bg-[#0f9d58]">
          <div className="w-12 h-1.5 rounded-full bg-white/30" />
        </div>

        {/* Main Bar / Header */}
        <header className="flex items-center justify-between px-4 py-3 bg-[#0f9d58] shrink-0 text-white relative z-30 shadow-xs">
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="p-1.5 text-white/90 hover:text-white transition-colors hover:bg-white/10 rounded-full" title="Back">
              <ChevronLeft size={24} />
            </button>
            
            <div className="flex items-center gap-3">
              {/* Keep only that person[svg] */}
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0 shadow-3xs">
                <DoctorLogo className="w-6 h-6 text-white" />
              </div>
              
              <div className="flex flex-col">
                <span className="font-extrabold text-white text-base tracking-tight leading-tight">AI Pharmacist</span>
                <div className="flex flex-col">
                  <span className="text-[10px] text-[#e0e1f9] font-black uppercase tracking-widest flex items-center gap-1.5 mt-0.5 leading-none">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-[#34d399]' : 'bg-[#ef4444]'}`} />
                    {isOnline ? 'ONLINE' : 'OFFLINE'}
                    {chatCount >= 10 && <span className="text-[8px] text-red-200 normal-case font-bold ml-1">(Limit Reached)</span>}
                  </span>
                  {keyStatus && !keyStatus.hasKey && (
                    <span className="text-[7px] text-red-100 font-bold leading-none mt-0.5 tracking-wider uppercase">
                      ⚠️ Keys Not Found Since {keyStatus.checkedAt || new Date().toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Red delete button with NO circular background */}
            <button
              onClick={handleClearChat}
              className="flex items-center justify-center text-red-500 hover:text-red-400 active:scale-95 transition-all p-2 bg-transparent border-none"
              title="Clear Entire Chat"
            >
              <Trash2 size={18} className="stroke-[2.5]" />
            </button>
            {/* Black cross button with circular apple-style glassmorphism background */}
            <button 
              onClick={onClose}
              className="w-10 h-10 rounded-full flex items-center justify-center bg-black/10 backdrop-blur-md text-white hover:bg-black/20 active:scale-95 rounded-full transition-all border border-white/10 shadow-xs"
              title="Close"
            >
              <X size={18} className="stroke-[2.5]" />
            </button>
          </div>
        </header>

        {/* Main Messages area with simple soft cream white background */}
        <main 
          className="flex-1 flex flex-col relative overflow-hidden bg-[#faf8f5]"
        >
          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-5 scrollbar-hide relative z-10 w-full max-w-4xl mx-auto custom-scrollbar">
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center py-8">
                <div className="w-16 h-16 rounded-full bg-[#0f9d58]/10 flex items-center justify-center text-[#0f9d58] mb-3 border border-[#0f9d58]/20 mx-auto">
                  <DoctorLogo className="w-12 h-12 text-[#0f9d58]" />
                </div>
                <p className="text-sm font-bold text-slate-700">How can I help you today?</p>
                <p className="text-xs text-slate-500 mt-1 max-w-[260px] mx-auto mb-6">Ask me anything about interactions, dosages, or side effects of your medicines.</p>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md mx-auto w-full px-4">
                  {SUGGESTED_PROMPTS.map((item, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleSendMessage(item.prompt)}
                      className="flex items-center gap-2.5 p-3 rounded-2xl bg-white border border-slate-200/80 hover:border-[#0f9d58]/40 hover:bg-[#0f9d58]/5 text-left text-[12.5px] text-slate-700 font-medium transition-all active:scale-95 shadow-2xs hover:shadow-xs cursor-pointer"
                    >
                      <span className="shrink-0">{item.icon}</span>
                      <span className="line-clamp-2">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-5">
              {messages.map((msg, idx) => {
                const currentDateStr = formatMessageDate(msg.timestamp);
                const prevDateStr = idx > 0 ? formatMessageDate(messages[idx - 1].timestamp) : null;
                const showDate = idx === 0 || currentDateStr !== prevDateStr;
                const exactDateStr = formatMessageDateString(msg.timestamp);
                const isTodayStr = currentDateStr === 'Today';

                return (
                  <React.Fragment key={`chat-msg-${msg.id || ''}-${idx}`}>
                    {showDate && (
                      <div className="flex flex-col items-center gap-1.5 my-5 select-none">
                        <span className="bg-[#0f9d58]/10 text-[#065f46] text-[10px] font-black px-3.5 py-1 rounded-full uppercase tracking-wider shadow-2xs border border-[#0f9d58]/10">
                          {exactDateStr}
                        </span>
                        {isTodayStr && (
                          <span className="bg-[#0f9d58]/15 text-[#065f46] text-[10px] font-black px-3 py-0.5 rounded-full uppercase tracking-wider shadow-3xs">
                            TODAY
                          </span>
                        )}
                      </div>
                    )}

                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      className={`flex items-start gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                    >
                      {/* Rounded Avatar next to bubbles */}
                      {msg.role === 'user' ? (
                        <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-slate-800 shrink-0 shadow-3xs border border-slate-300">
                          {userPhoto ? (
                            <img src={userPhoto} alt="" className="w-full h-full rounded-full object-cover" />
                          ) : (
                            <User size={16} className="stroke-[2.5]" />
                          )}
                        </div>
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-[#0f9d58]/10 flex items-center justify-center text-[#0f9d58] shrink-0 border border-[#0f9d58]/20 shadow-3xs">
                          <DoctorLogo className="w-6 h-6 text-[#0f9d58]" />
                        </div>
                      )}

                      {/* Flex column for Chat Bubble and action buttons below */}
                      <div className="flex flex-col max-w-[80%] md:max-w-[72%]">
                        {/* Chat Bubble */}
                        <div className={`relative px-4 py-3 shadow-3xs flex flex-col ${
                          msg.role === 'user' 
                            ? 'bg-[#e2f7cb] text-[#1f1f1f] rounded-[18px] rounded-tr-none' 
                            : 'bg-white text-[#1f1f1f] rounded-[18px] rounded-tl-none border border-slate-100'
                        }`}>
                          <div className="prose prose-sm max-w-none text-[14.5px] leading-relaxed break-words text-[#1f1f1f] [&_a]:text-[#0f9d58] [&_a]:underline [&_a]:font-bold hover:[&_a]:text-[#0d854a]">
                            <ReactMarkdown
                              components={{
                                a: ({ node, ...props }) => (
                                  <a 
                                    {...props} 
                                    target="_blank" 
                                    rel="noopener noreferrer" 
                                  />
                                )
                              }}
                            >
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                          
                          {/* Timestamp & Tick */}
                          <div className="flex items-center self-end gap-1 mt-1.5">
                            <span className="text-[9.5px] text-slate-400 font-medium select-none">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {msg.role === 'user' && (
                              <CheckCheck size={13} className="text-emerald-500" />
                            )}
                          </div>

                          {/* Aesthetic Tails */}
                          {msg.role === 'user' && (
                            <svg className="absolute top-0 -right-[8px]" width="9" height="13" viewBox="0 0 10 15">
                              <path d="M0 0 L 10 0 C 7 3 3 8 0 15 Z" fill="#e2f7cb" />
                            </svg>
                          )}
                          
                          {msg.role === 'assistant' && (
                            <svg className="absolute top-0 -left-[8px]" width="9" height="13" viewBox="0 0 10 15">
                              <path d="M10 0 L 0 0 C 3 3 7 8 10 15 Z" fill="#ffffff" />
                            </svg>
                          )}
                        </div>

                        {/* Speaker and copy button OUTSIDE of the reply box */}
                        {msg.role === 'assistant' && (
                          <div className="flex items-center gap-3 mt-1.5 px-2">
                            <button 
                              onClick={() => handleSpeakText(msg.content)} 
                              className="text-[10px] text-[#0f9d58] font-black hover:text-[#065f46] transition-colors flex items-center gap-1 select-none cursor-pointer"
                            >
                              <span>🔊 Speak</span>
                            </button>
                            <button 
                              onClick={() => handleCopyText(msg.content)} 
                              className="text-[10px] text-slate-400 font-black hover:text-slate-600 transition-colors flex items-center gap-1 select-none cursor-pointer"
                            >
                              <span>📋 Copy</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  </React.Fragment>
                );
              })}

              {isLoading && (
                <div className="flex justify-start items-start gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-[#0f9d58]/10 flex items-center justify-center text-[#0f9d58] shrink-0 border border-[#0f9d58]/20 shadow-3xs">
                    <DoctorLogo className="w-6 h-6 text-[#0f9d58]" />
                  </div>
                  <div className="bg-white px-4 py-3 rounded-[18px] rounded-tl-none shadow-3xs border border-slate-100">
                    <div className="flex gap-1.5 py-1">
                      <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.2 }} className="w-2 h-2 bg-[#0f9d58] rounded-full" />
                      <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.2, delay: 0.2 }} className="w-2 h-2 bg-[#0f9d58] rounded-full" />
                      <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1.2, delay: 0.4 }} className="w-2 h-2 bg-[#0f9d58] rounded-full" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Input Bar Section */}
          <div className="bg-[#f0f2f5] border-t border-slate-200/80 shrink-0 safe-bottom z-20 pb-4">
            <div className="w-full">
              {/* Daily Limit Status Indicator */}
              <div className="px-5 pt-2 pb-1 flex justify-between items-center text-[11px] text-slate-500 font-bold tracking-wide select-none">
                <span className="flex items-center gap-1 text-[#0f9d58]">
                  <Sparkles size={11} className="animate-pulse" />
                  HIGH THINKING AI ACTIVE
                </span>
                <span className="bg-slate-200/60 px-2 py-0.5 rounded-full font-mono">
                  {10 - chatCount > 0 ? `${10 - chatCount}/10 chats left today` : "Limit reached today"}
                </span>
              </div>

              {/* Input Row */}
              <div className="px-4 pt-1 flex items-center gap-3">
                {/* Main Input Pill */}
                <div className="flex-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="Type a message..."
                    className="w-full bg-white border border-slate-200 rounded-full py-3.5 px-5 text-[14px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#0f9d58]/30 placeholder:text-slate-400 shadow-inner"
                  />
                </div>

                {/* Send Button styled like WhatsApp (always green, white send icon) */}
                <button
                  onClick={() => handleSendMessage()}
                  disabled={isLoading}
                  className="p-3.5 rounded-full bg-[#00a884] hover:bg-[#008f72] text-white transition-all shadow-md active:scale-90 flex items-center justify-center shrink-0 cursor-pointer"
                  title="Send Message"
                >
                  {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} className="stroke-[2.5]" />}
                </button>
              </div>
            </div>
          </div>
        </main>

        {/* Custom Confirmation Modal */}
        <AnimatePresence>
          {showDeleteConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 rounded-[30px]"
            >
              <motion.div
                initial={{ scale: 0.9, y: 15 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 15 }}
                className="bg-white rounded-3xl p-6 max-w-xs w-full shadow-2xl border border-slate-100 text-center"
              >
                <div className="w-12 h-12 rounded-full bg-red-50 text-red-500 flex items-center justify-center mx-auto mb-4 border border-red-100">
                  <Trash2 size={22} className="stroke-[2.5]" />
                </div>
                <h3 className="text-base font-extrabold text-slate-900 mb-2">Clear Chat History?</h3>
                <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                  Are you sure you want to permanently clear your conversation with Dr. DawaLens? This action cannot be undone.
                </p>
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full font-bold text-xs transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmClearChat}
                    className="flex-1 py-3 px-4 bg-red-500 hover:bg-red-600 text-white rounded-full font-bold text-xs transition-colors cursor-pointer shadow-md"
                  >
                    Clear Chat
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
};
