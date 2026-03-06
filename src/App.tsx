import React, { useState, useEffect } from 'react';
import { Plus, Camera, Download, Upload, Info, Settings, Search, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import { Medicine } from './types';
import { CameraCapture } from './components/CameraCapture';
import { MedicineForm } from './components/MedicineForm';
import { MedicineList } from './components/MedicineList';
import { SettingsModal } from './components/SettingsModal';
import { extractMedicineData } from './services/geminiService';
import { 
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, 
  collection, doc, setDoc, deleteDoc, onSnapshot, query, where, orderBy, getDoc, User,
  handleFirestoreError, OperationType
} from './firebase';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingMedicine, setEditingMedicine] = useState<Medicine | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'expired' | 'expiring_soon' | 'expiring_3_months'>('all');
  const [sortOrder, setSortOrder] = useState<'default' | 'asc' | 'desc'>('default');
  const [alertThreshold, setAlertThreshold] = useState(90);
  const [lowQuantityThreshold, setLowQuantityThreshold] = useState(5);
  const [accentColor, setAccentColor] = useState('#ffffff');
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(false);
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(false);

  // Auth State Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Sync User Config from Firestore
  useEffect(() => {
    if (!user) return;

    const configRef = doc(db, 'userConfigs', user.uid);
    const unsubscribe = onSnapshot(configRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.alertThreshold) setAlertThreshold(data.alertThreshold);
        if (data.lowQuantityThreshold !== undefined) setLowQuantityThreshold(data.lowQuantityThreshold);
        if (data.accentColor) setAccentColor(data.accentColor);
        if (data.emailNotificationsEnabled !== undefined) setEmailNotificationsEnabled(data.emailNotificationsEnabled);
        if (data.browserNotificationsEnabled !== undefined) setBrowserNotificationsEnabled(data.browserNotificationsEnabled);
        if (data.sortOrder) setSortOrder(data.sortOrder);
      } else {
        // Initialize default config
        setDoc(configRef, {
          userId: user.uid,
          email: user.email,
          emailNotificationsEnabled: false,
          browserNotificationsEnabled: false,
          alertThreshold: 90,
          lowQuantityThreshold: 5,
          accentColor: '#ffffff',
          sortOrder: 'default'
        }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'userConfigs'));
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'userConfigs');
    });

    return () => unsubscribe();
  }, [user]);

  // Sync Medicines from Firestore
  useEffect(() => {
    if (!user) {
      setMedicines([]);
      return;
    }

    const q = query(
      collection(db, 'medicines'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const meds = snapshot.docs.map(doc => ({ ...doc.data() } as Medicine));
      setMedicines(meds);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'medicines');
    });

    return () => unsubscribe();
  }, [user]);

  // Background Notification Check
  useEffect(() => {
    if (!browserNotificationsEnabled || medicines.length === 0) return;

    const checkAndNotify = () => {
      if (Notification.permission !== 'granted') return;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const expiringMeds = medicines.filter(m => {
        const expiry = new Date(m.expirationDate);
        const diffTime = expiry.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // Notify if expiring exactly on the threshold, or exactly in 10 days, or exactly today
        return diffDays === alertThreshold || diffDays === 10 || diffDays === 0;
      });

      if (expiringMeds.length > 0) {
        const lastNotifiedDate = localStorage.getItem('mediscan_last_notified');
        const todayStr = today.toISOString().split('T')[0];

        if (lastNotifiedDate !== todayStr) {
          const medNames = expiringMeds.map(m => m.name).join(', ');
          new Notification('Mediscan Alert', {
            body: `You have ${expiringMeds.length} medicine(s) expiring soon: ${medNames}`,
            icon: '/favicon.ico'
          });
          localStorage.setItem('mediscan_last_notified', todayStr);
        }
      }
    };

    // Check immediately on load/change
    checkAndNotify();

    // Then check periodically (e.g., every 12 hours)
    const interval = setInterval(checkAndNotify, 12 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [medicines, browserNotificationsEnabled, alertThreshold]);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent-color', accentColor);
  }, [accentColor]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login Error:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  const handleAddManual = () => {
    setEditingMedicine(null);
    setIsFormOpen(true);
  };

  const handleEdit = (medicine: Medicine) => {
    setEditingMedicine(medicine);
    setIsFormOpen(true);
  };

  const handleSave = async (data: Partial<Medicine>) => {
    if (!user) return;

    try {
      if (editingMedicine && editingMedicine.id) {
        const medRef = doc(db, 'medicines', editingMedicine.id);
        await setDoc(medRef, { ...editingMedicine, ...data, userId: user.uid }, { merge: true });
        
        // Log history
        const changes: string[] = [];
        if (editingMedicine.quantity !== data.quantity) changes.push(`Quantity changed from ${editingMedicine.quantity ?? 'none'} to ${data.quantity ?? 'none'}`);
        if (editingMedicine.expirationDate !== data.expirationDate) changes.push(`Expiration date updated to ${data.expirationDate}`);
        if (editingMedicine.dosage !== data.dosage) changes.push(`Dosage updated to ${data.dosage}`);
        if (editingMedicine.name !== data.name) changes.push(`Name updated to ${data.name}`);
        
        if (changes.length > 0) {
          const historyId = crypto.randomUUID();
          await setDoc(doc(db, `medicines/${editingMedicine.id}/history`, historyId), {
            id: historyId,
            medicineId: editingMedicine.id,
            userId: user.uid,
            timestamp: Date.now(),
            actionType: 'EDIT',
            details: changes.join(', ')
          });
        }

      } else {
        const id = crypto.randomUUID();
        const newMed: Medicine = {
          id,
          name: data.name || 'Unknown',
          dosage: data.dosage || 'N/A',
          expirationDate: data.expirationDate || new Date().toISOString().split('T')[0],
          usageInstructions: data.usageInstructions || '',
          createdAt: Date.now(),
          capturedImage: data.capturedImage,
          userId: user.uid,
          ...(data.quantity !== undefined ? { quantity: data.quantity } : {}),
        };
        await setDoc(doc(db, 'medicines', id), newMed);

        // Log creation history
        const historyId = crypto.randomUUID();
        await setDoc(doc(db, `medicines/${id}/history`, historyId), {
          id: historyId,
          medicineId: id,
          userId: user.uid,
          timestamp: Date.now(),
          actionType: 'CREATE',
          details: `Added ${newMed.name} to vault`
        });
      }
      setIsFormOpen(false);
      setEditingMedicine(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'medicines');
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    try {
      // Note: In a real app, you might want a cloud function to clean up subcollections
      // when a parent document is deleted. For this demo, we'll just delete the parent.
      await deleteDoc(doc(db, 'medicines', id));
      setIsFormOpen(false);
      setEditingMedicine(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'medicines');
    }
  };

  const handleToggleTaken = async (medicine: Medicine) => {
    if (!user) return;
    try {
      const medRef = doc(db, 'medicines', medicine.id);
      await setDoc(medRef, { taken: !medicine.taken }, { merge: true });

      const historyId = crypto.randomUUID();
      await setDoc(doc(db, `medicines/${medicine.id}/history`, historyId), {
        id: historyId,
        medicineId: medicine.id,
        userId: user.uid,
        timestamp: Date.now(),
        actionType: !medicine.taken ? 'MARK_TAKEN' : 'MARK_NOT_TAKEN',
        details: !medicine.taken ? 'Marked as taken' : 'Marked as not taken'
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'medicines');
    }
  };

  const handleClearData = async () => {
    if (!user) return;
    // For safety, we only clear medicines, not the whole account
    const confirm = window.confirm("Are you sure you want to clear all medicines? This will delete them from the cloud.");
    if (!confirm) return;

    try {
      // In a real app, you'd use a batch or cloud function. 
      // Here we'll just delete them one by one for simplicity in this demo environment.
      for (const med of medicines) {
        await deleteDoc(doc(db, 'medicines', med.id));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'medicines');
    }
  };

  const handleUpdateConfig = async (updates: any) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'userConfigs', user.uid), updates, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'userConfigs');
    }
  };

  const handleCapture = async (base64: string) => {
    setIsProcessing(true);
    setExtractionError(null);
    const result = await extractMedicineData(base64);
    setIsProcessing(false);
    
    if (result.success && result.medicine) {
      setEditingMedicine(null);
      // Pre-fill form with extracted data
      const tempMed: Partial<Medicine> = {
        name: result.medicine.name,
        dosage: result.medicine.dosage,
        expirationDate: result.medicine.expirationDate,
        usageInstructions: result.medicine.usageInstructions || '',
        capturedImage: `data:image/jpeg;base64,${base64}`,
        ...(result.medicine.quantity !== undefined ? { quantity: result.medicine.quantity } : {}),
      };
      // We don't save immediately, we let user verify in form
      setEditingMedicine(tempMed as Medicine);
      setIsCameraOpen(false);
      setIsFormOpen(true);
    } else {
      setExtractionError(result.errorMessage || "Could not read the label. Please ensure good lighting and a clear, focused image.");
    }
  };

  const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const importedMeds = results.data as any[];
        let count = 0;

        for (const row of importedMeds) {
          // Map CSV headers to Medicine object
          // Expected headers: Name, Dosage, Expiration Date, Usage Instructions
          const name = row['Name'] || row['name'];
          const dosage = row['Dosage'] || row['dosage'];
          const quantityRaw = row['Quantity'] || row['quantity'] || row['Count'] || row['count'];
          const quantity = quantityRaw ? parseInt(quantityRaw, 10) : undefined;
          const expirationDate = row['Expiration Date'] || row['expirationDate'] || row['expiration_date'] || row['Expiry Date'] || row['expiryDate'] || row['expiry_date'];
          const usageInstructions = row['Usage Instructions'] || row['usageInstructions'] || row['usage_instructions'] || row['Notes'] || row['notes'] || '';

          if (name && expirationDate) {
            const id = crypto.randomUUID();
            const newMed: Medicine = {
              id,
              name,
              dosage: dosage || 'N/A',
              expirationDate,
              usageInstructions,
              createdAt: Date.now(),
              userId: user.uid,
              ...(quantity !== undefined && !isNaN(quantity) ? { quantity } : {}),
            };
            try {
              await setDoc(doc(db, 'medicines', id), newMed);
              count++;
            } catch (err) {
              handleFirestoreError(err, OperationType.WRITE, 'medicines');
            }
          }
        }
        alert(`Successfully imported ${count} medicines.`);
        // Reset input
        event.target.value = '';
      },
      error: (error) => {
        console.error("CSV Parse Error:", error);
        alert("Failed to parse CSV file. Please ensure it's a valid Google Sheets export.");
      }
    });
  };

  const exportToSheets = () => {
    if (medicines.length === 0) return;

    const headers = ['Name', 'Dosage', 'Quantity', 'Expiration Date', 'Usage Instructions', 'Alert Formula'];
    const rows = medicines.map(m => [
      m.name,
      m.dosage,
      m.quantity !== undefined ? m.quantity.toString() : '',
      m.expirationDate,
      m.usageInstructions.replace(/,/g, ';'),
      `=IF(TODAY() >= (D${medicines.indexOf(m) + 2} - 90), "ALERT: 3 Months", IF(TODAY() >= (D${medicines.indexOf(m) + 2} - 10), "ALERT: 10 Days", "OK"))`
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `mediscan_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const filteredMedicines = medicines.filter(m => {
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = 
      m.name.toLowerCase().includes(searchLower) ||
      m.dosage.toLowerCase().includes(searchLower) ||
      m.usageInstructions.toLowerCase().includes(searchLower);

    if (!matchesSearch) return false;

    if (filter === 'all') return true;

    const expiry = new Date(m.expirationDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [year, month, day] = m.expirationDate.split('-').map(Number);
    if (year && month && day) {
      expiry.setFullYear(year, month - 1, day);
    }
    expiry.setHours(0, 0, 0, 0);
    
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (filter === 'expired') return diffDays < 0;
    if (filter === 'expiring_soon') return diffDays >= 0 && diffDays <= 10;
    if (filter === 'expiring_3_months') return diffDays >= 0 && diffDays <= alertThreshold;
    
    return true;
  }).sort((a, b) => {
    if (sortOrder === 'asc') return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    if (sortOrder === 'desc') return b.name.toLowerCase().localeCompare(a.name.toLowerCase());
    return 0;
  });

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-white/10 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white font-sans flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-4"
          >
            <div className="w-24 h-24 bg-white rounded-[32px] mx-auto flex items-center justify-center shadow-2xl shadow-white/10">
              <Camera className="text-black" size={48} />
            </div>
            <h1 className="text-5xl font-bold tracking-tighter bg-gradient-to-b from-white to-white/40 bg-clip-text text-transparent">
              Mediscan
            </h1>
            <p className="text-white/40 text-sm font-medium uppercase tracking-[0.2em]">
              Your AI Medicine Vault
            </p>
          </motion.div>

          <div className="space-y-6">
            <p className="text-white/60 text-sm leading-relaxed">
              Securely store your medicine data in the cloud. Access your vault from any device, anytime.
            </p>
            <button
              onClick={handleLogin}
              className="w-full py-5 bg-white text-black rounded-[24px] font-bold text-lg hover:bg-white/90 transition-all shadow-xl shadow-white/5 flex items-center justify-center gap-3"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-6 h-6" />
              Sign in with Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-white selection:text-black">
      {/* Glossy Header */}
      <header className="sticky top-0 z-40 bg-black/40 backdrop-blur-2xl border-b border-white/5 px-4 py-4">
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl font-bold tracking-tighter bg-gradient-to-b from-accent to-accent/40 bg-clip-text text-transparent">
                Mediscan
              </h1>
              <p className="text-white/40 text-[10px] font-medium uppercase tracking-[0.2em] mt-1">
                AI Medicine Vault
              </p>
            </div>
            <div className="flex gap-2">
              <label className="p-2 bg-white/5 border border-white/10 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-all cursor-pointer" title="Import from CSV">
                <Upload size={18} />
                <input 
                  type="file" 
                  accept=".csv" 
                  className="hidden" 
                  onChange={handleImport}
                />
              </label>
              <button 
                onClick={exportToSheets}
                className="p-2 bg-white/5 border border-white/10 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-all"
                title="Export to CSV (Google Sheets)"
              >
                <Download size={18} />
              </button>
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 bg-white/5 border border-white/10 rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-all"
              >
                <Settings size={18} />
              </button>
            </div>
          </div>
          
          {/* Search Bar moved to Navbar */}
          <div className="relative group">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-white/20 group-focus-within:text-white/60 transition-colors">
              <Search size={18} />
            </div>
            <input 
              type="text" 
              placeholder="Search by name, dosage, or instructions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-4 focus:outline-none focus:border-white/30 transition-all placeholder:text-white/20 text-sm"
            />
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto pt-6 pb-32">
        {/* Stats / Info */}
        <div className="px-4 mb-6 grid grid-cols-2 gap-4">
          <div className="bg-gradient-to-br from-white/[0.08] to-transparent border border-white/10 rounded-3xl p-6">
            <p className="text-white/40 text-[10px] uppercase tracking-widest font-bold mb-1">Total Items</p>
            <p className="text-3xl font-bold tracking-tight">{medicines.length}</p>
          </div>
          <div className="bg-gradient-to-br from-white/[0.08] to-transparent border border-white/10 rounded-3xl p-6">
            <p className="text-white/40 text-[10px] uppercase tracking-widest font-bold mb-1">Expiring Soon</p>
            <p className="text-3xl font-bold tracking-tight text-orange-400">
              {medicines.filter(m => {
                const expiry = new Date(m.expirationDate);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const [year, month, day] = m.expirationDate.split('-').map(Number);
                if (year && month && day) {
                  expiry.setFullYear(year, month - 1, day);
                }
                expiry.setHours(0, 0, 0, 0);
                
                const diffTime = expiry.getTime() - today.getTime();
                const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                return diffDays > 0 && diffDays <= alertThreshold;
              }).length}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="px-4 mb-6 flex gap-1.5 overflow-x-auto no-scrollbar pb-2">
          <button 
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide whitespace-nowrap transition-all ${filter === 'all' ? 'bg-white text-black' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'}`}
          >
            All
          </button>
          <button 
            onClick={() => setFilter('expired')}
            className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide whitespace-nowrap transition-all ${filter === 'expired' ? 'bg-red-500 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'}`}
          >
            Expired
          </button>
          <button 
            onClick={() => setFilter('expiring_soon')}
            className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide whitespace-nowrap transition-all ${filter === 'expiring_soon' ? 'bg-orange-500 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'}`}
          >
            Soon
          </button>
          <button 
            onClick={() => setFilter('expiring_3_months')}
            className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide whitespace-nowrap transition-all ${filter === 'expiring_3_months' ? 'bg-yellow-500 text-black' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'}`}
          >
            &lt; 3 Mo
          </button>
          <div className="w-px h-6 bg-white/10 mx-1 self-center shrink-0"></div>
          <button 
            onClick={() => {
              const nextOrder = sortOrder === 'default' ? 'asc' : sortOrder === 'asc' ? 'desc' : 'default';
              setSortOrder(nextOrder);
              handleUpdateConfig({ sortOrder: nextOrder });
            }}
            className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide whitespace-nowrap transition-all ${sortOrder !== 'default' ? 'bg-indigo-500 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'}`}
          >
            {sortOrder === 'desc' ? 'Z-A' : 'A-Z'}
          </button>
        </div>

        <MedicineList 
          medicines={filteredMedicines} 
          onEdit={handleEdit} 
          onToggleTaken={handleToggleTaken}
          lowQuantityThreshold={lowQuantityThreshold}
          alertThreshold={alertThreshold}
        />
      </main>

      {/* Floating Action Bar */}
      <div className="fixed bottom-8 left-0 right-0 z-40 px-6">
        <div className="max-w-md mx-auto bg-black/40 backdrop-blur-3xl border border-white/10 rounded-[40px] p-3 flex items-center justify-between shadow-2xl">
          <button 
            onClick={handleAddManual}
            className="flex-1 py-4 flex flex-col items-center gap-1 text-white/40 hover:text-white transition-all"
          >
            <Plus size={24} />
            <span className="text-[10px] font-bold uppercase tracking-widest">Manual</span>
          </button>
          
          <button 
            onClick={() => setIsCameraOpen(true)}
            className="relative -top-8 w-20 h-20 bg-accent rounded-full flex items-center justify-center shadow-[0_20px_40px_rgba(var(--accent-color-rgb),0.2)] active:scale-95 transition-transform"
          >
            <div className="absolute inset-0 rounded-full bg-gradient-to-b from-accent to-neutral-300" />
            <Camera className="relative text-black" size={32} />
          </button>

          <button 
            onClick={() => setIsGuideOpen(true)}
            className="flex-1 py-4 flex flex-col items-center gap-1 text-white/40 hover:text-white transition-all"
          >
            <Info size={24} />
            <span className="text-[10px] font-bold uppercase tracking-widest">Guide</span>
          </button>
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {isCameraOpen && (
          <CameraCapture 
            onCapture={handleCapture}
            onClose={() => {
              setIsCameraOpen(false);
              setExtractionError(null);
            }}
            isProcessing={isProcessing}
            extractionError={extractionError}
          />
        )}
        
        {isFormOpen && (
          <MedicineForm 
            medicine={editingMedicine}
            onSave={handleSave}
            onDelete={handleDelete}
            onClose={() => {
              setIsFormOpen(false);
              setEditingMedicine(null);
            }}
          />
        )}

        {isSettingsOpen && (
          <SettingsModal 
            onClose={() => setIsSettingsOpen(false)}
            onClearData={handleClearData}
            alertThreshold={alertThreshold}
            setAlertThreshold={(val) => handleUpdateConfig({ alertThreshold: val })}
            lowQuantityThreshold={lowQuantityThreshold}
            setLowQuantityThreshold={(val) => handleUpdateConfig({ lowQuantityThreshold: val })}
            accentColor={accentColor}
            setAccentColor={(val) => handleUpdateConfig({ accentColor: val })}
            emailNotificationsEnabled={emailNotificationsEnabled}
            setEmailNotificationsEnabled={(val) => handleUpdateConfig({ emailNotificationsEnabled: val })}
            browserNotificationsEnabled={browserNotificationsEnabled}
            setBrowserNotificationsEnabled={async (val) => {
              if (val) {
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                  handleUpdateConfig({ browserNotificationsEnabled: true });
                } else {
                  alert('Please allow notifications in your browser settings to use this feature.');
                  handleUpdateConfig({ browserNotificationsEnabled: false });
                }
              } else {
                handleUpdateConfig({ browserNotificationsEnabled: false });
              }
            }}
            userEmail={user.email || ''}
            onLogout={handleLogout}
          />
        )}

        {isGuideOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-md"
          >
            <div className="w-full max-w-md bg-[#1a1a1a] border border-white/10 rounded-[40px] p-8 overflow-y-auto max-h-[80vh]">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-2xl font-bold tracking-tight">User Guide</h2>
                <button onClick={() => setIsGuideOpen(false)} className="p-2 text-white/40 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-8">
                <section>
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <Camera size={18} className="text-white/40" />
                    AI Scanning
                  </h3>
                  <p className="text-white/50 text-sm leading-relaxed">
                    Point your camera at any medicine label. Our AI will automatically extract the name, dosage, and expiration date. You can verify and edit the details before saving.
                  </p>
                </section>

                <section>
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <Download size={18} className="text-white/40" />
                    Backup & Restore
                  </h3>
                  <p className="text-white/50 text-sm leading-relaxed mb-4">
                    Use the <strong>Export</strong> button to save your data as a CSV. You can <strong>Import</strong> it back later or on another device using the upload icon. This is perfect for migrating data from Google Sheets.
                  </p>
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                    <p className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-2">CSV Format</p>
                    <p className="text-xs text-white/60">
                      Ensure your CSV has headers: <strong>Name, Dosage, Quantity, Expiration Date, Usage Instructions</strong>.
                    </p>
                  </div>
                </section>

                <section>
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <Download size={18} className="text-white/40" />
                    Cloud Sync & Notifications
                  </h3>
                  <p className="text-white/50 text-sm leading-relaxed mb-4">
                    Your data is now stored in the cloud. Even if you delete the app, your medicines are safe. Enable email notifications in settings to get alerts directly in your inbox.
                  </p>
                </section>
              </div>

              <button 
                onClick={() => setIsGuideOpen(false)}
                className="w-full mt-10 py-4 bg-white text-black rounded-full font-bold hover:bg-white/90 transition-all"
              >
                Got it
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
