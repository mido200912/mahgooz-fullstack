const path = require('path');
const fs = require('fs');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'MahgoozLocalSecretKey-2026';
const JWT_EXPIRES = '7d';
const ADMIN_EMAIL = 'admin@mahgooz.local';
const ADMIN_PASSWORD = 'Admin1234!';
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ------------------------------------------------------------------ */
/* Database                                                            */
/* ------------------------------------------------------------------ */

const dbPath = path.join(__dirname, 'data', 'mahgooz.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS venues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    area TEXT DEFAULT '',
    venue_type TEXT NOT NULL,
    rating REAL DEFAULT 0,
    price_from REAL DEFAULT 0,
    capacity_min INTEGER DEFAULT 1,
    capacity_max INTEGER DEFAULT 100,
    image_url TEXT DEFAULT '',
    tags TEXT DEFAULT '',
    description TEXT DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price_from REAL DEFAULT 0,
    image_url TEXT DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    venue_id INTEGER NOT NULL,
    occasion TEXT NOT NULL,
    booking_date TEXT NOT NULL,
    booking_time TEXT NOT NULL,
    guest_count INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    notes TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL,
    venue_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, venue_id)
  );

  CREATE INDEX IF NOT EXISTS idx_venues_city ON venues(city);
  CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
  CREATE INDEX IF NOT EXISTS idx_bookings_venue_date ON bookings(venue_id, booking_date);
`);

// Older databases created by previous versions may miss columns.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('packages', 'image_url', "TEXT DEFAULT ''");

const SEED_VENUES = [
  ['كافيه فيوليت', 'الفيوم', 'الفيوم - وسط المدينة', 'كافيه', 4.7, 1000, 10, 20,
    'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=800&q=85',
    'عيد ميلاد,أصحاب,جلسات خارجية', 'كافيه دافئ بإطلالة مفتوحة، مناسب للتجمعات الصغيرة وأعياد الميلاد.'],
  ['قاعة جاردن', 'الجيزة', '6 أكتوبر - الجيزة', 'قاعة', 4.8, 2500, 20, 60,
    'https://images.unsplash.com/photo-1514933651103-005eec06c04b?auto=format&fit=crop&w=800&q=85',
    'تخرج,احتفال عائلي,قاعة خاصة', 'قاعة خاصة بتجهيزات كاملة للحفلات والتخرج والمناسبات العائلية.'],
  ['مطعم ذا جاردن', 'الفيوم', 'الفيوم - كورنيش البحيرة', 'مطعم', 4.5, 1200, 15, 30,
    'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=800&q=85',
    'عيد ميلاد,أصحاب,تجمعات صغيرة', 'مطعم بحديقة داخلية وقوائم طعام متنوعة تناسب كل الأذواق.'],
  ['كافيه لونا', 'الفيوم', 'الفيوم - حي الجامعة', 'كافيه', 4.9, 800, 10, 25,
    'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=85',
    'خروجة عائلية,احتفال عائلي,مناسبة عائلية', 'كافيه هادئ بديكور بسيط وجلسات مريحة للعائلات.'],
  ['فيلا النخيل', 'الفيوم', 'الفيوم - طريق بحيرة قارون', 'فيلا', 4.6, 6500, 30, 120,
    'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=800&q=85',
    'خطوبة,احتفال عائلي,مناسبة أخرى', 'فيلا بحديقة خاصة ومسبح، مثالية لحفلات الخطوبة والمناسبات الكبيرة.'],
  ['قاعة الأهرام', 'القاهرة', 'القاهرة - الهرم', 'قاعة', 4.4, 9000, 80, 400,
    'https://images.unsplash.com/photo-1505236858219-8359eb29e329?auto=format&fit=crop&w=800&q=85',
    'احتفال عائلي,مناسبة أخرى,حفلات', 'قاعة أفراح واسعة بإضاءة وصوت احترافي وسعة كبيرة.'],
  ['مطعم بحر', 'الفيوم', 'الفيوم - شاطئ بحيرة قارون', 'مطعم', 4.3, 950, 10, 45,
    'https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=800&q=85',
    'خروجة عائلية,أصحاب,مناسبة أخرى', 'مطعم أسماك على البحيرة مع جلسات خارجية مفتوحة.'],
  ['استوديو نور', 'القاهرة', 'القاهرة - المعادي', 'استوديو', 4.8, 1800, 5, 25,
    'https://images.unsplash.com/photo-1520333789090-1afc82db536a?auto=format&fit=crop&w=800&q=85',
    'عيد ميلاد,تخرج,مناسبة أخرى', 'استوديو تصوير مجهز بإضاءة وخلفيات متعددة لجلسات التصوير.'],
  ['حديقة الياسمين', 'الفيوم', 'الفيوم - دمو', 'حديقة', 4.2, 1500, 25, 150,
    'https://images.unsplash.com/photo-1464366400600-7168b8af9bc3?auto=format&fit=crop&w=800&q=85',
    'عيد ميلاد,خروجة عائلية,احتفال عائلي', 'حديقة مفتوحة بمساحات لعب وأماكن مخصصة للشوي.'],
  ['قاعة اللؤلؤة', 'القاهرة', 'القاهرة - مدينة نصر', 'قاعة', 4.7, 12000, 100, 500,
    'https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=800&q=85',
    'خطوبة,احتفال عائلي,حفلات', 'قاعة فاخرة بطاولات أنيقة وتنظيم احترافي للمناسبات الكبيرة.'],
  ['كافيه سكاي', 'الجيزة', 'الشيخ زايد - الجيزة', 'كافيه', 4.5, 1100, 10, 40,
    'https://images.unsplash.com/photo-1493857671505-72967e2e2760?auto=format&fit=crop&w=800&q=85',
    'أصحاب,عيد ميلاد,جلسات خارجية', 'كافيه بروف مفتوح بإطلالة بانورامية وجلسات مسائية.'],
  ['شاليه وادي الريان', 'الفيوم', 'وادي الريان', 'شاليه', 4.9, 5000, 15, 60,
    'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?auto=format&fit=crop&w=800&q=85',
    'خروجة عائلية,مناسبة أخرى,أصحاب', 'شاليه على البحيرة مع تراس واسع وإطلالة على المحمية.']
];

const SEED_PACKAGES = [
  ['باقة عيد ميلاد', 'ديكور مميز · كيكة · جلسة خاصة', 2500,
    'https://images.unsplash.com/photo-1530103862676-de8c9debad1d?auto=format&fit=crop&w=300&q=80'],
  ['باقة تخرج', 'طاولة خاصة · تصوير · ضيافة', 3000,
    'https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=300&q=80'],
  ['باقة مناسبة عائلية', 'جلسة كاملة · قائمة طعام مميزة', 2800,
    'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=300&q=80'],
  ['باقة خطوبة', 'تنسيق كامل · إضاءة · ضيافة مميزة', 4500,
    'https://images.unsplash.com/photo-1523438885200-e635ba2c371e?auto=format&fit=crop&w=300&q=80'],
  ['باقة خروجة أصحاب', 'جلسة جماعية · مشروبات · سناكس', 1200,
    'https://images.unsplash.com/photo-1527529482837-4698179dc6ce?auto=format&fit=crop&w=300&q=80'],
  ['باقة عيد ميلاد أطفال', 'ديكور مبهج · كيك · ألعاب', 2200,
    'https://images.unsplash.com/photo-1464349095431-e9a21285b5f3?auto=format&fit=crop&w=300&q=80']
];

function seedDatabase() {
  const venueCount = db.prepare('SELECT COUNT(*) AS n FROM venues').get().n;
  if (venueCount === 0) {
    const insert = db.prepare(`
      INSERT INTO venues(name, city, area, venue_type, rating, price_from, capacity_min, capacity_max, image_url, tags, description)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const v of SEED_VENUES) insert.run(...v);
    console.log(`✓ Seeded ${SEED_VENUES.length} venues`);
  }

  const packageCount = db.prepare('SELECT COUNT(*) AS n FROM packages').get().n;
  if (packageCount === 0) {
    const insert = db.prepare('INSERT INTO packages(name, description, price_from, image_url) VALUES(?,?,?,?)');
    for (const p of SEED_PACKAGES) insert.run(...p);
    console.log(`✓ Seeded ${SEED_PACKAGES.length} packages`);
  }

  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
  if (!admin) {
    db.prepare('INSERT INTO users(name, email, phone, password_hash, role) VALUES(?,?,?,?,?)')
      .run('مدير محجوز', ADMIN_EMAIL, '', bcrypt.hashSync(ADMIN_PASSWORD, 10), 'admin');
    console.log('✓ Default admin account created');
  }
}

seedDatabase();

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function parseTags(raw) {
  if (Array.isArray(raw)) return raw.map(t => String(t).trim()).filter(Boolean);
  return String(raw || '')
    .split(/[,،]/)
    .map(t => t.trim())
    .filter(Boolean);
}

function mapVenue(row) {
  if (!row) return null;
  return { ...row, tags: parseTags(row.tags), is_active: Number(row.is_active) };
}

function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role };
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function readToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function auth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'سجّل الدخول أولًا' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'هذا الحساب لم يعد موجودًا' });
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'جلسة الدخول منتهية، سجّل الدخول مرة أخرى' });
  }
}

function optionalAuth(req) {
  const token = readToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return db.prepare('SELECT id FROM users WHERE id = ?').get(payload.id) || null;
  } catch (error) {
    return null;
  }
}

function admin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'صلاحيات المدير مطلوبة' });
  return next();
}

function todayISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Tiny request logger (skips static assets to keep the console readable).
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
    });
  }
  next();
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

/* ------------------------------- API ------------------------------- */

app.get('/api/health', (req, res) => {
  const venues = db.prepare('SELECT COUNT(*) AS n FROM venues WHERE is_active = 1').get().n;
  res.json({ ok: true, db: 'SQLite', venues, message: 'محجوز API يعمل' });
});

app.get('/api/venues', (req, res) => {
  const { city, tag, guests, q, sort } = req.query;
  const conditions = ['is_active = 1'];
  const args = [];

  if (city) {
    conditions.push('city = ?');
    args.push(String(city));
  }
  if (tag) {
    conditions.push('(tags LIKE ? OR tags LIKE ?)');
    args.push(`%${tag}%`, `%,${tag}%`);
  }
  if (guests) {
    conditions.push('capacity_max >= ?');
    args.push(Number(guests) || 0);
  }
  if (q) {
    conditions.push('(name LIKE ? OR description LIKE ? OR area LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like);
  }

  const order = sort === 'price' ? 'price_from ASC' : sort === 'price_desc' ? 'price_from DESC' : 'rating DESC, id ASC';
  const rows = db.prepare(`SELECT * FROM venues WHERE ${conditions.join(' AND ')} ORDER BY ${order}`).all(...args);
  res.json(rows.map(mapVenue));
});

app.get('/api/venues/:id', (req, res) => {
  const venue = db.prepare('SELECT * FROM venues WHERE id = ? AND is_active = 1').get(Number(req.params.id));
  if (!venue) return res.status(404).json({ error: 'المكان غير موجود' });
  return res.json(mapVenue(venue));
});

app.get('/api/packages', (req, res) => {
  const rows = db.prepare('SELECT * FROM packages WHERE is_active = 1 ORDER BY price_from ASC').all();
  res.json(rows);
});

/* ------------------------------ Auth ------------------------------- */

app.post('/api/auth/register', (req, res) => {
  const { name, email, password, phone = '' } = req.body || {};
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!cleanName || !cleanEmail || !password) {
    return res.status(400).json({ error: 'أدخل الاسم والبريد وكلمة المرور' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'صيغة البريد الإلكتروني غير صحيحة' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 8 أحرف على الأقل' });
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail)) {
    return res.status(409).json({ error: 'البريد الإلكتروني مسجل بالفعل' });
  }

  const hash = bcrypt.hashSync(String(password), 10);
  const result = db.prepare('INSERT INTO users(name, email, phone, password_hash, role) VALUES(?,?,?,?,?)')
    .run(cleanName, cleanEmail, String(phone || '').trim(), hash, 'customer');

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid));
  return res.status(201).json({ token: signToken(user), user: safeUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
  }

  return res.json({ token: signToken(user), user: safeUser(user) });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: safeUser(req.user) }));

/* ----------------------------- Bookings ---------------------------- */

app.post('/api/bookings', (req, res) => {
  const {
    venue_id, venue_name, occasion, booking_date, booking_time,
    guest_count, customer_name, customer_phone, notes = ''
  } = req.body || {};

  const venue = venue_id
    ? db.prepare('SELECT * FROM venues WHERE id = ? AND is_active = 1').get(Number(venue_id))
    : db.prepare('SELECT * FROM venues WHERE name = ? AND is_active = 1').get(String(venue_name || '').trim());

  if (!venue) return res.status(404).json({ error: 'المكان غير موجود' });

  const guests = Number(guest_count);
  if (!occasion || !booking_date || !booking_time || !customer_name || !customer_phone) {
    return res.status(400).json({ error: 'راجع بيانات الحجز المطلوبة' });
  }
  if (!DATE_RE.test(String(booking_date)) || !TIME_RE.test(String(booking_time))) {
    return res.status(400).json({ error: 'صيغة التاريخ أو الوقت غير صحيحة' });
  }
  if (String(booking_date) < todayISO()) {
    return res.status(400).json({ error: 'تاريخ الحجز يجب أن يكون اليوم أو بعده' });
  }
  if (!Number.isInteger(guests) || guests < 1) {
    return res.status(400).json({ error: 'عدد الأفراد يجب أن يكون رقمًا صحيحًا أكبر من صفر' });
  }
  if (guests > venue.capacity_max) {
    return res.status(400).json({ error: `السعة القصوى لهذا المكان ${venue.capacity_max} فرد` });
  }
  if (guests < venue.capacity_min) {
    return res.status(400).json({ error: `الحد الأدنى للحجز في هذا المكان ${venue.capacity_min} فرد` });
  }

  const conflict = db.prepare(`
    SELECT id FROM bookings
    WHERE venue_id = ? AND booking_date = ? AND booking_time = ? AND status IN ('pending','confirmed')
  `).get(venue.id, String(booking_date), String(booking_time));

  if (conflict) {
    return res.status(409).json({ error: 'هذا الموعد محجوز بالفعل، اختر وقتًا آخر' });
  }

  const currentUser = optionalAuth(req);
  const result = db.prepare(`
    INSERT INTO bookings(user_id, venue_id, occasion, booking_date, booking_time, guest_count, customer_name, customer_phone, notes)
    VALUES(?,?,?,?,?,?,?,?,?)
  `).run(
    currentUser ? currentUser.id : null,
    venue.id,
    String(occasion),
    String(booking_date),
    String(booking_time),
    guests,
    String(customer_name).trim(),
    String(customer_phone).trim(),
    String(notes || '').trim()
  );

  return res.status(201).json({
    message: 'تم حفظ طلب الحجز بقاعدة البيانات',
    booking: {
      id: Number(result.lastInsertRowid),
      status: 'pending',
      venue_name: venue.name,
      booking_date,
      booking_time
    }
  });
});

app.get('/api/bookings/mine', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, v.name AS venue_name, v.city, v.image_url
    FROM bookings b
    JOIN venues v ON v.id = b.venue_id
    WHERE b.user_id = ?
    ORDER BY b.created_at DESC, b.id DESC
  `).all(req.user.id);
  res.json(rows);
});

app.patch('/api/bookings/:id/cancel', auth, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(req.params.id));
  if (!booking) return res.status(404).json({ error: 'الحجز غير موجود' });
  if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'لا يمكنك تعديل هذا الحجز' });
  }
  if (!['pending', 'confirmed'].includes(booking.status)) {
    return res.status(400).json({ error: 'لا يمكن إلغاء هذا الحجز في حالته الحالية' });
  }
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking.id);
  return res.json({ ok: true });
});

/* ---------------------------- Favorites ---------------------------- */

app.get('/api/favorites/mine', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT v.* FROM favorites f
    JOIN venues v ON v.id = f.venue_id
    WHERE f.user_id = ? AND v.is_active = 1
    ORDER BY v.rating DESC
  `).all(req.user.id);
  res.json(rows.map(mapVenue));
});

app.post('/api/favorites/:venueId', auth, (req, res) => {
  const id = Number(req.params.venueId);
  const venue = db.prepare('SELECT id FROM venues WHERE id = ? AND is_active = 1').get(id);
  if (!venue) return res.status(404).json({ error: 'المكان غير موجود' });
  db.prepare('INSERT OR IGNORE INTO favorites(user_id, venue_id) VALUES(?,?)').run(req.user.id, id);
  return res.status(201).json({ saved: true });
});

app.delete('/api/favorites/:venueId', auth, (req, res) => {
  db.prepare('DELETE FROM favorites WHERE user_id = ? AND venue_id = ?')
    .run(req.user.id, Number(req.params.venueId));
  res.json({ saved: false });
});

/* ------------------------------ Admin ------------------------------ */

app.get('/api/admin/bookings', auth, admin, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, v.name AS venue_name
    FROM bookings b JOIN venues v ON v.id = b.venue_id
    ORDER BY b.created_at DESC, b.id DESC
  `).all();
  res.json(rows);
});

app.patch('/api/admin/bookings/:id/status', auth, admin, (req, res) => {
  const { status } = req.body || {};
  const allowed = ['pending', 'confirmed', 'cancelled', 'completed'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'حالة غير صالحة' });

  const booking = db.prepare('SELECT id FROM bookings WHERE id = ?').get(Number(req.params.id));
  if (!booking) return res.status(404).json({ error: 'الحجز غير موجود' });

  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, booking.id);
  return res.json({ ok: true });
});

app.get('/api/admin/venues', auth, admin, (req, res) => {
  res.json(db.prepare('SELECT * FROM venues ORDER BY is_active DESC, id DESC').all().map(mapVenue));
});

app.post('/api/admin/venues', auth, admin, (req, res) => {
  const v = req.body || {};
  const name = String(v.name || '').trim();
  const city = String(v.city || '').trim();
  const venueType = String(v.venue_type || '').trim();
  if (!name || !city || !venueType) {
    return res.status(400).json({ error: 'الاسم والمدينة ونوع المكان مطلوبون' });
  }

  const capacityMin = Math.max(1, Number(v.capacity_min) || 1);
  const capacityMax = Math.max(capacityMin, Number(v.capacity_max) || 100);

  const result = db.prepare(`
    INSERT INTO venues(name, city, area, venue_type, rating, price_from, capacity_min, capacity_max, image_url, tags, description)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    name, city, String(v.area || '').trim(), venueType,
    Math.min(5, Math.max(0, Number(v.rating) || 0)),
    Math.max(0, Number(v.price_from) || 0),
    capacityMin, capacityMax,
    String(v.image_url || '').trim(),
    parseTags(v.tags).join(','),
    String(v.description || '').trim()
  );

  return res.status(201).json({ id: Number(result.lastInsertRowid) });
});

app.patch('/api/admin/venues/:id', auth, admin, (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare('SELECT * FROM venues WHERE id = ?').get(id);
  if (!old) return res.status(404).json({ error: 'المكان غير موجود' });

  const v = req.body || {};
  const merged = { ...old, ...v };
  const tags = Array.isArray(v.tags) ? v.tags.join(',') : (v.tags !== undefined ? String(v.tags) : old.tags);
  const capacityMin = Math.max(1, Number(merged.capacity_min) || old.capacity_min);
  const capacityMax = Math.max(capacityMin, Number(merged.capacity_max) || old.capacity_max);

  db.prepare(`
    UPDATE venues SET name=?, city=?, area=?, venue_type=?, rating=?, price_from=?, capacity_min=?, capacity_max=?,
      image_url=?, tags=?, description=?, is_active=? WHERE id=?
  `).run(
    String(merged.name || old.name),
    String(merged.city || old.city),
    String(merged.area || ''),
    String(merged.venue_type || old.venue_type),
    Math.min(5, Math.max(0, Number(merged.rating) || 0)),
    Math.max(0, Number(merged.price_from) || 0),
    capacityMin,
    capacityMax,
    String(merged.image_url || ''),
    tags,
    String(merged.description || ''),
    Number(merged.is_active) ? 1 : 0,
    id
  );

  return res.json({ id });
});

app.delete('/api/admin/venues/:id', auth, admin, (req, res) => {
  const result = db.prepare('UPDATE venues SET is_active = 0 WHERE id = ?').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'المكان غير موجود' });
  return res.json({ ok: true });
});

app.get('/api/admin/stats', auth, admin, (req, res) => {
  res.json({
    users: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'").get().n,
    venues: db.prepare('SELECT COUNT(*) AS n FROM venues WHERE is_active = 1').get().n,
    bookings: db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n,
    pending: db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'pending'").get().n,
    confirmed: db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed'").get().n
  });
});

/* --------------------------- Fallbacks ----------------------------- */

app.use('/api', (req, res) => res.status(404).json({ error: 'المسار غير موجود' }));

app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'صيغة البيانات المرسلة غير صحيحة' });
  }
  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'حدث خطأ غير متوقع في السيرفر' });
});

/* ----------------------------- Startup ----------------------------- */

const server = app.listen(PORT, () => {
  console.log('=================================');
  console.log('🚀 محجوز - منصة حجز المناسبات');
  console.log('=================================');
  console.log(`🌐 الموقع:  http://localhost:${PORT}`);
  console.log(`🛠️  الإدارة: http://localhost:${PORT}/admin.html`);
  console.log(`🔑 Admin:   ${ADMIN_EMAIL}`);
  console.log(`🔐 Pass:    ${ADMIN_PASSWORD}`);
  console.log(`🗄️  DB:      ${dbPath}`);
  console.log('=================================');
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ المنفذ ${PORT} مستخدم بالفعل. أغلق السيرفر القديم أو شغّل بـ PORT=3001.`);
  } else {
    console.error('❌ فشل تشغيل السيرفر:', error);
  }
  process.exit(1);
});

function shutdown() {
  console.log('\n⏹️  إيقاف السيرفر...');
  server.close(() => {
    try { db.close(); } catch (error) { /* already closed */ }
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
