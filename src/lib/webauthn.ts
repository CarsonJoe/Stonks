export interface LocalPasskeyCredential {
  id: string;
  rawId: string;
  userId: string;
  label: string;
  transports?: AuthenticatorTransport[];
  createdAt: string;
}

export interface WebAuthnSupportSnapshot {
  supported: boolean;
  platformAuthenticator: boolean | null;
  conditionalMediation: boolean | null;
  clientCapabilities: Record<string, boolean>;
}

export interface AuthenticationResult {
  id: string;
  verifiedAt: string;
  clientDataBytes: number;
  authenticatorDataBytes: number;
  signatureBytes: number;
}

function toBase64Url(value: ArrayBuffer | ArrayBufferView) {
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function randomBytes(length = 32) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export async function getWebAuthnSupportSnapshot(): Promise<WebAuthnSupportSnapshot> {
  if (!window.PublicKeyCredential || !navigator.credentials) {
    return {
      supported: false,
      platformAuthenticator: null,
      conditionalMediation: null,
      clientCapabilities: {}
    };
  }

  const constructor = PublicKeyCredential as typeof PublicKeyCredential & {
    isConditionalMediationAvailable?: () => Promise<boolean>;
    getClientCapabilities?: () => Promise<Record<string, boolean>>;
  };

  const platformAuthenticator =
    typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
      ? await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      : null;

  const conditionalMediation =
    typeof constructor.isConditionalMediationAvailable === 'function'
      ? await constructor.isConditionalMediationAvailable()
      : null;

  const clientCapabilities =
    typeof constructor.getClientCapabilities === 'function'
      ? await constructor.getClientCapabilities()
      : {};

  return {
    supported: true,
    platformAuthenticator,
    conditionalMediation,
    clientCapabilities
  };
}

export async function registerLocalPasskey(
  label: string
): Promise<LocalPasskeyCredential> {
  if (!window.PublicKeyCredential || !navigator.credentials) {
    throw new Error('WebAuthn is not available in this browser.');
  }

  const userId = randomBytes(32);
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: {
        name: 'Stonks'
      },
      user: {
        id: userId,
        name: `local-${location.host}`,
        displayName: label.trim() || 'This device'
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 }
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        userVerification: 'required'
      },
      timeout: 60_000,
      attestation: 'none',
      extensions: {
        credProps: true
      }
    }
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('The passkey registration returned no credential.');
  }

  const attestation = credential.response as AuthenticatorAttestationResponse;

  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    userId: toBase64Url(userId),
    label: label.trim() || 'This device',
    transports:
      typeof attestation.getTransports === 'function'
        ? (attestation.getTransports() as AuthenticatorTransport[])
        : undefined,
    createdAt: new Date().toISOString()
  };
}

export async function authenticateLocalPasskey(
  record: LocalPasskeyCredential
): Promise<AuthenticationResult> {
  if (!window.PublicKeyCredential || !navigator.credentials) {
    throw new Error('WebAuthn is not available in this browser.');
  }

  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      timeout: 60_000,
      userVerification: 'required',
      allowCredentials: [
        {
          id: fromBase64Url(record.rawId),
          type: 'public-key',
          transports: record.transports
        }
      ]
    }
  })) as PublicKeyCredential | null;

  if (!credential) {
    throw new Error('The passkey authentication returned no assertion.');
  }

  const assertion = credential.response as AuthenticatorAssertionResponse;

  return {
    id: credential.id,
    verifiedAt: new Date().toISOString(),
    clientDataBytes: assertion.clientDataJSON.byteLength,
    authenticatorDataBytes: assertion.authenticatorData.byteLength,
    signatureBytes: assertion.signature.byteLength
  };
}
