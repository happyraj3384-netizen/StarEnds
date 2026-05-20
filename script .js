/* ============================================================
   StarEnds — script.js
   Real-time group chat using Firebase v9 (Modular SDK)

   This file handles:
   1. Firebase initialization & config
   2. Google Authentication (login / logout)
   3. Firestore real-time message listener
   4. Send & delete messages
   5. Online presence system
   6. Typing indicator
   7. Emoji picker
   8. Toast notifications
   9. Notification sounds (Web Audio API)
   10. Mobile sidebar toggle
   11. Particle background on login screen
   ============================================================ */

// ============================================================
// FIREBASE SDK IMPORTS
// Using v9 modular SDK — works with CDN type="module"
// ============================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  setDoc,
  deleteField,
  updateDoc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';


// ============================================================
// FIREBASE CONFIG
// ============================================================
// STEP 1: Replace this entire firebaseConfig object with YOUR config.
// Get it from: Firebase Console → Project Settings → Your Apps → Web App
//
// It looks like this — replace every value:
//
// const firebaseConfig = {
//   apiKey: "AIzaSy...",
//   authDomain: "yourproject.firebaseapp.com",
//   projectId: "yourproject",
//   storageBucket: "yourproject.appspot.com",
//   messagingSenderId: "123456789",
//   appId: "1:123456789:web:abcdef"
// };
// ============================================================
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAP1Ich02VnXy6E9n28LZVqhBRFp6eFisA",
  authDomain: "starends-eb7cd.firebaseapp.com",
  projectId: "starends-eb7cd",
  storageBucket: "starends-eb7cd.firebasestorage.app",
  messagingSenderId: "385951624269",
  appId: "1:385951624269:web:d4baeec936dfa2fa370004",
  measurementId: "G-WLRJGNK00V"
};

// Initialize Firebase
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// Firestore collection references
const messagesRef  = collection(db, 'messages');
const onlineRef    = collection(db, 'onlineUsers');


// ============================================================
// APP STATE
// ============================================================
let currentUser   = null;         // Logged-in Firebase User object
let unsubMessages = null;         // Unsubscribe function for message listener
let unsubOnline   = null;         // Unsubscribe function for online users
let typingTimeout = null;         // Debounce timer for typing indicator
let isTyping      = false;        // Whether current user is typing
let lastSenderId  = null;         // For grouping consecutive messages
let lastMsgTime   = null;         // For grouping messages within 3 minutes


// ============================================================
// DOM ELEMENTS
// Cache them once on load for performance
// ============================================================
const loginScreen     = document.getElementById('loginScreen');
const chatApp         = document.getElementById('chatApp');
const googleLoginBtn  = document.getElementById('googleLoginBtn');
const logoutBtn       = document.getElementById('logoutBtn');
const msgInput        = document.getElementById('msgInput');
const sendBtn         = document.getElementById('sendBtn');
const messagesEl      = document.getElementById('messagesContainer');
const typingIndicator = document.getElementById('typingIndicator');
const typingText      = document.getElementById('typingText');
const emojiBtn        = document.getElementById('emojiBtn');
const emojiPicker     = document.getElementById('emojiPicker');
const sfAvatar        = document.getElementById('sfAvatar');
const sfName          = document.getElementById('sfName');
const onlineList      = document.getElementById('onlineList');
const onlineCount     = document.getElementById('onlineCount');
const headerOnline    = document.getElementById('headerOnlineCount');
const charCount       = document.getElementById('charCount');
const toastContainer  = document.getElementById('toastContainer');
const menuBtn         = document.getElementById('menuBtn');
const sidebar         = document.getElementById('sidebar');
const sidebarOverlay  = document.getElementById('sidebarOverlay');
const scrollBottomBtn = document.getElementById('scrollBottomBtn');

// ============================================================
// USER COLOR ASSIGNMENT
// Each user gets a consistent color based on their UID
// ============================================================
const USER_COLORS = ['color-1', 'color-2', 'color-3', 'color-4', 'color-5', 'color-6'];

function getUserColor(uid) {
  // Simple hash: sum char codes → modulo number of colors
  let sum = 0;
  for (let i = 0; i < uid.length; i++) sum += uid.charCodeAt(i);
  return USER_COLORS[sum % USER_COLORS.length];
}


// ============================================================
// FIREBASE AUTHENTICATION
// ============================================================

// Listen for auth state changes (login / logout)
onAuthStateChanged(auth, function(user) {
  if (user) {
    // User is signed in
    currentUser = user;
    showChatApp();
    setUserOnline();
    loadMessages();
    subscribeOnlineUsers();
    showToast(`Welcome back, ${user.displayName.split(' ')[0]}! 👋`, 'success');
  } else {
    // User signed out
    currentUser = null;
    showLoginScreen();
    stopListeners();
  }
});

// Google Login
googleLoginBtn.addEventListener('click', async function() {
  try {
    googleLoginBtn.innerHTML = '<span class="loading-spinner"></span> Signing in...';
    googleLoginBtn.disabled = true;

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' }); // Always show account picker

    await signInWithPopup(auth, provider);
    // onAuthStateChanged will handle the rest

  } catch (error) {
    console.error('Login error:', error);
    showToast('Login failed. Please try again.', 'error');

    googleLoginBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
        <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.7 33.1 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.7-.1-4z"/>
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-1.9 13.5-5.1l-6.2-5.2C29.4 35.5 26.8 36 24 36c-5.2 0-9.7-3-11.3-7.2L6 33.7C9.5 39.8 16.3 44 24 44z"/>
        <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.5-2.6 4.6-4.8 6l6.2 5.2C41.5 35.6 44 30.2 44 24c0-1.3-.1-2.7-.4-4z"/>
      </svg>
      Continue with Google
    `;
    googleLoginBtn.disabled = false;
  }
});

// Logout
logoutBtn.addEventListener('click', async function() {
  if (!confirm('Are you sure you want to sign out?')) return;
  try {
    await setUserOffline();  // Remove from online list first
    await signOut(auth);
    showToast('Signed out. See you soon! 👋', 'info');
  } catch (e) {
    console.error('Logout error:', e);
  }
});


// ============================================================
// UI SWITCHING
// ============================================================

function showLoginScreen() {
  loginScreen.style.display  = 'flex';
  chatApp.style.display       = 'none';
  createParticles();          // Animate background particles
}

function showChatApp() {
  loginScreen.style.display   = 'none';
  chatApp.style.display        = 'flex';

  // Update sidebar user info
  sfAvatar.src          = currentUser.photoURL || generateAvatar(currentUser.displayName);
  sfName.textContent    = currentUser.displayName || 'Anonymous';
}

function stopListeners() {
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  if (unsubOnline)   { unsubOnline();   unsubOnline   = null; }
}


// ============================================================
// ONLINE PRESENCE
// Tracks who is currently in the chat room
// ============================================================

async function setUserOnline() {
  if (!currentUser) return;
  try {
    await setDoc(doc(onlineRef, currentUser.uid), {
      uid:       currentUser.uid,
      name:      currentUser.displayName,
      photoURL:  currentUser.photoURL || '',
      joinedAt:  serverTimestamp(),
      isOnline:  true
    });

    // Announce join to chat
    await addSystemMessage(`${currentUser.displayName.split(' ')[0]} joined the chat 👋`);

    // Auto remove when tab closes
    window.addEventListener('beforeunload', setUserOffline);
  } catch (e) {
    console.error('Error setting online status:', e);
  }
}

async function setUserOffline() {
  if (!currentUser) return;
  try {
    await deleteDoc(doc(onlineRef, currentUser.uid));
  } catch (e) {
    console.error('Error setting offline:', e);
  }
}

function subscribeOnlineUsers() {
  unsubOnline = onSnapshot(collection(db, 'onlineUsers'), function(snapshot) {
    const users = [];
    snapshot.forEach(function(d) { users.push(d.data()); });

    // Update count
    onlineCount.textContent    = users.length;
    headerOnline.textContent   = users.length;

    // Render user list in sidebar
    renderOnlineUsers(users);

    // Update typing indicator (filter current user)
    updateTypingFromSnapshot(users);
  });
}

function renderOnlineUsers(users) {
  onlineList.innerHTML = '';

  users.forEach(function(user) {
    const el = document.createElement('div');
    el.className = 'online-user';

    const isMe = currentUser && user.uid === currentUser.uid;

    el.innerHTML = `
      <img class="ou-avatar"
           src="${user.photoURL || generateAvatar(user.name)}"
           alt="${escapeHTML(user.name)}"
           onerror="this.src='${generateAvatar(user.name)}'" />
      <span class="ou-name">${escapeHTML(user.name.split(' ')[0])}</span>
      ${isMe ? '<span class="ou-you">you</span>' : ''}
    `;

    onlineList.appendChild(el);
  });


  // ── Mirror users into activity panel ──
  // Reuses already-fetched Firebase data. Zero extra reads.
  const mirror = document.getElementById('apOnlineMirror');
  const syncFill = document.getElementById('apSyncFill');
  const syncPct = document.getElementById('apSyncPct');
  const memberFill = document.getElementById('apMemberFill');
  const memberPct = document.getElementById('apMemberPct');

  if (mirror) {
    mirror.innerHTML = '';
    users.forEach(function(user) {
      const isMe = currentUser && user.uid === currentUser.uid;
      const row = document.createElement('div');
      row.className = 'ap-user-row';
      row.innerHTML = `
        <img class="ap-user-avatar"
             src="${user.photoURL || generateAvatar(user.name)}"
             alt="${escapeHTML(user.name)}"
             onerror="this.src='${generateAvatar(user.name)}'" />
        <span class="ap-user-name">${escapeHTML(user.name.split(' ')[0])}</span>
        ${isMe ? '<span class="ap-user-you">you</span>' : ''}
      `;
      mirror.appendChild(row);
    });

    // Update sync bars based on online count
    const count = users.length;
    const energyPct = Math.min(100, count * 18);
    const memberDisplay = count;
    if (syncFill)  syncFill.style.width  = energyPct + '%';
    if (syncPct)   syncPct.textContent   = energyPct + '%';
    if (memberFill) memberFill.style.width = Math.min(100, count * 20) + '%';
    if (memberPct)  memberPct.textContent  = memberDisplay;
  }
}

// ============================================================
// MESSAGES — LOAD & LISTEN
// ============================================================

function loadMessages() {
  // Query last 100 messages, ordered by timestamp
  const q = query(messagesRef, orderBy('timestamp', 'asc'), limit(100));

  lastSenderId = null;
  lastMsgTime  = null;

  unsubMessages = onSnapshot(q, function(snapshot) {
    snapshot.docChanges().forEach(function(change) {
      if (change.type === 'added') {
        // New message received
        const data = change.doc.data();
if (!data.timestamp) return;

appendMessage(change.doc.id, data);

        // Play notification sound if message is from someone else
        if (change.doc.data().uid !== currentUser?.uid) {
          playNotificationSound();
        }
      }

      if (change.type === 'removed') {
        // Message was deleted
        const msgEl = document.getElementById('msg-' + change.doc.id);
        if (msgEl) {
          msgEl.querySelector('.msg-text').innerHTML = '<em class="msg-deleted">Message deleted</em>';
          msgEl.querySelector('.btn-delete-msg')?.remove();
        }
      }
    });

    scrollToBottom();
  });
}


// ============================================================
// RENDER A MESSAGE
// ============================================================

function appendMessage(id, data) {
  // Skip system messages (handled separately)
  if (data.type === 'system') {
    appendSystemMessage(data.text);
    lastSenderId = null;
    return;
  }

  const isOwn = currentUser && data.uid === currentUser.uid;
  const msgTime = data.timestamp?.toDate();

  // Determine if this message should be "compact"
  // (same sender within 3 minutes = no avatar/name repeat)
  const THREE_MIN = 3 * 60 * 1000;
  const isCompact = (
    lastSenderId === data.uid &&
    lastMsgTime  &&
    msgTime      &&
    (msgTime - lastMsgTime) < THREE_MIN
  );

  lastSenderId = data.uid;
  lastMsgTime  = msgTime;

  const colorClass = getUserColor(data.uid);

  const el = document.createElement('div');
  el.className = `message ${isOwn ? 'own' : ''} ${isCompact ? 'compact' : ''}`;
  el.id = 'msg-' + id;

  const avatarSrc = data.photoURL || generateAvatar(data.name);
  const timeStr   = msgTime ? formatTime(msgTime) : '';

  // Only show delete button on own messages

   const deleteBtn = '';

  el.innerHTML = `
    <img class="msg-avatar"
         src="${avatarSrc}"
         alt="${escapeHTML(data.name)}"
         onerror="this.src='${generateAvatar(data.name)}'" />
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-author ${colorClass}">${escapeHTML(data.name.split(' ')[0])}</span>
        <span class="msg-time">${timeStr}</span>
      </div>
      <div class="msg-text">
        ${escapeHTML(data.text)}
        ${deleteBtn}
      </div>
    </div>
  `;

  messagesEl.appendChild(el);
console.log("appendMessage finished");
}
function appendSystemMessage(text) {
  const el = document.createElement('div');
  el.className = 'join-notification';
  el.textContent = text;
  messagesEl.appendChild(el);
}


// ============================================================
// SEND MESSAGE
// ============================================================

async function sendMessage() {
   alert("send function working");
  const text = msgInput.value.trim();
  if (!text || !currentUser) return;

  // Disable input briefly to prevent double-send
  sendBtn.disabled   = true;
  msgInput.disabled  = true;

  try {
     alert("trying firebase");
    await addDoc(messagesRef, {
      uid:       currentUser.uid,
      name:      currentUser.displayName,
      photoURL:  currentUser.photoURL || '',
      text:      text,
      timestamp: serverTimestamp()
    });
     alert("firebase success");

    msgInput.value = '';
    charCount.textContent = '';
    sendBtn.disabled = false;
    msgInput.disabled = false;
    msgInput.focus();

    // Clear typing indicator
    clearTyping();

  } catch (error) {
    console.error('Error sending message:', error);
    showToast('Failed to send message. Check your connection.', 'error');
    sendBtn.disabled  = false;
    msgInput.disabled = false;
  }
}

// Send button click
sendBtn.addEventListener('click', sendMessage);

// Enter key sends, Shift+Enter does nothing (single-line input)
msgInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});


// ============================================================
// DELETE MESSAGE
// ============================================================

// Exposed globally so inline onclick can call it
window.deleteMessage = async function(msgId) {
  if (!currentUser) return;
  if (!confirm('Delete this message?')) return;

  try {
    await deleteDoc(doc(db, 'messages', msgId));
  } catch (e) {
    console.error('Error deleting:', e);
    showToast('Could not delete message.', 'error');
  }
};


// ============================================================
// SYSTEM MESSAGES
// (user joined notifications stored in Firestore)
// ============================================================

async function addSystemMessage(text) {
  try {
    await addDoc(messagesRef, {
      type:      'system',
      text:      text,
      timestamp: serverTimestamp()
    });
  } catch (e) {
    console.error('System msg error:', e);
  }
}


// ============================================================
// INPUT BEHAVIOR — Character count + send button enable
// ============================================================

msgInput.addEventListener('input', function() {
  const len = msgInput.value.length;
  const max = 500;

  // Enable/disable send button
  sendBtn.disabled = len === 0;

  // Character counter
  if (len > 400) {
    charCount.textContent = `${len}/${max}`;
    charCount.className = 'char-count ' + (len >= max ? 'over' : 'warn');
  } else {
    charCount.textContent = '';
    charCount.className = 'char-count';
  }

  // Typing indicator logic
  handleTypingIndicator();
});


// ============================================================
// TYPING INDICATOR
// Stores typing state in the onlineUsers document
// ============================================================

function handleTypingIndicator() {
  if (!currentUser) return;

  // Clear existing timeout
  clearTimeout(typingTimeout);

  if (!isTyping) {
    isTyping = true;
    updateTypingStatus(true);
  }

  // Stop typing after 2 seconds of inactivity
  typingTimeout = setTimeout(function() {
    clearTyping();
  }, 2000);
}

function clearTyping() {
  clearTimeout(typingTimeout);
  if (isTyping) {
    isTyping = false;
    updateTypingStatus(false);
  }
}

async function updateTypingStatus(typing) {
  if (!currentUser) return;
  try {
    await updateDoc(doc(onlineRef, currentUser.uid), {
      typing: typing ? currentUser.displayName.split(' ')[0] : deleteField()
    });
  } catch (e) {
    // Ignore — not critical
  }
}

function updateTypingFromSnapshot(users) {
  // Find users who are typing (other than current user)
  const typingUsers = users
    .filter(u => u.typing && u.uid !== currentUser?.uid)
    .map(u => u.typing);

  if (typingUsers.length > 0) {
    typingIndicator.style.display = 'flex';
    if (typingUsers.length === 1) {
      typingText.textContent = `${typingUsers[0]} is typing...`;
    } else {
      typingText.textContent = `${typingUsers.join(', ')} are typing...`;
    }
  } else {
    typingIndicator.style.display = 'none';
  }
}


// ============================================================
// EMOJI PICKER
// ============================================================

emojiBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  emojiPicker.classList.toggle('open');
});

// Click an emoji → insert into input
emojiPicker.querySelectorAll('span').forEach(function(span) {
  span.addEventListener('click', function() {
    const emoji = span.textContent;
    const pos   = msgInput.selectionStart || msgInput.value.length;
    msgInput.value = msgInput.value.slice(0, pos) + emoji + msgInput.value.slice(pos);
    msgInput.focus();
    msgInput.selectionStart = pos + emoji.length;
    msgInput.selectionEnd   = pos + emoji.length;

    // Trigger input event to update char count & send button
    msgInput.dispatchEvent(new Event('input'));
    emojiPicker.classList.remove('open');
  });
});

// Close emoji picker when clicking outside
document.addEventListener('click', function(e) {
  if (!emojiBtn.contains(e.target) && !emojiPicker.contains(e.target)) {
    emojiPicker.classList.remove('open');
  }
});


// ============================================================
// MOBILE SIDEBAR TOGGLE
// ============================================================

menuBtn.addEventListener('click', function() {
  sidebar.classList.toggle('mobile-open');
  sidebarOverlay.classList.toggle('visible');
});

sidebarOverlay.addEventListener('click', function() {
  sidebar.classList.remove('mobile-open');
  sidebarOverlay.classList.remove('visible');
});


// ============================================================
// SCROLL TO BOTTOM
// Auto-scroll to latest message
// ============================================================

function scrollToBottom(force) {
  // Only auto-scroll if user is near the bottom (within 200px)
  // OR if force is true
  const threshold = 200;
  const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < threshold;

  if (nearBottom || force) {
    setTimeout(function() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }, 50);
  }
}
messagesEl.addEventListener('scroll', function() {
  const distFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  if (distFromBottom > 200) {
    scrollBottomBtn.classList.add('visible');
  } else {
    scrollBottomBtn.classList.remove('visible');
  }
});

scrollBottomBtn.addEventListener('click', function() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
  scrollBottomBtn.classList.remove('visible');
});

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================

function showToast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', info: '💬' };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || '💬'}</span> ${escapeHTML(message)}`;

  toastContainer.appendChild(toast);

  // Auto-remove after 3.5 seconds
  setTimeout(function() {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(function() { toast.remove(); }, 300);
  }, 3500);
}


// ============================================================
// NOTIFICATION SOUND
// Generated via Web Audio API — no file needed
// ============================================================

let audioCtx = null;

function playNotificationSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const oscillator = audioCtx.createOscillator();
    const gainNode   = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type      = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.1);

    gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.3);
  } catch (e) {
    // Audio not supported — silently fail
  }
}


// ============================================================
// PARTICLE BACKGROUND (Login Screen)
// Creates floating dots for atmosphere
// ============================================================

function createParticles() {
  const container = document.getElementById('particles');
  if (!container) return;

  container.innerHTML = '';

  const colors = ['#00E5FF', '#7B61FF', '#00FF9D', '#FFD93D'];
  const count  = window.innerWidth < 500 ? 20 : 40;

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';

    const size  = Math.random() * 4 + 2;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const left  = Math.random() * 100;
    const delay = Math.random() * 8;
    const dur   = Math.random() * 10 + 8;

    p.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      left: ${left}%;
      bottom: -20px;
      box-shadow: 0 0 ${size * 2}px ${color};
      animation-duration: ${dur}s;
      animation-delay: ${delay}s;
    `;

    container.appendChild(p);
  }
}


// ============================================================
// UTILITY FUNCTIONS
// ============================================================

// Format timestamp to readable time (e.g. "2:45 PM")
function formatTime(date) {
  if (!date) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Escape HTML to prevent XSS injection
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Generate a simple colored avatar placeholder when no photo available
function generateAvatar(name) {
  const colors = ['#00E5FF', '#7B61FF', '#00FF9D', '#FFD93D', '#FF6B9D'];
  const char   = (name || '?').charAt(0).toUpperCase();
  let hash     = 0;
  for (let i = 0; i < (name || '').length; i++) hash += (name || '').charCodeAt(i);
  const color  = colors[hash % colors.length];

  // Return a data URI SVG as placeholder avatar
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
    <rect width="36" height="36" rx="18" fill="${color}22" stroke="${color}" stroke-width="1.5"/>
    <text x="18" y="23" text-anchor="middle" font-size="16" font-family="Syne,sans-serif" font-weight="700" fill="${color}">${char}</text>
  </svg>`;

  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}


// ============================================================
// INIT ON PAGE LOAD
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
  // Start with login screen and particles
  createParticles();

  // Focus input when clicking anywhere in the chat main area
  document.getElementById('chatApp')?.addEventListener('click', function(e) {
    if (!emojiPicker.classList.contains('open') && e.target.tagName !== 'BUTTON') {
      msgInput.focus();
    }
  });

  console.log('⚡ StarEnds initialized. Waiting for auth...');
});

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
  clearTyping();
  setUserOffline();
});
