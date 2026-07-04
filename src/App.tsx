import React, { useState, useEffect } from 'react';
import { Plus, Camera, Download, Upload, Info, Settings, Search, X, History, Trash2, ShieldAlert, CheckCircle2, Bot, Stethoscope, Mail, Pill, BookOpen, Shield, Scale } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import { Medicine } from './types';
import { CameraCapture } from './components/CameraCapture';
import { MedicineForm } from './components/MedicineForm';
import { MedicineList } from './components/MedicineList';
import { SettingsModal } from './components/SettingsModal';
import { ChatView } from './components/ChatView';
import { MailboxModal } from './components/MailboxModal';
import { extractMedicineData } from './services/geminiService';
import { 
  auth, db, storage, googleProvider, signInWithPopup, signOut, onAuthStateChanged, 
  collection, doc, setDoc, addDoc, deleteDoc, updateDoc, writeBatch, onSnapshot, query, where, orderBy, getDoc, getDocs, User,
  handleFirestoreError, OperationType, deleteField, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  ref, uploadBytes, getDownloadURL, deleteObject, serverTimestamp, uploadBytesResumable
} from './firebase';
import { ErrorBoundary } from './components/ErrorBoundary';
import { checkDrugInteractions, InteractionResult } from './services/geminiService';

import { CookieConsentBanner } from './components/CookieConsentBanner';
import { DoctorLogo } from './components/DoctorLogo';

import { triggerLightHaptic, triggerSuccessHaptic } from './utils/haptics';
import { localImageStorage } from './services/localImageStorage';
import { sendEmailAlert, getExpiryEmailHTML, getLowStockEmailHTML } from './services/emailService';
import { trackEvent } from './utils/analytics';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isMailboxOpen, setIsMailboxOpen] = useState(false);
  const [editingMedicine, setEditingMedicine] = useState<Medicine | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extractionWarning, setExtractionWarning] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'expired' | 'expiring_soon' | 'expiring_3_months' | 'taken' | 'expiring_6_months'>('all');
  const [sortOrder, setSortOrder] = useState<'default' | 'asc' | 'desc'>('default');
  const [alertThreshold, setAlertThreshold] = useState(90);
  const [lowQuantityThreshold, setLowQuantityThreshold] = useState(5);
  const [accentColor, setAccentColor] = useState('#f97316');
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState(false);
  const [browserNotificationsEnabled, setBrowserNotificationsEnabled] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');
  const [isLikedOnly, setIsLikedOnly] = useState<boolean>(false);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [passwordResetEmailSent, setPasswordResetEmailSent] = useState<string | null>(null);
  const [activeFooterModal, setActiveFooterModal] = useState<'guide' | 'privacy' | 'terms' | null>(null);
  const [openedFromSettings, setOpenedFromSettings] = useState<boolean>(false);

  // Google Site Verification Dynamic Header Injection
  useEffect(() => {
    try {
      const savedToken = localStorage.getItem('google_site_verification_token');
      if (savedToken && savedToken.trim()) {
        const existing = document.querySelector('meta[name="google-site-verification"]');
        if (existing) existing.remove();
        
        const meta = document.createElement('meta');
        meta.name = 'google-site-verification';
        meta.content = savedToken.trim();
        document.head.appendChild(meta);
      }
    } catch (e) {
      console.warn('Failed to load Google Site Verification meta tag:', e);
    }
  }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isEmailLoginOpen, setIsEmailLoginOpen] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [interactionResult, setInteractionResult] = useState<InteractionResult | null>(null);
  const [isCheckingInteractions, setIsCheckingInteractions] = useState(false);
  const [isInteractionModalOpen, setIsInteractionModalOpen] = useState(false);

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
          accentColor: '#f97316',
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
      const medsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Medicine));
      // Deduplicate by ID to prevent React "duplicate key" warnings during sync lag or accidental duplicates
      const uniqueMeds = Array.from(new Map(medsData.map(m => [m.id, m])).values());
      setMedicines(uniqueMeds);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'medicines');
    });

    return () => unsubscribe();
  }, [user]);

  // Background Notification Check (Browser and Email)
  useEffect(() => {
    if (medicines.length === 0) return;

    const checkAndNotify = async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayStr = today.toISOString().split('T')[0];

      // 1. Browser Notification Alert
      const hasNotification = typeof window !== 'undefined' && 'Notification' in window && typeof Notification !== 'undefined';
      if (browserNotificationsEnabled && hasNotification && Notification.permission === 'granted') {
        const expiringMeds = medicines.filter(m => {
          if (m.isDeleted) return false;
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
          
          return diffDays === effectiveThreshold || diffDays === 10 || diffDays === 0;
        });

        if (expiringMeds.length > 0) {
          let lastNotifiedDate = null;
          try {
            lastNotifiedDate = localStorage.getItem('dawalens_ai_last_notified');
          } catch (e) {
            console.warn('LocalStorage access denied:', e);
          }
          
          if (lastNotifiedDate !== todayStr) {
            const medNames = expiringMeds.map(m => m.name).join(', ');
            try {
              new Notification('DawaLens AI Alert', {
                body: `You have ${expiringMeds.length} medicine(s) expiring soon: ${medNames}`,
                icon: '/favicon.ico'
              });
              localStorage.setItem('dawalens_ai_last_notified', todayStr);
            } catch (e) {
              console.error('Failed to trigger notification:', e);
            }
          }
        }
      }

      // 2. Email Notification Alerts
      if (emailNotificationsEnabled && user?.email) {
        // A. Filter medicines for expiration alerts
        const expiringMeds = medicines.filter(m => {
          if (m.isDeleted) return false;
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
          
          return diffDays === effectiveThreshold || diffDays === 10 || diffDays === 0;
        });

        // B. Filter medicines for low quantity alerts
        const lowQuantityMeds = medicines.filter(m => {
          if (m.isDeleted) return false;
          return m.quantity !== undefined && m.quantity <= lowQuantityThreshold;
        });

        // Format helper for expiry month & year
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

        const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;

        // Loop expiring meds and trigger if not already sent in the last 7 days
        for (const m of expiringMeds) {
          const storageKey = `dawalens_ai_email_exp_sent_${m.id}`;
          const lastSentStr = localStorage.getItem(storageKey);
          let shouldSend = true;
          if (lastSentStr) {
            const lastSentTime = Number(lastSentStr);
            if (!isNaN(lastSentTime) && (Date.now() - lastSentTime < sevenDaysInMs)) {
              shouldSend = false;
            }
          }

          if (shouldSend) {
            try {
              const formattedExpiry = formatExpiryMonthYear(m.expirationDate);
              const subject = `Expiry Alert: ${m.name} is Expiring Soon`;
              const text = `DawaLens AI alert: Your medicine ${m.name} is expiring soon.`;
              const html = getExpiryEmailHTML(m.name, m.quantity || "N/A", m.expirationDate);

              await sendEmailAlert({
                to: user.email,
                subject,
                text,
                html
              });
              localStorage.setItem(storageKey, String(Date.now()));
            } catch (err) {
              console.error("Auto expiry email alert failed:", err);
            }
          }
        }

        // Loop low quantity meds and trigger if not already sent in the last 7 days
        for (const m of lowQuantityMeds) {
          const storageKey = `dawalens_ai_email_qty_sent_${m.id}`;
          const lastSentStr = localStorage.getItem(storageKey);
          let shouldSend = true;
          if (lastSentStr) {
            const lastSentTime = Number(lastSentStr);
            if (!isNaN(lastSentTime) && (Date.now() - lastSentTime < sevenDaysInMs)) {
              shouldSend = false;
            }
          }

          if (shouldSend) {
            try {
              const subject = `Refill Required: ${m.name} is Low on Stock`;
              const text = `DawaLens AI alert: Your medicine ${m.name} quantity is down to ${m.quantity}. Please replenish your stocks soon.`;
              const html = getLowStockEmailHTML(m.name, m.quantity, lowQuantityThreshold);

              await sendEmailAlert({
                to: user.email,
                subject,
                text,
                html
              });
              localStorage.setItem(storageKey, String(Date.now()));
            } catch (err) {
              console.error("Auto quantity email alert failed:", err);
            }
          }
        }
      }
    };

    // Check immediately on load/change
    checkAndNotify();

    // Then check periodically (e.g., every 12 hours)
    const interval = setInterval(checkAndNotify, 12 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [medicines, browserNotificationsEnabled, emailNotificationsEnabled, alertThreshold, lowQuantityThreshold, user]);

  useEffect(() => {
    const applyThemeAndAccent = () => {
      document.documentElement.classList.remove('dark');
      let color = accentColor;
      if (color === '#ffffff') {
        color = '#111827';
      }
      document.documentElement.style.setProperty('--accent-color', color);
    };

    applyThemeAndAccent();
  }, [accentColor]);

  useEffect(() => {
    if (user) {
      const hasNotification = typeof window !== 'undefined' && 'Notification' in window && typeof Notification !== 'undefined';
      // Request notification permission
      if (hasNotification && Notification.permission === 'default') {
        Notification.requestPermission();
      }

      // Check for expiring medicines and notify
      const checkExpiring = () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        medicines.forEach(med => {
          if (med.taken || med.isDeleted) return;
          
          const [year, month, day] = med.expirationDate.split('-').map(Number);
          const expiry = new Date(year, month - 1, day);
          expiry.setHours(0, 0, 0, 0);
          
          const diffTime = expiry.getTime() - today.getTime();
          const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
          
          if (diffDays >= 0 && diffDays <= 7) {
            if (hasNotification && Notification.permission === 'granted') {
              new window.Notification('Medicine Expiring Soon', {
                body: `${med.name} expires in ${diffDays} days.`,
                icon: '/favicon.ico'
              });
            }
          }
        });
      };

      // Run check once on load after medicines are fetched
      if (medicines.length > 0) {
        const lastCheck = localStorage.getItem('lastExpiryCheck');
        const todayStr = new Date().toDateString();
        if (lastCheck !== todayStr) {
          checkExpiring();
          localStorage.setItem('lastExpiryCheck', todayStr);
        }
      }
    }
  }, [user, medicines]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      trackEvent('login', { method: 'google' });
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
      trackEvent('login', { method: 'email' });
    } catch (error: any) {
      console.warn('Email login warning:', error);
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
      trackEvent('sign_up', { method: 'email' });
    } catch (error: any) {
      console.warn('Email sign up warning:', error);
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

  const handlePasswordReset = async () => {
    if (!email || !email.trim()) {
      setAlertMessage('Please enter your email address in the input field first, then click "Forgot Password" to receive a reset link.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setPasswordResetEmailSent(email.trim());
      trackEvent('password_reset');
    } catch (error: any) {
      console.warn('Password reset warning:', error);
      if (error.code === 'auth/user-not-found') {
        setAlertMessage('No user account found with this email address.');
      } else if (error.code === 'auth/invalid-email') {
        setAlertMessage('Please enter a valid email address.');
      } else {
        setAlertMessage('Failed to send password reset email: ' + (error.message || String(error)));
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      trackEvent('logout');
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

  const base64ToBlob = (base64: string, mimeType: string) => {
    const byteCharacters = atob(base64.split(',')[1]);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  };

  const handleCheckInteractions = async () => {
    if (medicines.length < 2) {
      setAlertMessage("You need at least 2 medicines to check for interactions.");
      return;
    }

    setIsCheckingInteractions(true);
    try {
      const activeMedicines = medicines.filter(m => !m.isDeleted);
      const result = await checkDrugInteractions(activeMedicines.map(m => ({ name: m.name, dosage: m.dosage })));
      setInteractionResult(result);
      setIsInteractionModalOpen(true);
      trackEvent('check_interactions', { count: activeMedicines.length });
    } catch (error) {
      console.error("Interaction check failed:", error);
      setAlertMessage("Failed to check interactions. Please try again.");
    } finally {
      setIsCheckingInteractions(false);
    }
  };

  const handleSave = async (data: Partial<Medicine>) => {
    if (!user || isSaving) return;
    setIsSaving(true);

    try {
      const { capturedImage, ...firestoreData } = data;
      let imageUrl = data.imageUrl;
      let localImageToSave: string | null = null;

      if (capturedImage && capturedImage.startsWith('data:image')) {
        imageUrl = 'local';
        localImageToSave = capturedImage;
      }

      const normalizedName = (firestoreData.name || '').toLowerCase().trim();
      const existingMed = medicines.find(m => 
        m.name.toLowerCase().trim() === normalizedName &&
        m.expirationDate === firestoreData.expirationDate &&
        (!editingMedicine || m.id !== editingMedicine.id)
      );

      const batch = writeBatch(db);
      let targetId = '';

      if (existingMed) {
        targetId = existingMed.id;
        const medRef = doc(db, 'medicines', existingMed.id);
        const currentQty = existingMed.quantity || 0;
        const addedQty = firestoreData.quantity || 0;
        const newQuantity = currentQty + addedQty;

        const updateData: any = { 
          quantity: newQuantity,
          userId: user.uid,
          imageUrl: imageUrl || existingMed.imageUrl || null,
          updatedAt: serverTimestamp() // Ensure cloud sync timestamp
        };

        if (existingMed.dosage === 'N/A' && firestoreData.dosage) {
          updateData.dosage = firestoreData.dosage;
        }
        if (!existingMed.usageInstructions && firestoreData.usageInstructions) {
          updateData.usageInstructions = firestoreData.usageInstructions;
        }
        if (firestoreData.schedule || existingMed.schedule) {
          updateData.schedule = firestoreData.schedule || existingMed.schedule || null;
        }

        batch.set(medRef, updateData, { merge: true });

        const historyId = crypto.randomUUID();
        batch.set(doc(db, `medicines/${existingMed.id}/history`, historyId), {
          id: historyId,
          medicineId: existingMed.id,
          userId: user.uid,
          timestamp: Date.now(),
          actionType: 'EDIT',
          details: `Cloud Sync: Merged duplicates. Quantity updated to ${newQuantity}.`
        });

        if (editingMedicine && editingMedicine.id) {
          batch.delete(doc(db, 'medicines', editingMedicine.id));
        }
      } else if (editingMedicine && editingMedicine.id) {
        targetId = editingMedicine.id;
        const medRef = doc(db, 'medicines', editingMedicine.id);
        const updateData: any = { 
          ...editingMedicine, 
          ...firestoreData, 
          userId: user.uid,
          imageUrl: imageUrl || editingMedicine.imageUrl || null,
          updatedAt: serverTimestamp()
        };

        Object.keys(updateData).forEach(key => {
          if (updateData[key] === undefined) {
            updateData[key] = deleteField();
          }
        });
        batch.set(medRef, updateData, { merge: true });
        
        const changes: string[] = [];
        if (editingMedicine.quantity !== data.quantity) changes.push(`Qty: ${data.quantity}`);
        if (editingMedicine.expirationDate !== data.expirationDate) changes.push(`Exp: ${data.expirationDate}`);
        
        const historyId = crypto.randomUUID();
        batch.set(doc(db, `medicines/${editingMedicine.id}/history`, historyId), {
          id: historyId,
          medicineId: editingMedicine.id,
          userId: user.uid,
          timestamp: Date.now(),
          actionType: 'EDIT',
          details: `Cloud Update: ${changes.join(', ') || 'Metadata updated'}`
        });
      } else {
        const id = crypto.randomUUID();
        targetId = id;
        const newMed: any = {
          id,
          name: firestoreData.name || 'Unknown',
          dosage: firestoreData.dosage || 'N/A',
          expirationDate: firestoreData.expirationDate || new Date().toISOString().split('T')[0],
          usageInstructions: firestoreData.usageInstructions || '',
          schedule: firestoreData.schedule || '',
          createdAt: serverTimestamp(),
          userId: user.uid,
          form: firestoreData.form || 'other',
          imageUrl: imageUrl || null
        };

        if (firestoreData.quantity !== undefined) {
          newMed.quantity = firestoreData.quantity;
        }

        batch.set(doc(db, 'medicines', id), newMed);

        const historyId = crypto.randomUUID();
        batch.set(doc(db, `medicines/${id}/history`, historyId), {
          id: historyId,
          medicineId: id,
          userId: user.uid,
          timestamp: Date.now(),
          actionType: 'CREATE',
          details: 'Initial cloud record created.'
        });
      }

      // Commit all changes in ONE atomic operation
      await batch.commit();

      trackEvent('save_medication', { 
        name: data.name || 'Unknown', 
        form: data.form || 'other',
        is_edit: !!editingMedicine
      });

      if (localImageToSave && targetId) {
        await localImageStorage.saveImage(targetId, localImageToSave);
      }

      triggerSuccessHaptic();

      setIsFormOpen(false);
      setEditingMedicine(null);
      setExtractionWarning(null);
    } catch (error: any) {
      console.error('Cloud Save Error:', error);
      setAlertMessage("Cloud sync failed. Please check your internet connection.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    try {
      const medToDelete = medicines.find(m => m.id === id);
      if (medToDelete?.imageUrl && medToDelete.imageUrl !== 'local') {
        try {
          const imageRef = ref(storage, medToDelete.imageUrl);
          await deleteObject(imageRef);
        } catch (storageError) {
          console.error("Error deleting image from storage:", storageError);
          // Continue with medicine deletion even if image deletion fails
        }
      }

      await updateDoc(doc(db, 'medicines', id), {
        isDeleted: true,
        deletedAt: Date.now()
      });
      trackEvent('delete_medication', { name: medToDelete?.name || 'Unknown' });
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
      triggerSuccessHaptic();
      trackEvent('toggle_taken', { name: medicine.name, is_taken: !medicine.taken });

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

  const handleToggleLike = async (medicine: Medicine) => {
    if (!user) return;
    const originalLiked = !!medicine.liked;
    const newLiked = !originalLiked;

    // 1. Optimistic Update - immediately toggle state for instant UI response
    setMedicines(prev => prev.map(m => m.id === medicine.id ? { ...m, liked: newLiked } : m));
    triggerSuccessHaptic();

    try {
      const medRef = doc(db, 'medicines', medicine.id);
      await updateDoc(medRef, { liked: newLiked });
    } catch (error) {
      // 2. Rollback state if the backend save fails (e.g. offline/permission error)
      setMedicines(prev => prev.map(m => m.id === medicine.id ? { ...m, liked: originalLiked } : m));
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
      triggerSuccessHaptic();

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
      trackEvent('capture_image', { success: true, name: result.medicine.name || 'Unknown' });
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
      trackEvent('capture_image', { success: false, error: result.errorMessage || "Failed extraction" });
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
                ...(quantity !== undefined && !isNaN(quantity) ? { quantity: addQty } : {}),
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
            trackEvent('import_csv', { count, merged_count: mergedCount });
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

    const data = activeMedicines.map((m, index) => ({
      'Name': m.name,
      'Dosage': m.dosage,
      'Quantity': m.quantity !== undefined ? m.quantity : '',
      'Expiration Date': m.expirationDate,
      'Usage Instructions': m.usageInstructions,
      'Alert Formula': `=IF(TODAY() >= (D${index + 2} - 90), "ALERT: 3 Months", IF(TODAY() >= (D${index + 2} - 10), "ALERT: 10 Days", "OK"))`
    }));

    const csvContent = Papa.unparse(data);
    trackEvent('export_sheets', { count: activeMedicines.length });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `dawalens_ai_export_${new Date().toISOString().split('T')[0]}.csv`);
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

      // Clean up local image storage
      await localImageStorage.deleteImage(id);
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

  const filteredMedicines = React.useMemo(() => {
    return medicines.filter(m => {
      if (m.isDeleted) return false;
      if (isLikedOnly && !m.liked) return false;

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
      if (filter === 'expiring_6_months') return diffDays >= 0 && diffDays <= 180;
      if (filter === 'taken') return m.taken === true;
      
      // Default: hide taken medicines in other filters unless explicitly selected
      if (filter !== 'taken' && m.taken) return false;
      
      return true;
    }).sort((a, b) => {
      if (sortOrder === 'asc') return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      if (sortOrder === 'desc') return b.name.toLowerCase().localeCompare(a.name.toLowerCase());
      return 0;
    });
  }, [medicines, searchQuery, filter, sortOrder, alertThreshold, isLikedOnly]);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#faf8f5] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-[#e3e2e0] border-t-[#0f9d58] rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#faf8f5] text-[#1f1f1f] font-sans flex flex-col items-center justify-between p-6">
        <div className="flex-1 flex flex-col items-center justify-center max-w-md w-full text-center space-y-8 my-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="space-y-4"
          >
            <div className="w-24 h-24 bg-white border border-[#e3e2e0] rounded-[32px] mx-auto flex items-center justify-center shadow-md">
              <Camera className="text-[#0f9d58]" size={42} />
            </div>
            <h1 className="text-5xl font-black tracking-tight text-[#0f9d58]">
              DawaLens AI
            </h1>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-[0.2em]">
              Your AI Medicine Vault
            </p>
          </motion.div>

          <div className="space-y-6 w-full">
            <p className="text-slate-600 text-sm leading-relaxed font-medium">
              Securely store your medicine data in the cloud. Access your vault from any device, anytime.
            </p>
            <button
              onClick={handleLogin}
              className="w-full py-4.5 bg-white text-slate-800 border border-[#e3e2e0] rounded-[24px] font-bold text-base hover:bg-slate-50 transition-all shadow-sm flex items-center justify-center gap-3 active:scale-98"
            >
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
              Sign in with Google
            </button>

            <div className="pt-2">
              <button 
                onClick={() => {
                  setIsEmailLoginOpen(!isEmailLoginOpen);
                  setIsSignUp(false);
                }}
                className="text-slate-500 text-xs hover:text-[#0f9d58] transition-colors underline underline-offset-4 font-bold"
              >
                {isEmailLoginOpen ? 'Hide Email Login' : 'Sign in with Email & Password'}
              </button>
              
              {isEmailLoginOpen && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-6 space-y-4 bg-white border border-[#e3e2e0] rounded-[32px] p-6 shadow-sm text-left"
                >
                  <div className="flex gap-2 p-1 bg-[#faf8f5] border border-[#e3e2e0]/60 rounded-2xl mb-2">
                    <button 
                      onClick={() => setIsSignUp(false)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${!isSignUp ? 'bg-[#0f9d58] text-white shadow-xs' : 'text-slate-500 hover:text-[#0f9d58]'}`}
                    >
                      Login
                    </button>
                    <button 
                      onClick={() => setIsSignUp(true)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${isSignUp ? 'bg-[#0f9d58] text-white shadow-xs' : 'text-slate-500 hover:text-[#0f9d58]'}`}
                    >
                      Sign Up
                    </button>
                  </div>

                  <form onSubmit={isSignUp ? handleEmailSignUp : handleEmailLogin} className="space-y-3">
                    <input 
                      id="auth-email"
                      name="email"
                      type="email" 
                      placeholder="Email address"
                      value={email || ''}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-white border border-[#e3e2e0] rounded-xl py-3 px-4 focus:outline-none focus:border-[#0f9d58] focus:ring-2 focus:ring-[#0f9d58]/10 transition-all text-sm text-[#1f1f1f] placeholder:text-slate-400"
                      required
                    />
                    <input 
                      id="auth-password"
                      name="password"
                      type="password" 
                      placeholder="Password (min. 6 chars)"
                      value={password || ''}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-white border border-[#e3e2e0] rounded-xl py-3 px-4 focus:outline-none focus:border-[#0f9d58] focus:ring-2 focus:ring-[#0f9d58]/10 transition-all text-sm text-[#1f1f1f] placeholder:text-slate-400"
                      required
                    />

                    <div className="flex justify-end px-1 pt-1">
                      <button
                        id="auth-forgot-password-btn"
                        type="button"
                        onClick={handlePasswordReset}
                        className="text-xs font-bold text-slate-500 hover:text-[#0f9d58] transition-colors underline underline-offset-2"
                      >
                        Forgot Password?
                      </button>
                    </div>

                    <button 
                      id="auth-submit-btn"
                      type="submit"
                      className="w-full py-3.5 bg-[#0f9d58] hover:bg-[#0f9d58]/90 text-white rounded-xl font-bold text-sm transition-all shadow-sm active:scale-98"
                    >
                      {isSignUp ? 'Create Account' : 'Sign In'}
                    </button>
                  </form>
                  
                  <p className="text-[10px] text-slate-400 text-center leading-relaxed font-semibold">
                    {isSignUp 
                      ? 'By creating an account, you agree to store your medicine data securely in our cloud vault.' 
                      : 'Welcome back! Your data will sync automatically.'}
                  </p>
                </motion.div>
              )}
            </div>
          </div>
        </div>

        {/* Visible compliance footer on the homepage */}
        <footer className="w-full max-w-md border-t border-[#e3e2e0]/60 mt-12 pt-4 pb-2 flex flex-col sm:flex-row justify-between items-center gap-2 text-[11px] text-slate-400 font-bold">
          <div>&copy; 2026 DawaLens AI. All rights reserved.</div>
          <div className="flex gap-4">
            <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="hover:text-[#0f9d58] hover:underline">
              Privacy Policy
            </a>
            <a href="/terms.html" target="_blank" rel="noopener noreferrer" className="hover:text-[#0f9d58] hover:underline">
              Terms of Service
            </a>
          </div>
        </footer>

        {/* Global Dialogues & Popups for the Login/Signup Screen */}
        <AnimatePresence>
          {alertMessage && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm"
            >
              <div className="w-full max-w-sm bg-[#faf8f5] border border-[#e3e2e0] rounded-[32px] p-6 text-center shadow-2xl">
                <div className="w-16 h-16 bg-[#0f9d58]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Info className="text-[#0f9d58]" size={32} />
                </div>
                <h3 className="text-xl font-bold text-[#1f1f1f] mb-2">Notice</h3>
                <p className="text-slate-600 text-sm mb-6">{alertMessage}</p>
                <button 
                  onClick={() => setAlertMessage(null)}
                  className="w-full py-3 bg-[#0f9d58] text-white rounded-xl font-bold hover:bg-[#0f9d58]/95 transition-all shadow-sm"
                >
                  OK
                </button>
              </div>
            </motion.div>
          )}

          {passwordResetEmailSent && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm"
            >
              <div className="w-full max-w-sm bg-white border border-[#e3e2e0] rounded-[32px] p-6 text-center shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-2 bg-[#0f9d58]" />
                
                <div className="w-16 h-16 bg-[#0f9d58]/10 rounded-full flex items-center justify-center mx-auto mb-4 mt-2">
                  <Mail className="text-[#0f9d58]" size={32} />
                </div>
                
                <h3 className="text-xl font-bold text-[#1f1f1f] mb-2">Check Your Email</h3>
                
                <p className="text-slate-600 text-sm leading-relaxed mb-4">
                  We've sent a secure link to reset your password to:
                </p>
                
                <div className="bg-slate-50 border border-slate-100 rounded-xl py-2 px-3 mb-5 inline-block max-w-full">
                  <span className="font-mono text-xs text-slate-800 break-all font-bold select-all">
                    {passwordResetEmailSent}
                  </span>
                </div>
                
                <p className="text-slate-500 text-[13px] leading-relaxed mb-6">
                  Please look for a link sent through your mail. Check your inbox and spam folder to complete resetting your password.
                </p>
                
                <button 
                  onClick={() => setPasswordResetEmailSent(null)}
                  className="w-full py-3 bg-[#0f9d58] text-white rounded-xl font-bold hover:bg-[#0f9d58]/95 transition-all shadow-sm active:scale-[0.98]"
                >
                  Got It, Thanks!
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  const handleCloseFooterModal = () => {
    setActiveFooterModal(null);
    if (openedFromSettings) {
      setIsSettingsOpen(true);
      setOpenedFromSettings(false);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col bg-[#faf8f5] text-[#1f1f1f] font-sans selection:bg-[#0f9d58] selection:text-white">
      {/* Glossy Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-[#e3e2e0]/80 px-3 py-3 sm:px-4 sm:py-4 shadow-sm">
        <div className="max-w-2xl mx-auto space-y-3 sm:space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[#0f9d58]">
                DawaLens AI
              </h1>
              <p className="text-[#5f6368] text-[7px] sm:text-[10px] font-bold uppercase tracking-[0.2em] mt-0.5 sm:mt-1">
                Your Digital Pharmacy
              </p>
            </div>
            <div className="flex gap-2 items-center">
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full overflow-hidden border-2 border-[#e3e2e0] hover:border-[#0f9d58] transition-all flex items-center justify-center bg-[#faf8f5] shadow-xs relative group shrink-0"
                title={`Google Account: ${user?.email || ''}`}
              >
                <img 
                  src={user?.photoURL || "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=120&h=120"} 
                  alt="Profile" 
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-black/5 group-hover:bg-black/0 transition-colors" />
              </button>
            </div>
          </div>
          
          {/* Search Bar moved to Navbar */}
          <div className="relative group">
            <div className="absolute inset-y-0 left-3 sm:left-4 flex items-center pointer-events-none text-slate-400 group-focus-within:text-[#0f9d58] transition-colors">
              <Search size={16} className="sm:w-[18px] sm:h-[18px]" />
            </div>
            <input 
              type="text" 
              placeholder="Search medications..."
              value={searchQuery || ''}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-[#e3e2e0] text-[#1f1f1f] placeholder-slate-400 focus:outline-none focus:border-[#0f9d58] focus:ring-2 focus:ring-[#0f9d58]/10 transition-all rounded-2xl py-2.5 sm:py-3 pl-10 sm:pl-12 pr-10 sm:pr-12 text-xs sm:text-sm shadow-xs"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-3 sm:right-4 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                title="Clear search"
              >
                <X size={16} className="sm:w-[18px] sm:h-[18px]" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto pt-6 pb-32">
        {/* Stats / Info */}
        <div className="px-4 mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-[#e3e2e0] rounded-2xl p-3.5 shadow-sm">
            <p className="text-slate-500 text-[10px] sm:text-[11px] uppercase tracking-wider font-extrabold mb-1">Total</p>
            <p className="text-xl sm:text-2xl font-black text-[#1f1f1f] tracking-tight">{medicines.length}</p>
          </div>
          <div className="bg-white border border-[#e3e2e0] rounded-2xl p-3.5 shadow-sm">
            <p className="text-slate-500 text-[10px] sm:text-[11px] uppercase tracking-wider font-extrabold mb-1">Unique</p>
            <p className="text-xl sm:text-2xl font-black text-[#1a73e8] tracking-tight">
              {new Set(medicines.map(m => m.name.toLowerCase().trim())).size}
            </p>
          </div>
          <div className="bg-white border border-[#e3e2e0] rounded-2xl p-3.5 shadow-sm">
            <p className="text-slate-500 text-[10px] sm:text-[11px] uppercase tracking-wider font-extrabold mb-1">Expiring</p>
            <p className="text-xl sm:text-2xl font-black text-[#f2a154] tracking-tight">
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
          <div className="bg-white border border-[#e3e2e0] rounded-2xl p-3.5 shadow-sm">
            <p className="text-slate-500 text-[10px] sm:text-[11px] uppercase tracking-wider font-extrabold mb-1">Taken</p>
            <p className="text-xl sm:text-2xl font-black text-[#0f9d58] tracking-tight">
              {medicines.filter(m => m.taken).length}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="px-4 mb-6 flex flex-wrap gap-2">
          <button 
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide border transition-all ${filter === 'all' ? 'bg-[#0f9d58] text-white border-transparent shadow-xs' : 'bg-white hover:bg-slate-50 border-[#e3e2e0] text-slate-600 hover:text-slate-800'}`}
          >
            All
          </button>
          <button 
            onClick={() => setFilter('expired')}
            className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide border transition-all ${filter === 'expired' ? 'bg-[#ea4335] text-white border-transparent shadow-xs' : 'bg-white hover:bg-slate-50 border-[#e3e2e0] text-slate-600 hover:text-slate-800'}`}
          >
            Expired
          </button>
          <button 
            onClick={() => setFilter('expiring_soon')}
            className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide border transition-all ${filter === 'expiring_soon' ? 'bg-[#f2a154] text-white border-transparent shadow-xs' : 'bg-white hover:bg-slate-50 border-[#e3e2e0] text-slate-600 hover:text-slate-800'}`}
          >
            Soon
          </button>
          <div className="w-px h-6 bg-[#e3e2e0] mx-1 self-center shrink-0"></div>
          <button 
            onClick={() => {
              const nextOrder = sortOrder === 'default' ? 'asc' : sortOrder === 'asc' ? 'desc' : 'default';
              setSortOrder(nextOrder);
              handleUpdateConfig({ sortOrder: nextOrder });
            }}
            className={`px-3 py-1.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide border transition-all ${sortOrder !== 'default' ? 'bg-[#0f9d58] text-white border-transparent shadow-xs' : 'bg-white hover:bg-slate-50 border-[#e3e2e0] text-slate-600 hover:text-slate-800'}`}
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
          onToggleLike={handleToggleLike}
        />

        {/* Dynamic & Compliant Footer within main app view */}
        <footer className="mt-12 px-4 pb-4 border-t border-[#e3e2e0]/40 pt-4 flex flex-col sm:flex-row justify-between items-center gap-2 text-[11px] text-slate-400 font-bold">
          <div>&copy; 2026 DawaLens AI. All rights reserved.</div>
          <div className="flex gap-4">
            <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className="hover:text-[#0f9d58] hover:underline">
              Privacy Policy
            </a>
            <a href="/terms.html" target="_blank" rel="noopener noreferrer" className="hover:text-[#0f9d58] hover:underline">
              Terms of Service
            </a>
          </div>
        </footer>

      </main>

      {/* Floating Action Bar */}
      <div className="fixed bottom-6 left-0 right-0 z-40 px-6">
        <div className="max-w-[320px] mx-auto bg-white/95 backdrop-blur-md border border-[#e3e2e0] rounded-full p-2 flex items-center justify-between shadow-[0_12px_40px_rgba(0,0,0,0.06)]">
          <button 
            onClick={handleAddManual}
            className="flex-1 py-2 flex flex-col items-center gap-1 transition-all hover:opacity-80"
            style={{ color: 'var(--accent-color)', opacity: 1 }}
          >
            <Plus size={20} />
            <span className="text-[9px] font-bold uppercase tracking-widest">Manual</span>
          </button>
          
          <div className="w-px h-8 bg-slate-200 mx-1"></div>

          <button 
            onClick={() => {
              triggerLightHaptic();
              setIsCameraOpen(true);
            }}
            className="flex-1 py-2 flex flex-col items-center gap-1 transition-all hover:opacity-80"
            style={{ color: 'var(--accent-color)' }}
          >
            <Camera size={20} />
            <span className="text-[9px] font-bold uppercase tracking-widest">Scan</span>
          </button>

          <div className="w-px h-8 bg-slate-200 mx-1"></div>

          <button 
            onClick={() => setIsChatOpen(true)}
            className="flex-1 py-2 flex flex-col items-center gap-1 transition-all hover:opacity-80"
            style={{ color: 'var(--accent-color)' }}
          >
            <DoctorLogo className="w-5 h-5" />
            <span className="text-[9px] font-bold uppercase tracking-widest">Consult</span>
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
            allMedicines={medicines}
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

        {isChatOpen && (
          <ChatView 
            medicines={medicines}
            onClose={() => setIsChatOpen(false)}
            user={user}
            userPhoto={user?.photoURL}
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
                if (!('Notification' in window)) {
                  setAlertMessage('Notifications are not supported in this browser.');
                  return;
                }
                try {
                  const permission = await Notification.requestPermission();
                  if (permission === 'granted') {
                    handleUpdateConfig({ browserNotificationsEnabled: true });
                  } else {
                    setAlertMessage('Please allow notifications in your browser settings to use this feature.');
                    handleUpdateConfig({ browserNotificationsEnabled: false });
                  }
                } catch (e) {
                  console.error('Notification permission error:', e);
                  setAlertMessage('An error occurred while requesting notification permission. It might be blocked by your browser or iframe settings.');
                }
              } else {
                handleUpdateConfig({ browserNotificationsEnabled: false });
              }
            }}
            photoURL={user?.photoURL || undefined}
            userEmail={user.email || ''}
            onLogout={handleLogout}
            medicines={medicines}
            deletedMedicines={deletedMedicines}
            onRestore={handleRestore}
            onPermanentDelete={handlePermanentDelete}
            // Integrations
            onImportCSV={handleImport}
            onExportCSV={exportToSheets}
            onOpenMailbox={() => setIsMailboxOpen(true)}
            // Screenshot navigation matching
            onResetToHome={() => { setFilter('all'); setSearchQuery(''); setIsLikedOnly(false); }}
            onToggleLikedOnly={() => setIsLikedOnly(!isLikedOnly)}
            isLikedOnly={isLikedOnly}
            onOpenGuide={() => { triggerLightHaptic(); setOpenedFromSettings(true); setActiveFooterModal('guide'); }}
            onOpenPrivacy={() => { triggerLightHaptic(); setOpenedFromSettings(true); setActiveFooterModal('privacy'); }}
            onOpenTerms={() => { triggerLightHaptic(); setOpenedFromSettings(true); setActiveFooterModal('terms'); }}
          />
        )}

        {isMailboxOpen && (
          <MailboxModal 
            onClose={() => setIsMailboxOpen(false)}
            user={user}
            medicines={medicines}
          />
        )}

        {isInteractionModalOpen && interactionResult && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm overflow-y-auto"
          >
            <div className="w-full max-w-lg bg-[#faf8f5] border border-[#e3e2e0] rounded-[32px] p-8 shadow-2xl my-auto">
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-50 rounded-full flex items-center justify-center">
                    <ShieldAlert className="text-[#0f9d58]" size={20} />
                  </div>
                  <h3 className="text-xl font-bold text-[#1f1f1f] tracking-tight">Safety Analysis</h3>
                </div>
                <button 
                  onClick={() => setIsInteractionModalOpen(false)}
                  className="p-2 text-slate-400 hover:text-slate-800 transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-6">
                <div className="bg-white border border-[#e3e2e0] rounded-2xl p-4">
                  <p className="text-slate-600 text-sm leading-relaxed">
                    Our AI has analyzed your current medications for potential interactions. 
                    <span className="block mt-2 text-[10px] uppercase tracking-widest font-bold text-slate-400">Disclaimer: This is for informational purposes only. Always consult a doctor.</span>
                  </p>
                </div>

                {interactionResult.interactions.length > 0 ? (
                  <div className="space-y-4 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
                    {interactionResult.interactions.map((interaction, idx) => (
                      <div key={`interaction-${idx}`} className="bg-white border border-[#e3e2e0]/60 rounded-2xl p-4">
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="text-[#1f1f1f] font-semibold text-sm">{interaction.medications.join(' + ')}</h4>
                          <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                            interaction.severity === 'high' ? 'bg-red-50 text-red-700' :
                            interaction.severity === 'moderate' ? 'bg-orange-50 text-orange-700' :
                            'bg-blue-50 text-blue-700'
                          }`}>
                            {interaction.severity}
                          </span>
                        </div>
                        <p className="text-slate-500 text-xs leading-relaxed">{interaction.description}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-10 text-center">
                    <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 className="text-emerald-600" size={32} />
                    </div>
                    <p className="text-[#1f1f1f] font-medium">No significant interactions found</p>
                    <p className="text-slate-400 text-xs mt-1">Based on your current medication list.</p>
                  </div>
                )}

                <div className="pt-2 border-t border-[#e3e2e0]">
                  <h4 className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-3">General Advice</h4>
                  <p className="text-slate-500 text-xs leading-relaxed italic">
                    {interactionResult.generalAdvice}
                  </p>
                </div>
              </div>

              <button 
                onClick={() => setIsInteractionModalOpen(false)}
                className="w-full mt-8 py-4 bg-[#0f9d58] text-white rounded-full font-bold hover:bg-[#0f9d58]/95 transition-all shadow-sm"
              >
                Close Analysis
              </button>
            </div>
          </motion.div>
        )}

        {alertMessage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm"
          >
            <div className="w-full max-w-sm bg-[#faf8f5] border border-[#e3e2e0] rounded-[32px] p-6 text-center shadow-2xl">
              <div className="w-16 h-16 bg-[#0f9d58]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Info className="text-[#0f9d58]" size={32} />
              </div>
              <h3 className="text-xl font-bold text-[#1f1f1f] mb-2">Notice</h3>
              <p className="text-slate-600 text-sm mb-6">{alertMessage}</p>
              <button 
                onClick={() => setAlertMessage(null)}
                className="w-full py-3 bg-[#0f9d58] text-white rounded-xl font-bold hover:bg-[#0f9d58]/95 transition-all shadow-sm"
              >
                OK
              </button>
            </div>
          </motion.div>
        )}

        {passwordResetEmailSent && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm"
          >
            <div className="w-full max-w-sm bg-white border border-[#e3e2e0] rounded-[32px] p-6 text-center shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-2 bg-[#0f9d58]" />
              
              <div className="w-16 h-16 bg-[#0f9d58]/10 rounded-full flex items-center justify-center mx-auto mb-4 mt-2">
                <Mail className="text-[#0f9d58]" size={32} />
              </div>
              
              <h3 className="text-xl font-bold text-[#1f1f1f] mb-2">Check Your Email</h3>
              
              <p className="text-slate-600 text-sm leading-relaxed mb-4">
                We've sent a secure link to reset your password to:
              </p>
              
              <div className="bg-slate-50 border border-slate-100 rounded-xl py-2 px-3 mb-5 inline-block max-w-full">
                <span className="font-mono text-xs text-slate-800 break-all font-bold select-all">
                  {passwordResetEmailSent}
                </span>
              </div>
              
              <p className="text-slate-500 text-[13px] leading-relaxed mb-6">
                Please look for a link sent through your mail. Check your inbox and spam folder to complete resetting your password.
              </p>
              
              <button 
                onClick={() => setPasswordResetEmailSent(null)}
                className="w-full py-3 bg-[#0f9d58] text-white rounded-xl font-bold hover:bg-[#0f9d58]/95 transition-all shadow-sm active:scale-[0.98]"
              >
                Got It, Thanks!
              </button>
            </div>
          </motion.div>
        )}

        {activeFooterModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/40 backdrop-blur-sm overflow-y-auto"
            onClick={handleCloseFooterModal}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xl bg-white border border-[#e3e2e0] rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-[#e3e2e0]/60 flex items-center justify-between bg-[#faf8f5]">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-[#0f9d58]/10 rounded-lg flex items-center justify-center text-[#0f9d58]">
                    <Pill size={16} className="stroke-[2.5]" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-[#1f1f1f] tracking-tight text-sm sm:text-base">
                      {activeFooterModal === 'guide' ? 'User Guide & Manual' : 
                       activeFooterModal === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}
                    </h3>
                  </div>
                </div>
                <button 
                  onClick={handleCloseFooterModal}
                  className="p-1.5 hover:bg-slate-200/60 rounded-full text-slate-400 hover:text-slate-800 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto space-y-6 text-slate-600 text-sm leading-relaxed custom-scrollbar">
                {activeFooterModal === 'guide' && (
                  <>
                    {/* Header Image */}
                    <div className="rounded-2xl overflow-hidden border border-slate-100 bg-slate-50 relative h-40 sm:h-44 shrink-0 shadow-xs">
                      <img 
                        src="https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&q=80&w=600&h=300" 
                        alt="Medication Tracker" 
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
                      <div className="absolute bottom-4 left-4 right-4 text-white">
                        <span className="text-[9px] font-bold uppercase tracking-widest bg-[#0f9d58] px-2.5 py-0.5 rounded-full mb-1.5 inline-block">App Manual</span>
                        <h4 className="text-base sm:text-lg font-black leading-tight tracking-tight">Master Your Cabinet with DawaLens AI</h4>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <p className="text-slate-500 font-medium text-xs leading-relaxed">
                        Welcome to your digital medication assistant. DawaLens AI helps you safely catalog, scan, track, and analyze your daily medicine schedules using advanced AI technology.
                      </p>

                      <div className="space-y-3 pt-1">
                        {/* Step 1 */}
                        <div className="flex gap-3 items-start bg-[#faf8f5] p-3.5 rounded-2xl border border-slate-100">
                          <div className="w-8 h-8 bg-[#0f9d58]/10 text-[#0f9d58] rounded-xl flex items-center justify-center font-black shrink-0 text-sm">
                            1
                          </div>
                          <div className="space-y-0.5">
                            <h5 className="font-extrabold text-[#1f1f1f] text-xs uppercase tracking-wider">Scan Prescriptions 📸</h5>
                            <p className="text-xs text-slate-500 leading-relaxed">
                              Tap <strong className="text-slate-700">Scan</strong> in the floating bar at the bottom. Position any medication bottle, pill blister, or prescription sheet inside the camera guide. Our built-in Gemini AI will instantly identify the drug name, dosage frequencies, inventory count, and expiration date.
                            </p>
                          </div>
                        </div>

                        {/* Step 2 */}
                        <div className="flex gap-3 items-start bg-[#faf8f5] p-3.5 rounded-2xl border border-slate-100">
                          <div className="w-8 h-8 bg-[#0f9d58]/10 text-[#0f9d58] rounded-xl flex items-center justify-center font-black shrink-0 text-sm">
                            2
                          </div>
                          <div className="space-y-0.5">
                            <h5 className="font-extrabold text-[#1f1f1f] text-xs uppercase tracking-wider">Add Medicines Manually ✍️</h5>
                            <p className="text-xs text-slate-500 leading-relaxed">
                              Prefer entering details by hand? Tap <strong className="text-slate-700">Manual</strong> to trigger the complete medication form. You can select custom medicine types, color accents, current quantity, threshold triggers, and details on daily schedule alarms.
                            </p>
                          </div>
                        </div>

                        {/* Step 3 */}
                        <div className="flex gap-3 items-start bg-[#faf8f5] p-3.5 rounded-2xl border border-slate-100">
                          <div className="w-8 h-8 bg-[#0f9d58]/10 text-[#0f9d58] rounded-xl flex items-center justify-center font-black shrink-0 text-sm">
                            3
                          </div>
                          <div className="space-y-0.5">
                            <h5 className="font-extrabold text-[#1f1f1f] text-xs uppercase tracking-wider">Track Intake & Stock Deductions ✅</h5>
                            <p className="text-xs text-slate-500 leading-relaxed">
                              On the main dashboard, simply tap the checkbox next to any medicine to record your dosage. The app automatically subtracts the correct volume or pill count from your active stock and logs the date and time.
                            </p>
                          </div>
                        </div>

                        {/* Step 4 */}
                        <div className="flex gap-3 items-start bg-[#faf8f5] p-3.5 rounded-2xl border border-slate-100">
                          <div className="w-8 h-8 bg-[#0f9d58]/10 text-[#0f9d58] rounded-xl flex items-center justify-center font-black shrink-0 text-sm">
                            4
                          </div>
                          <div className="space-y-0.5">
                            <h5 className="font-extrabold text-[#1f1f1f] text-xs uppercase tracking-wider">AI Interaction Analysis 🛡️</h5>
                            <p className="text-xs text-slate-500 leading-relaxed">
                              Concerned about combination safety? The system automatically parses your medication list to check for potential severe or moderate drug interactions. Look at the real-time health insights right on your dashboard!
                            </p>
                          </div>
                        </div>

                        {/* Step 5 */}
                        <div className="flex gap-3 items-start bg-[#faf8f5] p-3.5 rounded-2xl border border-slate-100">
                          <div className="w-8 h-8 bg-[#0f9d58]/10 text-[#0f9d58] rounded-xl flex items-center justify-center font-black shrink-0 text-sm">
                            5
                          </div>
                          <div className="space-y-0.5">
                            <h5 className="font-extrabold text-[#1f1f1f] text-xs uppercase tracking-wider">Alerts & Configuration 🔔</h5>
                            <p className="text-xs text-slate-500 leading-relaxed">
                              Go to Settings to set custom alert thresholds (e.g. alert 15 or 30 days before expiration), low inventory warnings, and sync options. Enable browser or email notifications to stay fully on top of your daily schedule.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {activeFooterModal === 'privacy' && (
                  <div className="space-y-4">
                    <div className="bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100 flex gap-3 items-start mb-4">
                      <Shield className="text-[#0f9d58] shrink-0 mt-0.5" size={18} />
                      <div>
                        <h4 className="font-extrabold text-[#1f1f1f] text-xs uppercase tracking-wider mb-1">Your Privacy is Protected</h4>
                        <p className="text-xs text-emerald-850/80 leading-relaxed font-semibold">
                          DawaLens AI is dedicated to protecting your personal information and your right to privacy. This privacy policy applies to our application hosted at noorpos.in.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4 text-xs">
                      <div>
                        <h5 className="font-extrabold text-slate-800 text-[13px] uppercase tracking-wider mb-1">1. What Information We Access and How We Use It</h5>
                        <p className="text-slate-500 leading-relaxed mb-2">
                          DawaLens AI is an AI-powered medication scanner and scheduler designed to assist you in organizing your personal medical reminders with maximum privacy in mind.
                        </p>
                        <ul className="list-disc pl-5 mt-2 space-y-2 text-slate-500 leading-relaxed">
                          <li>
                            <strong className="text-slate-700 font-bold">Medicines & Prescriptions Data:</strong> Any medicine name, dosage, or scheduling frequency you input or scan is saved securely inside your private cloud database (Firebase).
                          </li>
                          <li>
                            <strong className="text-slate-700 font-bold">On-Device Medicine Photos:</strong> Any images or photos captured using your camera are processed strictly on-device in your browser. The captured images are stored locally on your physical device (using secure IndexedDB browser storage) and are <strong>never</strong> uploaded, sent to, or stored in our cloud databases. If you delete a medicine or log out, these local images are permanently purged from your device cache.
                          </li>
                        </ul>
                      </div>

                      <div className="pt-4 border-t border-slate-100">
                        <h5 className="font-extrabold text-slate-800 text-[13px] uppercase tracking-wider mb-1">2. Contact Us</h5>
                        <p className="text-slate-500 leading-relaxed">
                          If you have any questions, feedback, or concerns regarding your privacy or data protection practices, feel free to contact us at:
                        </p>
                        <p className="font-bold text-slate-800 mt-1.5 select-all">
                          Email: noorpos.alerts@gmail.com
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {activeFooterModal === 'terms' && (
                  <div className="space-y-4">
                    <div className="bg-red-50 p-4 rounded-2xl border border-red-100 flex gap-3 items-start mb-4">
                      <ShieldAlert className="text-red-600 shrink-0 mt-0.5" size={18} />
                      <div>
                        <h4 className="font-extrabold text-red-800 text-xs uppercase tracking-wider mb-1">Medical Disclaimer</h4>
                        <p className="text-xs text-red-700/95 leading-relaxed font-bold">
                          DawaLens AI is NOT a clinical tool, medical device, or licensed medical professional. Our features (including AI summaries and drug interaction warnings) are generated by general artificial intelligence models and are subject to errors. Never change, delay, or start medical treatment without directly consulting your doctor or pharmacist.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4 text-xs">
                      <div>
                        <h5 className="font-extrabold text-slate-800 text-[13px] uppercase tracking-wider mb-1">1. Description of Service</h5>
                        <p className="text-slate-500 leading-relaxed">
                          DawaLens AI provides medication barcode/label scanning, scheduling, and smart drug-interaction checking using AI technology. These features are designed strictly for educational and personal organization purposes.
                        </p>
                      </div>

                      <div className="pt-3 border-t border-slate-100">
                        <h5 className="font-extrabold text-slate-800 text-[13px] uppercase tracking-wider mb-1">2. Privacy, Photos & Personal Data</h5>
                        <p className="text-slate-500 leading-relaxed">
                          We respect your privacy. All captured medicine images or photos are kept locally on your own physical device (IndexedDB storage) and are never sent or stored in our cloud environment. All handling of user inputs is done in accordance with our Privacy Policy.
                        </p>
                      </div>

                      <div className="pt-3 border-t border-slate-100">
                        <h5 className="font-extrabold text-slate-800 text-[13px] uppercase tracking-wider mb-1">3. Limitation of Liability</h5>
                        <p className="text-slate-500 leading-relaxed">
                          DawaLens AI is provided "as is" without any guarantees. We are not responsible for any issues resulting from missed doses, data sync failures, or information accuracy errors.
                        </p>
                      </div>

                      <div className="pt-3 border-t border-slate-100">
                        <h5 className="font-extrabold text-slate-800 text-[13px] uppercase tracking-wider mb-1">4. Governing Law & Contact</h5>
                        <p className="text-slate-500 leading-relaxed">
                          For any questions or legal inquiries, please contact us at:
                        </p>
                        <p className="font-bold text-slate-800 mt-1.5 select-all">
                          Email: noorpos.alerts@gmail.com
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-[#e3e2e0]/60 bg-[#faf8f5] flex justify-end shrink-0">
                <button 
                  onClick={handleCloseFooterModal}
                  className="px-6 py-2.5 bg-[#0f9d58] hover:bg-[#0f9d58]/95 text-white rounded-full font-bold text-xs shadow-sm transition-all active:scale-[0.98]"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}
