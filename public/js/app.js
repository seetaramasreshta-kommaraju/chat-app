// ===== State =====
const state = {
  user: null,
  token: null,
  socket: null,
  rooms: [],
  currentRoom: null,
  onlineUsers: [],
  typingUsers: {}, // roomId -> [{ userId, username }]
  messages: {}, // roomId -> [messages]
};

// ===== DOM Elements =====
const authScreen = document.getElementById('auth-screen');
const chatScreen = document.getElementById('chat-screen');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginError = document.getElementById('login-error');
const registerError = document.getElementById('register-error');
const logoutBtn = document.getElementById('logout-btn');
const currentUsername = document.getElementById('current-username');
const roomsList = document.getElementById('rooms-list');
const onlineUsersList = document.getElementById('online-users-list');
const onlineCount = document.getElementById('online-count');
const noRoomSelected = document.getElementById('no-room-selected');
const chatContainer = document.getElementById('chat-container');
const chatRoomName = document.getElementById('chat-room-name');
const chatRoomInfo = document.getElementById('chat-room-info');
const messagesContainer = document.getElementById('messages-container');
const messagesList = document.getElementById('messages-list');
const typingIndicator = document.getElementById('typing-indicator');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const createRoomBtn = document.getElementById('create-room-btn');
const createRoomModal = document.getElementById('create-room-modal');
const createRoomForm = document.getElementById('create-room-form');
const createRoomError = document.getElementById('create-room-error');
const cancelCreateRoom = document.getElementById('cancel-create-room');
const roomNameInput = document.getElementById('room-name-input');

// ===== Initialization =====
async function init() {
  // Check for saved token
  const savedToken = localStorage.getItem('chat_token');
  const savedUser = localStorage.getItem('chat_user');

  if (savedToken && savedUser) {
    try {
      state.token = savedToken;
      state.user = JSON.parse(savedUser);
      await validateToken();
    } catch {
      clearAuth();
    }
  }

  setupEventListeners();
}

function clearAuth() {
  localStorage.removeItem('chat_token');
  localStorage.removeItem('chat_user');
  state.token = null;
  state.user = null;
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
}

async function validateToken() {
  try {
    const data = await API.getMe();
    state.user = data.user;
    showChatScreen();
    connectSocket();
    await loadRooms();
  } catch {
    clearAuth();
  }
}

// ===== Event Listeners =====
function setupEventListeners() {
  // Auth tabs
  document.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach((f) => f.classList.remove('active'));
      tab.classList.add('active');
      const form = document.getElementById(`${tab.dataset.tab}-form`);
      form.classList.add('active');
      loginError.textContent = '';
      registerError.textContent = '';
    });
  });

  // Login
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    loginError.textContent = '';

    try {
      const data = await API.login(username, password);
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('chat_token', data.token);
      localStorage.setItem('chat_user', JSON.stringify(data.user));
      showChatScreen();
      connectSocket();
      await loadRooms();
    } catch (err) {
      loginError.textContent = err.message;
    }
  });

  // Register
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    registerError.textContent = '';

    try {
      const data = await API.register(username, password);
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('chat_token', data.token);
      localStorage.setItem('chat_user', JSON.stringify(data.user));
      showChatScreen();
      connectSocket();
      await loadRooms();
    } catch (err) {
      registerError.textContent = err.message;
    }
  });

  // Logout
  logoutBtn.addEventListener('click', () => {
    clearAuth();
    showAuthScreen();
  });

  // Message form
  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });

  // Typing indicator
  let typingTimeout;
  messageInput.addEventListener('input', () => {
    if (!state.currentRoom) return;

    // Emit typing start
    state.socket.emit('typing:start', state.currentRoom.id);

    // Clear existing timeout
    clearTimeout(typingTimeout);

    // Set timeout to emit typing stop
    typingTimeout = setTimeout(() => {
      state.socket.emit('typing:stop', state.currentRoom.id);
    }, 2000);
  });

  // Create room
  createRoomBtn.addEventListener('click', () => {
    createRoomModal.classList.add('active');
    roomNameInput.value = '';
    createRoomError.textContent = '';
    roomNameInput.focus();
  });

  cancelCreateRoom.addEventListener('click', () => {
    createRoomModal.classList.remove('active');
  });

  createRoomModal.querySelector('.modal-overlay').addEventListener('click', () => {
    createRoomModal.classList.remove('active');
  });

  createRoomForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = roomNameInput.value.trim();
    createRoomError.textContent = '';

    try {
      const data = await API.createRoom(name);
      createRoomModal.classList.remove('active');
      await loadRooms();
      selectRoom(data.room.id);
    } catch (err) {
      createRoomError.textContent = err.message;
    }
  });
}

// ===== Screen Management =====
function showAuthScreen() {
  chatScreen.classList.remove('active');
  authScreen.classList.add('active');
}

function showChatScreen() {
  authScreen.classList.remove('active');
  chatScreen.classList.add('active');
  currentUsername.textContent = state.user.username;
}

// ===== Socket.IO =====
function connectSocket() {
  if (state.socket) {
    state.socket.disconnect();
  }

  state.socket = io({
    auth: { token: state.token },
  });

  state.socket.on('connect', () => {
    console.log('Connected to server');
  });

  state.socket.on('connect_error', (err) => {
    console.error('Connection error:', err.message);
    if (err.message.includes('Authentication') || err.message.includes('Invalid token')) {
      clearAuth();
      showAuthScreen();
    }
  });

  state.socket.on('disconnect', () => {
    console.log('Disconnected from server');
  });

  // Online users
  state.socket.on('presence:online', (users) => {
    state.onlineUsers = users;
    renderOnlineUsers();
  });

  // New message
  state.socket.on('message:received', (message) => {
    const roomMessages = state.messages[message.roomId] || [];
    roomMessages.push(message);
    state.messages[message.roomId] = roomMessages;

    if (state.currentRoom && state.currentRoom.id === message.roomId) {
      renderMessage(message);
      scrollToBottom();
    }
  });

  // Typing indicator
  state.socket.on('typing:update', (data) => {
    const { roomId, userId, username, isTyping } = data;

    if (!state.typingUsers[roomId]) {
      state.typingUsers[roomId] = [];
    }

    if (isTyping) {
      // Add user to typing list if not already there
      const exists = state.typingUsers[roomId].find((u) => u.userId === userId);
      if (!exists) {
        state.typingUsers[roomId].push({ userId, username });
      }
    } else {
      // Remove user from typing list
      state.typingUsers[roomId] = state.typingUsers[roomId].filter((u) => u.userId !== userId);
    }

    if (state.currentRoom && state.currentRoom.id === roomId) {
      renderTypingIndicator();
    }
  });

  // User joined room
  state.socket.on('room:user_joined', (data) => {
    if (state.currentRoom && state.currentRoom.id === data.roomId) {
      addSystemMessage(data.roomId, `${data.username} joined the room`);
    }
  });

  // User left room
  state.socket.on('room:user_left', (data) => {
    if (state.currentRoom && state.currentRoom.id === data.roomId) {
      addSystemMessage(data.roomId, `${data.username} left the room`);
    }
  });
}

// ===== Rooms =====
async function loadRooms() {
  try {
    const data = await API.getRooms();
    state.rooms = data.rooms;
    renderRooms();
  } catch (err) {
    console.error('Failed to load rooms:', err);
  }
}

function renderRooms() {
  roomsList.innerHTML = '';

  state.rooms.forEach((room) => {
    const div = document.createElement('div');
    div.className = `room-item ${state.currentRoom && state.currentRoom.id === room.id ? 'active' : ''}`;
    div.dataset.roomId = room.id;
    div.innerHTML = `
      <span class="room-icon">#</span>
      <span class="room-name">${escapeHtml(room.name)}</span>
      <span class="room-members">${room.member_count}</span>
    `;
    div.addEventListener('click', () => selectRoom(room.id));
    roomsList.appendChild(div);
  });
}

function selectRoom(roomId) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return;

  // Leave current room
  if (state.currentRoom && state.socket) {
    state.socket.emit('room:leave', state.currentRoom.id);
  }

  state.currentRoom = room;
  state.messages[roomId] = state.messages[roomId] || [];

  // Update UI
  noRoomSelected.style.display = 'none';
  chatContainer.classList.add('active');
  chatRoomName.textContent = `# ${room.name}`;
  chatRoomInfo.textContent = `${room.member_count} members`;

  // Clear and render messages
  messagesList.innerHTML = '';
  state.messages[roomId].forEach((msg) => renderMessage(msg));
  scrollToBottom();

  // Join room via socket
  state.socket.emit('room:join', roomId, (response) => {
    if (response.error) {
      console.error('Failed to join room:', response.error);
      return;
    }

    // Update messages from server (in case we missed any)
    state.messages[roomId] = response.messages;
    messagesList.innerHTML = '';
    response.messages.forEach((msg) => renderMessage(msg));
    scrollToBottom();
  });

  // Update active room in sidebar
  renderRooms();
}

// ===== Messages =====
function sendMessage() {
  const content = messageInput.value.trim();
  if (!content || !state.currentRoom || !state.socket) return;

  state.socket.emit('message:send', {
    roomId: state.currentRoom.id,
    content,
  }, (response) => {
    if (response.error) {
      console.error('Failed to send message:', response.error);
    }
  });

  messageInput.value = '';
  messageInput.focus();

  // Stop typing indicator
  state.socket.emit('typing:stop', state.currentRoom.id);
}

function renderMessage(message) {
  const isOwn = message.userId === state.user.id;
  const div = document.createElement('div');
  div.className = `message ${isOwn ? 'own' : 'other'}`;

  const time = formatTime(message.createdAt || message.created_at);

  div.innerHTML = `
    ${!isOwn ? `<div class="message-username">${escapeHtml(message.username)}</div>` : ''}
    <div class="message-bubble">${escapeHtml(message.content)}</div>
    <div class="message-meta">${time}</div>
  `;

  messagesList.appendChild(div);
}

function addSystemMessage(roomId, text) {
  const div = document.createElement('div');
  div.className = 'message system';
  div.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
  messagesList.appendChild(div);
  scrollToBottom();
}

function renderTypingIndicator() {
  if (!state.currentRoom) return;

  const typing = state.typingUsers[state.currentRoom.id] || [];
  // Filter out current user
  const othersTyping = typing.filter((u) => u.userId !== state.user.id);

  if (othersTyping.length === 0) {
    typingIndicator.textContent = '';
  } else if (othersTyping.length === 1) {
    typingIndicator.textContent = `${othersTyping[0].username} is typing...`;
  } else if (othersTyping.length === 2) {
    typingIndicator.textContent = `${othersTyping[0].username} and ${othersTyping[1].username} are typing...`;
  } else {
    typingIndicator.textContent = 'Several people are typing...';
  }
}

// ===== Online Users =====
function renderOnlineUsers() {
  onlineUsersList.innerHTML = '';
  onlineCount.textContent = state.onlineUsers.length;

  state.onlineUsers.forEach((user) => {
    const div = document.createElement('div');
    div.className = 'online-user';
    const isSelf = user.userId === state.user.id;
    div.innerHTML = `
      <span class="status-dot"></span>
      <span class="username">${escapeHtml(user.username)}${isSelf ? ' (you)' : ''}</span>
    `;
    onlineUsersList.appendChild(div);
  });
}

// ===== Utilities =====
function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ===== Start =====
init();
