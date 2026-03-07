import React, { useState, useEffect } from 'react';
import { Medicine, MedicineHistory } from '../types';
import { X, Save, Trash2, Eye, AlertTriangle, History, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, collection, query, orderBy, onSnapshot, handleFirestoreError, OperationType } from '../firebase';

interface MedicineFormProps {
  medicine?: Medicine | null;
  onSave: (medicine: Partial<Medicine>) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}

export const MedicineForm: React.FC<MedicineFormProps> = ({ medicine, onSave, onDelete, onClose }) => {
  const [formData, setFormData] = useState<Partial<Medicine>>({
    name: '',
    dosage: '',
    expirationDate: '',
    usageInstructions: '',
    capturedImage: '',
    quantity: undefined,
  });
  const [history, setHistory] = useState<MedicineHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (medicine) {
      setFormData(medicine);
    }
  }, [medicine]);

  useEffect(() => {
    if (!medicine?.id) return;

    const q = query(
      collection(db, `medicines/${medicine.id}/history`),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const historyData = snapshot.docs.map(doc => doc.data() as MedicineHistory);
      setHistory(historyData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `medicines/${medicine.id}/history`);
    });

    return () => unsubscribe();
  }, [medicine?.id]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  const formatActionType = (type: string) => {
    switch (type) {
      case 'CREATE': return 'Added';
      case 'EDIT': return 'Edited';
      case 'MARK_TAKEN': return 'Taken';
      case 'MARK_NOT_TAKEN': return 'Untaken';
      case 'DELETE': return 'Deleted';
      default: return type;
    }
  };

  const getActionColor = (type: string) => {
    switch (type) {
      case 'CREATE': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
      case 'EDIT': return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
      case 'MARK_TAKEN': return 'text-purple-400 bg-purple-400/10 border-purple-400/20';
      case 'MARK_NOT_TAKEN': return 'text-orange-400 bg-orange-400/10 border-orange-400/20';
      default: return 'text-white/60 bg-white/5 border-white/10';
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg bg-[#1a1a1a] border border-white/10 rounded-3xl overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-white/5 to-transparent shrink-0">
          <h2 className="text-xl font-semibold text-white tracking-tight">
            {medicine?.id ? 'Edit Medicine' : 'Verify Details'}
          </h2>
          <div className="flex items-center gap-2">
            {medicine?.id && (
              <button 
                onClick={() => setShowHistory(!showHistory)} 
                className={`p-2 rounded-xl transition-colors ${showHistory ? 'bg-red-500/20 text-red-500' : 'text-red-400 hover:text-red-300 hover:bg-red-500/10'}`}
                title="View History"
              >
                <History size={20} />
              </button>
            )}
            <button onClick={onClose} className="p-2 text-white/50 hover:text-white hover:bg-white/5 rounded-xl transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          <AnimatePresence mode="wait">
            {showHistory ? (
              <motion.div
                key="history"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="p-6 space-y-4"
              >
                <h3 className="text-sm font-bold uppercase tracking-widest text-white/40 mb-6">Activity Log</h3>
                {history.length === 0 ? (
                  <div className="text-center py-8 text-white/40 text-sm">No history available yet.</div>
                ) : (
                  <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-white/10 before:to-transparent">
                    {history.map((log) => (
                      <div key={log.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                        <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white/10 bg-[#1a1a1a] text-white/50 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                          <Clock size={14} />
                        </div>
                        <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white/5 border border-white/10 p-4 rounded-2xl">
                          <div className="flex items-center justify-between mb-2">
                            <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border ${getActionColor(log.actionType)}`}>
                              {formatActionType(log.actionType)}
                            </span>
                            <time className="text-[10px] text-white/40 font-mono">
                              {new Date(log.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                            </time>
                          </div>
                          <p className="text-sm text-white/80 leading-relaxed">{log.details}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="form"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                {formData.capturedImage && (
                  <div className="px-6 pt-6">
                    <div className="relative group rounded-2xl overflow-hidden border border-white/10 aspect-video bg-black">
                      <img 
                        src={formData.capturedImage} 
                        alt="Captured Label" 
                        className="w-full h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute top-3 left-3 px-3 py-1 bg-black/60 backdrop-blur-md rounded-full border border-white/10 flex items-center gap-2">
                        <Eye size={12} className="text-white/60" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-white/80">Reference Photo</span>
                      </div>
                    </div>
                    <p className="mt-2 text-[10px] text-white/30 text-center uppercase tracking-widest font-medium">
                      Check the photo to verify AI extraction
                    </p>
                  </div>
                )}

                <form id="medicine-form" onSubmit={handleSubmit} className="p-6 space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold ml-1">Medicine Name</label>
                    <input
                      required
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-all placeholder:text-white/20"
                      placeholder="e.g. Paracetamol"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold ml-1">Dosage</label>
                      <input
                        required
                        type="text"
                        value={formData.dosage}
                        onChange={(e) => setFormData({ ...formData, dosage: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-all placeholder:text-white/20"
                        placeholder="e.g. 500mg"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold ml-1">Quantity</label>
                      <input
                        type="number"
                        min="0"
                        value={formData.quantity === undefined ? '' : formData.quantity}
                        onChange={(e) => setFormData({ ...formData, quantity: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })}
                        className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-all placeholder:text-white/20"
                        placeholder="e.g. 30"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 relative">
                    <label className="text-[10px] uppercase tracking-[0.2em] text-orange-400 font-bold ml-1 flex items-center gap-1">
                      Expiration Date <AlertTriangle size={10} />
                    </label>
                    <div className="relative">
                      <input
                        required
                        type="date"
                        value={formData.expirationDate}
                        onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })}
                        className="w-full bg-orange-500/5 border border-orange-500/30 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-orange-500/60 transition-all [color-scheme:dark] shadow-[0_0_15px_rgba(249,115,22,0.05)]"
                      />
                    </div>
                    <p className="text-[9px] text-orange-400/60 font-medium mt-1 ml-1 animate-pulse">
                      Verify this is NOT the Mfg Date
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold ml-1">Usage Instructions</label>
                    <textarea
                      value={formData.usageInstructions}
                      onChange={(e) => setFormData({ ...formData, usageInstructions: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-all placeholder:text-white/20 min-h-[80px]"
                      placeholder="e.g. Take 1 tablet after meals..."
                    />
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {!showHistory && (
          <div className="p-6 border-t border-white/5 bg-[#1a1a1a] shrink-0 flex gap-3">
            {medicine?.id && onDelete && (
              <button
                type="button"
                onClick={() => onDelete(medicine.id)}
                className="flex-1 py-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 font-medium flex items-center justify-center gap-2 hover:bg-red-500/20 transition-all"
              >
                <Trash2 size={18} />
                Delete
              </button>
            )}
            <button
              type="submit"
              form="medicine-form"
              className="flex-[2] py-4 bg-white text-black rounded-2xl font-semibold flex items-center justify-center gap-2 hover:bg-white/90 transition-all shadow-[0_10px_20px_rgba(255,255,255,0.1)]"
            >
              <Save size={18} />
              Save Medicine
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};
