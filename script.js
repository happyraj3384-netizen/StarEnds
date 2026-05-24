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
// ALL imports must be at the top — ES module rule
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
  initializeFirestore,
  CACHE_SIZE_UNLIMITED,
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
  getDoc,
  getDocs
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ============================================================
// FIREBASE CONFIG — Replace with your own from Firebase Console
// ============================================================
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
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,   // fixes WebChannel errors on mobile networks
  useFetchStreams: false
});
// FIX #2 + #3: Removed illegal mid-file import and deprecated
// enableIndexedDbPersistence call. getFirestore() is sufficient.

// Firestore collection references
const messagesRef = collection(db, 'messages');
const onlineRef   = collection(db, 'onlineUsers');


// ============================================================
// APP STATE
// ============================================================
let currentUser   = null;
let unsubMessages = null;
let unsubOnline   = null;
let typingTimeout = null;
let isTyping      = false;
let lastSenderId  = null;
let lastMsgTime   = null;


// ============================================================
// DOM ELEMENTS — cached once on load
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
// ADD THIS — show loading overlay until auth resolves
chatApp.style.display    = 'none';

// ============================================================
// USER COLOR ASSIGNMENT
// ============================================================
const USER_COLORS = ['color-1', 'color-2', 'color-3', 'color-4', 'color-5', 'color-6'];

function getUserColor(uid) {
  let sum = 0;
  for (let i = 0; i < uid.length; i++) sum += uid.charCodeAt(i);
  return USER_COLORS[sum % USER_COLORS.length];
}


// ============================================================
// FIREBASE AUTHENTICATION
// ============================================================

// FIX #4: Removed requestAnimationFrame wrapper — unnecessary delay
onAuthStateChanged(auth, function(user) {
  // Hide loading screen on first auth resolution
  const loadingEl = document.getElementById('authLoading');
  if (loadingEl) loadingEl.remove();

  if (user) {
    currentUser = user;
    window._currentUser = user;
    showChatApp();
    setUserOnline();
    loadMessages();
    subscribeOnlineUsers();
    showToast(`Welcome back, ${user.displayName.split(' ')[0]}! 👋`, 'success');
  } else {
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
    provider.setCustomParameters({ prompt: 'select_account' });

    await signInWithPopup(auth, provider);
    // onAuthStateChanged handles the rest

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
    await setUserOffline();
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
  loginScreen.style.display = 'flex';
  chatApp.style.display     = 'none';
  createParticles();
}

function showChatApp() {
  loginScreen.style.display = 'none';
  chatApp.style.display     = 'flex';
  sfAvatar.src              = currentUser.photoURL || generateAvatar(currentUser.displayName);
  sfName.textContent        = currentUser.displayName || 'Anonymous';
}

function stopListeners() {
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  if (unsubOnline)   { unsubOnline();   unsubOnline   = null; }
  if (window._pollInterval)      { clearInterval(window._pollInterval);      window._pollInterval      = null; }
  if (window._snapshotWatchdog)  { clearInterval(window._snapshotWatchdog);  window._snapshotWatchdog  = null; }
  if (messagesEl) {
    messagesEl.innerHTML = '<div class="system-message" id="welcomeMsg">⚡ Welcome to <strong>#general</strong> — StarEnds is live. Say something!</div>';
  }
  lastSenderId = null;
  lastMsgTime  = null;
}

// ============================================================
// ONLINE PRESENCE
// ============================================================

async function setUserOnline() {
  if (!currentUser) return;
  try {
    // Check if already online — prevents duplicate join messages on re-auth
    const existingDoc  = await getDoc(doc(onlineRef, currentUser.uid));
    const alreadyOnline = existingDoc.exists();

    await setDoc(doc(onlineRef, currentUser.uid), {
      uid:      currentUser.uid,
      name:     currentUser.displayName,
      photoURL: currentUser.photoURL || '',
      joinedAt: serverTimestamp(),
      isOnline: true
    });

    // Only post join message on fresh session
    if (!alreadyOnline) {
      await addSystemMessage(`${currentUser.displayName.split(' ')[0]} joined the chat 👋`);
    }
    // FIX #6: Removed duplicate beforeunload here — handled at bottom of file

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
  if (unsubOnline) { unsubOnline(); unsubOnline = null; }
  unsubOnline = onSnapshot(collection(db, 'onlineUsers'), function(snapshot) {
    const users = [];
    snapshot.forEach(function(d) { users.push(d.data()); });

    onlineCount.textContent  = users.length;
    headerOnline.textContent = users.length;

    renderOnlineUsers(users);
    updateTypingFromSnapshot(users);
  });
}

function renderOnlineUsers(users) {
  onlineList.innerHTML = '';

  users.forEach(function(user) {
    const el  = document.createElement('div');
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

  // Mirror into activity panel
  const mirror     = document.getElementById('apOnlineMirror');
  const syncFill   = document.getElementById('apSyncFill');
  const syncPct    = document.getElementById('apSyncPct');
  const memberFill = document.getElementById('apMemberFill');
  const memberPct  = document.getElementById('apMemberPct');

  if (mirror) {
    mirror.innerHTML = '';
    users.forEach(function(user) {
      const isMe = currentUser && user.uid === currentUser.uid;
      const row  = document.createElement('div');
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

    const count     = users.length;
    const energyPct = Math.min(100, count * 18);
    if (syncFill)   syncFill.style.width   = energyPct + '%';
    if (syncPct)    syncPct.textContent    = energyPct + '%';
    if (memberFill) memberFill.style.width = Math.min(100, count * 20) + '%';
    if (memberPct)  memberPct.textContent  = count;
  }
}


// ============================================================
// MESSAGES — LOAD & LISTEN
// ============================================================

function loadMessages() {
  if (unsubMessages) { unsubMessages(); unsubMessages = null; }
  if (window._pollInterval) { clearInterval(window._pollInterval); window._pollInterval = null; }
  if (window._snapshotWatchdog) { clearInterval(window._snapshotWatchdog); window._snapshotWatchdog = null; }

  lastSenderId = null;
  lastMsgTime  = null;

  let snapshotFired  = false;
  let lastSnapshotAt = Date.now();

  const q = query(messagesRef, orderBy('timestamp', 'asc'), limit(100));

  unsubMessages = onSnapshot(
    q,
    function(snapshot) {
      snapshotFired  = true;
      lastSnapshotAt = Date.now();

      snapshot.docChanges().forEach(function(change) {
        if (change.type === 'added') {
          if (document.getElementById('msg-' + change.doc.id)) return;
          appendMessage(change.doc.id, change.doc.data());
          if (change.doc.data().uid !== currentUser?.uid) {
            playNotificationSound();
          }
        }
        if (change.type === 'removed') {
          const isStillPresent = snapshot.docs.some(function(d) { return d.id === change.doc.id; });
          const msgEl = document.getElementById('msg-' + change.doc.id);
          if (msgEl && !isStillPresent) {
            const msgText = msgEl.querySelector('.msg-text');
            if (msgText) msgText.innerHTML = '<em class="msg-deleted">Message deleted</em>';
            msgEl.querySelector('.btn-delete-msg')?.remove();
          }
        }
      });
      scrollToBottom();
    },
    function(error) {
      console.error('onSnapshot failed:', error.code, error.message);
      if (unsubMessages) { unsubMessages(); unsubMessages = null; }
      if (window._snapshotWatchdog) { clearInterval(window._snapshotWatchdog); window._snapshotWatchdog = null; }
      startPolling();
    }
  );

  // Watchdog: if snapshot stops firing for 20 seconds, switch to polling
  window._snapshotWatchdog = setInterval(function() {
    if (!currentUser) return;
    const silentFor = Date.now() - lastSnapshotAt;
    if (snapshotFired && silentFor > 20000) {
      console.warn('Snapshot silent for 20s — switching to polling');
      if (unsubMessages) { unsubMessages(); unsubMessages = null; }
      clearInterval(window._snapshotWatchdog);
      window._snapshotWatchdog = null;
      startPolling();
    }
    if (!snapshotFired && silentFor > 8000) {
      console.warn('Snapshot never fired — switching to polling');
      if (unsubMessages) { unsubMessages(); unsubMessages = null; }
      clearInterval(window._snapshotWatchdog);
      window._snapshotWatchdog = null;
      startPolling();
    }
  }, 5000);
}

async function startPolling() {
  if (window._pollInterval) { clearInterval(window._pollInterval); window._pollInterval = null; }

  async function poll() {
    if (!currentUser) return;
    try {
      const q = query(messagesRef, orderBy('timestamp', 'asc'), limit(100));
      const snap = await getDocs(q);
      snap.forEach(function(docSnap) {
        if (!document.getElementById('msg-' + docSnap.id)) {
          appendMessage(docSnap.id, docSnap.data());
        }
      });
      scrollToBottom();
    } catch (e) {
      console.error('Poll error:', e);
    }
  }

  await poll();
  window._pollInterval = setInterval(poll, 5000);
}
// ============================================================
// RENDER A MESSAGE
// FIX #1: appendMessage function brace structure fully corrected.
// The timestamp block was accidentally closing the function early.
// ============================================================

function appendMessage(id, data) {
  // System messages render differently
  if (data.type === 'system') {
    appendSystemMessage(data.text);
    lastSenderId = null;
    return;
  }

  const isOwn = currentUser && data.uid === currentUser.uid;
  let msgTime  = null;

  // FIX #1 — this block is now properly INSIDE the function
  if (data.timestamp) {
    if (typeof data.timestamp.toDate === 'function') {
      msgTime = data.timestamp.toDate();
    } else {
      msgTime = new Date(data.timestamp);
    }
  }

  // Compact grouping: same sender within 3 minutes
  const THREE_MIN  = 3 * 60 * 1000;
  const isCompact  = (
    lastSenderId === data.uid &&
    lastMsgTime  &&
    msgTime      &&
    (msgTime - lastMsgTime) < THREE_MIN
  );

  lastSenderId = data.uid;
  lastMsgTime  = msgTime || lastMsgTime;

  const colorClass = getUserColor(data.uid);
  const el         = document.createElement('div');
  el.className     = `message ${isOwn ? 'own' : ''} ${isCompact ? 'compact' : ''}`;
  el.id            = 'msg-' + id;

  const avatarSrc = data.photoURL || generateAvatar(data.name);
  const timeStr   = msgTime ? formatTime(msgTime) : '';

  const deleteBtn = isOwn ? `
    <button class="btn-delete-msg" onclick="deleteMessage('${id}')" title="Delete message">×</button>
  ` : '';

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
}

function appendSystemMessage(text) {
  const el      = document.createElement('div');
  el.className  = 'join-notification';
  el.textContent = text;
  messagesEl.appendChild(el);
}


// ============================================================
// SEND MESSAGE
// ============================================================

// AFTER
async function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  if (!currentUser) {
    showToast('Not signed in. Please reload and log in again.', 'error');
    return;
  }

  sendBtn.disabled  = true;
  msgInput.disabled = true;

  try {
    await addDoc(messagesRef, {
      uid:       currentUser.uid,
      name:      currentUser.displayName,
      photoURL:  currentUser.photoURL || '',
      text:      text,
      timestamp: new Date()
    });

    msgInput.value        = '';
    charCount.textContent = '';
    sendBtn.disabled      = false;
    msgInput.disabled     = false;
    msgInput.focus();
    clearTyping();

  } catch (error) {
    console.error('Error sending message:', error);
    showToast('Failed to send message. Check your connection.', 'error');
    sendBtn.disabled  = false;
    msgInput.disabled = false;
  }
}

sendBtn.addEventListener('click', sendMessage);

msgInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});


// ============================================================
// DELETE MESSAGE
// ============================================================

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
// ============================================================

async function addSystemMessage(text) {
  if (!currentUser) return;
  try {
    await addDoc(messagesRef, {
      type:      'system',
      uid:       currentUser.uid,
      text:      text,
      timestamp: new Date()
    });
  } catch (e) {
    console.error('System msg error:', e);
  }
}

// ============================================================
// INPUT BEHAVIOR — character count + send button enable
// ============================================================

msgInput.addEventListener('input', function() {
  const len = msgInput.value.length;
  const max = 500;

  sendBtn.disabled = len === 0;

  if (len > 400) {
    charCount.textContent = `${len}/${max}`;
    charCount.className   = 'char-count ' + (len >= max ? 'over' : 'warn');
  } else {
    charCount.textContent = '';
    charCount.className   = 'char-count';
  }

  handleTypingIndicator();
});


// ============================================================
// TYPING INDICATOR
// ============================================================

function handleTypingIndicator() {
  if (!currentUser) return;
  clearTimeout(typingTimeout);

  if (!isTyping) {
    isTyping = true;
    updateTypingStatus(true);
  }

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
    // Not critical — ignore
  }
}

function updateTypingFromSnapshot(users) {
  const typingUsers = users
    .filter(u => u.typing && u.uid !== currentUser?.uid)
    .map(u => u.typing);

  if (typingUsers.length > 0) {
    typingIndicator.style.display = 'flex';
    typingText.textContent = typingUsers.length === 1
      ? `${typingUsers[0]} is typing...`
      : `${typingUsers.join(', ')} are typing...`;
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

emojiPicker.querySelectorAll('span').forEach(function(span) {
  span.addEventListener('click', function() {
    const emoji = span.textContent;
    const pos   = msgInput.selectionStart || msgInput.value.length;
    msgInput.value          = msgInput.value.slice(0, pos) + emoji + msgInput.value.slice(pos);
    msgInput.focus();
    msgInput.selectionStart = pos + emoji.length;
    msgInput.selectionEnd   = pos + emoji.length;
    msgInput.dispatchEvent(new Event('input'));
    emojiPicker.classList.remove('open');
  });
});

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
// ============================================================

function scrollToBottom(force) {
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

  setTimeout(function() {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(function() { toast.remove(); }, 300);
  }, 3500);
}


// ============================================================
// NOTIFICATION SOUND
// ============================================================

let audioCtx = null;

function playNotificationSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode   = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.3);
  } catch (e) {
    // Audio not supported — ignore
  }
}


// ============================================================
// PARTICLE BACKGROUND (Login Screen)
// ============================================================

function createParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  container.innerHTML = '';

  const colors = ['#00E5FF', '#7B61FF', '#00FF9D', '#FFD93D'];
  const count  = window.innerWidth < 500 ? 20 : 40;

  for (let i = 0; i < count; i++) {
    const p     = document.createElement('div');
    p.className = 'particle';
    const size  = Math.random() * 4 + 2;
    const color = colors[Math.floor(Math.random() * colors.length)];
    p.style.cssText = `
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      left: ${Math.random() * 100}%;
      bottom: -20px;
      box-shadow: 0 0 ${size * 2}px ${color};
      animation-duration: ${Math.random() * 10 + 8}s;
      animation-delay: ${Math.random() * 8}s;
    `;
    container.appendChild(p);
  }
}


// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function formatTime(date) {
  if (!date) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function generateAvatar(name) {
  const colors = ['#00E5FF', '#7B61FF', '#00FF9D', '#FFD93D', '#FF6B9D'];
  const char   = (name || '?').charAt(0).toUpperCase();
  let hash     = 0;
  for (let i = 0; i < (name || '').length; i++) hash += (name || '').charCodeAt(i);
  const color  = colors[hash % colors.length];
  const svg    = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
    <rect width="36" height="36" rx="18" fill="${color}22" stroke="${color}" stroke-width="1.5"/>
    <text x="18" y="23" text-anchor="middle" font-size="16" font-family="Syne,sans-serif" font-weight="700" fill="${color}">${char}</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}


// ============================================================
// INIT — ES modules are deferred, DOM is ready here
// FIX #5: DOMContentLoaded removed — fires before module executes
// ============================================================
createParticles();

document.getElementById('chatApp')?.addEventListener('click', function(e) {
  if (!emojiPicker.classList.contains('open') && e.target.tagName !== 'BUTTON') {
    msgInput.focus();
  }
});

console.log('⚡ StarEnds initialized. Waiting for auth...');


// ============================================================
// CLEANUP ON PAGE UNLOAD
// FIX #6: Single beforeunload handler — covers both typing + offline
// ============================================================
window.addEventListener('beforeunload', function() {
  clearTyping();
  setUserOffline();
});
