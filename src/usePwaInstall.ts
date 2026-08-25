import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

type NavigatorWithStandalone = Navigator & {
  readonly standalone?: boolean;
};

const isStandalone = () => {
  const navigatorWithStandalone = navigator as NavigatorWithStandalone;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
  );
};

const isAppleMobileDevice = () => {
  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isTouchEnabledIpad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isIos || isTouchEnabledIpad;
};

const isMobileDevice = () => isAppleMobileDevice() || /Android/i.test(navigator.userAgent);

export const usePwaInstall = () => {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(isStandalone);
  const [isInstallHelpOpen, setIsInstallHelpOpen] = useState(false);
  const [isAppleMobile] = useState(isAppleMobileDevice);
  const [isMobile] = useState(isMobileDevice);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
      setIsInstallHelpOpen(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) {
      setIsInstallHelpOpen(true);
      return;
    }

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);

      if (choice.outcome === 'dismissed') {
        setIsInstallHelpOpen(true);
      }
    } catch {
      setInstallPrompt(null);
      setIsInstallHelpOpen(true);
    }
  }, [installPrompt]);

  const dismissInstallHelp = useCallback(() => setIsInstallHelpOpen(false), []);

  return {
    canInstall: !isInstalled && (installPrompt !== null || isMobile),
    dismissInstallHelp,
    install,
    isAppleMobile,
    isInstallHelpOpen,
  };
};
