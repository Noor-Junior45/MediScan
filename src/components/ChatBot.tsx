import React, { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, User, Sparkles, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Medicine, ChatMessage } from '../types';
import { chatWithGemini } from '../services/geminiService';

interface ChatBotProps {
  onClose: () => void;
  medicines: Medicine[];
  userPhoto?: string | null;
}

export const ChatBot: React.FC<ChatBotProps> = ({ onClose, medicines, userPhoto }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'model',
      text: "Hey friend! I'm DawaLens AI, your medicine buddy. How can I help you today? 😊",
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const history = [...messages, userMsg].map(m => ({
        role: m.role,
        text: m.text,
      }));

      const aiResponse = await chatWithGemini(history, medicines);

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: aiResponse,
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      console.error("Chat Error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg bg-[#1a1a1a] border border-white/10 rounded-[32px] flex flex-col h-[80vh] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 border-bottom border-white/5 flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent">
              <Bot size={24} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white leading-tight">DawaLens AI</h2>
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-bold uppercase tracking-widest">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Online
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-white/40 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-hide">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
            >
              <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden ${
                msg.role === 'user' ? 'bg-white/10' : 'bg-accent/20 text-accent'
              }`}>
                {msg.role === 'user' ? (
                  userPhoto ? <img src={userPhoto} alt="User" referrerPolicy="no-referrer" className="w-full h-full object-cover" /> : <User size={18} />
                ) : (
                  <Bot size={18} />
                )}
              </div>
              <div className={`flex flex-col max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`p-4 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user' 
                    ? 'bg-accent text-black rounded-tr-none' 
                    : 'bg-white/5 text-white/90 rounded-tl-none border border-white/5'
                }`}>
                  {msg.text}
                </div>
                <span className="text-[9px] text-white/20 mt-1 font-medium">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center">
                <Bot size={18} />
              </div>
              <div className="bg-white/5 p-4 rounded-2xl rounded-tl-none border border-white/5">
                <Loader2 size={18} className="animate-spin text-white/40" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-6 bg-white/5 border-t border-white/5">
          <div className="relative flex items-center">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Ask me anything about your medicines..."
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-5 pr-14 text-sm text-white focus:outline-none focus:border-accent/50 transition-all"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className={`absolute right-2 p-2.5 rounded-xl transition-all ${
                input.trim() && !isLoading 
                  ? 'bg-accent text-black shadow-lg shadow-accent/20' 
                  : 'bg-white/5 text-white/20'
              }`}
            >
              <Send size={20} />
            </button>
          </div>
          <div className="mt-3 flex items-center justify-center gap-1.5 text-[9px] text-white/20 font-medium">
            <Sparkles size={10} />
            Powered by Gemini AI
          </div>
        </div>
      </div>
    </motion.div>
  );
};
