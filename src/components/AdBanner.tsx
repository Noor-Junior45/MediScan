import React, { useEffect } from 'react';

interface AdBannerProps {
  slot: string;
  format?: 'auto' | 'fluid' | 'rectangle';
  responsive?: boolean;
}

export const AdBanner: React.FC<AdBannerProps> = ({ slot, format = 'auto', responsive = true }) => {
  const adRef = React.useRef<HTMLModElement>(null);

  useEffect(() => {
    let timeoutId: number;
    
    const pushAd = () => {
      try {
        if (adRef.current && adRef.current.offsetWidth > 0) {
          // Check if this specific element already has an ad or is being processed
          const status = adRef.current.getAttribute('data-adsbygoogle-status');
          if (!status) {
            // @ts-ignore
            (window.adsbygoogle = window.adsbygoogle || []).push({});
          }
        } else if (adRef.current) {
          // If width is 0, retry after a short delay
          timeoutId = window.setTimeout(pushAd, 500);
        }
      } catch (e) {
        // Silently catch common AdSense errors that don't affect app functionality
        if (e instanceof Error && (
          e.message.includes('No slot size') || 
          e.message.includes('already have ads')
        )) {
          return;
        }
        console.error('AdSense error:', e);
      }
    };

    // Small initial delay to allow layout to settle
    timeoutId = window.setTimeout(pushAd, 1000);

    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [slot]);

  return (
    <div className="my-8 w-full flex justify-center overflow-hidden min-h-[100px]">
      <ins
        ref={adRef}
        className="adsbygoogle"
        style={{ display: 'block', minWidth: '250px' }}
        data-ad-client="ca-pub-5865716270182311"
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive={responsive ? 'true' : 'false'}
      />
    </div>
  );
};
