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

export type EnrolledBiometricAccount = {
  email: string;
  enrolledAt: number;
  credentialId: string;
  isCurrent: boolean;
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

// Multi-account support: keep a list keyed by email for the same device.
// We migrate any older single-cred record into the list on first read.
const LIST_KEY = "stein.biometric.list.v1";

function readList(): StoredCred[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (raw) return JSON.parse(raw) as StoredCred[];
  } catch { /* ignore */ }
  // migrate legacy single record
  try {
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (legacy) {
      const cred = JSON.parse(legacy) as StoredCred;
      const list = [cred];
      localStorage.setItem(LIST_KEY, JSON.stringify(list));
      return list;
    }
  } catch { /* ignore */ }
  return [];
}

function writeList(list: StoredCred[]) {
  try { localStorage.setItem(LIST_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  // keep legacy key in sync with the most-recently-used credential so
  // older code paths that still read it pick a sensible default.
  try {
    if (list.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(list[0]));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

export function listEnrolledAccounts(): { email: string; enrolledAt: number; credentialId: string }[] {
  return readList().map((c) => ({ email: c.email, enrolledAt: c.enrolledAt, credentialId: c.credentialId }));
}

export function getEnrolledAccountsWithStatus(activeEmail?: string | null): EnrolledBiometricAccount[] {
  return readList().map((c, index) => ({
    email: c.email,
    enrolledAt: c.enrolledAt,
    credentialId: c.credentialId,
    isCurrent: activeEmail ? c.email === activeEmail : index === 0,
  }));
}

export function getStored(email?: string): StoredCred | null {
  const list = readList();
  if (list.length === 0) return null;
  if (email) return list.find((c) => c.email === email) ?? null;
  return list[0];
}

export function isEnrolled(email?: string): boolean {
  return !!getStored(email);
}

export function getEnrolledEmail(): string | null {
  return getStored()?.email ?? null;
}

export async function disableBiometric(email?: string): Promise<void> {
  const list = readList();
  const target = email ? list.find((c) => c.email === email) : list[0];
  const next = email ? list.filter((c) => c.email !== email) : [];
  writeList(next);
  if (target?.credentialId) {
    try {
      await supabase
        .from("biometric_credentials")
        .delete()
        .eq("credential_id", target.credentialId);
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
  // upsert into the multi-account list (replace any existing entry for the same email)
  const list = readList().filter((c) => c.email !== params.email);
  list.unshift(stored);
  writeList(list);

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

async function logAttempt(opts: {
  status: "success" | "failed";
  email: string | null;
  credential_id: string | null;
  error_message?: string | null;
}): Promise<void> {
  try {
    const { label, platform, ua } = detectDeviceLabel();
    let userId: string | null = null;
    try {
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id ?? null;
    } catch { /* anonymous */ }
    await supabase.from("biometric_auth_log").insert({
      user_id: userId,
      email: opts.email,
      credential_id: opts.credential_id,
      status: opts.status,
      error_message: opts.error_message ?? null,
      device_label: label,
      platform,
      user_agent: ua,
    });
  } catch { /* best-effort */ }
}

export async function verifyBiometric(email?: string): Promise<{
  email: string;
  access_token: string;
  refresh_token: string;
}> {
  const list = readList();
  if (list.length === 0) {
    await logAttempt({ status: "failed", email: null, credential_id: null, error_message: "No enrolled biometric" });
    throw new Error("No enrolled biometric");
  }
  if (!isBiometricSupported()) {
    await logAttempt({ status: "failed", email: email ?? null, credential_id: null, error_message: "WebAuthn not supported" });
    throw new Error("WebAuthn not supported");
  }

  // If a specific email is requested, restrict allowCredentials to it; otherwise
  // let the platform pick from any enrolled credential on this device.
  const candidates = email ? list.filter((c) => c.email === email) : list;
  if (candidates.length === 0) {
    await logAttempt({ status: "failed", email: email ?? null, credential_id: null, error_message: "Email not enrolled on this device" });
    throw new Error("No enrolled biometric for that account");
  }

  const challenge = randomBytes(32);
  const rpId = window.location.hostname;

  let assertion: PublicKeyCredential | null;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        timeout: 60_000,
        rpId,
        userVerification: "required",
        ...(email
          ? {
              allowCredentials: candidates.map((c) => ({
                type: "public-key" as const,
                id: b64urlToBuf(c.credentialId),
                transports: ["internal" as AuthenticatorTransport],
              })),
            }
          : {}),
      },
    }) as PublicKeyCredential | null;
  } catch (err: any) {
    await logAttempt({ status: "failed", email: candidates[0].email, credential_id: candidates[0].credentialId, error_message: err?.message ?? "WebAuthn get failed" });
    throw err;
  }

  if (!assertion) {
    await logAttempt({ status: "failed", email: candidates[0].email, credential_id: candidates[0].credentialId, error_message: "No assertion returned" });
    throw new Error("Biometric verification failed");
  }

  // Identify which credential the platform chose
  const usedId = bufToB64url(assertion.rawId);
  const used = list.find((c) => c.credentialId === usedId);
  if (!used) {
    await logAttempt({
      status: "failed",
      email: email ?? null,
      credential_id: usedId,
      error_message: "Credential not enrolled on this device",
    });
    throw new Error("Credential not enrolled on this device");
  }

  // Bring the just-used account to the front of the list
  const reordered = [used, ...list.filter((c) => c.credentialId !== used.credentialId)];
  writeList(reordered);

  void supabase
    .from("biometric_credentials")
    .update({ last_used_at: new Date().toISOString() })
    .eq("credential_id", used.credentialId);

  await logAttempt({ status: "success", email: used.email, credential_id: used.credentialId });

  return {
    email: used.email,
    access_token: used.access_token,
    refresh_token: used.refresh_token,
  };
}

export function updateStoredTokens(tokens: { access_token: string; refresh_token: string }, email?: string) {
  const list = readList();
  const idx = email ? list.findIndex((c) => c.email === email) : -1;
  if (idx < 0 || !list[idx]) return;
  list[idx] = { ...list[idx], access_token: tokens.access_token, refresh_token: tokens.refresh_token };
  const current = list[idx];
  writeList([current, ...list.filter((_, itemIndex) => itemIndex !== idx)]);
}
