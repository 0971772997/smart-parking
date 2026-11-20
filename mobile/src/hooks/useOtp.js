import { useCallback, useEffect, useState } from 'react';
import { authApi } from '../api/auth';

// Quan ly 1 phien OTP: gui ma, dem nguoc gui lai, ma xac thuc tu dong
export function useOtp(purpose) {
  const [session, setSession] = useState(null); // { otpId, sentTo, devCode, expiresAt }
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = useCallback(async (identifiers, opts) => {
    setSending(true);
    try {
      const r = await authApi.requestOtp({ purpose, ...identifiers }, opts);
      setSession({ otpId: r.otpId, sentTo: r.sentTo, devCode: r.devCode, expiresAt: Date.now() + r.expiresIn * 1000 });
      setCooldown(r.resendAfter || 60);
      return r;
    } catch (e) {
      if (e.code === 'otp_too_soon' && e.details?.retryAfter) setCooldown(e.details.retryAfter);
      throw e;
    } finally {
      setSending(false);
    }
  }, [purpose]);

  const reset = useCallback(() => { setSession(null); setCooldown(0); }, []);

  return { session, send, sending, cooldown, reset };
}
