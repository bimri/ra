// A3 · "Your mind sits behind a lock only you hold." A passkey is the account:
// no password, no email. The Worker issues the options and verifies; the
// phone's own fingerprint or screen lock does the rest. With WebAuthn PRF,
// the passkey also yields a key for the phone's copy of your mind.

const b64url = {
  encode(buf: ArrayBuffer | Uint8Array): string {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(s: string): Uint8Array<ArrayBuffer> {
    const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(new ArrayBuffer(b.length));
    for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    return out;
  },
};

export function passkeysAvailable(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  // WebView exposes PublicKeyCredential even without a native credential
  // provider. Ra's Android shell currently supports the passphrase path.
  const embedded = /RaAndroid\/\d+|;\s*wv\)/i.test(navigator.userAgent);
  return !embedded && "PublicKeyCredential" in window && window.isSecureContext &&
    typeof navigator.credentials?.create === "function" && typeof navigator.credentials?.get === "function";
}

function requirePasskeys(): void {
  if (!passkeysAvailable()) throw new Error("Passkeys aren't available here. Use a passphrase, or open Ra in the browser where you created your passkey.");
}

async function post<T>(path: string, body: unknown,signal?:AbortSignal): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(body),signal });
  if (!res.ok) throw new Error((await res.text()) || `${path} ${res.status}`);
  return (await res.json()) as T;
}

interface CreationOptionsJSON {
  challengeId: string;
  publicKey: {
    challenge: string;
    rp: { name: string; id: string };
    user: { id: string; name: string; displayName: string };
    pubKeyCredParams: { type: "public-key"; alg: number }[];
    authenticatorSelection: AuthenticatorSelectionCriteria;
    timeout: number;
    attestation: AttestationConveyancePreference;
  };
}

interface RequestOptionsJSON {
  challengeId: string;
  publicKey: { challenge: string; rpId: string; timeout: number; userVerification: UserVerificationRequirement };
}

/** Create the account: a new passkey on this phone. */
export async function register(opts: { ageBracket: "under-16" | "16-17" | "adult"; lang: string }): Promise<{ accountId: string }> {
  requirePasskeys();
  const o = await post<CreationOptionsJSON>("/auth/passkey/register/options", opts);
  const cred = (await navigator.credentials.create({
    publicKey: {
      ...o.publicKey,
      challenge: b64url.decode(o.publicKey.challenge),
      user: { ...o.publicKey.user, id: b64url.decode(o.publicKey.user.id) },
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was made.");
  const r = cred.response as AuthenticatorAttestationResponse;
  return post("/auth/passkey/register/verify", {
    challengeId: o.challengeId,
    credential: {
      id: cred.id,
      rawId: b64url.encode(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: b64url.encode(r.clientDataJSON),
        attestationObject: b64url.encode(r.attestationObject),
        transports: r.getTransports?.() ?? [],
      },
    },
  });
}

/** J3 · Unlock: sign in with the passkey already on this phone. */
async function authenticate(signal?:AbortSignal,prfInput?:Uint8Array<ArrayBuffer>):Promise<{accountId:string;credential:PublicKeyCredential;rpId:string}> {
  requirePasskeys();
  const o = await post<RequestOptionsJSON>("/auth/passkey/login/options", {},signal);
  const cred = (await navigator.credentials.get({
    signal,
    publicKey: { ...o.publicKey, challenge: b64url.decode(o.publicKey.challenge),...(prfInput?{userVerification:"required" as const,extensions:{prf:{eval:{first:prfInput}}}}:{}) },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("No passkey was used.");
  const r = cred.response as AuthenticatorAssertionResponse;
  let identity:{accountId:string};
  try {identity=await post<{accountId:string}>("/auth/passkey/login/verify", {
    challengeId: o.challengeId,
    credential: {
      id: cred.id,
      rawId: b64url.encode(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: b64url.encode(r.clientDataJSON),
        authenticatorData: b64url.encode(r.authenticatorData),
        signature: b64url.encode(r.signature),
        userHandle: r.userHandle ? b64url.encode(r.userHandle) : null,
      },
    },
  },signal)}catch(error){if(prfInput)takePrf(cred)?.fill(0);throw error}
  return {...identity,credential:cred,rpId:o.publicKey.rpId};
}

export async function signIn(signal?:AbortSignal):Promise<{accountId:string}> {
  const {accountId}=await authenticate(signal);return {accountId};
}

/** Extension secrets stay in the browser; only the normal assertion reaches the server. */
export async function signInForPrf(first:Uint8Array<ArrayBuffer>,signal?:AbortSignal):Promise<{accountId:string;credentialId:string;rpId:string;prf:Uint8Array<ArrayBuffer>|null}> {
  if(first.length!==32)throw new Error("Invalid local passkey request.");
  const {accountId,credential,rpId}=await authenticate(signal,first);
  return {accountId,credentialId:credential.id,rpId,prf:takePrf(credential)};
}

export function takePrf(credential:PublicKeyCredential):Uint8Array<ArrayBuffer>|null {
  const output=credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs&{prf?:{results?:{first?:BufferSource}}};
  const first=output.prf?.results?.first;if(!first)return null;
  const source=first instanceof ArrayBuffer?new Uint8Array(first):new Uint8Array(first.buffer,first.byteOffset,first.byteLength);
  try{if(source.length!==32)return null;return new Uint8Array(source)}finally{source.fill(0)}
}

/** Offline assertion: a local challenge, saved credential and PRF input; no fetch. */
export async function offlinePrf(credentialId:string,rpId:string,first:Uint8Array<ArrayBuffer>,signal?:AbortSignal):Promise<Uint8Array<ArrayBuffer>> {
  requirePasskeys();const challenge=crypto.getRandomValues(new Uint8Array(32));
  const credential=await navigator.credentials.get({signal,publicKey:{challenge,rpId,allowCredentials:[{type:"public-key",id:b64url.decode(credentialId)}],userVerification:"required",timeout:60000,extensions:{prf:{eval:{first}}}}}) as PublicKeyCredential|null;
  if(!credential)throw new Error("No passkey was used. You can still use your local passphrase.");
  const secret=takePrf(credential);
  try {
    const response=credential.response as AuthenticatorAssertionResponse;
    const client=JSON.parse(new TextDecoder().decode(response.clientDataJSON)) as {type?:unknown;challenge?:unknown;origin?:unknown;crossOrigin?:unknown};
    const flags=new Uint8Array(response.authenticatorData);
    if(credential.id!==credentialId||b64url.encode(credential.rawId)!==credentialId||client.type!=="webauthn.get"||client.challenge!==b64url.encode(challenge)||client.origin!==location.origin||client.crossOrigin===true||flags.length<37||(flags[32]!&5)!==5)throw new Error("The local passkey assertion could not be checked.");
    if(!secret)throw new Error("This passkey cannot unlock the local copy. Use your local passphrase.");
    return secret;
  }catch(error){secret?.fill(0);throw error}
}

/** Who is signed in on this phone, if anyone. */
export async function whoAmI(): Promise<{ accountId: string } | null> {
  try {
    const res = await fetch("/auth/me", { credentials: "include" });
    return res.ok ? ((await res.json()) as { accountId: string }) : null;
  } catch {
    return null;
  }
}

// ── the passphrase lock (A3 / J3), for phones without passkeys ───────────────

/** A3 · create the account, locked with a passphrase instead of a passkey. */
export async function registerWithPassphrase(opts: { passphrase: string; ageBracket: "under-16" | "16-17" | "adult"; lang: string }): Promise<{ accountId: string }> {
  return post<{ accountId: string }>("/auth/passphrase/register", opts);
}

/** J3 · unlock this phone's account with its passphrase. */
export async function signInWithPassphrase(accountId: string, passphrase: string,signal?:AbortSignal): Promise<{ accountId: string }> {
  return post<{ accountId: string }>("/auth/passphrase/login", { accountId, passphrase },signal);
}
