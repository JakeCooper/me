// Generate a stable fingerprint-based offset for coordinates
const getDeviceOffset = (): { latOffset: number, lngOffset: number } => {
    // Collect stable browser characteristics
    const fingerprint = {
      // Screen properties
      screen: `${window.screen.width},${window.screen.height},${window.screen.colorDepth}`,
      // Browser info
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      // Hardware info
      cores: navigator.hardwareConcurrency || 1,
      memory: (navigator as any).deviceMemory || 1,
      // Language settings
      language: navigator.language,
      // Time zone
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  
    // Convert fingerprint to string
    const fingerprintString = Object.values(fingerprint).join('|');
  
    // Generate a number hash from the string (djb2 algorithm)
    let hash = 5381;
    for (let i = 0; i < fingerprintString.length; i++) {
      hash = ((hash << 5) + hash) + fingerprintString.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
  
    // Use the hash to generate two different offset values
    // We'll use different bit ranges for lat/lng to ensure they're different
    const latBits = (hash & 0xFFFF) / 0xFFFF;          // Use lower 16 bits
    const lngBits = ((hash >>> 16) & 0xFFFF) / 0xFFFF; // Use upper 16 bits
  
    // Convert to offsets between -0.05 and 0.05 degrees
    // This is roughly 5-6km at the equator
    const MAX_OFFSET = 0.05;
    return {
      latOffset: (latBits * 2 - 1) * MAX_OFFSET,
      lngOffset: (lngBits * 2 - 1) * MAX_OFFSET
    };
  };
  
// Usage in IP geolocation code:
export const applyDeviceOffset = (baseLocation: { lat: number, lng: number }) => {
  const { latOffset, lngOffset } = getDeviceOffset();
  return {
    lat: baseLocation.lat + latOffset,
    lng: baseLocation.lng + lngOffset
  };
};
