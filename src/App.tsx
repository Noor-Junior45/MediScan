import React, { useState, useEffect } from 'react';
import { Plus, Camera, Download, Upload, Info, Settings, Search, X, History, Trash2, ShieldAlert } from 'lucide-react';
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
  collection, doc, setDoc, deleteDoc, updateDoc, writeBatch, onSnapshot, query, where, orderBy, getDoc, getDocs, User,
  handleFirestoreError, OperationType, deleteField, signInWithEmailAndPassword, createUserWithEmailAndPassword
} from './firebase';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AdBanner } from './components/AdBanner';

import { CookieConsentBanner } from './components/CookieConsentBanner';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [editingMedicine, setEditingMedicine] = useState<Medicine | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extractionWarning, setExtractionWarning] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'expired' | 'expiring_soon' | 'expiring_3_months'>('all');
  const [sortOrder, setSortOrder] = useState<'default' | 'asc' | 'desc'>('default');
  const [alertThreshold, setAlertThreshold] = useState(90);
  const [lowQuantityThreshold, setLowQuantityThreshold] = useState(5);
  const [accentColor, setAccentColor] = useState('#ffffff');
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(false);
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isEmailLoginOpen, setIsEmailLoginOpen] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

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
        if (data.theme) setTheme(data.theme);
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
          sortOrder: 'default',
          theme: 'system'
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
        const [year, month, day] = m.expirationDate.split('-').map(Number);
        const expiry = new Date();
        if (year && month && day) {
          expiry.setFullYear(year, month - 1, day);
        } else {
          return false;
        }
        expiry.setHours(0, 0, 0, 0);
        
        const diffTime = expiry.getTime() - today.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
        
        const effectiveThreshold = alertThreshold === 90 ? 92 : alertThreshold;
        
        // Notify if expiring exactly on the threshold, or exactly in 10 days, or exactly today
        return diffDays === effectiveThreshold || diffDays === 10 || diffDays === 0;
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
    const applyThemeAndAccent = () => {
      let isDark = false;
      if (theme === 'dark') {
        isDark = true;
      } else if (theme === 'light') {
        isDark = false;
      } else {
        // System preference
        isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      }

      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }

      // Adjust accent color for light mode if it's white
      let color = accentColor;
      if (!isDark && color === '#ffffff') {
        color = '#111827';
      }
      document.documentElement.style.setProperty('--accent-color', color);
    };

    applyThemeAndAccent();

    // Listen for system theme changes if set to 'system'
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyThemeAndAccent();
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme, accentColor]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        // Silently handle popup closure
        return;
      }
      console.error("Login Error:", error);
      setAlertMessage('Failed to sign in with Google. Please try again.');
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error: any) {
      console.error('Email login error:', error);
      if (error.code === 'auth/invalid-credential') {
        setAlertMessage('Invalid email or password. Please check your credentials or sign up if you don\'t have an account.');
      } else if (error.code === 'auth/user-disabled') {
        setAlertMessage('This account has been disabled.');
      } else {
        setAlertMessage('An error occurred during login. Please try again.');
      }
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setAlertMessage('Password must be at least 6 characters long.');
      return;
    }
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (error: any) {
      console.error('Email sign up error:', error);
      if (error.code === 'auth/email-already-in-use') {
        setAlertMessage('This email is already in use. Please try logging in instead.');
      } else if (error.code === 'auth/invalid-email') {
        setAlertMessage('Please enter a valid email address.');
      } else if (error.code === 'auth/weak-password') {
        setAlertMessage('The password is too weak.');
      } else {
        setAlertMessage('An error occurred during sign up. Please try again.');
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      // Reset UI states on logout
      setIsSettingsOpen(false);
      setIsEmailLoginOpen(false);
      setIsSignUp(false);
      setIsCameraOpen(false);
      setIsFormOpen(false);
      setIsGuideOpen(false);
    } catch (error) {
      console.error("Logout Error:", error);
    }
  };

  const handleAddManual = () => {
    setEditingMedicine(null);
    setExtractionWarning(null);
    setIsFormOpen(true);
  };

  const handleEdit = async (medicine: Medicine) => {
    setExtractionWarning(null);
    setEditingMedicine(medicine);
    setIsFormOpen(true);
  };

  const handleSave = async (data: Partial<Medicine>) => {
    if (!user || isSaving) return;
    setIsSaving(true);

    try {
      const { capturedImage, ...firestoreData } = data;
      
      const normalizedName = (firestoreData.name || '').toLowerCase().trim();
      const existingMed = medicines.find(m => 
        m.name.toLowerCase().trim() === normalizedName &&
        m.expirationDate === firestoreData.expirationDate &&
        (!editingMedicine || m.id !== editingMedicine.id)
      );

      if (existingMed) {
        const medRef = doc(db, 'medicines', existingMed.id);
        
        const currentQty = existingMed.quantity || 0;
        const addedQty = firestoreData.quantity || 0;
        const newQuantity = currentQty + addedQty;

        const updateData: any = { 
          quantity: newQuantity,
          userId: user.uid
        };

        if (capturedImage) {
          updateData.capturedImage = capturedImage;
        }

        if (existingMed.dosage === 'N/A' && firestoreData.dosage) {
          updateData.dosage = firestoreData.dosage;
        }
        if (!existingMed.usageInstructions && firestoreData.usageInstructions) {
          updateData.usageInstructions = firestoreData.usageInstructions;
        }

        await setDoc(medRef, updateData, { merge: true });

        const historyId = crypto.randomUUID();
        await setDoc(doc(db, `medicines/${existingMed.id}/history`, historyId), {
          id: historyId,
          medicineId: existingMed.id,
          userId: user.uid,
          timestamp: Date.now(),
          actionType: 'EDIT',
          details: `Merged with another entry. Quantity increased by ${addedQty} to ${newQuantity}.`
        });

        if (editingMedicine && editingMedicine.id) {
          await deleteDoc(doc(db, 'medicines', editingMedicine.id));
        }
      } else if (editingMedicine && editingMedicine.id) {
        const medRef = doc(db, 'medicines', editingMedicine.id);
        const updateData: any = { ...editingMedicine, ...firestoreData, userId: user.uid };
        
        if (capturedImage) {
          updateData.capturedImage = capturedImage;
        }

        Object.keys(updateData).forEach(key => {
          if (updateData[key] === undefined) {
            updateData[key] = deleteField();
          }
        });
        await setDoc(medRef, updateData, { merge: true });
        
        // Log history
        const changes: string[] = [];
        if (editingMedicine.quantity !== data.quantity) changes.push(`Quantity changed from ${editingMedicine.quantity ?? 'none'} to ${data.quantity ?? 'none'}`);
        if (editingMedicine.expirationDate !== data.expirationDate) changes.push(`Expiration date updated to ${data.expirationDate}`);
        if (editingMedicine.dosage !== data.dosage) changes.push(`Dosage updated to ${data.dosage}`);
        if (editingMedicine.name !== data.name) changes.push(`Name updated to ${data.name}`);
        if (editingMedicine.form !== data.form) changes.push(`Form updated to ${data.form}`);
        
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
        const newMed: any = {
          id,
          name: firestoreData.name || 'Unknown',
          dosage: firestoreData.dosage || 'N/A',
          expirationDate: firestoreData.expirationDate || new Date().toISOString().split('T')[0],
          usageInstructions: firestoreData.usageInstructions || '',
          createdAt: Date.now(),
          userId: user.uid,
          form: firestoreData.form || 'other',
          ...(firestoreData.quantity !== undefined ? { quantity: firestoreData.quantity } : {}),
          ...(capturedImage ? { capturedImage } : {}),
        };
        Object.keys(newMed).forEach(key => {
          if (newMed[key] === undefined) {
            delete newMed[key];
          }
        });
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
      setExtractionWarning(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'medicines');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'medicines', id), {
        isDeleted: true,
        deletedAt: Date.now()
      });
      setIsFormOpen(false);
      setEditingMedicine(null);
      setExtractionWarning(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'medicines');
    }
  };

  const handleDeleteMultiple = async (ids: string[]) => {
    if (!user) return;
    try {
      const CHUNK_SIZE = 500;
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(db);
        chunk.forEach(id => {
          const docRef = doc(db, 'medicines', id);
          batch.update(docRef, {
            isDeleted: true,
            deletedAt: Date.now()
          });
        });
        await batch.commit();
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'medicines');
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

  const handleReduceQuantity = async (medicine: Medicine) => {
    if (!user || medicine.quantity === undefined || medicine.quantity <= 0) return;
    try {
      const newQuantity = medicine.quantity - 1;
      const isFinished = newQuantity === 0;
      const medRef = doc(db, 'medicines', medicine.id);
      
      const updateData: any = { quantity: newQuantity };
      if (isFinished) {
        updateData.taken = true;
      }
      
      await setDoc(medRef, updateData, { merge: true });

      const historyId = crypto.randomUUID();
      await setDoc(doc(db, `medicines/${medicine.id}/history`, historyId), {
        id: historyId,
        medicineId: medicine.id,
        userId: user.uid,
        timestamp: Date.now(),
        actionType: 'EDIT',
        details: `Quantity reduced to ${newQuantity}${isFinished ? ' (Marked as finished)' : ''}`
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'medicines');
    }
  };

  const confirmClearData = async () => {
    if (!user || isSaving) return;
    setIsSaving(true);
    try {
      const CHUNK_SIZE = 100; // Smaller chunk for complex deletes (includes history)
      const allMeds = [...medicines];
      
      for (let i = 0; i < allMeds.length; i += CHUNK_SIZE) {
        const chunk = allMeds.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(med => handlePermanentDelete(med.id)));
      }
      setAlertMessage("All data cleared successfully.");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'medicines');
    } finally {
      setIsSaving(false);
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
    if (isProcessing) return;
    setIsProcessing(true);
    setExtractionError(null);
    setExtractionWarning(null);
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
        form: result.medicine.form || 'other',
      };
      // We don't save immediately, we let user verify in form
      setEditingMedicine(tempMed as Medicine);
      if (result.warningMessage) {
        setExtractionWarning(result.warningMessage);
      }
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
        let mergedCount = 0;

        const batch = writeBatch(db);
        const existingMap = new Map<string, Medicine>();
        medicines.forEach(m => {
          const key = `${m.name.toLowerCase().trim()}_${m.expirationDate}`;
          existingMap.set(key, m);
        });
        
        const newMedsMap = new Map<string, any>();
        const existingUpdates = new Map<string, number>();

        for (const row of importedMeds) {
          // Map CSV headers to Medicine object
          // Expected headers: Name, Dosage, Expiration Date, Usage Instructions
          const name = row['Name'] || row['name'];
          const dosage = row['Dosage'] || row['dosage'];
          const quantityRaw = row['Quantity'] || row['quantity'] || row['Count'] || row['count'];
          const quantity = quantityRaw ? parseInt(quantityRaw, 10) : undefined;
          const expirationDateRaw = row['Expiration Date'] || row['expirationDate'] || row['expiration_date'] || row['Expiry Date'] || row['expiryDate'] || row['expiry_date'];
          const usageInstructions = row['Usage Instructions'] || row['usageInstructions'] || row['usage_instructions'] || row['Notes'] || row['notes'] || '';
          const form = (row['Form'] || row['form'] || 'other').toLowerCase();
          const validForm = ['tablet', 'capsule', 'syrup', 'ampule', 'powder', 'tape', 'liquid', 'other'].includes(form) ? form : 'other';

          if (name && expirationDateRaw) {
            let expirationDate = expirationDateRaw;
            // Try to format date to YYYY-MM-DD if it's not already
            if (!/^\d{4}-\d{2}-\d{2}$/.test(expirationDateRaw)) {
              try {
                const d = new Date(expirationDateRaw);
                if (!isNaN(d.getTime())) {
                  expirationDate = d.toISOString().split('T')[0];
                } else {
                  // Skip invalid dates
                  continue;
                }
              } catch (e) {
                // Skip invalid dates
                continue;
              }
            }

            const key = `${name.toLowerCase().trim()}_${expirationDate}`;
            const addQty = quantity !== undefined && !isNaN(quantity) && quantity >= 0 ? quantity : 0;

            if (existingMap.has(key)) {
              const existingMed = existingMap.get(key)!;
              const currentTotal = existingUpdates.has(existingMed.id) 
                ? existingUpdates.get(existingMed.id)! 
                : (existingMed.quantity || 0);
              existingUpdates.set(existingMed.id, currentTotal + addQty);
              mergedCount++;
            } else if (newMedsMap.has(key)) {
              const newMed = newMedsMap.get(key)!;
              newMed.quantity = (newMed.quantity || 0) + addQty;
              mergedCount++;
            } else {
              const id = crypto.randomUUID();
              const newMed: any = {
                id,
                name,
                dosage: dosage || 'N/A',
                expirationDate,
                usageInstructions,
                createdAt: Date.now(),
                userId: user.uid,
                form: validForm,
                ...(addQty > 0 ? { quantity: addQty } : {}),
              };
              newMedsMap.set(key, newMed);
              count++;
            }
          }
        }
        
        try {
          // Process in chunks of 500 (Firestore batch limit)
          const CHUNK_SIZE = 500;
          
          // Combine all operations
          const allOperations: { type: 'set' | 'update', ref: any, data: any }[] = [];
          
          for (const [id, newQty] of existingUpdates.entries()) {
            allOperations.push({ type: 'update', ref: doc(db, 'medicines', id), data: { quantity: newQty } });
          }
          
          for (const newMed of newMedsMap.values()) {
            allOperations.push({ type: 'set', ref: doc(db, 'medicines', newMed.id), data: newMed });
          }

          if (allOperations.length > 0) {
            for (let i = 0; i < allOperations.length; i += CHUNK_SIZE) {
              const chunk = allOperations.slice(i, i + CHUNK_SIZE);
              const batch = writeBatch(db);
              chunk.forEach(op => {
                if (op.type === 'set') batch.set(op.ref, op.data);
                else batch.update(op.ref, op.data);
              });
              await batch.commit();
            }
            setAlertMessage(`Successfully imported ${count} new medicines and merged ${mergedCount} duplicates.`);
          } else {
            setAlertMessage("No valid medicines found to import.");
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, 'medicines');
        }
        
        // Reset input
        event.target.value = '';
      },
      error: (error) => {
        console.error("CSV Parse Error:", error);
        setAlertMessage("Failed to parse CSV file. Please ensure it's a valid Google Sheets export.");
      }
    });
  };

  const exportToSheets = () => {
    const activeMedicines = medicines.filter(m => !m.isDeleted);
    if (activeMedicines.length === 0) {
      setAlertMessage("No active medicines to export.");
      return;
    }

    const headers = ['Name', 'Dosage', 'Quantity', 'Expiration Date', 'Usage Instructions', 'Alert Formula'];
    const rows = activeMedicines.map((m, index) => [
      `"${m.name.replace(/"/g, '""')}"`,
      `"${m.dosage.replace(/"/g, '""')}"`,
      m.quantity !== undefined ? m.quantity.toString() : '',
      m.expirationDate,
      `"${m.usageInstructions.replace(/"/g, '""')}"`,
      `=IF(TODAY() >= (D${index + 2} - 90), "ALERT: 3 Months", IF(TODAY() >= (D${index + 2} - 10), "ALERT: 10 Days", "OK"))`
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

  const deletedMedicines = medicines.filter(m => m.isDeleted);

  const handlePermanentDelete = async (id: string) => {
    if (!user) return;
    try {
      const batch = writeBatch(db);
      
      // Delete all history documents
      const historyRef = collection(db, 'medicines', id, 'history');
      const historySnapshot = await getDocs(historyRef);
      historySnapshot.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      // Delete the medicine document
      batch.delete(doc(db, 'medicines', id));
      
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'medicines');
    }
  };

  // Cleanup old deleted medicines
  useEffect(() => {
    if (!user || deletedMedicines.length === 0) return;
    
    const cleanup = async () => {
      const now = Date.now();
      const fifteenDaysMs = 15 * 24 * 60 * 60 * 1000;
      
      const toDelete = deletedMedicines.filter(m => m.deletedAt && (now - m.deletedAt > fifteenDaysMs));
      
      if (toDelete.length > 0) {
        try {
          for (const m of toDelete) {
            await handlePermanentDelete(m.id);
          }
        } catch (error) {
          console.error("Cleanup error:", error);
        }
      }
    };
    
    cleanup();
  }, [user, deletedMedicines]);

  const handleRestore = async (id: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'medicines', id), {
        isDeleted: false,
        deletedAt: null
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'medicines');
    }
  };

  const filteredMedicines = medicines.filter(m => {
    if (m.isDeleted) return false;

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

    const effectiveThreshold = alertThreshold === 90 ? 92 : alertThreshold;

    if (filter === 'expired') return diffDays < 0;
    if (filter === 'expiring_soon') return diffDays >= 0 && diffDays <= 10;
    if (filter === 'expiring_3_months') return diffDays >= 0 && diffDays <= effectiveThreshold;
    
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

            <div className="pt-4">
              <button 
                onClick={() => {
                  setIsEmailLoginOpen(!isEmailLoginOpen);
                  setIsSignUp(false);
                }}
                className="text-white/40 text-xs hover:text-white transition-colors underline underline-offset-4"
              >
                {isEmailLoginOpen ? 'Hide Email Login' : 'Sign in with Email & Password'}
              </button>
              
              {isEmailLoginOpen && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 space-y-4 bg-white/[0.02] border border-white/10 rounded-[32px] p-6"
                >
                  <div className="flex gap-2 p-1 bg-white/5 rounded-2xl mb-2">
                    <button 
                      onClick={() => setIsSignUp(false)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${!isSignUp ? 'bg-white text-black' : 'text-white/40 hover:text-white'}`}
                    >
                      Login
                    </button>
                    <button 
                      onClick={() => setIsSignUp(true)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${isSignUp ? 'bg-white text-black' : 'text-white/40 hover:text-white'}`}
                    >
                      Sign Up
                    </button>
                  </div>

                  <form onSubmit={isSignUp ? handleEmailSignUp : handleEmailLogin} className="space-y-3">
                    <input 
                      id="auth-email"
                      name="email"
                      type="email" 
                      placeholder="Email Address"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 focus:outline-none focus:border-white/30 transition-all text-sm"
                      required
                    />
                    <input 
                      id="auth-password"
                      name="password"
                      type="password" 
                      placeholder="Password (min. 6 chars)"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 focus:outline-none focus:border-white/30 transition-all text-sm"
                      required
                    />
                    <button 
                      id="auth-submit-btn"
                      type="submit"
                      className="w-full py-4 bg-white text-black rounded-xl font-bold text-sm hover:bg-white/90 transition-all shadow-lg"
                    >
                      {isSignUp ? 'Create Account' : 'Sign In'}
                    </button>
                  </form>
                  
                  <p className="text-[10px] text-white/30 text-center leading-relaxed">
                    {isSignUp 
                      ? 'By creating an account, you agree to store your medicine data securely in our cloud vault.' 
                      : 'Welcome back! Your data will sync automatically.'}
                  </p>
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#0a0a0a] text-white font-sans selection:bg-white selection:text-black">
      {/* Glossy Header */}
      <header className="sticky top-0 z-40 bg-white/[0.01] backdrop-blur-3xl border-b border-white/5 px-4 py-4">
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
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-12 pr-12 focus:outline-none focus:border-white/30 transition-all placeholder:text-white/20 text-sm"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-4 flex items-center text-white/20 hover:text-white/60 transition-colors"
                title="Clear search"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto pt-6 pb-32">
        {/* Stats / Info */}
        <div className="px-4 mb-6 grid grid-cols-2 gap-4">
          <div className="bg-white/[0.02] backdrop-blur-2xl border border-white/10 rounded-3xl p-6 shadow-lg ring-1 ring-white/5">
            <p className="text-white/40 text-[10px] uppercase tracking-widest font-bold mb-1">Total Items</p>
            <p className="text-3xl font-bold tracking-tight">{medicines.length}</p>
          </div>
          <div className="bg-white/[0.02] backdrop-blur-2xl border border-white/10 rounded-3xl p-6 shadow-lg ring-1 ring-white/5">
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
                const effectiveThreshold = alertThreshold === 90 ? 92 : alertThreshold;
                return diffDays >= 0 && diffDays <= effectiveThreshold;
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
            className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wide whitespace-nowrap transition-all ${filter === 'expiring_3_months' ? 'bg-yellow-500' : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'}`}
            style={filter === 'expiring_3_months' ? { color: '#000000' } : {}}
          >
            {alertThreshold === 90 ? '< 3 Mo' : `< ${alertThreshold}d`}
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
          onReduceQuantity={handleReduceQuantity}
          onDeleteMultiple={handleDeleteMultiple}
          lowQuantityThreshold={lowQuantityThreshold}
          alertThreshold={alertThreshold}
        />
        <AdBanner slot="7890123456" />
      </main>

      {/* Floating Action Bar */}
      <div className="fixed bottom-6 left-0 right-0 z-40 px-6">
        <div className="max-w-[320px] mx-auto bg-white/[0.01] backdrop-blur-3xl border border-white/10 rounded-full p-2 flex items-center justify-between shadow-[0_20px_50px_rgba(0,0,0,0.5)] ring-1 ring-white/5">
          <button 
            onClick={handleAddManual}
            className="flex-1 py-2 flex flex-col items-center gap-1 transition-all"
            style={{ color: 'var(--accent-color)', opacity: 1 }}
          >
            <Plus size={20} />
            <span className="text-[9px] font-bold uppercase tracking-widest">Manual</span>
          </button>
          
          <div className="w-px h-8 bg-white/10 mx-1"></div>

          <button 
            onClick={() => setIsCameraOpen(true)}
            className="flex-none py-2 px-4 flex flex-col items-center justify-center gap-1 transition-all hover:scale-105 active:scale-95"
            style={{ color: 'var(--accent-color)' }}
          >
            <Camera size={20} />
            <span className="text-[9px] font-bold uppercase tracking-widest">Scan</span>
          </button>

          <div className="w-px h-8 bg-white/10 mx-1"></div>

          <button 
            onClick={() => setIsGuideOpen(true)}
            className="flex-1 py-2 flex flex-col items-center gap-1 transition-all"
            style={{ color: 'var(--accent-color)', opacity: 1 }}
          >
            <Info size={20} />
            <span className="text-[9px] font-bold uppercase tracking-widest">Guide</span>
          </button>
        </div>
      </div>

      {/* Modals */}
      <CookieConsentBanner />
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
            extractionWarning={extractionWarning}
            isSaving={isSaving}
            onClose={() => {
              setIsFormOpen(false);
              setEditingMedicine(null);
              setExtractionWarning(null);
            }}
          />
        )}

        {isSettingsOpen && (
          <SettingsModal 
            onClose={() => setIsSettingsOpen(false)}
            onClearData={confirmClearData}
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
                  setAlertMessage('Please allow notifications in your browser settings to use this feature.');
                  handleUpdateConfig({ browserNotificationsEnabled: false });
                }
              } else {
                handleUpdateConfig({ browserNotificationsEnabled: false });
              }
            }}
            theme={theme}
            setTheme={(val) => handleUpdateConfig({ theme: val })}
            userEmail={user.email || ''}
            onLogout={handleLogout}
            medicines={medicines}
            deletedMedicines={deletedMedicines}
            onRestore={handleRestore}
            onPermanentDelete={handlePermanentDelete}
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

                <section>
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <History size={18} className="text-white/40" />
                    History Log & Multi-Select
                  </h3>
                  <p className="text-white/50 text-sm leading-relaxed mb-4">
                    Tap the red clock icon when editing a medicine to view its complete history log. You can also select multiple medicines from the main list to delete them at once. Deleted items are kept in the <strong>Recently Deleted</strong> section in Settings for 15 days before permanent removal.
                  </p>
                </section>
                <section>
                  <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                    <ShieldAlert size={18} className="text-white/40" />
                    Cookie Policy & Privacy
                  </h3>
                  <p className="text-white/50 text-sm leading-relaxed mb-4">
                    We use cookies to enhance your experience and analyze app usage via Google Analytics. You can manage your cookie preferences at any time in the <strong>Settings</strong> menu under "Cookie Preferences". We do not sell your personal data.
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

        {alertMessage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-md"
          >
            <div className="w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-[32px] p-6 text-center">
              <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Info className="text-white" size={32} />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Notice</h3>
              <p className="text-white/60 text-sm mb-6">{alertMessage}</p>
              <button 
                onClick={() => setAlertMessage(null)}
                className="w-full py-3 bg-white text-black rounded-xl font-bold hover:bg-white/90 transition-all"
              >
                OK
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
