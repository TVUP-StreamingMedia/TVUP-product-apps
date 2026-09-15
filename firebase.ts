import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDRNyBDXfCgb68wvvGVztCLJRLEmybtySE",
  authDomain: "tvup-seed-wizard.firebaseapp.com",
  projectId: "tvup-seed-wizard",
  storageBucket: "tvup-seed-wizard.firebasestorage.app",
  messagingSenderId: "343186445936",
  appId: "1:343186445936:web:7cef2215ce702e213146b5",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
