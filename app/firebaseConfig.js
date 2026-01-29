import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore"; // Added for database
import { getAuth } from "firebase/auth"; // Added for login

const firebaseConfig = {
  apiKey: "AIzaSyDlobwR52cQZPO-aRQQjMb0XqSlrr1PCZc",
  authDomain: "bus-inventory.firebaseapp.com",
  projectId: "bus-inventory",
  storageBucket: "bus-inventory.firebasestorage.app",
  messagingSenderId: "449114522566",
  appId: "1:449114522566:web:465cbef0f2cae216eb28c7",
  measurementId: "G-SXFCZ0EK9N"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// THESE ARE THE MISSING LINKS:
export const db = getFirestore(app);
export const auth = getAuth(app);