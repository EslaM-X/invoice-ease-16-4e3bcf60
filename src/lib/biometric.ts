// Local biometric (Face ID / Fingerprint) unlock using WebAuthn platform authenticator.
// The biometric acts as a local gate that releases a stored Supabase session
// (refresh + access token) so the user can sign in without typing credentials.

const STORAGE_KEY = "stein.biometric.v1";

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

export function disableBiometric(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
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

  const stored: StoredCred = {
    credentialId: bufToB64url(cred.rawId),
    email: params.email,
    access_token: params.access_token,
    refresh_token: params.refresh_token,
    enrolledAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
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
