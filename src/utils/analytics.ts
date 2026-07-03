/**
 * Google Analytics Helper for DawaLens AI
 */

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
  }
}

/**
 * Tracks a custom event in Google Analytics
 * @param eventName Name of the event (e.g., 'chat_with_ai', 'medication_scanned')
 * @param params Optional event parameters
 */
export const trackEvent = (eventName: string, params?: Record<string, any>) => {
  try {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', eventName, {
        ...params,
        timestamp: new Date().toISOString()
      });
      console.log(`[GA Event Tracked]: ${eventName}`, params);
    } else {
      // Safe fallback/development logging
      console.log(`[GA Event Simulated]: ${eventName}`, params);
    }
  } catch (error) {
    console.warn('[GA Tracking Failed]:', error);
  }
};
