import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDqTa1ZckjhYuHdLfzTnyZyITu6fWmltIE",
  authDomain: "trade-trends-70426.firebaseapp.com",
  projectId: "trade-trends-70426",
  storageBucket: "trade-trends-70426.firebasestorage.app",
  messagingSenderId: "17148570174",
  appId: "1:17148570174:web:837af3a3c2979d69daff6f"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true
});
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();

export { app, auth, db, storage, googleProvider };
