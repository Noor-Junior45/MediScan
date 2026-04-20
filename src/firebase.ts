import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, getDocFromServer, writeBatch, deleteField, serverTimestamp } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export { signInWithPopup, signOut, onAuthStateChanged, collection, doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, getDocFromServer, writeBatch, deleteField, serverTimestamp, signInWithEmailAndPassword, createUserWithEmailAndPassword, ref, uploadBytes, getDownloadURL, deleteObject };
export type { User };

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

// Safe stringify helper to handle circular references and non-serializable objects
const getSafeStringify = () => {
  const cache = new WeakSet();
  return (key: string, value: any) => {
    if (typeof value === 'object' && value !== null) {
      // Handle React internal fiber nodes and other internal properties early
      if (
        key.startsWith('__reactFiber') || 
        key.startsWith('__reactProps') || 
        key.startsWith('__reactEvents') || 
        key.startsWith('__reactContainer') ||
        key.startsWith('__reactInternal') ||
        key.startsWith('__reactEventHandlers')
      ) {
        return '[React Internal]';
      }

      if (cache.has(value)) {
        return '[Circular]';
      }
      
      // Handle DOM elements which often cause circular issues and can't be stringified
      // Use multiple checks for robustness across different environments
      const isDOM = (val: any): boolean => {
        try {
          return (
            val instanceof Node || 
            (typeof val.nodeType === 'number' && typeof val.nodeName === 'string') ||
            (val.constructor && (
              val.constructor.name === 'HTMLVideoElement' || 
              val.constructor.name === 'Window' || 
              val.constructor.name.includes('Element') ||
              val.constructor.name.includes('HTML')
            ))
          );
        } catch (e) {
          return false;
        }
      };

      if (isDOM(value)) {
        return `[DOM Element: ${value.nodeName || value.tagName || value.constructor?.name || 'Unknown'}]`;
      }

      cache.add(value);
    }
    return value;
  };
};

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  
  let errString: string;
  try {
    const safeStringify = getSafeStringify();
    errString = JSON.stringify(errInfo, safeStringify);
  } catch (e) {
    errString = `{"error": "Failed to stringify error info", "originalError": "${errInfo.error}"}`;
  }
  
  console.error('Firestore Error: ', errString);
  throw new Error(errString);
}

// Test connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
  }
}
testConnection();
