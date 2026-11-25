import { Server as HTTPServer } from 'http';
import { Server as ChatServer, Socket } from 'socket.io';

import prisma from '../app/shared/prisma';
import { jwtHelpers } from '../app/helper/jwtHelpers';
import config from '../app/config';

let io: ChatServer;
// একজন ইউজারের একাধিক ট্যাব (socketId) ট্র্যাক করার জন্য Set ব্যবহার করা হয়েছে
const onlineUsers = new Map<string, Set<string>>();

const connectSocket = (server: HTTPServer) => {
  if (!io) {
    io = new ChatServer(server, {
      cors: {
        origin: config.allowed_origins || '*',
        methods: ['GET', 'POST'],
        credentials: true,
      },
      pingInterval: 10000,
      pingTimeout: 5000,
      allowEIO3: true,
    });
  }

  io.on('connection', async (socket: Socket) => {
    console.log('🔌 Socket connected:', socket.id);

    let currentUserId: string | null = null;

    try {
      // auth এবং query দুই জায়গা থেকেই টোকেন চেক করবে
      const token = String(
        socket.handshake.auth?.token || socket.handshake.query?.token || ''
      ).trim();

      if (token) {
        const decoded = await jwtHelpers.verifyToken(
          token,
          config.jwt_access_secret as string
        );

        const userId = decoded?.id;

        if (!userId) {
          socket.emit('error', { message: 'Invalid token userId' });
          setTimeout(() => socket.disconnect(), 500);
          return;
        }

        currentUserId = String(userId);

        // ইউজারের সকেট লিস্ট আপডেট
        if (!onlineUsers.has(currentUserId)) {
          onlineUsers.set(currentUserId, new Set());
        }
        const userSockets = onlineUsers.get(currentUserId)!;
        const isFirstConnection = userSockets.size === 0;
        userSockets.add(socket.id);

        // শুধু প্রথম ট্যাব কানেক্ট হলেই ডাটাবেজে isOnline: true করবে
        if (isFirstConnection) {
          const currentUser = await prisma.user
            .update({
              where: { id: currentUserId },
              data: {
                isOnline: true,
                updatedAt: new Date(),
              },
            })
            .catch(() => null);

          if (!currentUser) {
            userSockets.delete(socket.id);
            if (userSockets.size === 0) onlineUsers.delete(currentUserId);
            socket.emit('error', { message: 'User not found' });
            setTimeout(() => socket.disconnect(), 500);
            return;
          }

          socket.broadcast.emit('user-online', {
            userId: currentUserId,
          });
        }

        socket.join(currentUserId);

        socket.emit('connected', {
          success: true,
          type: 'authenticated',
          message: 'User connected successfully',
          userId: currentUserId,
          socketId: socket.id,
        });

        console.log('✅ Authenticated user connected:', currentUserId, 'Socket:', socket.id);
      } else {
        socket.emit('connected', {
          success: true,
          type: 'guest',
          message: 'Guest connected (no authentication)',
          socketId: socket.id,
          userId: null,
        });

        console.log('👤 Guest connected:', socket.id);
      }
    } catch (error) {
      console.error('❌ Socket auth error:', error);

      socket.emit('error', {
        message: 'Authentication failed',
      });

      setTimeout(() => socket.disconnect(), 500);
      return;
    }

    socket.on('disconnect', async (reason: string) => {
      console.log('❌ Disconnected:', socket.id, 'Reason:', reason);

      if (!currentUserId) return;

      const userSockets = onlineUsers.get(currentUserId);
      if (userSockets) {
        userSockets.delete(socket.id);

        // ইউজারের সব ট্যাব বন্ধ হলে তবেই অফলাইন করবে
        if (userSockets.size === 0) {
          onlineUsers.delete(currentUserId);

          try {
            await prisma.user.update({
              where: { id: currentUserId },
              data: {
                isOnline: false,
                updatedAt: new Date(),
              },
            });

            socket.broadcast.emit('user-offline', {
              userId: currentUserId,
            });
            console.log('🔴 User marked offline in DB:', currentUserId);
          } catch (err) {
            console.error('❌ Error updating offline status:', err);
          }
        }
      }
    });
  });

  return io;
};

const getSocketIO = () => {
  if (!io) throw new Error('socket.io is not initialized');
  return io;
};

export { connectSocket, getSocketIO, onlineUsers };