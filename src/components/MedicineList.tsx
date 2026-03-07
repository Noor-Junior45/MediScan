import React, { useState } from 'react';
import { Medicine } from '../types';
import { Calendar, Package, ChevronRight, AlertCircle, CheckCircle2, Pill, AlertTriangle, XCircle, Clock, Trash2, CheckSquare, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface MedicineListProps {
  medicines: Medicine[];
  onEdit: (medicine: Medicine) => void;
  onToggleTaken: (medicine: Medicine) => void;
  onDeleteMultiple: (ids: string[]) => void;
  lowQuantityThreshold: number;
  alertThreshold: number;
}

export const MedicineList: React.FC<MedicineListProps> = ({ medicines, onEdit, onToggleTaken, onDeleteMultiple, lowQuantityThreshold, alertThreshold }) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
    if (newSelected.size === 0) {
      setIsSelectionMode(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === medicines.length) {
      setSelectedIds(new Set());
      setIsSelectionMode(false);
    } else {
      setSelectedIds(new Set(medicines.map(m => m.id)));
      setIsSelectionMode(true);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    setShowDeleteConfirm(true);
  };

  const confirmDelete = () => {
    onDeleteMultiple(Array.from(selectedIds));
    setSelectedIds(new Set());
    setIsSelectionMode(false);
    setShowDeleteConfirm(false);
  };

  const getExpiryStatus = (dateStr: string) => {
    const expiry = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // Handle dateStr which might be YYYY-MM-DD (parsed as UTC)
    // We want to treat it as local time midnight
    const [year, month, day] = dateStr.split('-').map(Number);
    if (year && month && day) {
      expiry.setFullYear(year, month - 1, day);
    }
    expiry.setHours(0, 0, 0, 0);
    
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return { label: 'Expired', color: 'text-red-500', bg: 'bg-red-500/10', Icon: XCircle };
    if (diffDays <= 10) return { label: 'Expiring Soon (10d)', color: 'text-orange-500', bg: 'bg-orange-500/10', Icon: AlertTriangle };
    if (diffDays <= alertThreshold) {
      const label = alertThreshold === 90 ? 'Expiring in 3mo' : `Expiring in ${alertThreshold}d`;
      return { label, color: 'text-yellow-500', bg: 'bg-yellow-500/10', Icon: Clock };
    }
    return { label: 'Safe', color: 'text-emerald-500', bg: 'bg-emerald-500/10', Icon: CheckCircle2 };
  };

  if (medicines.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-6">
        <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6 border border-white/10">
          <Package className="text-white/20" size={32} />
        </div>
        <h3 className="text-white font-medium text-lg mb-2">No medicines tracked</h3>
        <p className="text-white/40 text-sm max-w-[240px]">
          Start by scanning a medicine label or adding one manually.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 pb-24">
      <div className="flex justify-between items-center mb-4">
        <button 
          onClick={() => {
            if (isSelectionMode) {
              setIsSelectionMode(false);
              setSelectedIds(new Set());
            } else {
              setIsSelectionMode(true);
            }
          }}
          className="text-sm text-white/60 hover:text-white transition-colors"
        >
          {isSelectionMode ? 'Cancel Selection' : 'Select Multiple'}
        </button>
        
        <AnimatePresence>
          {isSelectionMode && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex items-center gap-3"
            >
              <button 
                onClick={toggleSelectAll}
                className="text-sm text-white/60 hover:text-white transition-colors flex items-center gap-1.5"
              >
                {selectedIds.size === medicines.length ? <CheckSquare size={16} /> : <Square size={16} />}
                All
              </button>
              {selectedIds.size > 0 && (
                <button 
                  onClick={handleDeleteSelected}
                  className="text-sm text-red-400 hover:text-red-300 transition-colors flex items-center gap-1.5 bg-red-500/10 px-3 py-1.5 rounded-full"
                >
                  <Trash2 size={14} />
                  Delete ({selectedIds.size})
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {medicines.map((med, index) => {
        const status = getExpiryStatus(med.expirationDate);
        const expiry = new Date(med.expirationDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [year, month, day] = med.expirationDate.split('-').map(Number);
        if (year && month && day) {
          expiry.setFullYear(year, month - 1, day);
        }
        expiry.setHours(0, 0, 0, 0);
        
        const diffTime = expiry.getTime() - today.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

        const isExpired = diffDays < 0;
        const isExpiringSoon = diffDays >= 0 && diffDays <= 10;
        const isExpiringAlert = diffDays > 10 && diffDays <= alertThreshold;
        const isLowQuantity = med.quantity !== undefined && med.quantity <= lowQuantityThreshold;
        const needsAttention = !med.taken && (isExpired || isExpiringSoon || isExpiringAlert || isLowQuantity);
        const isSelected = selectedIds.has(med.id);

        return (
          <motion.div
            key={med.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ 
              opacity: med.taken ? 0.5 : 1, 
              y: 0,
              ...(needsAttention && !isSelected ? {
                boxShadow: isExpired 
                  ? ['0px 0px 0px rgba(239,68,68,0)', '0px 0px 15px rgba(239,68,68,0.15)', '0px 0px 0px rgba(239,68,68,0)']
                  : isExpiringSoon 
                    ? ['0px 0px 0px rgba(249,115,22,0)', '0px 0px 15px rgba(249,115,22,0.15)', '0px 0px 0px rgba(249,115,22,0)']
                    : isExpiringAlert || isLowQuantity
                      ? ['0px 0px 0px rgba(234,179,8,0)', '0px 0px 15px rgba(234,179,8,0.15)', '0px 0px 0px rgba(234,179,8,0)']
                      : undefined,
              } : {})
            }}
            transition={{ 
              delay: index * 0.05,
              ...(needsAttention && !isSelected ? {
                boxShadow: { repeat: Infinity, duration: 2, ease: "easeInOut" }
              } : {})
            }}
            onClick={() => {
              if (isSelectionMode) {
                toggleSelection(med.id);
              } else if (!med.taken) {
                onEdit(med);
              }
            }}
            className={`w-full text-left group relative overflow-hidden border rounded-3xl p-5 transition-all ${
              isSelectionMode ? 'cursor-pointer' : ''
            } ${
              isSelected ? 'bg-white/10 border-white/40' :
              med.taken ? 'bg-white/5 border-white/5 grayscale' :
              isExpired ? 'bg-white/5 border-red-500/30 hover:border-red-500/50 hover:bg-white/[0.08]' :
              isExpiringSoon ? 'bg-white/5 border-orange-500/30 hover:border-orange-500/50 hover:bg-white/[0.08]' :
              isExpiringAlert ? 'bg-white/5 border-yellow-500/30 hover:border-yellow-500/50 hover:bg-white/[0.08]' :
              isLowQuantity ? 'bg-white/5 border-yellow-500/30 hover:border-yellow-500/50 hover:bg-white/[0.08]' :
              'bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/[0.08]'
            }`}
          >
            <div className="flex justify-between items-start mb-3">
              <div className="flex items-start gap-3 flex-1">
                {isSelectionMode && (
                  <div className="mt-1 text-white/40">
                    {isSelected ? <CheckSquare size={20} className="text-white" /> : <Square size={20} />}
                  </div>
                )}
                <div className={`flex-1 ${med.taken && !isSelectionMode ? 'cursor-default' : 'cursor-pointer'}`}>
                  <h3 className={`font-semibold text-lg tracking-tight transition-colors ${med.taken ? 'text-white/40 line-through' : 'text-white group-hover:text-white'}`}>
                    {med.name}
                  </h3>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="flex items-center gap-1.5 text-white/40 text-xs">
                      <Package size={12} />
                      {med.dosage}
                    </span>
                    {!med.taken && (
                      <span className={`flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${status.bg} ${status.color}`}>
                        <status.Icon size={12} />
                        {status.label}
                      </span>
                    )}
                    {!med.taken && med.quantity !== undefined && (
                      <span className={`flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${isLowQuantity ? 'bg-yellow-500/10 text-yellow-500' : 'bg-white/10 text-white/50'}`}>
                        <Pill size={12} />
                        {med.quantity} left
                      </span>
                    )}
                    {med.taken && (
                      <span className="flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-white/10 text-white/50">
                        <CheckCircle2 size={12} />
                        Taken
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {!isSelectionMode && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleTaken(med);
                    }}
                    className={`p-2 rounded-full transition-all ${
                      med.taken 
                        ? 'bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30' 
                        : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'
                    }`}
                    title={med.taken ? "Mark as not taken" : "Mark as taken"}
                  >
                    <CheckCircle2 size={20} />
                  </button>
                  {!med.taken && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(med);
                      }}
                      className="p-2 bg-white/5 rounded-full text-white/20 hover:text-white/60 transition-all"
                    >
                      <ChevronRight size={18} />
                    </button>
                  )}
                </div>
              )}
            </div>
            
            <div className={`flex items-center gap-2 text-white/60 text-sm ${isSelectionMode ? 'pl-8' : ''}`}>
              <Calendar size={14} className="text-white/30" />
              <span className={`font-mono text-xs tracking-wider ${med.taken ? 'line-through opacity-50' : ''}`}>
                Exp: {new Date(med.expirationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>

            {med.usageInstructions && (
              <p className={`mt-3 text-white/30 text-xs line-clamp-1 italic ${med.taken ? 'line-through opacity-50' : ''} ${isSelectionMode ? 'pl-8' : ''}`}>
                "{med.usageInstructions}"
              </p>
            )}
          </motion.div>
        );
      })}

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowDeleteConfirm(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-3xl p-6 shadow-2xl"
            >
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4 mx-auto">
                <Trash2 className="text-red-500" size={24} />
              </div>
              <h3 className="text-xl font-medium text-white text-center mb-2">Delete Medicines?</h3>
              <p className="text-white/60 text-sm text-center mb-6">
                Are you sure you want to delete {selectedIds.size} selected medicine(s)? This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmDelete}
                  className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium transition-colors shadow-lg shadow-red-500/20"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
