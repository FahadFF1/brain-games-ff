// سيرفر «تمرين المخ اليومي» — يخدم الموقع + تحدّي لايف عبر Socket.IO.
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

// ملفات الموقع الثابتة (index.html، الخطوط…)
app.use(express.static(__dirname, { extensions: ['html'] }));
// أي مسار غير معروف يرجع للصفحة الرئيسية (تطبيق صفحة واحدة)
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

/* ================= تحدّي لايف ================= */
const rooms = new Map();
const clean = s => String(s || '').trim().slice(0, 14) || 'لاعب';
const DEFAULT = { game: 'calc', duration: 60, diff: 1, mode: 'time', target: 20 };

function code4() { let c; do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c)); return c; }
function listPlayers(r) {
  return Object.entries(r.players).map(([id, p]) => ({ id, name: p.name, score: p.score, done: p.done }));
}
function snapshot(r) {
  return { code: r.code, hostId: r.hostId, state: r.state, settings: r.settings, players: listPlayers(r) };
}
function broadcast(r) { io.to(r.code).emit('room', snapshot(r)); }
function endRoom(r) {
  if (!r || r.state === 'ended') return;
  r.state = 'ended';
  clearTimeout(r.timer); r.timer = null;
  const rank = listPlayers(r).sort((a, b) => b.score - a.score);
  io.to(r.code).emit('results', rank);
}

io.on('connection', socket => {
  let roomCode = null;

  socket.on('create', ({ name, settings } = {}, cb) => {
    const code = code4();
    const r = { code, hostId: socket.id, players: {}, settings: Object.assign({}, DEFAULT, settings || {}), state: 'lobby', seed: 0, timer: null };
    r.players[socket.id] = { name: clean(name), score: 0, done: false };
    rooms.set(code, r); socket.join(code); roomCode = code;
    cb && cb({ ok: true, code, snap: snapshot(r) });
  });

  socket.on('join', ({ code, name } = {}, cb) => {
    const r = rooms.get(String(code || '').trim());
    if (!r) return cb && cb({ ok: false, err: 'الكود غير موجود' });
    if (r.state !== 'lobby') return cb && cb({ ok: false, err: 'المباراة بدأت بالفعل' });
    if (Object.keys(r.players).length >= 8) return cb && cb({ ok: false, err: 'الغرفة ممتلئة (8)' });
    r.players[socket.id] = { name: clean(name), score: 0, done: false };
    socket.join(r.code); roomCode = r.code;
    cb && cb({ ok: true, code: r.code, snap: snapshot(r) });
    broadcast(r);
  });

  socket.on('settings', s => {
    const r = rooms.get(roomCode);
    if (r && r.hostId === socket.id && r.state === 'lobby') {
      r.settings = Object.assign({}, DEFAULT, s || {});
      broadcast(r);
    }
  });

  socket.on('start', () => {
    const r = rooms.get(roomCode);
    if (!r || r.hostId !== socket.id || r.state !== 'lobby') return;
    if (Object.keys(r.players).length < 2) return;
    r.seed = (Math.random() * 1e9) | 0;
    r.state = 'playing';
    Object.values(r.players).forEach(p => { p.score = 0; p.done = false; });
    io.to(r.code).emit('go', { seed: r.seed, settings: r.settings });
    // مؤقّت السيرفر: بالوقت = المدة + هامش؛ بالنقاط = أمان أقصى (6 دقائق)
    clearTimeout(r.timer);
    const _dur = r.settings.mode === 'points' ? 366 : (r.settings.duration || 60);
    r.timer = setTimeout(() => endRoom(r), (_dur + 6) * 1000);
  });

  socket.on('score', ({ score, done } = {}) => {
    const r = rooms.get(roomCode);
    if (!r || r.state !== 'playing') return;
    const p = r.players[socket.id];
    if (!p) return;
    if (typeof score === 'number') p.score = score;
    if (done) p.done = true;
    io.to(r.code).emit('scores', listPlayers(r));
    // بالنقاط: أول من يوصل الهدف (done) ينهي الجولة ويفوز
    if (done && r.settings && r.settings.mode === 'points') return endRoom(r);
    if (Object.values(r.players).every(p => p.done)) endRoom(r);
  });

  socket.on('rematch', () => {
    const r = rooms.get(roomCode);
    if (r && r.hostId === socket.id) {
      r.state = 'lobby';
      Object.values(r.players).forEach(p => { p.score = 0; p.done = false; });
      broadcast(r);
    }
  });

  socket.on('leave', () => { socket.disconnect(true); });

  socket.on('disconnect', () => {
    const r = rooms.get(roomCode);
    if (!r) return;
    delete r.players[socket.id];
    if (Object.keys(r.players).length === 0) { clearTimeout(r.timer); rooms.delete(r.code); return; }
    if (r.hostId === socket.id) r.hostId = Object.keys(r.players)[0];
    if (r.state === 'playing' && Object.values(r.players).every(p => p.done)) endRoom(r);
    else broadcast(r);
  });
});

server.listen(PORT, () => console.log('🧠 تمرين المخ + تحدّي لايف يعمل على المنفذ ' + PORT));
