import React from 'react';
import { X, Trash2, Bell, Palette, ShieldAlert, LogOut, Mail, RotateCcw, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';
import { Medicine } from '../types';

interface SettingsModalProps {
  onClose: () => void;
  onClearData: () => void;
  alertThreshold: number;
  setAlertThreshold: (val: number) => void;
  lowQuantityThreshold: number;
  setLowQuantityThreshold: (val: number) => void;
  accentColor: string;
  setAccentColor: (color: string) => void;
  emailNotificationsEnabled: boolean;
  setEmailNotificationsEnabled: (val: boolean) => void;
  browserNotificationsEnabled: boolean;
  setBrowserNotificationsEnabled: (val: boolean) => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (val: 'light' | 'dark' | 'system') => void;
  userEmail: string;
  onLogout: () => void;
  medicines: Medicine[];
  deletedMedicines: Medicine[];
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  onClose,
  onClearData,
  alertThreshold,
  setAlertThreshold,
  lowQuantityThreshold,
  setLowQuantityThreshold,
  accentColor,
  setAccentColor,
  emailNotificationsEnabled,
  setEmailNotificationsEnabled,
  browserNotificationsEnabled,
  setBrowserNotificationsEnabled,
  theme,
  setTheme,
  userEmail,
  onLogout,
  medicines,
  deletedMedicines,
  onRestore,
  onPermanentDelete
}) => {
  const [showConfirmClear, setShowConfirmClear] = React.useState(false);
  const [cookieConsent, setCookieConsent] = React.useState(() => {
    try {
      return localStorage.getItem('mediscan_cookie_consent') !== 'denied';
    } catch (e) {
      return true; // Default to true if storage is blocked
    }
  });

  const colors = [
    { name: 'Orange', value: '#f97316' },
    { name: 'Emerald', value: '#10b981' },
    { name: 'Violet', value: '#8b5cf6' },
    { name: 'Sky', value: '#0ea5e9' },
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
          <h2 className="text-2xl font-bold tracking-tight text-white">Settings</h2>
          <button onClick={onClose} className="p-2 text-white/40 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="space-y-8">
          {/* User Profile */}
          <section className="bg-white/5 rounded-3xl p-4 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Account</span>
              <span className="text-sm text-white/80 font-medium truncate max-w-[180px]">{userEmail}</span>
            </div>
            <button 
              onClick={onLogout}
              className="p-3 bg-white/5 hover:bg-red-500/20 text-white/40 hover:text-red-400 rounded-2xl transition-all"
              title="Logout"
            >
              <LogOut size={20} />
            </button>
          </section>

          {/* Recently Deleted */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-white/60">
              <Trash2 size={18} />
              <h3 className="text-sm font-bold uppercase tracking-widest">Recently Deleted</h3>
            </div>
            {deletedMedicines.length === 0 ? (
              <p className="text-xs text-white/30 italic px-1">No recently deleted items.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                {deletedMedicines.map(med => {
                  const daysLeft = med.deletedAt ? Math.max(0, 15 - Math.floor((Date.now() - med.deletedAt) / (1000 * 60 * 60 * 24))) : 15;
                  return (
                    <div key={med.id} className="flex items-center justify-between bg-white/5 p-3 rounded-2xl border border-white/5">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-white/80">{med.name}</span>
                        <span className="text-[10px] text-white/40 flex items-center gap-1">
                          <AlertTriangle size={10} />
                          {daysLeft} days left
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => onRestore(med.id)}
                          className="p-2 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded-xl transition-colors"
                          title="Restore"
                        >
                          <RotateCcw size={14} />
                        </button>
                        <button 
                          onClick={() => onPermanentDelete(med.id)}
                          className="p-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-xl transition-colors"
                          title="Delete Permanently"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-[10px] text-white/30 px-1">
              Items are kept for 15 days before being permanently deleted.
            </p>
          </section>

          {/* Email Notifications */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white/60">
                <Mail size={18} />
                <h3 className="text-sm font-bold uppercase tracking-widest">Email Alerts</h3>
              </div>
              <button 
                onClick={() => setEmailNotificationsEnabled(!emailNotificationsEnabled)}
                className={`w-12 h-6 rounded-full transition-all relative ${emailNotificationsEnabled ? 'bg-accent' : 'bg-white/10'}`}
              >
                <div 
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${emailNotificationsEnabled ? 'left-7' : 'left-1'}`} 
                  style={{ backgroundColor: emailNotificationsEnabled ? '#ffffff' : '' }}
                />
              </button>
            </div>
            <p className="text-[10px] text-white/30 px-1">
              Receive expiry warnings at {userEmail}. Alerts are sent at {alertThreshold} days and 10 days before expiry.
            </p>
          </section>

          {/* Browser Notifications */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white/60">
                <Bell size={18} />
                <h3 className="text-sm font-bold uppercase tracking-widest">Push Notifications</h3>
              </div>
              <button 
                onClick={() => setBrowserNotificationsEnabled(!browserNotificationsEnabled)}
                className={`w-12 h-6 rounded-full transition-all relative ${browserNotificationsEnabled ? 'bg-accent' : 'bg-white/10'}`}
              >
                <div 
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${browserNotificationsEnabled ? 'left-7' : 'left-1'}`} 
                  style={{ backgroundColor: browserNotificationsEnabled ? '#ffffff' : '' }}
                />
              </button>
            </div>
            <p className="text-[10px] text-white/30 px-1">
              Receive browser push notifications when medicines are expiring.
            </p>
          </section>

          {/* Alert Threshold */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-white/60">
              <Bell size={18} />
              <h3 className="text-sm font-bold uppercase tracking-widest">Expiry Alert Threshold</h3>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[30, 60, 90].map((days) => (
                <button
                  key={days}
                  onClick={() => setAlertThreshold(days)}
                  className={`py-3 rounded-2xl border transition-all text-xs font-bold ${
                    alertThreshold === days 
                      ? 'bg-accent text-black border-accent' 
                      : 'bg-white/5 text-white/40 border-white/10 hover:border-white/30'
                  }`}
                >
                  {days} Days
                </button>
              ))}
            </div>
          </section>

          {/* Low Quantity Threshold */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-white/60">
              <ShieldAlert size={18} />
              <h3 className="text-sm font-bold uppercase tracking-widest">Low Quantity Warning</h3>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="number"
                min="0"
                value={lowQuantityThreshold ?? 0}
                onChange={(e) => setLowQuantityThreshold(parseInt(e.target.value, 10) || 0)}
                className="w-24 bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-white/30 transition-all text-center font-bold"
              />
              <p className="text-[10px] text-white/30 flex-1">
                Show a warning when a medicine's quantity falls to this number or below.
              </p>
            </div>
          </section>

          {/* Theme Settings */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-white/60">
              <Palette size={18} />
              <h3 className="text-sm font-bold uppercase tracking-widest">App Theme</h3>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`py-3 rounded-2xl border transition-all text-xs font-bold capitalize ${
                    theme === t 
                      ? 'bg-accent text-black border-accent' 
                      : 'bg-white/5 text-white/40 border-white/10 hover:border-white/30'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </section>

          {/* Accent Color */}
          <section className="space-y-4">
            <div className="flex items-center gap-2 text-white/60">
              <Palette size={18} />
              <h3 className="text-sm font-bold uppercase tracking-widest">Accent Theme</h3>
            </div>
            <div className="flex gap-3">
              {colors.map((color) => (
                <button
                  key={color.value}
                  onClick={() => setAccentColor(color.value)}
                  className={`w-10 h-10 rounded-full border-2 transition-all flex items-center justify-center ${
                    accentColor === color.value ? 'border-white scale-110' : 'border-transparent opacity-50'
                  }`}
                  style={{ backgroundColor: color.value }}
                >
                  {accentColor === color.value && (
                    <div 
                      className="w-2 h-2 rounded-full" 
                      style={{ backgroundColor: color.value === '#ffffff' ? '#000000' : '#ffffff' }} 
                    />
                  )}
                </button>
              ))}
            </div>
          </section>

          {/* Cookie Preferences */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-white/60">
                <ShieldAlert size={18} />
                <h3 className="text-sm font-bold uppercase tracking-widest">Cookie Preferences</h3>
              </div>
              <button 
                onClick={() => {
                  const newConsent = !cookieConsent;
                  setCookieConsent(newConsent);
                  try {
                    localStorage.setItem('mediscan_cookie_consent', newConsent ? 'granted' : 'denied');
                  } catch (e) {
                    console.warn('Failed to save cookie consent to localStorage:', e);
                  }
                  if (typeof window !== 'undefined' && (window as any).gtag) {
                    (window as any).gtag('consent', 'update', {
                      'ad_storage': newConsent ? 'granted' : 'denied',
                      'ad_user_data': newConsent ? 'granted' : 'denied',
                      'ad_personalization': newConsent ? 'granted' : 'denied',
                      'analytics_storage': newConsent ? 'granted' : 'denied'
                    });
                  }
                }}
                className={`w-12 h-6 rounded-full transition-all relative ${cookieConsent ? 'bg-accent' : 'bg-white/10'}`}
              >
                <div 
                  className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${cookieConsent ? 'left-7' : 'left-1'}`} 
                  style={{ backgroundColor: cookieConsent ? '#ffffff' : '' }}
                />
              </button>
            </div>
            <p className="text-[10px] text-white/30 px-1">
              Allow cookies for analytics and personalized content. You can change this at any time.
            </p>
          </section>

          {/* Data Management */}
          <section className="space-y-4 pt-4 border-t border-white/5">
            <div className="flex items-center gap-2 text-red-400/60">
              <ShieldAlert size={18} />
              <h3 className="text-sm font-bold uppercase tracking-widest">Danger Zone</h3>
            </div>
            
            {!showConfirmClear ? (
              <button
                onClick={() => setShowConfirmClear(true)}
                className="w-full py-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm font-bold flex items-center justify-center gap-2 hover:bg-red-500/20 transition-all"
              >
                <Trash2 size={18} />
                Clear All Data
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-red-400 text-center font-medium">Are you absolutely sure? This cannot be undone.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowConfirmClear(false)}
                    className="flex-1 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-xs font-bold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      onClearData();
                      setShowConfirmClear(false);
                      onClose();
                    }}
                    className="flex-1 py-3 bg-red-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-red-500/20"
                  >
                    Yes, Delete
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        <button 
          onClick={onClose}
          className="w-full mt-10 py-4 bg-white text-black rounded-full font-bold hover:bg-white/90 transition-all shadow-xl"
        >
          Close Settings
        </button>
      </div>
    </motion.div>
  );
};
