import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldAlert, Check, X } from 'lucide-react';

export const CookieConsentBanner: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    try {
      const consent = localStorage.getItem('mediscan_cookie_consent');
      if (!consent) {
        setIsVisible(true);
      } else {
        applyConsent(consent === 'granted');
      }
    } catch (e) {
      console.warn('LocalStorage access denied:', e);
      // If localStorage is blocked, we still want to show the banner or assume denied
      setIsVisible(true);
    }
  }, []);

  const applyConsent = (granted: boolean) => {
    if (typeof window !== 'undefined' && (window as any).gtag) {
      (window as any).gtag('consent', 'update', {
        'ad_storage': granted ? 'granted' : 'denied',
        'ad_user_data': granted ? 'granted' : 'denied',
        'ad_personalization': granted ? 'granted' : 'denied',
        'analytics_storage': granted ? 'granted' : 'denied'
      });
    }
  };

  const handleAccept = () => {
    try {
      localStorage.setItem('mediscan_cookie_consent', 'granted');
    } catch (e) {
      console.warn('Failed to save cookie consent to localStorage:', e);
    }
    applyConsent(true);
    setIsVisible(false);
  };

  const handleDecline = () => {
    try {
      localStorage.setItem('mediscan_cookie_consent', 'denied');
    } catch (e) {
      console.warn('Failed to save cookie consent to localStorage:', e);
    }
    applyConsent(false);
    setIsVisible(false);
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-0 left-0 right-0 z-[100] p-4 md:p-6 pointer-events-none"
        >
          <div className="max-w-4xl mx-auto bg-[#1a1a1a] border border-white/10 rounded-3xl p-6 shadow-2xl pointer-events-auto flex flex-col md:flex-row items-center gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert size={20} className="text-accent" />
                <h3 className="text-lg font-bold text-white">We value your privacy</h3>
              </div>
              <p className="text-sm text-white/60 leading-relaxed">
                We use cookies to enhance your browsing experience, serve personalized ads or content, and analyze our traffic. By continuing to use our app, you consent to our use of cookies. You can manage your preferences in Settings.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto shrink-0">
              <button
                onClick={handleDecline}
                className="px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
              >
                <X size={16} />
                Decline
              </button>
              <button
                onClick={handleAccept}
                className="px-6 py-3 rounded-xl bg-accent text-black text-sm font-bold transition-colors shadow-lg flex items-center justify-center gap-2 hover:opacity-90"
              >
                <Check size={16} />
                Got it
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
