import React, { useState, useEffect } from 'react';
import { Medicine, MedicineHistory } from '../types';
import { X, Save, Trash2, Eye, AlertTriangle, History, Clock, Sparkles, Plus, Bell, BellOff, Layers, Package, Calendar } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { db, collection, query, orderBy, onSnapshot, handleFirestoreError, OperationType } from '../firebase';
import { MEDICINE_FORM_ICONS, MEDICINE_FORM_LABELS } from '../constants';
import { MedicineForm as MedicineFormType } from '../types';
import { localImageStorage } from '../services/localImageStorage';

interface MedicineFormProps {
  medicine?: Medicine | null;
  onSave: (medicine: Partial<Medicine>) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
  extractionWarning?: string | null;
  isSaving?: boolean;
  allMedicines?: Medicine[];
  globalLowQuantityThreshold?: number;
}

export const MedicineForm: React.FC<MedicineFormProps> = ({ 
  medicine, onSave, onDelete, onClose, extractionWarning, isSaving, allMedicines = [], globalLowQuantityThreshold = 5
}) => {
  const [formData, setFormData] = useState<Partial<Medicine>>({
    name: '',
    dosage: '',
    expirationDate: '',
    usageInstructions: '',
    schedule: '',
    capturedImage: '',
    quantity: undefined,
    enableLowStockAlert: true,
    lowStockThreshold: undefined,
  });
  const [history, setHistory] = useState<MedicineHistory[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [suggestions, setSuggestions] = useState<Medicine[]>([]);

  useEffect(() => {
    if (medicine) {
      if (medicine.imageUrl === 'local' && !medicine.capturedImage) {
        localImageStorage.getImage(medicine.id).then((localImg) => {
          if (localImg) {
            setFormData({ ...medicine, capturedImage: localImg });
          } else {
            setFormData(medicine);
          }
        }).catch(() => {
          setFormData(medicine);
        });
      } else {
        setFormData(medicine);
      }
    } else {
      setFormData({
        name: '',
        dosage: '',
        expirationDate: '',
        usageInstructions: '',
        schedule: '',
        capturedImage: '',
        quantity: undefined,
        enableLowStockAlert: true,
        lowStockThreshold: undefined,
      });
    }
  }, [medicine]);

  const handleNameChange = (name: string) => {
    setFormData({ ...formData, name });
    
    // Clear previous timeout
    const timeoutId = (window as any)._suggestionTimeout;
    if (timeoutId) clearTimeout(timeoutId);

    if (name.length > 1) {
      (window as any)._suggestionTimeout = setTimeout(() => {
        const filtered = allMedicines.filter(m => 
          m.name.toLowerCase().includes(name.toLowerCase()) && 
          m.id !== medicine?.id
        );
        // Unique suggestions by name/dosage/form
        const unique = filtered.filter((m, index, self) => 
          index === self.findIndex((t) => t.name === m.name && t.dosage === m.dosage && t.form === m.form)
        ).slice(0, 3);
        setSuggestions(unique);
      }, 150); // 150ms debounce
    } else {
      setSuggestions([]);
    }
  };

  const applySuggestion = (suggested: Medicine) => {
    setFormData({
      ...formData,
      name: suggested.name,
      dosage: suggested.dosage,
      form: suggested.form,
      usageInstructions: suggested.usageInstructions || formData.usageInstructions,
      schedule: suggested.schedule || formData.schedule
    });
    setSuggestions([]);
  };

  useEffect(() => {
    if (!medicine?.id) return;

    const q = query(
      collection(db, `medicines/${medicine.id}/history`),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const historyData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MedicineHistory));
      const uniqueHistory = Array.from(new Map(historyData.map(h => [h.id, h])).values());
      setHistory(uniqueHistory);
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

  const formatDisplayDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    const [year, month, day] = dateStr.split('-').map(Number);
    if (year && month && day && !isNaN(year) && !isNaN(month) && !isNaN(day)) {
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  const getDiffDays = (dateStr?: string): number => {
    if (!dateStr) return 9999;
    const [year, month, day] = dateStr.split('-').map(Number);
    const expiry = new Date();
    if (year && month && day && !isNaN(year) && !isNaN(month) && !isNaN(day)) {
      expiry.setFullYear(year, month - 1, day);
    } else {
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        parsed.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return Math.round((parsed.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      }
      return 9999;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);
    return Math.round((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  const getExpiryStatus = (dateStr?: string) => {
    if (!dateStr) {
      return { label: 'No Date', color: 'text-slate-400', bg: 'bg-white/5 border-white/10' };
    }
    const diffDays = getDiffDays(dateStr);
    if (diffDays < 0) return { label: 'Expired', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' };
    if (diffDays === 0) return { label: 'Expiring Today', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' };
    if (diffDays <= 10) return { label: 'Expiring Soon (10d)', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' };
    if (diffDays <= 92) return { label: 'Expiring in 3mo', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' };
    if (diffDays <= 180) return { label: 'Expiring in 6mo', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' };
    return { label: 'Safe', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' };
  };

  // Grouped batches for the current medicine
  const relatedBatches = React.useMemo(() => {
    const targetName = (formData.name || medicine?.name || '').trim().toLowerCase();
    if (!targetName) return [];
    return allMedicines.filter(m => !m.isDeleted && m.name.trim().toLowerCase() === targetName);
  }, [allMedicines, formData.name, medicine?.name]);

  const activeBatches = React.useMemo(() => {
    return relatedBatches
      .filter(m => !m.taken && getDiffDays(m.expirationDate) >= 0 && (m.quantity === undefined || m.quantity > 0))
      .sort((a, b) => getDiffDays(a.expirationDate) - getDiffDays(b.expirationDate));
  }, [relatedBatches]);

  const expiredOrEmptyBatches = React.useMemo(() => {
    return relatedBatches
      .filter(m => m.taken || getDiffDays(m.expirationDate) < 0 || (m.quantity !== undefined && m.quantity <= 0))
      .sort((a, b) => getDiffDays(b.expirationDate) - getDiffDays(a.expirationDate));
  }, [relatedBatches]);

  const totalActiveUnits = React.useMemo(() => {
    return activeBatches.reduce((sum, b) => sum + (b.quantity || 0), 0);
  }, [activeBatches]);

  const getDisplayMonth = (dateStr?: string) => {
    if (!dateStr) return '';
    if (dateStr.length >= 7) {
      return dateStr.substring(0, 7);
    }
    return dateStr;
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
                    {history.map((log, idx) => (
                      <div key={`history-log-${log.id || idx}-${idx}`} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
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

                {extractionWarning && (
                  <div className="mx-6 mt-6 p-4 rounded-2xl bg-yellow-500/10 border border-yellow-500/20 flex items-start gap-3">
                    <AlertTriangle className="text-yellow-500 shrink-0 mt-0.5" size={16} />
                    <p className="text-xs text-yellow-200/80 leading-relaxed">
                      {extractionWarning}
                    </p>
                  </div>
                )}

                <div className="mx-6 mt-6 p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="text-indigo-400" size={16} />
                    <h4 className="text-[10px] font-bold uppercase tracking-widest text-indigo-200/80">Treatment Guide</h4>
                  </div>
                  <div className="space-y-3">
                    {formData.usageInstructions && (
                      <div>
                        <p className="text-[9px] text-white/40 uppercase tracking-wider font-bold mb-0.5">Instructions</p>
                        <p className="text-xs text-white/80 leading-relaxed">{formData.usageInstructions}</p>
                      </div>
                    )}
                    {formData.schedule && (
                      <div>
                        <p className="text-[9px] text-white/40 uppercase tracking-wider font-bold mb-0.5">Schedule</p>
                        <p className="text-xs text-indigo-300 font-medium">{formData.schedule}</p>
                      </div>
                    )}
                  </div>
                </div>

                <form id="medicine-form" onSubmit={handleSubmit} className="p-6 space-y-5">
                  <div className="space-y-1.5 relative">
                    <label className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold ml-1">Medicine Name</label>
                    <input
                      required
                      type="text"
                      value={formData.name || ''}
                      onChange={(e) => handleNameChange(e.target.value)}
                      className="w-full bg-white/[0.02] backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-all placeholder:text-white/20"
                      placeholder="e.g. Paracetamol"
                    />
                    
                    <AnimatePresence>
                      {suggestions.length > 0 && (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="absolute z-10 left-0 right-0 mt-2 bg-[#252525] border border-white/10 rounded-2xl overflow-hidden shadow-2xl"
                        >
                          <div className="p-2 border-b border-white/5 bg-white/5 flex items-center gap-2">
                            <Sparkles size={10} className="text-accent" />
                            <span className="text-[8px] font-bold uppercase tracking-widest text-white/40">Smart Fill Suggestions</span>
                          </div>
                          {suggestions.map((s, idx) => (
                            <button
                              key={`suggestion-${s.id || idx}-${idx}`}
                              type="button"
                              onClick={() => applySuggestion(s)}
                              className="w-full text-left p-3 hover:bg-white/5 flex items-center justify-between border-b border-white/5 last:border-0 transition-colors"
                            >
                              <div className="flex flex-col">
                                <span className="text-sm font-bold text-white">{s.name}</span>
                                <span className="text-[10px] text-white/40">{s.dosage} • {MEDICINE_FORM_LABELS[s.form || 'other']}</span>
                              </div>
                              <Plus size={14} className="text-accent/40" />
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold ml-1">Medicine Form</label>
                    <div className="grid grid-cols-4 gap-2">
                      {(Object.keys(MEDICINE_FORM_ICONS) as MedicineFormType[]).map((form) => (
                        <button
                          key={form}
                          type="button"
                          onClick={() => {
                            const isLiquid = form === 'syrup' || form === 'liquid' || form === 'ampule';
                            setFormData({ 
                              ...formData, 
                              form,
                              // If not yet explicitly toggled by user and switching to syrup/liquid, default low stock alert to false
                              ...(formData.enableLowStockAlert === undefined || (!medicine && formData.enableLowStockAlert === true && isLiquid) 
                                ? { enableLowStockAlert: !isLiquid } 
                                : {})
                            });
                          }}
                          className={`flex flex-col items-center justify-center p-2 rounded-2xl border transition-all gap-1 ${
                            formData.form === form 
                              ? 'bg-white/10 border-white/40 text-white' 
                              : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white/60'
                          }`}
                        >
                          {MEDICINE_FORM_ICONS[form]}
                          <span className="text-[8px] font-bold uppercase tracking-widest truncate w-full text-center">{MEDICINE_FORM_LABELS[form]}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold ml-1">Dosage</label>
                        <input
                          required
                          type="text"
                          value={formData.dosage || ''}
                          onChange={(e) => setFormData({ ...formData, dosage: e.target.value })}
                          className="w-full bg-white/[0.02] backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-all placeholder:text-white/20"
                          placeholder="e.g. 500mg"
                        />
                      </div>
                      <div className="space-y-1.5 overflow-hidden">
                        <label className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold ml-1 flex justify-between items-center">
                          Stock
                          {formData.quantity !== undefined && formData.enableLowStockAlert !== false && formData.quantity <= (formData.lowStockThreshold ?? globalLowQuantityThreshold) && (
                            <span className="text-red-400 text-[8px] animate-pulse">Low!</span>
                          )}
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={formData.quantity === undefined ? '' : formData.quantity}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '') {
                              setFormData({ ...formData, quantity: undefined });
                            } else {
                              const parsed = parseInt(val, 10);
                              if (!isNaN(parsed) && parsed >= 0) {
                                setFormData({ ...formData, quantity: parsed });
                              }
                            }
                          }}
                          className="w-full bg-white/[0.02] backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-all placeholder:text-white/20"
                          placeholder="e.g. 30"
                        />
                      </div>
                    </div>

                    {/* Individual Low Stock Alert Setting */}
                    <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {formData.enableLowStockAlert !== false ? (
                            <Bell size={14} className="text-amber-400" />
                          ) : (
                            <BellOff size={14} className="text-white/40" />
                          )}
                          <div>
                            <span className="text-xs font-semibold text-white block">Low Stock Alert</span>
                            <span className="text-[9px] text-white/40 block">
                              {formData.enableLowStockAlert !== false 
                                ? 'Notify when stock runs low' 
                                : 'Disabled (No low quantity emails or warnings for this item)'}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const current = formData.enableLowStockAlert !== false;
                            setFormData({ ...formData, enableLowStockAlert: !current });
                          }}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            formData.enableLowStockAlert !== false ? 'bg-[#0f9d58]' : 'bg-white/20'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              formData.enableLowStockAlert !== false ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>

                      {formData.enableLowStockAlert !== false && (
                        <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-3">
                          <label className="text-[10px] text-white/60 font-medium">
                            Alert when stock drops to or below:
                          </label>
                          <input
                            type="number"
                            min="0"
                            value={formData.lowStockThreshold === undefined ? '' : formData.lowStockThreshold}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === '') {
                                setFormData({ ...formData, lowStockThreshold: undefined });
                              } else {
                                const parsed = parseInt(val, 10);
                                if (!isNaN(parsed) && parsed >= 0) {
                                  setFormData({ ...formData, lowStockThreshold: parsed });
                                }
                              }
                            }}
                            placeholder={`Default (${globalLowQuantityThreshold})`}
                            className="w-24 bg-black/30 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white text-right focus:outline-none focus:border-amber-400 placeholder:text-white/25"
                          />
                        </div>
                      )}
                    </div>

                  <div className="space-y-1.5 relative">
                    <label className="text-[10px] uppercase tracking-[0.2em] text-orange-400 font-bold ml-1 flex items-center gap-1">
                      Expiration Date <AlertTriangle size={10} />
                    </label>
                    <div className="relative">
                      <input
                        required
                        type="month"
                        value={getDisplayMonth(formData.expirationDate)}
                        onChange={(e) => {
                          const monthVal = e.target.value;
                          const fullDateVal = monthVal ? `${monthVal}-01` : '';
                          setFormData({ ...formData, expirationDate: fullDateVal });
                        }}
                        className="w-full bg-orange-500/5 border border-orange-500/30 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-orange-500/60 transition-all [color-scheme:dark] shadow-[0_0_15px_rgba(249,115,22,0.05)]"
                      />
                    </div>
                    <p className="text-[9px] text-orange-400/60 font-medium mt-1 ml-1 animate-pulse">
                      Verify this is NOT the Mfg Date
                    </p>
                  </div>

                  {/* Stock & Expiration Breakdown for this Medicine */}
                  {relatedBatches.length > 0 && (
                    <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock size={15} className="text-[#0f9d58]" />
                          <div>
                            <h4 className="text-xs font-bold uppercase tracking-wider text-white">Stock & Expiration Breakdown</h4>
                            <p className="text-[10px] text-white/40">
                              {activeBatches.length} active {activeBatches.length === 1 ? 'batch' : 'batches'} • {totalActiveUnits} total units in stock
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2 pt-1">
                        {/* Active Batches */}
                        {activeBatches.map((batch) => {
                          const isCurrent = formData.id ? batch.id === formData.id : batch.id === medicine?.id;
                          const status = getExpiryStatus(batch.expirationDate);
                          const diffDays = getDiffDays(batch.expirationDate);

                          return (
                            <div
                              key={batch.id}
                              onClick={() => {
                                if (!isCurrent) {
                                  setFormData(batch);
                                }
                              }}
                              className={`p-3 rounded-xl border transition-all ${
                                isCurrent 
                                  ? 'bg-[#0f9d58]/10 border-[#0f9d58]/40 ring-1 ring-[#0f9d58]/30 cursor-default' 
                                  : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.06] hover:border-white/20 cursor-pointer'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${isCurrent ? 'bg-[#0f9d58]' : 'bg-white/40'}`} />
                                  <div className="flex flex-col min-w-0">
                                    <span className="text-xs font-semibold text-white truncate">
                                      <strong className="text-emerald-400 font-bold">{batch.quantity !== undefined ? `${batch.quantity} units` : '1 pack'}</strong> will expire on <strong className="text-white font-bold">{formatDisplayDate(batch.expirationDate)}</strong>
                                    </span>
                                    <span className="text-[9px] text-white/40 font-mono">
                                      {batch.dosage} • {diffDays === 0 ? 'Expires today' : `${diffDays} days remaining`}
                                    </span>
                                  </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className={`text-[8px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${status.bg} ${status.color}`}>
                                    {status.label}
                                  </span>
                                  {isCurrent ? (
                                    <span className="text-[8px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#0f9d58]/20 text-[#0f9d58] border border-[#0f9d58]/30">
                                      Editing
                                    </span>
                                  ) : (
                                    <span className="text-[9px] text-accent hover:underline font-medium">
                                      Switch
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {/* Expired or Empty Batches */}
                        {expiredOrEmptyBatches.length > 0 && (
                          <div className="pt-2 border-t border-white/5 space-y-1.5">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-rose-400/80 block">
                              Expired / Finished Batches ({expiredOrEmptyBatches.length})
                            </span>
                            {expiredOrEmptyBatches.map((batch) => {
                              const isCurrent = formData.id ? batch.id === formData.id : batch.id === medicine?.id;
                              return (
                                <div
                                  key={batch.id}
                                  onClick={() => {
                                    if (!isCurrent) {
                                      setFormData(batch);
                                    }
                                  }}
                                  className={`p-2.5 rounded-xl border border-rose-500/20 bg-rose-500/5 flex items-center justify-between gap-2 transition-all ${
                                    isCurrent ? 'ring-1 ring-rose-500/40' : 'hover:bg-rose-500/10 cursor-pointer'
                                  }`}
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                                    <div className="flex flex-col min-w-0">
                                      <span className="text-xs text-white/70 truncate">
                                        <strong className="text-rose-400 font-bold">{batch.quantity !== undefined ? `${batch.quantity} units` : 'Stock'}</strong> expired on <strong className="text-white/90 font-bold">{formatDisplayDate(batch.expirationDate)}</strong>
                                      </span>
                                      <span className="text-[9px] text-rose-400/60 font-mono">
                                        Deducted from active inventory
                                      </span>
                                    </div>
                                  </div>

                                  <span className="text-[8px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                                    {batch.taken ? 'Taken' : 'Expired'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold ml-1">Medication Schedule</label>
                      <input
                        type="text"
                        value={formData.schedule || ''}
                        onChange={(e) => setFormData({ ...formData, schedule: e.target.value })}
                        className="w-full bg-white/[0.02] backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-all placeholder:text-white/20"
                        placeholder="e.g. Twice a day, after meals"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold ml-1">Usage Instructions</label>
                      <textarea
                        value={formData.usageInstructions || ''}
                        onChange={(e) => setFormData({ ...formData, usageInstructions: e.target.value })}
                        className="w-full bg-white/[0.02] backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-all placeholder:text-white/20 min-h-[80px]"
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
              disabled={isSaving}
              className={`flex-[2] py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 transition-all shadow-[0_10px_20px_rgba(255,255,255,0.1)] ${isSaving ? 'bg-white/50 text-black/50 cursor-not-allowed' : 'bg-white text-black hover:bg-white/90'}`}
            >
              {isSaving ? (
                <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
              ) : (
                <Save size={18} />
              )}
              {isSaving ? 'Saving...' : 'Save Medicine'}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
};
