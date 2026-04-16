export const getPlatform = () => {
  const nav = window.navigator as any;
  if ((window as any).Capacitor?.isNativePlatform) {
    return nav.userAgent.toLowerCase().includes('android') ? 'android' : 'ios';
  }
  // Simplified check for Android TV browsers
  if (nav.userAgent.toLowerCase().includes('large screen') || nav.userAgent.toLowerCase().includes('tv')) {
    return 'android_tv';
  }
  return 'web';
};

export const pushEvent = (eventName: string, lobbyId: string, role: string, deviceId: string, extraProps = {}) => {
  if (typeof window !== 'undefined' && (window as any).dataLayer) {
    (window as any).dataLayer.push({
      event: eventName,
      lobby_id: lobbyId,
      platform: getPlatform(),
      user_role: role,
      device_id: deviceId,
      env: "production",
      version: "1.0.0",
      ...extraProps
    });
  }
};
