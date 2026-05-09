// Local biometric (Face ID / Fingerprint) unlock using WebAuthn platform authenticator.
// The biometric acts as a local gate that releases a stored Supabase session
// (refresh + access token) so the user can sign in without typing credentials.
// Enrollment metadata is also recorded in the `biometric_credentials` table
// so users can list and manage devices from any signed-in client.

import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "stein.biometric.v1";

function detectDeviceLabel(): { label: string; platform: string; ua: string } {
  if (typeof navigator === "undefined") return { label: "Unknown device", platform: "unknown", ua: "" };
  const ua = navigator.userAgent;
  let label = "Device";
  if (/iPhone/i.test(ua)) label = "iPhone";
  else if (/iPad/i.test(ua)) label = "iPad";
  else if (/Macintosh/i.test(ua)) label = "Mac";
  else if (/Android/i.test(ua)) label = /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  else if (/Windows/i.test(ua)) label = "Windows PC";
  else if (/Linux/i.test(ua)) label = "Linux PC";
  const platform = (navigator as any).userAgentData?.platform || navigator.platform || "unknown";
  return { label, platform, ua };
}

export type BiometricDevice = {
  id: string;
  credential_id: string;
  device_label: string | null;
  platform: string | null;
  user_agent: string | null;
  created_at: string;
  last_used_at: string | null;
};


type StoredCred = {
  credentialId: string; // base64url
  email: string;
  refresh_token: string;
  access_token: string;
  enrolledAt: number;
};

function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBuf(b64: string): ArrayBuffer {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function randomBytes(n: number): ArrayBuffer {
  const b = new Uint8Array(new ArrayBuffer(n));
  crypto.getRandomValues(b);
  return b.buffer;
}

export function isBiometricSupported(): boolean {
  return typeof window !== "undefined"
    && typeof window.PublicKeyCredential !== "undefined"
    && typeof navigator !== "undefined"
    && !!navigator.credentials;
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isBiometricSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function getStored(): StoredCred | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as StoredCred : null;
  } catch {
    return null;
  }
}

export function isEnrolled(): boolean {
  return !!getStored();
}

export function getEnrolledEmail(): string | null {
  return getStored()?.email ?? null;
}

export async function disableBiometric(): Promise<void> {
  const stored = getStored();
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  if (stored?.credentialId) {
    try {
      await supabase
        .from("biometric_credentials")
        .delete()
        .eq("credential_id", stored.credentialId);
    } catch {
      // ignore – DB cleanup best-effort (user may be offline)
    }
  }
}

export async function enrollBiometric(params: {
  email: string;
  access_token: string;
  refresh_token: string;
}): Promise<void> {
  if (!isBiometricSupported()) throw new Error("WebAuthn not supported");

  const challenge = randomBytes(32);
  const userId = randomBytes(16);
  const rpName = "Steinheim";
  const rpId = window.location.hostname;

  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: rpName, id: rpId },
      user: {
        id: userId,
        name: params.email,
        displayName: params.email,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },   // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      timeout: 60_000,
      attestation: "none",
    },
  }) as PublicKeyCredential | null;

  if (!cred) throw new Error("Enrollment cancelled");

  const credentialId = bufToB64url(cred.rawId);
  const stored: StoredCred = {
    credentialId,
    email: params.email,
    access_token: params.access_token,
    refresh_token: params.refresh_token,
    enrolledAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

  // Persist enrollment to DB so the user can list/manage devices,
  // and create an in-app notification for the user + managers.
  try {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (uid) {
      const { label, platform, ua } = detectDeviceLabel();
      await supabase.from("biometric_credentials").upsert({
        user_id: uid,
        credential_id: credentialId,
        device_label: label,
        platform,
        user_agent: ua,
        last_used_at: new Date().toISOString(),
      }, { onConflict: "credential_id" });

      const isApple = /iP(hone|ad|od)|Mac/i.test(ua);
      const lang = (typeof localStorage !== "undefined" && localStorage.getItem("lang")) === "en" ? "en" : "ar";
      const method = isApple
        ? (lang === "en" ? "Face ID / Touch ID" : "Face ID / Touch ID")
        : (lang === "en" ? "Fingerprint" : "بصمة الإصبع");
      const userTitle = lang === "en"
        ? `${method} enabled successfully`
        : `تم تفعيل ${method} بنجاح`;
      const userBody = lang === "en"
        ? `You can now sign in instantly on ${label} (${params.email}) without typing your password.`
        : `يمكنك الآن تسجيل الدخول فورًا على ${label} (${params.email}) بدون كتابة كلمة المرور.`;
      const mgrTitle = lang === "en"
        ? "New biometric sign-in enabled"
        : "تفعيل دخول جديد بالبصمة";
      const mgrBody = lang === "en"
        ? `${params.email} enabled ${method} on ${label}.`
        : `${params.email} فعّل ${method} على جهاز ${label}.`;
      await supabase.from("notifications").insert([
        {
          user_id: uid,
          type: "biometric_enrolled",
          title: userTitle,
          body: userBody,
          meta: { credential_id: credentialId, device_label: label, platform, email: params.email, lang },
        },
        {
          recipient_role: "manager",
          type: "biometric_enrolled",
          title: mgrTitle,
          body: mgrBody,
          meta: { credential_id: credentialId, device_label: label, platform, email: params.email, lang },
        },
      ]);
    }
  } catch {
    // Best-effort: enrollment still works locally even if the insert failed.
  }
}

export async function listBiometricDevices(): Promise<BiometricDevice[]> {
  const { data, error } = await supabase
    .from("biometric_credentials")
    .select("id, credential_id, device_label, platform, user_agent, created_at, last_used_at")
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as BiometricDevice[];
}

export async function removeBiometricDevice(id: string): Promise<void> {
  const stored = getStored();
  const { data: row } = await supabase
    .from("biometric_credentials")
    .select("credential_id")
    .eq("id", id)
    .maybeSingle();
  await supabase.from("biometric_credentials").delete().eq("id", id);
  if (row && stored && row.credential_id === stored.credentialId) {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
}

export async function verifyBiometric(): Promise<{
  email: string;
  access_token: string;
  refresh_token: string;
}> {
  const stored = getStored();
  if (!stored) throw new Error("No enrolled biometric");
  if (!isBiometricSupported()) throw new Error("WebAuthn not supported");

  const challenge = randomBytes(32);
  const rpId = window.location.hostname;

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      timeout: 60_000,
      rpId,
      userVerification: "required",
      allowCredentials: [{
        type: "public-key",
        id: b64urlToBuf(stored.credentialId),
        transports: ["internal"],
      }],
    },
  }) as PublicKeyCredential | null;

  if (!assertion) throw new Error("Biometric verification failed");

  // Best-effort: update last_used_at after the session is restored by the caller.
  // We update it here too — RLS will accept it if the active session is the owner.
  void supabase
    .from("biometric_credentials")
    .update({ last_used_at: new Date().toISOString() })
    .eq("credential_id", stored.credentialId);

  return {
    email: stored.email,
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
  };
}

export function updateStoredTokens(tokens: { access_token: string; refresh_token: string }) {
  const stored = getStored();
  if (!stored) return;
  stored.access_token = tokens.access_token;
  stored.refresh_token = tokens.refresh_token;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)); } catch {}
}
