/* محجوز — ربط الواجهة بالـ API */
const API_BASE = '';
const TOKEN_KEY = 'mahgooz_token';
const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=800&q=80';

let authToken = localStorage.getItem(TOKEN_KEY) || '';
let currentUser = null;
let authMode = 'login';
let venueCache = [];
let favoriteIds = new Set();
let lastVenueRefresh = 0;

/* ------------------------------ Helpers ----------------------------- */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function money(n) {
  return Number(n || 0).toLocaleString('en-US') + ' ج.م';
}

function todayISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function statusLabel(status) {
  return ({
    pending: 'قيد المراجعة',
    confirmed: 'مؤكد',
    cancelled: 'ملغي',
    completed: 'مكتمل'
  }[status] || status);
}

function toast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function showToast(message) {
  toast(message);
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken) headers.Authorization = 'Bearer ' + authToken;

  const response = await fetch(API_BASE + path, { ...options, headers });

  if (response.status === 401 && authToken && !path.startsWith('/api/auth/')) {
    clearSession();
    showToast('انتهت الجلسة، سجّل الدخول مرة أخرى');
  }
  return response;
}

async function readJSON(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

/* --------------------------- Auth session --------------------------- */

function clearSession() {
  authToken = '';
  currentUser = null;
  favoriteIds = new Set();
  localStorage.removeItem(TOKEN_KEY);
  document.querySelectorAll('.venue .heart').forEach(btn => {
    btn.classList.remove('saved');
    btn.textContent = '♡';
  });
  updateAuthUI();
}

function updateAuthUI() {
  const userLink = document.getElementById('userLink');
  const authBtn = document.getElementById('navAuthBtn');
  if (!userLink || !authBtn) return;

  if (currentUser) {
    userLink.textContent = '👤 ' + currentUser.name;
    userLink.setAttribute('href', '#');
    userLink.onclick = event => { event.preventDefault(); showMyBookings(); };
    authBtn.textContent = 'تسجيل خروج';
    authBtn.className = 'btn btn-light';
    authBtn.onclick = logout;
  } else {
    userLink.textContent = 'تسجيل الدخول';
    userLink.setAttribute('href', '#');
    userLink.onclick = event => { event.preventDefault(); openAuth('login'); };
    authBtn.textContent = 'إنشاء حساب';
    authBtn.className = 'btn btn-dark';
    authBtn.onclick = () => openAuth('register');
  }
}

async function restoreSession() {
  if (!authToken) {
    updateAuthUI();
    return;
  }
  try {
    const response = await apiFetch('/api/auth/me');
    if (!response.ok) {
      clearSession();
      return;
    }
    const data = await readJSON(response);
    currentUser = data.user;
    updateAuthUI();
    prefillBookingForm();
    await loadMyFavorites();
  } catch (error) {
    updateAuthUI();
  }
}

function logout() {
  clearSession();
  showToast('تم تسجيل الخروج');
}

function openAuth(mode = 'login') {
  authMode = mode;
  const register = mode === 'register';

  document.getElementById('authTitle').textContent = register ? 'إنشاء حساب جديد' : 'تسجيل الدخول';
  document.getElementById('authSubmit').textContent = register ? 'إنشاء الحساب' : 'دخول';
  document.getElementById('authNameField').style.display = register ? 'block' : 'none';
  document.getElementById('authPhoneField').style.display = register ? 'block' : 'none';
  document.getElementById('authName').required = register;
  document.getElementById('authSwitchText').textContent = register ? 'لديك حساب بالفعل؟' : 'ليس لديك حساب؟';
  document.getElementById('authSwitch').textContent = register ? 'تسجيل الدخول' : 'إنشاء حساب';
  document.getElementById('authPassword').autocomplete = register ? 'new-password' : 'current-password';
  document.getElementById('authModal').classList.add('open');
  setTimeout(() => document.getElementById('authEmail').focus(), 80);
}

function closeAuth() {
  document.getElementById('authModal').classList.remove('open');
}

document.getElementById('authSwitch').addEventListener('click', event => {
  event.preventDefault();
  openAuth(authMode === 'register' ? 'login' : 'register');
});

document.getElementById('authForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  const register = authMode === 'register';
  const body = {
    email: document.getElementById('authEmail').value.trim(),
    password: document.getElementById('authPassword').value
  };
  if (register) {
    body.name = document.getElementById('authName').value.trim();
    body.phone = document.getElementById('authPhone').value.trim();
  }

  const submit = document.getElementById('authSubmit');
  submit.disabled = true;

  try {
    const response = await apiFetch('/api/auth/' + (register ? 'register' : 'login'), {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const data = await readJSON(response);
    if (!response.ok) {
      showToast(data.error || 'تعذر إتمام العملية');
      return;
    }

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem(TOKEN_KEY, authToken);
    closeAuth();
    this.reset();
    updateAuthUI();
    prefillBookingForm();
    await loadMyFavorites();
    showToast(register ? 'تم إنشاء الحساب وتسجيل الدخول' : 'تم تسجيل الدخول بنجاح');
  } catch (error) {
    showToast('السيرفر غير متصل، شغّل السيرفر أولًا');
  } finally {
    submit.disabled = false;
  }
});

/* ------------------------------ Venues ------------------------------ */

function venueCard(venue) {
  const tags = Array.isArray(venue.tags) ? venue.tags : String(venue.tags || '').split(',').filter(Boolean);
  const image = venue.image_url || FALLBACK_IMAGE;
  const name = esc(venue.name);

  return `<article class="venue" data-tags="${esc(tags.join(' '))}" data-capacity="${Number(venue.capacity_max)}" data-city="${esc(venue.city)}" data-venue-id="${Number(venue.id)}">
      <div class="venue-img"><img loading="lazy" src="${esc(image)}" alt="${name}" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'"><button class="heart" aria-label="إضافة للمفضلة" onclick="toggleHeart(this)">♡</button></div>
      <div class="venue-content"><div class="venue-head"><h3>${name}</h3><div class="rating"><span>★</span> ${Number(venue.rating).toFixed(1)}</div></div>
      <p class="meta">${esc(venue.city)} · ${esc(venue.venue_type)}</p><div class="tags">${tags.slice(0, 2).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="venue-bottom"><div class="price">من ${money(venue.price_from)}</div><span class="capacity">${Number(venue.capacity_min)}-${Number(venue.capacity_max)} فرد</span></div>
      <div class="venue-actions"><button class="btn btn-light btn-small" onclick="venueDetails(${Number(venue.id)})">التفاصيل</button><button class="btn btn-dark btn-small" onclick="openBooking(${Number(venue.id)})">احجز الآن</button></div></div></article>`;
}

function populateAreaFilter(venues) {
  const select = document.getElementById('searchArea');
  if (!select) return;

  const previous = select.value;
  const cities = [...new Set(venues.map(v => String(v.city || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ar'));

  select.innerHTML = '<option value="">كل المناطق</option>' +
    cities.map(city => `<option value="${esc(city)}">${esc(city)}</option>`).join('');

  select.value = cities.includes(previous) ? previous : '';
}

async function loadVenues() {
  lastVenueRefresh = Date.now();
  const grid = document.getElementById('venueGrid');
  try {
    const response = await apiFetch('/api/venues');
    if (!response.ok) throw new Error('API');
    const venues = await readJSON(response);
    if (!Array.isArray(venues) || !venues.length) return;

    venueCache = venues;
    populateAreaFilter(venues);
    grid.innerHTML = venues.map(venueCard).join('');
    if (authToken) await loadMyFavorites();
  } catch (error) {
    console.error(error);
    showToast('تعذر تحميل الأماكن من قاعدة البيانات');
  }
}

async function loadPackages() {
  try {
    const response = await apiFetch('/api/packages');
    if (!response.ok) return;
    const packages = await readJSON(response);
    if (!Array.isArray(packages) || !packages.length) return;

    document.querySelector('.packages').innerHTML = packages.map(pkg => `
      <article class="package"><img loading="lazy" src="${esc(pkg.image_url || FALLBACK_IMAGE)}" alt="${esc(pkg.name)}" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'"><div><h3>${esc(pkg.name)}</h3><p>${esc(pkg.description)}</p><strong>من ${money(pkg.price_from)}</strong></div></article>`
    ).join('');
  } catch (error) {
    console.error(error);
  }
}

function findVenue(key) {
  return venueCache.find(v => Number(v.id) === Number(key)) ||
    venueCache.find(v => v.name === key) ||
    null;
}

function venueDetails(key) {
  const venue = findVenue(key);
  if (!venue) return;

  const body = document.getElementById('venueModalBody');
  const tags = Array.isArray(venue.tags) ? venue.tags : [];
  body.innerHTML = `
    <img src="${esc(venue.image_url || FALLBACK_IMAGE)}" alt="${esc(venue.name)}" style="width:100%;height:210px;object-fit:cover;border-radius:12px;margin-bottom:16px" onerror="this.onerror=null;this.src='${FALLBACK_IMAGE}'">
    <div class="venue-head" style="margin-bottom:6px"><h2 style="font-size:22px">${esc(venue.name)}</h2><div class="rating"><span>★</span> ${Number(venue.rating).toFixed(1)}</div></div>
    <p class="meta" style="margin-bottom:10px">${esc(venue.area || venue.city)} · ${esc(venue.venue_type)}</p>
    <p style="font-size:14px;color:#4c5d59">${esc(venue.description || 'مكان مميز لمناسبتك القادمة.')}</p>
    <div class="tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    <div class="venue-bottom" style="margin-top:16px"><div class="price">من ${money(venue.price_from)}</div><span class="capacity">${Number(venue.capacity_min)}-${Number(venue.capacity_max)} فرد</span></div>
    <button class="btn btn-dark" style="width:100%;margin-top:16px" onclick="closeVenueDetails();openBooking(${Number(venue.id)})">احجز الآن</button>`;
  document.getElementById('venueModal').classList.add('open');
}

function closeVenueDetails() {
  document.getElementById('venueModal').classList.remove('open');
}

/* ----------------------------- Favorites ---------------------------- */

async function loadMyFavorites() {
  if (!authToken) return;
  try {
    const response = await apiFetch('/api/favorites/mine');
    if (!response.ok) return;
    const favorites = await readJSON(response);
    favoriteIds = new Set(favorites.map(venue => Number(venue.id)));
    document.querySelectorAll('.venue[data-venue-id]').forEach(card => {
      const btn = card.querySelector('.heart');
      const saved = favoriteIds.has(Number(card.dataset.venueId));
      btn.classList.toggle('saved', saved);
      btn.textContent = saved ? '♥' : '♡';
    });
  } catch (error) {
    console.error(error);
  }
}

async function toggleHeart(btn) {
  const card = btn.closest('.venue');
  const id = Number(card && card.dataset.venueId);
  if (!id) return;

  if (!authToken) {
    showToast('سجّل الدخول لإضافة المكان للمفضلة');
    openAuth('login');
    return;
  }

  const saved = btn.classList.contains('saved');
  try {
    const response = await apiFetch('/api/favorites/' + id, { method: saved ? 'DELETE' : 'POST' });
    const data = await readJSON(response);
    if (!response.ok) {
      showToast(data.error || 'تعذر تحديث المفضلة');
      return;
    }
    btn.classList.toggle('saved', !saved);
    btn.textContent = !saved ? '♥' : '♡';
    if (!saved) favoriteIds.add(id); else favoriteIds.delete(id);
    showToast(!saved ? 'اتضاف للمفضلة' : 'اتشال من المفضلة');
  } catch (error) {
    showToast('مشكلة اتصال بالسيرفر');
  }
}

/* ------------------------------ Booking ----------------------------- */

function prefillBookingForm() {
  if (!currentUser) return;
  const name = document.getElementById('bookName');
  const phone = document.getElementById('bookPhone');
  if (name && !name.value) name.value = currentUser.name || '';
  if (phone && !phone.value) phone.value = currentUser.phone || '';
}

function openBooking(key) {
  const found = findVenue(key);
  const venue = found || (typeof key === 'string' ? {
    id: null, name: key, capacity_min: 1, capacity_max: 100, price_from: 0
  } : null);
  if (!venue) return;

  selectedVenue = venue.name;
  selectedVenueId = venue.id;
  document.getElementById('modalTitle').textContent = 'طلب حجز — ' + venue.name;

  const count = document.getElementById('bookCount');
  count.min = venue.capacity_min;
  count.max = venue.capacity_max;
  count.value = Math.max(venue.capacity_min, Math.min(10, venue.capacity_max));

  document.getElementById('bookingHint').textContent =
    `السعة المسموحة: ${venue.capacity_min}-${venue.capacity_max} فرد · يبدأ السعر من ${money(venue.price_from)}`;

  prefillBookingForm();
  document.getElementById('bookingModal').classList.add('open');
}

function closeBooking() {
  document.getElementById('bookingModal').classList.remove('open');
}

document.getElementById('bookingForm').addEventListener('submit', async function (event) {
  event.preventDefault();

  const payload = {
    venue_id: selectedVenueId || undefined,
    venue_name: selectedVenue,
    occasion: document.getElementById('bookOcc').value,
    booking_date: document.getElementById('bookDate').value,
    booking_time: document.getElementById('bookTime').value,
    guest_count: Number(document.getElementById('bookCount').value),
    customer_name: document.getElementById('bookName').value.trim(),
    customer_phone: document.getElementById('bookPhone').value.trim(),
    notes: document.getElementById('bookNotes').value.trim()
  };

  const submit = this.querySelector('button[type="submit"]');
  submit.disabled = true;

  try {
    const response = await apiFetch('/api/bookings', { method: 'POST', body: JSON.stringify(payload) });
    const result = await readJSON(response);
    if (!response.ok) {
      showToast(result.error || 'تعذر حفظ الحجز');
      return;
    }
    showToast('تم حفظ طلب الحجز رقم ' + result.booking.id + ' في قاعدة البيانات');
    closeBooking();
    this.reset();
  } catch (error) {
    showToast('السيرفر غير متصل، شغّل السيرفر أولًا');
  } finally {
    submit.disabled = false;
  }
});

/* ---------------------------- My bookings --------------------------- */

async function showMyBookings() {
  if (!authToken) {
    openAuth('login');
    return;
  }

  const modal = document.getElementById('bookingsModal');
  const list = document.getElementById('myBookingsList');
  list.innerHTML = '<p class="notice">جاري تحميل الحجوزات...</p>';
  modal.classList.add('open');

  try {
    const response = await apiFetch('/api/bookings/mine');
    const bookings = await readJSON(response);
    if (!response.ok) {
      list.innerHTML = `<p class="notice">${esc(bookings.error || 'تعذر عرض الحجوزات')}</p>`;
      return;
    }
    if (!Array.isArray(bookings) || !bookings.length) {
      list.innerHTML = `<div class="empty-state"><span>📅</span><p>لا توجد حجوزات محفوظة لحسابك بعد.</p><button class="btn btn-dark btn-small" onclick="closeMyBookings();document.getElementById('venues').scrollIntoView({behavior:'smooth'})">تصفّح الأماكن</button></div>`;
      return;
    }

    list.innerHTML = bookings.map(booking => `
      <div class="booking-item">
        <div class="booking-item-head">
          <strong>${esc(booking.venue_name)}</strong>
          <span class="status status-${esc(booking.status)}">${esc(statusLabel(booking.status))}</span>
        </div>
        <p class="meta">${esc(booking.city)} · ${esc(booking.occasion)}</p>
        <p class="booking-line"><span dir="ltr">🗓️ ${esc(booking.booking_date)} · 🕒 ${esc(booking.booking_time)}</span> · 👥 ${booking.guest_count} فرد</p>
        ${['pending', 'confirmed'].includes(booking.status)
          ? `<button class="btn btn-light btn-small" onclick="cancelBooking(${Number(booking.id)}, this)">إلغاء الحجز</button>`
          : ''}
      </div>`).join('');
  } catch (error) {
    list.innerHTML = '<p class="notice">تعذر الاتصال بالسيرفر.</p>';
  }
}

function closeMyBookings() {
  document.getElementById('bookingsModal').classList.remove('open');
}

async function cancelBooking(id, btn) {
  if (!confirm('متأكد إنك عايز تلغي الحجز؟')) return;
  btn.disabled = true;
  try {
    const response = await apiFetch('/api/bookings/' + id + '/cancel', { method: 'PATCH' });
    const data = await readJSON(response);
    if (!response.ok) {
      showToast(data.error || 'تعذر إلغاء الحجز');
      btn.disabled = false;
      return;
    }
    showToast('تم إلغاء الحجز');
    showMyBookings();
  } catch (error) {
    showToast('تعذر الاتصال بالسيرفر');
    btn.disabled = false;
  }
}

/* ------------------------------ Filters ----------------------------- */

function filterByTag(tag) {
  document.querySelectorAll('.cat').forEach(cat => cat.classList.toggle('active', cat.dataset.tag === tag));
  let shown = 0;
  document.querySelectorAll('.venue').forEach(card => {
    const match = !tag || card.dataset.tags.includes(tag);
    card.style.display = match ? '' : 'none';
    if (match) shown++;
  });
  showToast(shown ? 'الأماكن المناسبة: ' + shown : 'مفيش أماكن مطابقة للمناسبة دي');
}

document.querySelectorAll('.cat').forEach(cat => {
  cat.addEventListener('click', () => filterByTag(cat.dataset.tag));
});

function clearFilters() {
  document.querySelectorAll('.cat').forEach(cat => cat.classList.remove('active'));
  document.querySelectorAll('.venue').forEach(card => { card.style.display = ''; });
}

function searchVenues() {
  const tag = document.getElementById('searchOcc').value;
  const city = document.getElementById('searchArea').value;
  const count = Number(document.getElementById('searchCount').value) || 0;
  const date = document.getElementById('searchDate').value;

  if (date && date < todayISO()) {
    showToast('اختار تاريخ اليوم أو تاريخ قادم');
    return;
  }

  document.querySelectorAll('.cat').forEach(cat => cat.classList.toggle('active', cat.dataset.tag === tag));

  let shown = 0;
  document.querySelectorAll('.venue').forEach(card => {
    const matchesTag = !tag || card.dataset.tags.includes(tag);
    const matchesCity = !city || !card.dataset.city || card.dataset.city === city;
    const matchesCount = !count || Number(card.dataset.capacity) >= count;
    const ok = matchesTag && matchesCity && matchesCount;
    card.style.display = ok ? '' : 'none';
    if (ok) shown++;
  });

  document.getElementById('venues').scrollIntoView({ behavior: 'smooth' });
  showToast(shown ? 'لقينا ' + shown + ' مكان مناسب' : 'مفيش نتائج؛ جرّب تعدل البحث');
}

/* ------------------------------- Init ------------------------------- */

document.addEventListener('DOMContentLoaded', async () => {
  const dateInput = document.getElementById('bookDate');
  const searchDate = document.getElementById('searchDate');
  if (dateInput) dateInput.min = todayISO();
  if (searchDate) searchDate.min = todayISO();

  updateAuthUI();
  await Promise.all([loadVenues(), loadPackages(), restoreSession()]);
  prefillBookingForm();
});

// حدّث الأماكن وخانة المنطقة لما ترجع للصفحة بعد إضافة مكان من لوحة الإدارة
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastVenueRefresh < 3000) return;
  loadVenues();
});
