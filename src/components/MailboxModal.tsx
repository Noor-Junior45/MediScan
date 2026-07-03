import React, { useState, useEffect } from 'react';
import { 
  X, Mail, RefreshCw, CheckCircle2, AlertTriangle, 
  Clock, Eye, ArrowRight, ShieldCheck, Trash2, Send, Play, ArrowLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, query, where, onSnapshot, addDoc, 
  deleteDoc, doc, getDocs, writeBatch, serverTimestamp 
} from 'firebase/firestore';
import { db } from '../firebase';
import { Medicine } from '../types';
import { sendEmailAlert, getExpiryEmailHTML, getLowStockEmailHTML } from '../services/emailService';

interface MailboxModalProps {
  onClose: () => void;
  user: any;
  medicines: Medicine[];
}

interface MailDocument {
  id: string;
  to: string;
  message: {
    subject: string;
    text: string;
    html: string;
  };
  createdAt?: number;
  // Trigger email extension adds a 'delivery' block
  delivery?: {
    attempts?: number;
    endTime?: any;
    error?: string;
    state: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'ERROR' | 'SIMULATED';
  };
}

const formatExpiryMonthYear = (dateStr?: string) => {
  if (!dateStr) return 'N/A';
  try {
    const parts = dateStr.split('-');
    if (parts.length >= 2) {
      const year = parts[0];
      const monthNum = parseInt(parts[1], 10);
      const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      const monthName = months[monthNum - 1] || parts[1];
      return `${monthName} ${year}`;
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
  } catch (e) {
    console.warn(e);
  }
  return dateStr;
};

export const MailboxModal: React.FC<MailboxModalProps> = ({ onClose, user, medicines }) => {
  const [emails, setEmails] = useState<MailDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState<MailDocument | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [testSentSuccess, setTestSentSuccess] = useState<string | null>(null);
  const [activeMobileView, setActiveMobileView] = useState<'list' | 'detail'>('list');

  // Real-time listen to queue updates for this user
  useEffect(() => {
    if (!user?.email) return;

    setIsLoading(true);
    const q = query(
      collection(db, 'mail'),
      where('to', '==', user.email)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const mailList = snapshot.docs.map(doc => {
        const data = doc.data();
        let createdAtMillis = Date.now();
        if (data.timestamp) {
          createdAtMillis = typeof data.timestamp.toMillis === 'function' 
            ? data.timestamp.toMillis() 
            : Number(data.timestamp);
        }
        return {
          id: doc.id,
          to: data.to,
          message: data.message,
          createdAt: createdAtMillis,
          delivery: data.delivery || data.status
        } as MailDocument;
      });

      // Deduplicate by ID to prevent duplicate keys
      const uniqueMail = Array.from(new Map(mailList.map(m => [m.id, m])).values());

      // Sort in-memory to dodge custom indexing requirements
      const sorted = uniqueMail.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setEmails(sorted);
      setIsLoading(false);
    }, (error) => {
      console.error("Mail subscription failed:", error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  // Method to manually queue a high-fidelity test alert
  const triggerTestEmailAlert = async (type: 'expiry' | 'refill') => {
    if (!user || isSending) return;
    setIsSending(true);
    setTestSentSuccess(null);

    try {
      // Find a medicine to populate fields, or make a plausible mock
      const sampleMed = medicines.filter(m => !m.isDeleted)[0] || {
        name: "Lisinopril",
        dosage: "10mg",
        expirationDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        quantity: 3
      };

      const formattedExpiry = formatExpiryMonthYear(sampleMed.expirationDate);

      let subject = '';
      let text = '';
      let html = '';

      if (type === 'expiry') {
        subject = `Expiry Alert: ${sampleMed.name} is Expiring Soon`;
        text = `DawaLens AI alert: Your medicine ${sampleMed.name} is expiring soon.`;
        html = getExpiryEmailHTML(sampleMed.name, sampleMed.quantity || "N/A", sampleMed.expirationDate);
      } else {
        subject = `Refill Required: ${sampleMed.name} is Low on Stock`;
        text = `DawaLens AI alert: Your medicine ${sampleMed.name} quantity is down to ${sampleMed.quantity || 3}. Please replenish your stocks soon.`;
        html = getLowStockEmailHTML(sampleMed.name, sampleMed.quantity || 3, 5);
      }

      const result = await sendEmailAlert({
        to: user.email,
        subject,
        text,
        html
      });

      setTestSentSuccess(`Success! A test "${type === 'expiry' ? 'Expiry Alert' : 'Low Stock Warning'}" email was successfully dispatched via Resend API.`);
    } catch (err: any) {
      console.error("Test email dispatch error:", err);
      alert(`Simulation failed: ${err.message || err}`);
    } finally {
      setIsSending(false);
    }
  };

  // Safe method to empty out sent mailbox documents completely
  const clearSentHistory = async () => {
    if (!user?.email || emails.length === 0) return;
    if (window.confirm("This will permanently clear your outbox/mail queue history. Continue?")) {
      try {
        const q = query(collection(db, 'mail'), where('to', '==', user.email));
        const snap = await getDocs(q);
        const batch = writeBatch(db);
        snap.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        setEmails([]);
        setSelectedEmail(null);
      } catch (err: any) {
        console.error("Failed to delete emails:", err);
        alert("Operation denied: " + err.message);
      }
    }
  };

  const getStatusDisplay = (delivery: MailDocument['delivery']) => {
    if (!delivery) {
      return {
        label: 'Sent',
        style: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        icon: <CheckCircle2 size={12} />
      };
    }
    const state = String(delivery.state || '').toUpperCase();
    switch (state) {
      case 'SUCCESS':
      case 'SIMULATED':
        return {
          label: 'Sent',
          style: 'bg-emerald-50 text-emerald-700 border-emerald-100',
          icon: <CheckCircle2 size={12} />
        };
      case 'PROCESSING':
        return {
          label: 'Sending...',
          style: 'bg-blue-50 text-blue-700 border-blue-100',
          icon: <RefreshCw size={12} className="animate-spin" />
        };
      case 'ERROR':
        return {
          label: 'Error',
          style: 'bg-rose-50 text-rose-700 border-rose-100',
          icon: <AlertTriangle size={12} />
        };
      default:
        return {
          label: 'Sent',
          style: 'bg-emerald-50 text-emerald-700 border-emerald-100',
          icon: <CheckCircle2 size={12} />
        };
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-[#2d2a26]/40 backdrop-blur-md flex items-center justify-center p-0 md:p-6"
    >
      <div className="w-full max-w-4xl h-full md:h-[85vh] bg-[#faf8f5] border-0 md:border border-[#e3e2e0] rounded-none md:rounded-[36px] overflow-hidden shadow-2xl flex flex-col text-[#2d2a26]">
        {/* Header Section */}
        <header className="p-4 sm:p-6 bg-[#fcfaf7] border-b border-[#e3e2e0] flex justify-between items-center shrink-0 relative">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-[#0f9d58]/10 text-[#0f9d58] rounded-2xl flex items-center justify-center border border-[#0f9d58]/20 shrink-0">
              <Mail size={20} className="sm:size-[22px]" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base md:text-xl font-bold tracking-tight text-[#2d2a26] flex flex-wrap items-center gap-1.5 sm:gap-2">
                DawaLens AI Mailbox Outbox
                <span className="text-[8px] sm:text-[10px] px-2.5 py-1 bg-[#0f9d58] text-white rounded-full font-bold uppercase tracking-wider">
                  Live Queue
                </span>
              </h1>
              <p className="text-[10px] sm:text-xs text-[#8c857b] font-medium mt-0.5 sm:mt-1">Verify automatic, cloud-sent prescription notifications</p>
            </div>
          </div>

          <button 
            onClick={onClose} 
            className="p-2 sm:p-3 hover:bg-[#e3e2e0]/40 active:scale-95 border border-[#e3e2e0] rounded-2xl text-[#8c857b] hover:text-[#2d2a26] transition-all w-11 h-11 flex items-center justify-center shrink-0 ml-2"
            title="Close outbox modal"
          >
            <X size={20} />
          </button>
        </header>

        {/* Action Panel: Test Alert & Logs */}
        <div id="mailbox-action-panel" className="px-4 sm:px-6 py-4 bg-[#fcfaf7] border-b border-[#e3e2e0] shrink-0 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="hidden">
              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-[#8c857b] flex items-center gap-1.5 shrink-0">
                <Play size={12} className="text-[#0f9d58]" /> Tester:
              </span>
              <button
                id="btn-trigger-test-email"
                onClick={() => triggerTestEmailAlert('expiry')}
                disabled={isSending}
                className="py-2 px-4 bg-emerald-50 hover:bg-emerald-100 active:scale-95 border border-emerald-200 rounded-full text-xs font-bold text-emerald-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-sm min-h-[38px]"
              >
                <Send size={12} />
                Send Test Email
              </button>
            </div>

            {emails.length > 0 && (
              <button
                id="btn-clear-mail-logs"
                onClick={clearSentHistory}
                className="py-2 px-4 border border-red-200 bg-red-50 hover:bg-red-100 active:scale-95 rounded-full text-xs text-red-700 font-bold flex items-center justify-center gap-2 transition-all shrink-0 min-h-[38px]"
              >
                <Trash2 size={13} />
                Clear Mail Logs
              </button>
            )}
          </div>

          {testSentSuccess && (
            <div id="test-mail-success-alert" className="flex items-center justify-between p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl text-xs text-emerald-800 font-medium">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-[#0f9d58]" />
                <span>{testSentSuccess}</span>
              </div>
              <button 
                onClick={() => setTestSentSuccess(null)}
                className="text-emerald-600 hover:text-emerald-800 transition-colors font-bold text-sm px-1.5"
              >
                ×
              </button>
            </div>
          )}
        </div>

        {/* Body Content Areas */}
        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
          
          {/* Left panel: List of Emails */}
          <div className={`w-full md:w-[40%] overflow-y-auto flex flex-col h-full bg-[#fcfaf7] border-r border-[#e3e2e0] ${
            activeMobileView === 'detail' ? 'hidden md:flex' : 'flex'
          }`}>
            {isLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8">
                <RefreshCw size={24} className="animate-spin text-[#8c857b]" />
                <p className="text-sm text-[#8c857b] mt-4">Connecting to Mail Queue...</p>
              </div>
            ) : emails.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
                <div className="w-12 h-12 rounded-full border border-[#e3e2e0] bg-white flex items-center justify-center text-[#8c857b]">
                  <Mail size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[#2d2a26]">Outbox Queue Empty</h4>
                  <p className="text-xs text-[#8c857b] max-w-[200px] mx-auto mt-1 leading-relaxed">
                    Once automated alert emails or reports are triggered, they'll match and synchronize right here.
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-[#e3e2e0] pb-20">
                {emails.map((mail, idx) => {
                  const status = getStatusDisplay(mail.delivery);
                  const isSelected = selectedEmail?.id === mail.id;
                  
                  return (
                    <button
                      key={`mail-${mail.id || idx}-${idx}`}
                      onClick={() => {
                        setSelectedEmail(mail);
                        setActiveMobileView('detail');
                      }}
                      className={`w-full text-left p-5 transition-all flex flex-col gap-2 border-l-[3px] ${
                        isSelected 
                          ? 'bg-white border-[#0f9d58]' 
                          : 'hover:bg-white/50 border-transparent'
                      }`}
                    >
                      <div className="flex justify-between items-center w-full">
                        <span className={`text-[9px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-widest flex items-center gap-1.5 ${status.style}`}>
                          {status.icon}
                          {status.label}
                        </span>
                        <time className="text-[10px] text-[#8c857b] font-mono">
                          {new Date(mail.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </time>
                      </div>
                      
                      <h4 className="text-sm font-bold text-[#2d2a26] leading-tight tracking-tight mt-1 line-clamp-2">
                        {mail.message.subject}
                      </h4>
                      
                      <p className="text-xs text-[#8c857b] line-clamp-1 truncate mt-0.5 font-medium">
                        {mail.message.text}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right panel: Single Mail Preview */}
          <div className={`w-full md:w-[60%] overflow-y-auto h-full flex flex-col bg-white ${
            activeMobileView === 'list' ? 'hidden md:flex' : 'flex'
          }`}>
            {selectedEmail ? (
              <div className="p-4 sm:p-6 space-y-6">
                
                {/* Mobile Back Button */}
                <div className="md:hidden">
                  <button
                    onClick={() => setActiveMobileView('list')}
                    className="flex items-center gap-2 text-xs font-bold text-[#0f9d58] hover:text-[#0b7a44] py-1.5 px-3 bg-[#eefcf5] rounded-full"
                  >
                    <ArrowLeft size={14} />
                    Back to Inbox Queue
                  </button>
                </div>

                {/* Header Information */}
                <div className="bg-[#fcfaf7] border border-[#e3e2e0] p-4 sm:p-6 rounded-3xl space-y-4">
                  <div className="flex flex-wrap justify-between items-start gap-4">
                    <div>
                      <span className="text-[9px] font-black uppercase tracking-wider text-[#8c857b]">Target Recipient</span>
                      <p className="text-sm font-bold text-[#2d2a26] selection:bg-[#2d2a26]/10">{selectedEmail.to}</p>
                    </div>
                    <div>
                      <span className="text-[9px] font-black uppercase tracking-wider text-[#8c857b]">Timestamp</span>
                      <p className="text-xs text-[#8c857b] font-mono">
                        {new Date(selectedEmail.createdAt || Date.now()).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div>
                    <span className="text-[9px] font-black uppercase tracking-wider text-[#8c857b]">Subject Line</span>
                    <h3 className="text-base font-bold text-[#2d2a26] mt-0.5">{selectedEmail.message.subject}</h3>
                  </div>

                  {/* Delivery Status Insights */}
                  {selectedEmail.delivery && selectedEmail.delivery.error && (
                    <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5">
                      <AlertTriangle size={15} className="text-red-700 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-red-800 uppercase">Trigger Mail Error</p>
                        <p className="text-[11px] text-red-700 leading-relaxed mt-0.5">{selectedEmail.delivery.error}</p>
                      </div>
                    </div>
                  )}

                  {(!selectedEmail.delivery || selectedEmail.delivery.state === 'SUCCESS' || selectedEmail.delivery.state === 'SIMULATED') && (
                    <div className="mt-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-[#0f9d58] shrink-0" />
                      <p className="text-xs font-medium text-emerald-800">
                        Email processed and delivered securely via Resend API.
                      </p>
                    </div>
                  )}
                </div>

                {/* HTML Envelope Panel */}
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#8c857b] block ml-1">
                    📩 Rendered Template Body:
                  </span>
                  <div className="bg-[#faf8f5] border border-[#e3e2e0] rounded-[24px] overflow-hidden max-h-[500px]">
                    <iframe
                      title="Email Body Preview"
                      srcDoc={selectedEmail.message.html}
                      className="w-full h-[400px] border-0 select-none bg-white"
                      sandbox="allow-popups allow-popups-to-escape-sandbox"
                    />
                  </div>
                </div>

              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4 bg-white">
                <div className="w-16 h-16 bg-[#fcfaf7] border border-[#e3e2e0] rounded-[24px] flex items-center justify-center text-[#8c857b] shadow-inner">
                  <Eye size={26} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#2d2a26]">Select a message</h3>
                  <p className="text-xs text-[#8c857b] max-w-[240px] mx-auto mt-1 leading-relaxed">
                    Click any queued notification or consultation report in the left pane to inspect its live SMTP delivery metadata and rendered email envelope.
                  </p>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </motion.div>
  );
};
