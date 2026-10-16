const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const db = require('./db');
const { router: authRouter, authMiddleware } = require('./auth');
const { setupSocket } = require('./socket');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Auth routes
app.use('/api/auth', authRouter);

// Get all rooms
app.get('/api/rooms', authMiddleware, (req, res) => {
  const rooms = db.prepare(`
    SELECT r.id, r.name, r.created_at, 
           (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = r.id) as member_count,
           (SELECT COUNT(*) FROM messages m WHERE m.room_id = r.id) as message_count
    FROM rooms r
    ORDER BY r.name ASC
  `).all();
  res.json({ rooms });
});

// Create a new room
app.post('/api/rooms', authMiddleware, (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Room name is required' });
    }

    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 50) {
      return res.status(400).json({ error: 'Room name must be 2-50 characters' });
    }

    const existing = db.prepare('SELECT id FROM rooms WHERE name = ?').get(trimmedName);
    if (existing) {
      return res.status(409).json({ error: 'Room name already exists' });
    }

    const result = db.prepare('INSERT INTO rooms (name, created_by) VALUES (?, ?)')
      .run(trimmedName, req.user.id);

    // Auto-join the creator
    db.prepare('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)')
      .run(result.lastInsertRowid, req.user.id);

    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ room });
  } catch (err) {
    console.error('Create room error:', err);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Get room details with members
app.get('/api/rooms/:id', authMiddleware, (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const members = db.prepare(`
    SELECT u.id, u.username 
    FROM room_members rm 
    JOIN users u ON rm.user_id = u.id 
    WHERE rm.room_id = ?
  `).all(req.params.id);

  res.json({ room, members });
});

// Get messages for a room (REST fallback)
app.get('/api/rooms/:id/messages', authMiddleware, (req, res) => {
  const roomId = req.params.id;
  const before = req.query.before; // cursor: message id to get messages before
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  let messages;
  if (before) {
    messages = db.prepare(
      'SELECT * FROM messages WHERE room_id = ? AND id < ? ORDER BY created_at DESC LIMIT ?'
    ).all(roomId, before, limit);
    messages.reverse();
  } else {
    messages = db.prepare(
      'SELECT * FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(roomId, limit);
    messages.reverse();
  }

  res.json({ messages });
});

// Get users in a room (for member list)
app.get('/api/rooms/:id/online', authMiddleware, (req, res) => {
  // This is handled via sockets, but we can return room members
  const members = db.prepare(`
    SELECT u.id, u.username 
    FROM room_members rm 
    JOIN users u ON rm.user_id = u.id 
    WHERE rm.room_id = ?
  `).all(req.params.id);
  res.json({ members });
});

// Serve the SPA for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Setup Socket.IO
setupSocket(io);

// Start server
server.listen(PORT, () => {
  console.log(`\n  🚀 Chat server running at http://localhost:${PORT}\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ❌ Port ${PORT} is already in use. Stop the other process or use a different port.\n`);
    process.exit(1);
  }
});
