import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const PWAInstallButton: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [isIOS, setIsIOS] = useState<boolean>(false);
  const [showIOSGuide, setShowIOSGuide] = useState<boolean>(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      setShowIOSGuide(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (isInstalled) return null;

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
    }
  };

  if (deferredPrompt) {
    return (
      <button
        type="button"
        onClick={handleInstallClick}
        aria-label="Zainstaluj aplikację Delivery Tycoon"
        className="fixed bottom-3 left-3 z-20 min-h-[40px] px-3 py-2 rounded-xl bg-[#182030]/95 hover:bg-slate-800 text-amber-300 border border-amber-400/50 shadow-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
      >
        <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Zainstaluj</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          aria-label="Zainstaluj Delivery Tycoon na ekranie głównym"
          className="fixed bottom-3 left-3 z-20 min-h-[40px] px-3 py-2 rounded-xl bg-[#182030]/95 hover:bg-slate-800 text-amber-300 border border-amber-400/50 shadow-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
        >
          <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Zainstaluj</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-[2px]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-pwa-guide-heading"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl bg-[#131a27] border border-slate-700 p-5 text-slate-100 shadow-2xl space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 id="ios-pwa-guide-heading" className="text-base font-bold text-amber-300">
                  Instalacja na iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Zamknij instrukcję instalacji"
                  className="min-w-[36px] min-h-[36px] rounded-lg flex items-center justify-center bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <ol className="text-xs sm:text-sm text-slate-300 space-y-2 list-decimal list-inside">
                <li>
                  Kliknij przycisk <strong className="text-slate-100">Udostępnij</strong> na pasku przeglądarki Safari.
                </li>
                <li>
                  Wybierz <strong className="text-slate-100">Do ekranu początkowego</strong> i potwierdź przyciskiem <strong className="text-slate-100">Dodaj</strong>.
                </li>
              </ol>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
