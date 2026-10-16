const jwt = require('jsonwebtoken');
const db = require('./db');
const { JWT_SECRET } = require('./auth');

// Track online users: userId -> { socketId, username, rooms: Set }
const onlineUsers = new Map();

function setupSocket(io) {
  // Auth middleware for socket connections
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(decoded.userId);
      if (!user) {
        return next(new Error('User not found'));
      }
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    console.log(`[Socket] ${user.username} connected (${socket.id})`);

    // Track user as online
    onlineUsers.set(user.id, {
      socketId: socket.id,
      username: user.username,
      rooms: new Set(),
    });

    // Broadcast updated online users list to everyone
    broadcastOnlineUsers(io);

    // Send current online users to the newly connected socket
    socket.emit('presence:online', getOnlineUsersList());

    // Join a room
    socket.on('room:join', (roomId, callback) => {
      try {
        const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
        if (!room) {
          return callback && callback({ error: 'Room not found' });
        }

        // Check if user is a member, if not add them
        const membership = db.prepare(
          'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'
        ).get(roomId, user.id);

        if (!membership) {
          db.prepare('INSERT INTO room_members (room_id, user_id) VALUES (?, ?)')
            .run(roomId, user.id);
        }

        socket.join(`room:${roomId}`);
        const userData = onlineUsers.get(user.id);
        if (userData) {
          userData.rooms.add(roomId);
        }

        // Get message history
        const messages = db.prepare(
          'SELECT id, room_id, user_id, username, content, created_at FROM messages WHERE room_id = ? ORDER BY created_at ASC LIMIT 100'
        ).all(roomId);

        callback && callback({ success: true, room, messages });

        // Notify others in the room
        socket.to(`room:${roomId}`).emit('room:user_joined', {
          userId: user.id,
          username: user.username,
          roomId,
        });
      } catch (err) {
        console.error('Room join error:', err);
        callback && callback({ error: 'Failed to join room' });
      }
    });

    // Leave a room
    socket.on('room:leave', (roomId) => {
      socket.leave(`room:${roomId}`);
      const userData = onlineUsers.get(user.id);
      if (userData) {
        userData.rooms.delete(roomId);
      }
      socket.to(`room:${roomId}`).emit('room:user_left', {
        userId: user.id,
        username: user.username,
        roomId,
      });
    });

    // Send a message
    socket.on('message:send', (data, callback) => {
      try {
        const { roomId, content } = data;
        if (!roomId || !content || !content.trim()) {
          return callback && callback({ error: 'Invalid message' });
        }

        if (content.length > 2000) {
          return callback && callback({ error: 'Message too long (max 2000 chars)' });
        }

        const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
        if (!room) {
          return callback && callback({ error: 'Room not found' });
        }

        const result = db.prepare(
          'INSERT INTO messages (room_id, user_id, username, content) VALUES (?, ?, ?, ?)'
        ).run(roomId, user.id, user.username, content.trim());

        const message = {
          id: result.lastInsertRowid,
          roomId,
          userId: user.id,
          username: user.username,
          content: content.trim(),
          createdAt: new Date().toISOString(),
        };

        // Broadcast to everyone in the room
        io.to(`room:${roomId}`).emit('message:received', message);

        callback && callback({ success: true, message });
      } catch (err) {
        console.error('Message send error:', err);
        callback && callback({ error: 'Failed to send message' });
      }
    });

    // Typing indicator - start
    socket.on('typing:start', (roomId) => {
      socket.to(`room:${roomId}`).emit('typing:update', {
        userId: user.id,
        username: user.username,
        roomId,
        isTyping: true,
      });
    });

    // Typing indicator - stop
    socket.on('typing:stop', (roomId) => {
      socket.to(`room:${roomId}`).emit('typing:update', {
        userId: user.id,
        username: user.username,
        roomId,
        isTyping: false,
      });
    });

    // Disconnect
    socket.on('disconnect', () => {
      console.log(`[Socket] ${user.username} disconnected (${socket.id})`);
      const userData = onlineUsers.get(user.id);
      if (userData) {
        // Notify all rooms the user was in
        userData.rooms.forEach((roomId) => {
          socket.to(`room:${roomId}`).emit('room:user_left', {
            userId: user.id,
            username: user.username,
            roomId,
          });
        });
        onlineUsers.delete(user.id);
      }
      broadcastOnlineUsers(io);
    });
  });
}

function getOnlineUsersList() {
  const users = [];
  onlineUsers.forEach((data, userId) => {
    users.push({ userId, username: data.username });
  });
  return users;
}

function broadcastOnlineUsers(io) {
  io.emit('presence:online', getOnlineUsersList());
}

module.exports = { setupSocket };
