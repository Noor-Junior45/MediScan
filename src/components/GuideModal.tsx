import React from 'react';
import { X, Camera, Zap, Bell, ShieldCheck, Pill, Search } from 'lucide-react';
import { motion } from 'motion/react';

interface GuideModalProps {
  onClose: () => void;
}

export const GuideModal: React.FC<GuideModalProps> = ({ onClose }) => {
  const steps = [
    {
      icon: <Camera className="text-emerald-400" size={24} />,
      title: "Scan Label",
      description: "Point your camera at any medicine label. Our AI will automatically extract the name, dosage, and expiration date."
    },
    {
      icon: <Zap className="text-yellow-400" size={24} />,
      title: "Verify Details",
      description: "Always double-check the AI's extraction, especially the expiration date, to ensure your safety."
    },
    {
      icon: <Bell className="text-orange-400" size={24} />,
      title: "Get Alerts",
      description: "We'll notify you when your medicine is about to expire or when your stock is running low."
    },
    {
      icon: <Search className="text-blue-400" size={24} />,
      title: "Chat AI",
      description: "Use our AI Chatbot to ask questions about your stored medicines in a friendly, conversational way."
    }
  ];

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-md"
    >
      <div className="w-full max-w-md bg-[#1a1a1a] border border-white/10 rounded-[40px] p-8 overflow-y-auto max-h-[80vh] shadow-2xl">
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500/10 rounded-2xl flex items-center justify-center">
              <ShieldCheck className="text-emerald-500" size={24} />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">User Guide</h2>
          </div>
          <button onClick={onClose} className="p-2 text-white/40 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="space-y-6">
          {steps.map((step, index) => (
            <div key={index} className="flex gap-4 p-4 bg-white/5 rounded-3xl border border-white/5">
              <div className="shrink-0 w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center">
                {step.icon}
              </div>
              <div className="space-y-1">
                <h3 className="text-white font-semibold">{step.title}</h3>
                <p className="text-white/40 text-sm leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}

          <div className="p-4 bg-orange-500/10 rounded-3xl border border-orange-500/20 flex gap-4">
            <div className="shrink-0">
              <Pill className="text-orange-500" size={24} />
            </div>
            <div className="space-y-1">
              <h3 className="text-orange-500 font-semibold text-sm uppercase tracking-widest">Safety First</h3>
              <p className="text-orange-200/60 text-xs leading-relaxed">
                This app is an assistant, not a medical professional. Always consult your doctor or pharmacist for medical advice.
              </p>
            </div>
          </div>
        </div>

        <button 
          onClick={onClose}
          className="w-full mt-10 py-4 bg-white text-black rounded-full font-bold hover:bg-white/90 transition-all shadow-xl"
        >
          Got it, Thanks!
        </button>
      </div>
    </motion.div>
  );
};
