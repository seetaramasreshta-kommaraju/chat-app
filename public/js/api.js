const API = {
  baseUrl: '',

  getToken() {
    return localStorage.getItem('chat_token');
  },

  getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  },

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}/api${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: { ...this.getHeaders(), ...options.headers },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Request failed: ${response.status}`);
    }

    return data;
  },

  // Auth
  async login(username, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  async register(username, password) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  async getMe() {
    return this.request('/auth/me');
  },

  // Rooms
  async getRooms() {
    return this.request('/rooms');
  },

  async createRoom(name) {
    return this.request('/rooms', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  async getRoom(id) {
    return this.request(`/rooms/${id}`);
  },

  async getMessages(roomId, before = null, limit = 50) {
    let url = `/rooms/${roomId}/messages?limit=${limit}`;
    if (before) url += `&before=${before}`;
    return this.request(url);
  },
};
