import { FirebaseApp, initializeApp } from 'firebase/app';
import { Auth, GoogleAuthProvider, getAuth } from 'firebase/auth';
import { Firestore, doc, getDocFromServer, getFirestore } from 'firebase/firestore';

export interface FirebaseAppletConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  firestoreDatabaseId?: string;
}

const configModules = import.meta.glob('/firebase-applet-config.json', {
  eager: true,
}) as Record<string, { default?: Partial<FirebaseAppletConfig> }>;

function resolveFirebaseConfig(): FirebaseAppletConfig | null {
  const fileConfig = Object.values(configModules)[0]?.default;
  if (
    fileConfig?.apiKey &&
    fileConfig?.projectId &&
    fileConfig?.appId &&
    fileConfig.projectId !== 'remixed-project-id'
  ) {
    return {
      apiKey: fileConfig.apiKey,
      authDomain: fileConfig.authDomain || `${fileConfig.projectId}.firebaseapp.com`,
      projectId: fileConfig.projectId,
      storageBucket: fileConfig.storageBucket,
      messagingSenderId: fileConfig.messagingSenderId,
      appId: fileConfig.appId,
      firestoreDatabaseId: fileConfig.firestoreDatabaseId,
    };
  }

  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID;

  if (apiKey && projectId && appId) {
    return {
      apiKey,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId,
      firestoreDatabaseId: import.meta.env.VITE_FIREBASE_DATABASE_ID || undefined,
    };
  }

  return null;
}

export const resolvedFirebaseConfig = resolveFirebaseConfig();
export const isFirebaseConfigured = Boolean(resolvedFirebaseConfig);

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let googleProvider: GoogleAuthProvider | null = null;

if (resolvedFirebaseConfig) {
  app = initializeApp(resolvedFirebaseConfig);
  db = resolvedFirebaseConfig.firestoreDatabaseId
    ? getFirestore(app, resolvedFirebaseConfig.firestoreDatabaseId)
    : getFirestore(app);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: 'select_account' });
}

export { app, auth, db, googleProvider };

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
      isAnonymous: auth?.currentUser?.isAnonymous,
      tenantId: auth?.currentUser?.tenantId,
      providerInfo:
        auth?.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  if (!db) return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();
