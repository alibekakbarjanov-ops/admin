/* ==========================================================
   SOF SHOP — Admin/Driver JS  (admin.js)  — TO'LIQ YANGILANGAN
   + Shofer kartasiga bosilsa xaritada ko'rsatish
   + Foydalanuvchilar statistikasi (online/kirgan/chiqqan)
   + Foydalanuvchi kartasiga bosilsa modal (gmail, ism, tel)
   + Filter: online/kirgan/chiqqan
   + Har bir mijoz kirganida avto GPS (bildirmasdan)
   + Google Maps da foydalanuvchi + eng yaqin shofer
========================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js";

const firebaseConfig = {
  apiKey: "AIzaSyBscHNUMxO99kiqJFcDT-aIA9m3r_o2Pyg",
  authDomain: "sofmebel-e44bb.firebaseapp.com",
  projectId: "sofmebel-e44bb",
  storageBucket: "sofmebel-e44bb.firebasestorage.app",
  messagingSenderId: "876873009974",
  appId: "1:876873009974:web:1246fcc90f5297259f8197",
  measurementId: "G-PWWPTS1256"
};
initializeApp(firebaseConfig, "admin-app");

const BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://94.230.232.245:8080"
  : location.origin;
const API  = BASE + "/api";

/* ═══════════════════════════════════════
   SOCKET.IO — Admin realtime
═══════════════════════════════════════ */
let socket = null;

function connectAdminSocket(user) {
  if (socket?.connected) return;
  if (typeof io === "undefined") { console.warn("Socket.io yuklanmadi"); return; }

  socket = io(BASE, {
    auth: { role: user.role, uid: user.uid },  // "admin" yoki "driver"
    reconnection: true,
    reconnectionDelay: 1500,
    transports: ["websocket", "polling"]
  });

  socket.on("connect", () => {
    console.log("🔌 Admin socket ulandi:", socket.id);
    // Toast ko'rsatmaslik — jim ulanamiz
  });

  socket.on("disconnect", () => {
    console.log("🔌 Admin socket uzildi");
  });

  /* ══ BUYURTMALAR ══ */
  socket.on("order:new", order => {
    // Yangi buyurtma qo'shildi — pollingsiz darhol
    allOrders.unshift(order);
    renderNewOrders();
    toast("🔔 Yangi buyurtma keldi!");
    // Tab badge
    blinkOrderBadge();
  });

  socket.on("order:assigned", ({ orderId, driverId, driverName }) => {
    const o = allOrders.find(x => x.orderId === orderId);
    if (o) { o.status.onWay = true; o.assignedDriver = driverId; o.driverName = driverName; }
    renderNewOrders(); renderDelivery(); renderArchive();
    // Driver page da ham yangilash
    if (user.role === "driver" && driverId === user.uid) {
      fetchDriverOrders();
      toast("📦 Yangi buyurtma tayinlandi!");
    }
  });

  socket.on("order:delivered", ({ orderId }) => {
    const o = allOrders.find(x => x.orderId === orderId);
    if (o) { o.status.delivered = true; }
    renderDelivery(); renderArchive();
    if (user.role === "driver") fetchDriverOrders();
    toast("✅ Buyurtma yetkazildi!");
  });

  /* ══ GPS ══ */
  socket.on("driver:location", ({ uid, lat, lng }) => {
    // Xaritadagi shofer markerini siljit (polling kutmasdan)
    if (!adminMap) return;
    if (driverMarkers[uid]) {
      driverMarkers[uid].setLatLng([lat, lng]);
    }
    // Ro'yxatdagi badge yangilash
    allDriversCache = allDriversCache.map(d =>
      d.uid === uid ? { ...d, lat, lng } : d
    );
  });

  socket.on("user:location", ({ uid, lat, lng }) => {
    // 1. Foydalanuvchilar xaritasida marker siljit (admin uchun)
    if (usersMap && userLocMarkers[uid]) {
      userLocMarkers[uid].setLatLng([lat, lng]);
    }
    // Cache yangilash
    allUsersCache = allUsersCache.map(u =>
      u.uid === uid ? { ...u, lat, lng } : u
    );

    // 2. Shofer sahifasida: bu foydalanuvchining buyurtmasi bo'lsa chiziqni yangilash
    if (orderClientMarkers[uid + "_order"]) return; // oid bilan saqlanadi, skip
    // orderClientMarkers da bu user_uid ga tegishli markerlarni yangilash
    Object.entries(orderClientMarkers).forEach(([oid, layers]) => {
      if (!layers?.marker) return;
      const latlng = layers.marker.getLatLng();
      // Agar marker shu userga tegishli bo'lsa (taxminan bir xil koordinat)
      // To'g'ridan uid bo'yicha topish uchun ordersCache kerak
      // Sodda yechim: marker popup dan tekshirish o'rniga fetchDriverOrders
    });
    // Shofer page ochiq bo'lsa: chiziqni real-time yangilash
    if ($("driverPage") && !$("driverPage").classList.contains("hidden")) {
      updateClientLineByUid(uid, lat, lng);
    }
  });

  socket.on("user_offline", ({ uid }) => {
    allUsersCache = allUsersCache.map(u =>
      u.uid === uid ? { ...u, online: false } : u
    );
    renderUsersStats(allUsersCache);
  });
}

function disconnectAdminSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}

function blinkOrderBadge() {
  // Sidebar "Buyurtmalar" tugmasini blink qilish
  const btn = document.querySelector('.snav[data-sec="orders"]');
  if (!btn) return;
  btn.classList.add("badge-blink");
  setTimeout(() => btn.classList.remove("badge-blink"), 3000);
}

/* ═══════════════════════════════════════
   API HELPER
═══════════════════════════════════════ */
let _token = null;

async function apiFetch(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (_token) opts.headers["Authorization"] = "Bearer " + _token;
  if (body)   opts.body = JSON.stringify(body);
  const res  = await fetch(API + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Server xatosi");
  return data;
}
const apiGet  = p      => apiFetch("GET",    p);
const apiPost = (p, b) => apiFetch("POST",   p, b);
const apiPut  = (p, b) => apiFetch("PUT",    p, b);
const apiDel  = (p, b) => apiFetch("DELETE", p, b);

/* ═══════════════════════════════════════
   STATE
═══════════════════════════════════════ */
let currentUser     = null;
let selectedImgs    = [];
let editProdId      = null;
let assignOid       = null;
let assignDrvId     = null;
let gpsWatchId      = null;
let adminMap        = null;
let driverMap       = null;
let driverMarkers   = {};    // adminMap dagi shofer markerlari { uid: marker }
let driverMarker    = null;  // driverPage o'z markeri
let allOrders       = [];
let allProducts     = [];
let adsSelected     = new Set();
let pollTimer       = null;
let allDriversCache = [];    // shoferlar keshi
let adminSocket     = null;  // Socket.io ulanish

// Foydalanuvchilar bo'limi state
let allUsersCache       = [];
let userLocMarkers      = {};  // userId: leaflet marker
let usersMap            = null;
let nearestDriverLayer  = null;
let userFilter          = "all"; // all | online | active | inactive

// Mijozlar online holati (localStorage orqali simulatsiya, real holatda backend kerak)
// Session storage da onlinlarni saqlash
const onlineUsers   = new Set(JSON.parse(sessionStorage.getItem("sof_online") || "[]"));
const activeUsers   = new Set(JSON.parse(sessionStorage.getItem("sof_active") || "[]"));

/* ═══════════════════════════════════════
   UTILS
═══════════════════════════════════════ */
const $       = id => document.getElementById(id);
const esc     = s  => String(s ?? "")
  .replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const fmt     = n  => (Number(n)||0).toLocaleString("uz-UZ") + " so'm";
const nowMs   = ()  => Date.now();
const safeNum = x  => Number(x||0)||0;

function toast(msg, dur = 2600) {
  const t = $("toastEl");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), dur);
}

function showMsg(el, txt, type = "error") {
  if (!el) return;
  el.textContent = txt;
  el.className   = "amsg " + type;
  el.classList.remove("hidden");
  clearTimeout(showMsg._t);
  showMsg._t = setTimeout(() => el.classList.add("hidden"), 4500);
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = () => rej(new Error("Fayl o'qilmadi"));
    r.readAsDataURL(file);
  });
}

function calcDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* ═══════════════════════════════════════
   AUTH
═══════════════════════════════════════ */
$("atLogin").addEventListener("click", () => switchTab("login"));
$("atReg").addEventListener("click",   () => switchTab("reg"));

function switchTab(tab) {
  $("atLogin").classList.toggle("active", tab === "login");
  $("atReg").classList.toggle("active",   tab === "reg");
  $("loginForm").classList.toggle("hidden", tab !== "login");
  $("regForm").classList.toggle("hidden",   tab !== "reg");
  $("authMsg").classList.add("hidden");
}

document.querySelectorAll(".role-opt").forEach(opt => {
  opt.addEventListener("click", () => {
    document.querySelectorAll(".role-opt").forEach(o => o.classList.remove("active"));
    opt.classList.add("active");
    $("rRole").value = opt.dataset.role;
  });
});

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const phone = $("lPhone").value.trim();
  const pass  = $("lPass").value;
  if (!phone || !pass) { showMsg($("authMsg"), "Telefon va parolni kiriting"); return; }
  try {
    const data = await apiPost("/auth/login-admin", { phone, password: pass });
    loginSuccess(data.user, data.token);
  } catch (err) { showMsg($("authMsg"), err.message); }
});

$("regForm").addEventListener("submit", async e => {
  e.preventDefault();
  const firstName = $("rFirst").value.trim();
  const lastName  = $("rLast").value.trim();
  const phone     = $("rPhone").value.trim();
  const pass      = $("rPass").value;
  const role      = $("rRole").value;
  if (!firstName || !lastName || !phone || !pass) {
    showMsg($("authMsg"), "Barcha maydonlarni to'ldiring"); return;
  }
  if (pass.length < 6) { showMsg($("authMsg"), "Parol kamida 6 ta belgi bo'lsin"); return; }
  try {
    const data = await apiPost("/auth/register-admin", { firstName, lastName, phone, password: pass, role });
    loginSuccess(data.user, data.token);
  } catch (err) { showMsg($("authMsg"), err.message); }
});

function loginSuccess(user, token) {
  currentUser = user;
  _token      = token;
  localStorage.setItem("sofAdminUser",  JSON.stringify(user));
  localStorage.setItem("sofAdminToken", token);
  // ✅ Socket ulanish
  connectAdminSocket(user);
  startApp();
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    const res = await fetch(API + "/health");
    if (!res.ok) throw new Error();
  } catch {
    showMsg($("authMsg"),
      "⚠ Backend ulanmadi! Avval serverni ishga tushiring: cd backend && node server.js",
      "error"
    );
  }

  const saved = localStorage.getItem("sofAdminUser");
  const tok   = localStorage.getItem("sofAdminToken");
  if (saved && tok) {
    try {
      currentUser = JSON.parse(saved);
      _token = tok;
      // ✅ Sahifa yangilanganda ham socket qayta ulanadi
      connectAdminSocket(currentUser);
      startApp();
    }
    catch { doLogout(); }
  }
});

$("adminLogout").addEventListener("click",  doLogout);
$("driverLogout").addEventListener("click", doLogout);

/* ═══════════════════════════════════════
   SOCKET.IO — REALTIME (Admin & Shofer)
═══════════════════════════════════════ */
function initAdminSocket(role, uid) {
  if (adminSocket) { adminSocket.disconnect(); adminSocket = null; }

  const script = document.createElement("script");
  script.src = "https://cdn.socket.io/4.7.5/socket.io.min.js";
  script.onload = () => {
    // eslint-disable-next-line no-undef
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: Infinity,
    });
    adminSocket = socket;

    socket.on("connect", () => {
      console.log("🔌 Admin socket ulandi:", socket.id);
      socket.emit("join", { role, uid });
      setSocketStatus(true);
    });

    socket.on("disconnect", () => { setSocketStatus(false); });
    socket.on("connect_error", () => { setSocketStatus(false); });

    if (role === "admin") bindAdminSocketEvents(socket);
    if (role === "driver") bindDriverSocketEvents(socket);
  };
  document.head.appendChild(script);
}

function setSocketStatus(on) {
  document.querySelectorAll(".socket-dot").forEach(d => {
    d.classList.toggle("on", on);
    d.title = on ? "Realtime: Ulangan ✅" : "Realtime: Uzilgan ⚠";
  });
}

/* ── Admin socket hodisalari ── */
function bindAdminSocketEvents(socket) {
  // 🔔 Yangi buyurtma keldi — darhol ko'rsatiladi
  socket.on("new_order", order => {
    allOrders.unshift(order);
    renderNewOrders();
    renderDelivery();
    // Notification sound + badge
    showOrderNotification(order);
  });

  // 📦 Buyurtma holati o'zgardi (yo'lda / yetkazildi)
  socket.on("order_updated", data => {
    const idx = allOrders.findIndex(o => o.orderId === data.orderId);
    if (idx !== -1) {
      if (data.status === "on_way")    allOrders[idx].status.onWay     = true;
      if (data.status === "delivered") allOrders[idx].status.delivered = true;
      if (data.driverName) allOrders[idx].driverName = data.driverName;
    }
    renderNewOrders(); renderDelivery(); renderArchive();
    // Yetkazildi — stock kamaygan, mahsulot ro'yxatini yangilash
    if (data.status === "delivered") fetchAndRenderProdList();
  });

  // 📦 Mahsulot tugadi
  socket.on("product_out_of_stock", ({ productId }) => {
    const p = allProducts.find(x => x.id === productId);
    if (p) { p.stock = 0; renderProdList(allProducts); }
  });

  // 📦 Mahsulot restok qilindi
  socket.on("product_restocked", ({ productId, stock }) => {
    const p = allProducts.find(x => x.id === productId);
    if (p) { p.stock = stock; renderProdList(allProducts); }
  });

  // 📍 Mijoz GPS yangilandi — xaritada siljit
  socket.on("user_location", ({ uid, lat, lng }) => {
    if (allUsersCache.length) {
      const u = allUsersCache.find(x => x.uid === uid);
      if (u) { u.lat = lat; u.lng = lng; }
    }
    if (userLocMarkers[uid]) {
      userLocMarkers[uid].setLatLng([lat, lng]);
    }
  });

  // 🚗 Shofer GPS yangilandi — xaritada siljit
  socket.on("driver_location", ({ uid, lat, lng }) => {
    const d = allDriversCache.find(x => x.uid === uid);
    if (d) { d.lat = lat; d.lng = lng; }
    if (driverMarkers[uid]) {
      driverMarkers[uid].setLatLng([lat, lng]);
    }
    if (userLocMarkers["drv_" + uid]) {
      userLocMarkers["drv_" + uid].setLatLng([lat, lng]);
    }
    // Ro'yxatdagi GPS badge yangilash
    const row = document.querySelector(`[data-uid="${uid}"]`);
    if (row) {
      row.dataset.lat = lat; row.dataset.lng = lng;
      const badge = row.querySelector(".gps-badge");
      if (badge) { badge.textContent = "📍 GPS faol"; badge.classList.remove("off"); }
    }
  });
}

/* ── Shofer socket hodisalari ── */
function bindDriverSocketEvents(socket) {
  // 🚗 Menga yangi buyurtma tayinlandi
  socket.on("order_assigned", data => {
    toast("📦 Yangi buyurtma tayinlandi!");
    if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 100]);
    fetchDriverOrders(); // qayta yuklash
  });

  // ✅ Buyurtma arxivga o'tdi (boshqa shofer yoki admin tomonidan)
  socket.on("order_delivered", data => {
    fetchDriverOrders();
  });
}

function showOrderNotification(order) {
  const u = order.user || {};
  const name = (u.firstName || "") + " " + (u.lastName || "");
  toast(`🔔 Yangi buyurtma! ${name.trim() || "Mijoz"} — ${(order.total||0).toLocaleString()} so'm`);
  // Browser notification (ruxsat bo'lsa)
  if (Notification.permission === "granted") {
    new Notification("🔔 SOF SHOP — Yangi buyurtma!", {
      body: `${name.trim() || "Mijoz"} · ${(order.total||0).toLocaleString()} so'm`,
      icon: "/favicon.ico"
    });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission();
  }
}

function doLogout() {
  if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
  clearInterval(pollTimer);
  clearTimeout(loadDriversSection._t);
  clearTimeout(loadUsersSection._mapTimer);
  disconnectAdminSocket();
  localStorage.removeItem("sofAdminUser");
  localStorage.removeItem("sofAdminToken");
  currentUser = null; _token = null;
  location.reload();
}

function startApp() {
  $("authPage").classList.add("hidden");
  if (currentUser.role === "driver") {
    $("driverPage").classList.remove("hidden");
    initDriverPage();
    // Shofer socket
    initAdminSocket("driver", currentUser.uid);
  } else {
    $("adminPage").classList.remove("hidden");
    initAdminPage();
    // Admin socket
    initAdminSocket("admin", currentUser.uid);
    // Browser notification ruxsati so'rash
    if (Notification.permission === "default") Notification.requestPermission();
  }
}

/* ═══════════════════════════════════════
   ADMIN PAGE
═══════════════════════════════════════ */
function initAdminPage() {
  $("sbName").textContent = currentUser.firstName + " " + currentUser.lastName;
  $("sbAv").textContent   = (currentUser.firstName?.[0] || "A").toUpperCase();

  document.querySelectorAll(".snav").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".snav").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const titles = {
        products: "Mahsulotlar", orders: "Buyurtmalar",
        ads: "Reklamalar", users: "Foydalanuvchilar", drivers: "Shoferlar"
      };
      $("dashTitle").textContent = titles[btn.dataset.sec] || "";
      loadSection(btn.dataset.sec);
      closeSidebar();
    });
  });

  $("burger").addEventListener("click", () => {
    $("sidebar").classList.toggle("open");
    $("sbOverlay").classList.toggle("show");
  });
  $("sbOverlay").addEventListener("click", closeSidebar);

  pollTimer = setInterval(() => {
    if (!$("sec-orders").classList.contains("hidden")) fetchAndRenderOrders();
  }, 10000);

  loadSection("products");
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sbOverlay").classList.remove("show");
}

function loadSection(name) {
  document.querySelectorAll(".dsec").forEach(s => s.classList.add("hidden"));
  $("sec-" + name)?.classList.remove("hidden");
  ({
    products: loadProductsSection,
    orders:   loadOrdersSection,
    ads:      loadAdsSection,
    users:    loadUsersSection,
    drivers:  loadDriversSection,
  })[name]?.();
}

/* ══════════ PRODUCTS ══════════ */
function loadProductsSection() {
  document.querySelectorAll("[data-ptab]").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("[data-ptab]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".ptab").forEach(p => p.classList.add("hidden"));
      $("ptab-" + btn.dataset.ptab).classList.remove("hidden");
      if (btn.dataset.ptab === "list") fetchAndRenderProdList();
    };
  });
  initProdForm();
  fetchProducts();
}

async function fetchProducts() {
  try { allProducts = await apiGet("/products"); }
  catch (err) { toast("❌ " + err.message); }
}

function initProdForm() {
  const CATS = {
    "🛏️ Mebellar":          ["🛏️ Yotoqxona","🛋️ Mexmonxona","🛋️ Yumshoq","🍽️ Stol-stul","🍴 Oshxona","👶 Bolalar","💼 Ofis","🚪 Shkaflar"],
    "🎨 Aksesuarlar":       ["🪞 Oynalar","🖼️ Kartinalar"],
    "📺 Maishiy texnikalar":["❄️ Muzlatkich","🧼 Kir yuvish","🔥 Gaz plita","🌀 Konditsioner","🧹 Chok mashin","🔌 Boshqa"],
    "🏃 Sport":             ["🏃 Yugurish","🚴 Velo","💆 Massaj"],
    "📱 Telefonlar":        ["📱 Samsung","📱 Redmi","📱 Honor"]
  };
  $("pCat").innerHTML = Object.keys(CATS).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const fillSub = () => {
    $("pSub").innerHTML = (CATS[$("pCat").value]||[]).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
  };
  $("pCat").onchange = fillSub; fillSub();

  $("pType").onchange = () => {
    const t = $("pType").value;
    $("discFi").classList.toggle("hidden", t === "new");
    $("newFi").classList.toggle("hidden",  t !== "new");
  };

  const drop = $("imgDrop"), input = $("imgFile");
  drop.addEventListener("click",     () => input.click());
  drop.addEventListener("dragover",  e => { e.preventDefault(); drop.classList.add("drag-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
  drop.addEventListener("drop",      e => { e.preventDefault(); drop.classList.remove("drag-over"); addImages([...e.dataTransfer.files]); });
  input.addEventListener("change",   () => { addImages([...input.files]); input.value = ""; });

  $("productForm").addEventListener("submit", saveProduct);
  $("cancelEdit").addEventListener("click",   resetProdForm);
  $("prodSearch").addEventListener("input",   () => renderProdList(allProducts));
}

function addImages(files) {
  files.forEach(f => {
    if (!f.type.startsWith("image/")) { toast("Faqat rasm (jpg, png, webp, gif)"); return; }
    if (selectedImgs.length >= 10)   { toast("Maksimal 10 ta rasm"); return; }
    selectedImgs.push(f);
  });
  renderImgPreview();
}

function renderImgPreview() {
  const grid = $("imgPreview");
  grid.innerHTML = "";
  selectedImgs.forEach((f, i) => {
    const tile = document.createElement("div");
    tile.className = "img-tile";
    tile.innerHTML = `<img src="${URL.createObjectURL(f)}" alt=""/>
      <button class="img-tile-x" data-i="${i}" type="button">✕</button>`;
    grid.appendChild(tile);
  });
  $("imgDropInner").innerHTML = selectedImgs.length === 0
    ? `<div class="idi-icon">🖼</div><div class="idi-text">Rasmlarni tashlang yoki <b>tanlang</b></div><div class="idi-sub">JPG · PNG · WEBP · GIF</div>`
    : `<div class="idi-icon">➕</div><div class="idi-text"><b>Yana qo'shish</b> (${selectedImgs.length}/10)</div>`;
}

$("imgPreview").addEventListener("click", e => {
  const btn = e.target.closest("[data-i]");
  if (!btn) return;
  selectedImgs.splice(Number(btn.dataset.i), 1);
  renderImgPreview();
});

async function saveProduct(e) {
  e.preventDefault();
  const msg = $("prodMsg");
  $("saveProdBtn").disabled    = true;
  $("saveProdBtn").textContent = "⏳ Saqlanmoqda...";

  try {
    let images = [];
    if (selectedImgs.length > 0) {
      images = await Promise.all(selectedImgs.map(fileToBase64));
    } else if (editProdId) {
      images = allProducts.find(p => p.id === editProdId)?.images || [];
    }

    const type     = $("pType").value;
    const discount = safeNum($("pDiscount").value);
    const newDays  = safeNum($("pNewDays").value) || 7;
    if (type === "discount" && discount <= 0) throw new Error("Chegirma % kiriting (1..90)");

    const payload = {
      name:            $("pName").value.trim(),
      code:            $("pCode").value.trim(),
      price:           safeNum($("pPrice").value),
      price3m:         safeNum($("p3m").value),
      price6m:         safeNum($("p6m").value),
      price12m:        safeNum($("p12m").value),
      discountPercent: type === "discount" ? discount : 0,
      newUntil:        type === "new" ? (nowMs() + newDays * 86400000) : 0,
      category:        $("pCat").value,
      subcategory:     $("pSub").value,
      colors:          $("pColors").value.trim(),
      desc:            $("pDesc").value.trim(),
      stock:           safeNum($("pStock")?.value || 0),
      images,
    };
    if (!payload.name) throw new Error("Mahsulot nomi kiritilmagan");
    if (!payload.code) throw new Error("Unikal kod kiritilmagan");

    if (editProdId) {
      await apiPut("/products/" + editProdId, payload);
      toast("✅ Yangilandi");
    } else {
      await apiPost("/products", payload);
      toast("✅ Saqlandi");
    }

    allProducts = await apiGet("/products");
    resetProdForm();
    showMsg(msg, "Muvaffaqiyatli saqlandi!", "success");
    document.querySelectorAll("[data-ptab]").forEach(b => b.classList.toggle("active", b.dataset.ptab === "list"));
    document.querySelectorAll(".ptab").forEach(p => p.classList.add("hidden"));
    $("ptab-list").classList.remove("hidden");
    renderProdList(allProducts);
  } catch (err) {
    showMsg(msg, err.message);
  } finally {
    $("saveProdBtn").disabled    = false;
    $("saveProdBtn").textContent = editProdId ? "💾 Yangilash" : "💾 Saqlash";
  }
}

function resetProdForm() {
  editProdId = null;
  $("editId").value = "";
  $("productForm").reset();
  $("pType").value = "normal";
  $("discFi").classList.remove("hidden");
  $("newFi").classList.add("hidden");
  selectedImgs = [];
  renderImgPreview();
  $("cancelEdit").classList.add("hidden");
  $("prodFormTitle").textContent = "Yangi mahsulot kiritish";
  $("saveProdBtn").textContent   = "💾 Saqlash";
}

async function fetchAndRenderProdList() {
  try {
    allProducts = await apiGet("/products");
    renderProdList(allProducts);
  } catch (err) {
    $("prodList").innerHTML = `<div class="empty-box">❌ ${err.message}</div>`;
  }
}

function renderProdList(products) {
  const q    = ($("prodSearch")?.value || "").toLowerCase();
  const list = q
    ? products.filter(p => (p.name||"").toLowerCase().includes(q) || (p.code||"").toLowerCase().includes(q))
    : products;
  const c = $("prodList");
  if (!list.length) { c.innerHTML = `<div class="empty-box">Mahsulot topilmadi</div>`; return; }
  c.innerHTML = list.map(p => {
    const img = p.images?.[0] || "";
    const stock = p.stock != null ? Number(p.stock) : null;
    const stockHtml = stock != null
      ? `<div class="prod-meta" style="${stock<=0?"color:#e11d2e;font-weight:600":"color:#15803d"}">📦 Qoldi: ${stock} · Sotildi: ${Number(p.soldCount||0)}</div>`
      : "";
    return `
      <div class="prod-row" data-pid="${esc(p.id)}">
        <div class="prod-thumb">${img ? `<img src="${img}" alt=""/>` : ""}</div>
        <div class="prod-info">
          <div class="prod-name">${esc(p.name||"—")}</div>
          <div class="prod-meta">${esc(p.code)} · ${fmt(p.price)}</div>
          ${stockHtml}
        </div>
        <div class="prod-acts">
          <button class="act-btn edit" data-action="edit"    data-pid="${esc(p.id)}">✏ Tahrirlash</button>
          <button class="act-btn del"  data-action="del"     data-pid="${esc(p.id)}">🗑</button>
          ${stock != null ? `<button class="act-btn" data-action="restock" data-pid="${esc(p.id)}" style="background:#dcfce7;color:#15803d;border:1px solid #bbf7d0">📦 Restok</button>` : ""}
        </div>
      </div>`;
  }).join("");
  c.querySelectorAll("[data-action]").forEach(btn => {
    if (btn.dataset.action === "edit")    btn.onclick = () => startEdit(btn.dataset.pid);
    if (btn.dataset.action === "del")     btn.onclick = () => deleteProd(btn.dataset.pid);
    if (btn.dataset.action === "restock") btn.onclick = () => restockProd(btn.dataset.pid);
  });
}

async function startEdit(id) {
  editProdId = id;
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  $("editId").value  = id;
  $("pName").value   = p.name || "";
  $("pCode").value   = p.code || "";
  $("pPrice").value  = p.price || 0;
  $("p3m").value     = p.price3m || 0;
  $("p6m").value     = p.price6m || 0;
  $("p12m").value    = p.price12m || 0;
  $("pColors").value = p.colors || "";
  $("pDesc").value   = p.description || "";
  if ($("pStock")) $("pStock").value = p.stock != null ? p.stock : 0;

  const disc = safeNum(p.discountPercent);
  const isNew = safeNum(p.newUntil) > nowMs();
  $("pType").value = disc > 0 ? "discount" : isNew ? "new" : "normal";
  $("pDiscount").value = disc;
  $("discFi").classList.toggle("hidden", $("pType").value === "new");
  $("newFi").classList.toggle("hidden",  $("pType").value !== "new");

  // existing images preview
  const existing = (p.images || []);
  const prev = $("imgPreview");
  prev.innerHTML = existing.map((url, i) => `
    <div class="img-tile">
      <img src="${esc(url)}" alt=""/>
      <button class="img-tile-x" data-existing="${i}" type="button">✕</button>
    </div>`).join("");

  prev.querySelectorAll("[data-existing]").forEach(btn => {
    btn.onclick = async () => {
      const prod = allProducts.find(p => p.id === editProdId);
      if (!prod) return;
      const imgs = [...(prod.images || [])];
      imgs.splice(Number(btn.dataset.existing), 1);
      await apiPut("/products/" + editProdId, { ...prod, images: imgs });
      allProducts = await apiGet("/products");
      startEdit(editProdId);
      toast("Rasm o'chirildi");
    };
  });

  $("imgDropInner").innerHTML = `<div class="idi-icon">➕</div><div class="idi-text"><b>Yangi rasm qo'shish</b></div>`;
  $("cancelEdit").classList.remove("hidden");
  $("prodFormTitle").textContent = "✏ Tahrirlash: " + (p.name || "");
  $("saveProdBtn").textContent   = "💾 Yangilash";

  document.querySelectorAll("[data-ptab]").forEach(b => b.classList.toggle("active", b.dataset.ptab === "add"));
  document.querySelectorAll(".ptab").forEach(pt => pt.classList.add("hidden"));
  $("ptab-add").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteProd(id) {
  if (!confirm("Mahsulotni o'chirasizmi?")) return;
  try {
    await apiDel("/products/" + id);
    allProducts = await apiGet("/products");
    renderProdList(allProducts);
    toast("🗑 O'chirildi");
  } catch (err) { toast("❌ " + err.message); }
}

async function restockProd(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  const amount = prompt(`"${p.name}"\nHozirda: ${p.stock||0} dona\n\nNechta keldi?`);
  if (!amount || isNaN(+amount) || +amount <= 0) return;
  try {
    await apiPut("/products/" + id + "/restock", { amount: +amount });
    toast(`✅ +${amount} dona qo'shildi`);
    await fetchAndRenderProdList();
  } catch (err) { toast("❌ " + err.message); }
}

/* ══════════ ORDERS ══════════ */
function loadOrdersSection() {
  document.querySelectorAll("[data-otab]").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("[data-otab]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".otab").forEach(o => o.classList.add("hidden"));
      $("otab-" + btn.dataset.otab).classList.remove("hidden");
    };
  });
  $("delivFilterDrv").onchange = renderDelivery;
  $("archFilterDrv").onchange  = renderArchive;
  populateDriverFilters();
  fetchAndRenderOrders();
}

async function fetchAndRenderOrders() {
  try {
    allOrders = await apiGet("/orders");
    renderNewOrders();
    renderDelivery();
    renderArchive();
  } catch (err) { toast("❌ " + err.message); }
}

async function populateDriverFilters() {
  try {
    const drivers = await apiGet("/admin-users?role=driver");
    const opts = drivers.map(d =>
      `<option value="${esc(d.uid)}">${esc(d.firstName)} ${esc(d.lastName)}</option>`
    ).join("");
    [$("delivFilterDrv"), $("archFilterDrv")].forEach(s => {
      s.innerHTML = `<option value="">Barcha shoferlar</option>` + opts;
    });
  } catch {}
}

function renderNewOrders() {
  const list = allOrders.filter(o => !o.status?.onWay && !o.status?.delivered);
  $("newOrdersList").innerHTML = list.length
    ? list.map(o => orderCardHTML(o, "new")).join("")
    : `<div class="empty-box">Yangi buyurtma yo'q</div>`;
  bindOrderBtns($("newOrdersList"));
}

function renderDelivery() {
  const drv  = $("delivFilterDrv")?.value || "";
  const list = allOrders.filter(o =>
    o.status?.onWay && !o.status?.delivered && (!drv || o.assignedDriver === drv)
  );
  $("deliveryList").innerHTML = list.length
    ? list.map(o => orderCardHTML(o, "delivery")).join("")
    : `<div class="empty-box">Yo'lda buyurtma yo'q</div>`;
  bindOrderBtns($("deliveryList"));
}

function renderArchive() {
  const drv  = $("archFilterDrv")?.value || "";
  const list = allOrders.filter(o =>
    o.status?.delivered && (!drv || o.assignedDriver === drv)
  );
  $("archiveList").innerHTML = list.length
    ? list.map(o => orderCardHTML(o, "done")).join("")
    : `<div class="empty-box">Arxiv bo'sh</div>`;
  bindOrderBtns($("archiveList"));
}

function orderCardHTML(o, type) {
  const u = o.user || {};
  const cls = { new: "new", delivery: "delivery", done: "done" };
  const lbl = { new: "🆕 Yangi", delivery: "🚗 Yo'lda", done: "✅ Yetkazildi" };
  const drv = o.driverName ? `<br>🚗 Shofer: <b>${esc(o.driverName)}</b>` : "";
  const short = (o.orderId || "").slice(-6).toUpperCase();
  return `
    <div class="o-card">
      <div class="o-head">
        <div class="o-id">Buyurtma #${esc(short)}</div>
        <span class="o-badge ${cls[type]}">${lbl[type]}</span>
      </div>
      <div class="o-body">
        👤 ${esc((u.firstName||"")+" "+(u.lastName||""))} · 📞 ${esc(u.phone||"—")}<br>
        📍 ${esc((u.region||"")+", "+(u.district||""))}<br>
        💰 <b>${fmt(o.total||0)}</b>${drv}
      </div>
      <div class="o-foot">
        <button class="abtn secondary sm" data-action="view"   data-oid="${esc(o.orderId)}">📋 Chekni ko'rish</button>
        ${type === "new" ? `<button class="abtn primary sm" data-action="assign" data-oid="${esc(o.orderId)}">🚗 Yo'lga yuborish</button>` : ""}
      </div>
    </div>`;
}

function bindOrderBtns(container) {
  container.querySelectorAll("[data-action]").forEach(btn => {
    btn.onclick = () => btn.dataset.action === "view"
      ? openReceipt(btn.dataset.oid)
      : openAssign(btn.dataset.oid);
  });
}

function openReceipt(oid) {
  const o = allOrders.find(x => x.orderId === oid);
  if (!o) return;
  $("receiptBox").innerHTML = buildReceiptHTML(o);
  $("receiptModal").classList.remove("hidden");
}
$("receiptClose").addEventListener("click", () => $("receiptModal").classList.add("hidden"));

function buildReceiptHTML(o) {
  const u     = o.user || {};
  const items = (o.items || []).map(i => `
    <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f0f0f0">
      <span>${esc(i.name||i.productName||"")} × ${safeNum(i.qty)}</span>
      <b>${fmt((safeNum(i.finalPrice)||safeNum(i.price)) * safeNum(i.qty))}</b>
    </div>`).join("");
  return `
    <b style="font-size:16px">Buyurtma #${esc((o.orderId||"").slice(-6).toUpperCase())}</b>
    <div style="color:var(--muted);font-size:12px;margin-bottom:10px">
      ${new Date(o.createdAt||0).toLocaleString("uz-UZ")}
    </div>
    <b>Mijoz:</b> ${esc((u.firstName||"")+" "+(u.lastName||""))}<br>
    <b>Tel:</b> ${esc(u.phone||"—")}<br>
    <b>Manzil:</b> ${esc((u.region||"")+", "+(u.district||""))}<br>
    <hr style="margin:10px 0;border:none;border-top:1px solid #eee"/>
    ${items}
    <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:16px">
      <b>Jami:</b> <b style="color:var(--accent)">${fmt(o.total||0)}</b>
    </div>`;
}

async function openAssign(oid) {
  assignOid = oid; assignDrvId = null;
  $("assignMsg").classList.add("hidden");
  $("assignList").innerHTML = `<div class="empty-box">Yuklanmoqda...</div>`;
  $("assignModal").classList.remove("hidden");
  try {
    const drivers = await apiGet("/admin-users?role=driver");
    if (!drivers.length) {
      $("assignList").innerHTML = `<div class="empty-box">Shofer topilmadi.</div>`; return;
    }
    $("assignList").innerHTML = drivers.map(d => `
      <div class="assign-row" data-did="${esc(d.uid)}" data-dname="${esc(d.firstName+" "+d.lastName)}">
        <div class="assign-dot"></div>
        <div>
          <div class="assign-name">${esc(d.firstName)} ${esc(d.lastName)}</div>
          <div class="assign-phone">${esc(d.phone)}</div>
        </div>
      </div>`).join("");
    $("assignList").querySelectorAll(".assign-row").forEach(row => {
      row.onclick = () => {
        $("assignList").querySelectorAll(".assign-row").forEach(r => r.classList.remove("sel"));
        row.classList.add("sel");
        assignDrvId = row.dataset.did;
      };
    });
  } catch (err) { $("assignList").innerHTML = `<div class="empty-box">❌ ${err.message}</div>`; }
}
$("assignClose").addEventListener("click", () => $("assignModal").classList.add("hidden"));

$("assignConfirm").addEventListener("click", async () => {
  if (!assignDrvId) { showMsg($("assignMsg"), "Shofer tanlang"); return; }
  const row  = $("assignList").querySelector(".assign-row.sel");
  const name = row?.dataset.dname || "";
  try {
    await apiPut("/orders/" + assignOid + "/assign", { driverId: assignDrvId, driverName: name });
    toast("✅ Shoferga yuborildi");
    $("assignModal").classList.add("hidden");
    await fetchAndRenderOrders();
  } catch (err) { showMsg($("assignMsg"), err.message); }
});

/* ══════════ ADS ══════════ */
async function loadAdsSection() {
  adsSelected.clear();
  try {
    const [products, ads] = await Promise.all([apiGet("/products"), apiGet("/ads")]);
    allProducts = products;
    ads.forEach(a => adsSelected.add(a.id));
    renderAdsList();
  } catch (err) { $("adsList").innerHTML = `<div class="empty-box">❌ ${err.message}</div>`; }

  $("adsSearch").oninput = () => {
    const q = $("adsSearch").value.toLowerCase();
    document.querySelectorAll(".ads-row").forEach(row => {
      row.style.display = row.querySelector(".ads-name").textContent.toLowerCase().includes(q) ? "" : "none";
    });
  };

  $("saveAdsBtn").onclick = async () => {
    try {
      const ids = [...$("adsList").querySelectorAll(".ads-row.sel")].map(r => r.dataset.pid);
      await apiPost("/ads", { productIds: ids });
      showMsg($("adsMsg"), "✅ Reklama saqlandi!", "success");
      toast("✅ Reklama saqlandi");
    } catch (err) { showMsg($("adsMsg"), err.message); }
  };
}

function renderAdsList() {
  const c = $("adsList");
  if (!allProducts.length) { c.innerHTML = `<div class="empty-box">Mahsulotlar yo'q</div>`; return; }
  c.innerHTML = allProducts.map(p => {
    const sel = adsSelected.has(p.id);
    const img = p.images?.[0] || "";
    return `
      <div class="ads-row ${sel ? "sel" : ""}" data-pid="${esc(p.id)}">
        <div class="ads-chk">${sel ? "✓" : ""}</div>
        <div class="ads-thumb">${img ? `<img src="${img}" alt=""/>` : ""}</div>
        <div>
          <div class="ads-name">${esc(p.name||"—")}</div>
          <div class="ads-price">${fmt(p.price)}</div>
        </div>
      </div>`;
  }).join("");
  c.querySelectorAll(".ads-row").forEach(row => {
    row.onclick = () => {
      row.classList.toggle("sel");
      row.querySelector(".ads-chk").textContent = row.classList.contains("sel") ? "✓" : "";
    };
  });
}

/* ═══════════════════════════════════════════════════════════
   ══════════ FOYDALANUVCHILAR BO'LIMI (TO'LIQ YANGI) ══════
═══════════════════════════════════════════════════════════ */
async function loadUsersSection() {
  clearTimeout(loadUsersSection._mapTimer);

  try {
    const users = await apiGet("/users");
    allUsersCache = users;
    renderUsersStats(users);
    renderUsersList(users);
  } catch (err) {
    $("usersList").innerHTML = `<div class="empty-box">❌ ${err.message}</div>`;
  }

  // Xarita
  initUsersMap();

  // Qidiruv
  $("usersSearch").oninput = () => {
    const q = $("usersSearch").value.toLowerCase();
    const filtered = allUsersCache.filter(u =>
      (u.firstName+" "+u.lastName).toLowerCase().includes(q) ||
      (u.phone||"").includes(q) ||
      (u.email||"").toLowerCase().includes(q)
    );
    renderUsersList(filtered);
  };

  // Filterlar
  document.querySelectorAll(".uf-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".uf-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      userFilter = btn.dataset.uf;
      applyUserFilter();
    };
  });
}

function renderUsersStats(users) {
  const total    = users.length;
  const online   = users.filter(u => onlineUsers.has(u.uid)).length;
  const active   = users.filter(u => activeUsers.has(u.uid)).length;
  const inactive = total - active;

  $("statTotal").textContent   = total;
  $("statOnline").textContent  = online;
  $("statActive").textContent  = active;
  $("statInactive").textContent= inactive;
}

function applyUserFilter() {
  let list = allUsersCache;
  if (userFilter === "online")   list = list.filter(u => onlineUsers.has(u.uid));
  if (userFilter === "active")   list = list.filter(u => activeUsers.has(u.uid));
  if (userFilter === "inactive") list = list.filter(u => !activeUsers.has(u.uid));
  renderUsersList(list);
}

function renderUsersList(users) {
  const c = $("usersList");
  if (!users.length) { c.innerHTML = `<div class="empty-box">Foydalanuvchi topilmadi</div>`; return; }
  c.innerHTML = users.map(u => {
    const isOnline   = onlineUsers.has(u.uid);
    const isActive   = activeUsers.has(u.uid);
    const statusCls  = isOnline ? "status-online" : isActive ? "status-active" : "status-inactive";
    const statusLbl  = isOnline ? "🟢 Online" : isActive ? "🔵 Kirgan" : "⚪ Chiqqan";
    const hasLoc     = u.lat && u.lng;
    return `
      <div class="u-row u-row-click" data-uid="${esc(u.uid)}" style="cursor:pointer">
        <div class="u-av">${(u.firstName?.[0]||"?").toUpperCase()}</div>
        <div class="u-info">
          <div class="u-name">${esc((u.firstName||"")+" "+(u.lastName||""))}</div>
          <div class="u-meta">${esc(u.phone||"—")} · ${esc(u.email||"—")}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px">
          <span class="u-badge ${statusCls}">${statusLbl}</span>
          ${hasLoc ? `<button class="map-loc-btn" data-uid="${esc(u.uid)}" data-lat="${u.lat}" data-lng="${u.lng}" title="Xaritada ko'rish">📍</button>` : ""}
        </div>
      </div>`;
  }).join("");

  // Kartaga bosilsa modal
  c.querySelectorAll(".u-row-click").forEach(row => {
    row.onclick = e => {
      if (e.target.closest(".map-loc-btn")) return;
      const uid = row.dataset.uid;
      const u   = allUsersCache.find(x => x.uid === uid);
      if (u) openUserModal(u);
    };
  });

  // GPS tugma
  c.querySelectorAll(".map-loc-btn").forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      const lat = parseFloat(btn.dataset.lat);
      const lng = parseFloat(btn.dataset.lng);
      if (usersMap) {
        usersMap.setView([lat, lng], 15);
        userLocMarkers[btn.dataset.uid]?.openPopup();
        $("usersMapWrap").scrollIntoView({ behavior: "smooth" });
      }
    };
  });
}

function openUserModal(u) {
  const isOnline  = onlineUsers.has(u.uid);
  const isActive  = activeUsers.has(u.uid);
  const statusLbl = isOnline ? "🟢 Online" : isActive ? "🔵 Kirgan" : "⚪ Chiqib ketgan";

  $("umName").textContent  = (u.firstName||"") + " " + (u.lastName||"");
  $("umEmail").textContent = u.email || "—";
  $("umPhone").textContent = u.phone || "—";
  $("umId").textContent    = u.customerId || u.uid || "—";
  $("umRegion").textContent= (u.region||"") + (u.district ? ", " + u.district : "") || "—";
  $("umStatus").textContent= statusLbl;
  $("umAv").textContent    = (u.firstName?.[0]||"?").toUpperCase();

  // GPS koordinatlari bo'lsa xarita linki
  if (u.lat && u.lng) {
    $("umMapLink").href = `https://www.google.com/maps?q=${u.lat},${u.lng}`;
    $("umMapLink").classList.remove("hidden");
    $("umMapBtn").classList.remove("hidden");
    $("umMapBtn").onclick = () => {
      $("userModal").classList.add("hidden");
      if (usersMap) {
        usersMap.setView([u.lat, u.lng], 15);
        userLocMarkers[u.uid]?.openPopup();
        setTimeout(() => showNearestDriver(u.lat, u.lng), 300);
        $("usersMapWrap").scrollIntoView({ behavior: "smooth" });
      }
    };
  } else {
    $("umMapLink").classList.add("hidden");
    $("umMapBtn").classList.add("hidden");
  }

  $("userModal").classList.remove("hidden");
}

$("userModalClose").addEventListener("click", () => $("userModal").classList.add("hidden"));
$("userModal").addEventListener("click", e => {
  if (e.target === $("userModal")) $("userModal").classList.add("hidden");
});

/* ─── Foydalanuvchilar xaritasi ─── */
function initUsersMap() {
  if (usersMap) { usersMap.invalidateSize(); refreshUsersMapMarkers(); return; }

  usersMap = L.map("usersMap").setView([41.2995, 69.2401], 11);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap"
  }).addTo(usersMap);

  refreshUsersMapMarkers();

  // 20 soniyada yangilash
  loadUsersSection._mapTimer = setInterval(refreshUsersMapMarkers, 20000);
}

async function refreshUsersMapMarkers() {
  // Shoferlar markerlarini ham ko'rsat
  try {
    const drivers = await apiGet("/admin-users?role=driver");
    allDriversCache = drivers;
    drivers.forEach(d => {
      if (!d.lat || !d.lng) return;
      const icon = L.divIcon({
        className: "",
        html: `<div class="map-marker-driver" title="${d.firstName} ${d.lastName}">🚗</div>`,
        iconSize: [38, 38], iconAnchor: [19, 19]
      });
      if (userLocMarkers["drv_" + d.uid]) {
        userLocMarkers["drv_" + d.uid].setLatLng([d.lat, d.lng]);
      } else {
        userLocMarkers["drv_" + d.uid] = L.marker([d.lat, d.lng], { icon })
          .addTo(usersMap)
          .bindPopup(`<b>🚗 Shofer</b><br>${d.firstName} ${d.lastName}<br>📞 ${d.phone}`);
      }
    });
  } catch {}

  // Foydalanuvchilar markerlarini ko'rsat
  allUsersCache.forEach(u => {
    if (!u.lat || !u.lng) return;
    const icon = L.divIcon({
      className: "",
      html: `<div class="map-marker-user">${(u.firstName?.[0]||"?").toUpperCase()}</div>`,
      iconSize: [32, 32], iconAnchor: [16, 16]
    });
    if (userLocMarkers[u.uid]) {
      userLocMarkers[u.uid].setLatLng([u.lat, u.lng]);
    } else {
      userLocMarkers[u.uid] = L.marker([u.lat, u.lng], { icon })
        .addTo(usersMap)
        .bindPopup(`
          <b>${u.firstName || ""} ${u.lastName || ""}</b><br>
          📞 ${u.phone||"—"}<br>
          ✉️ ${u.email||"—"}<br>
          <a href="https://www.google.com/maps?q=${u.lat},${u.lng}" target="_blank" style="color:#e11d2e">🗺 Google Maps</a>
        `);
    }
    userLocMarkers[u.uid].on("click", () => {
      showNearestDriver(u.lat, u.lng);
    });
  });
}

function showNearestDriver(userLat, userLng) {
  if (!usersMap) return;

  // Eski eng yaqin chiziqni o'chir
  if (nearestDriverLayer) {
    usersMap.removeLayer(nearestDriverLayer);
    nearestDriverLayer = null;
  }

  const driversWithLoc = allDriversCache.filter(d => d.lat && d.lng);
  if (!driversWithLoc.length) { toast("📍 GPS faol shofer topilmadi"); return; }

  // Eng yaqin shoferni hisoblash
  let nearest = null;
  let minDist = Infinity;
  driversWithLoc.forEach(d => {
    const dist = calcDistance(userLat, userLng, d.lat, d.lng);
    if (dist < minDist) { minDist = dist; nearest = d; }
  });

  if (!nearest) return;

  // Foydalanuvchi → shofer orasida chiziq chiz
  nearestDriverLayer = L.layerGroup().addTo(usersMap);

  const line = L.polyline(
    [[userLat, userLng], [nearest.lat, nearest.lng]],
    { color: "#e11d2e", weight: 3, dashArray: "8,5", opacity: 0.85 }
  ).addTo(nearestDriverLayer);

  // O'rtada masofa label
  const midLat = (userLat + nearest.lat) / 2;
  const midLng = (userLng + nearest.lng) / 2;
  const distKm = minDist.toFixed(1);
  L.marker([midLat, midLng], {
    icon: L.divIcon({
      className: "",
      html: `<div class="map-dist-label">${distKm} km</div>`,
      iconSize: [80, 28], iconAnchor: [40, 14]
    })
  }).addTo(nearestDriverLayer);

  toast(`🚗 Eng yaqin shofer: ${nearest.firstName} ${nearest.lastName} — ${distKm} km`);

  // Ikki nuqtani ham ko'rinadigan qilib zoom
  usersMap.fitBounds([[userLat, userLng], [nearest.lat, nearest.lng]], { padding: [50, 50] });
}

/* ═══════════════════════════════════════════════════════════
   ══════════ SHOFERLAR BO'LIMI (YANGILANGAN) ══════════════
═══════════════════════════════════════════════════════════ */
async function loadDriversSection() {
  // Xarita yaratish
  if (!adminMap) {
    adminMap = L.map("adminMap").setView([41.2995, 69.2401], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap"
    }).addTo(adminMap);
  }

  try {
    const drivers = await apiGet("/admin-users?role=driver");
    allDriversCache = drivers;
    renderDriversList(drivers);

    drivers.forEach(d => {
      if (!d.lat || !d.lng) return;
      const icon = L.divIcon({
        className: "",
        html: `<div class="map-marker-driver" id="drvicon-${d.uid}">🚗</div>`,
        iconSize: [38, 38], iconAnchor: [19, 38]
      });
      if (driverMarkers[d.uid]) {
        driverMarkers[d.uid].setLatLng([d.lat, d.lng]);
      } else {
        driverMarkers[d.uid] = L.marker([d.lat, d.lng], { icon })
          .addTo(adminMap)
          .bindPopup(`
            <div style="min-width:160px">
              <b style="font-size:15px">🚗 ${d.firstName} ${d.lastName}</b><br>
              <span style="color:#555">📞 ${d.phone}</span><br>
              <span style="color:#22c55e;font-size:12px">${d.lat ? "📍 GPS faol" : ""}</span>
            </div>
          `);
      }
    });
  } catch (err) {
    $("driversList").innerHTML = `<div class="empty-box">❌ ${err.message}</div>`;
  }

  clearTimeout(loadDriversSection._t);
  loadDriversSection._t = setTimeout(loadDriversSection, 15000);
}

function renderDriversList(drivers) {
  const c = $("driversList");
  if (!drivers.length) { c.innerHTML = `<div class="empty-box">Hali shofer yo'q</div>`; return; }
  c.innerHTML = drivers.map(d => `
    <div class="u-row driver-row-click" data-uid="${esc(d.uid)}"
         data-lat="${d.lat||""}" data-lng="${d.lng||""}"
         style="cursor:pointer" title="Xaritada ko'rish">
      <div class="u-av" style="background:linear-gradient(135deg,#0284c7,#38bdf8)">🚗</div>
      <div class="u-info">
        <div class="u-name">${esc(d.firstName)} ${esc(d.lastName)}</div>
        <div class="u-meta">${esc(d.phone)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px">
        <span class="u-badge driver">🚗 Shofer</span>
        ${d.lat ? `<span class="gps-badge">📍 GPS faol</span>` : `<span class="gps-badge off">GPS yo'q</span>`}
      </div>
    </div>`).join("");

  // Ismi bosilsa xaritada marker ochiladi
  c.querySelectorAll(".driver-row-click").forEach(row => {
    row.onclick = () => {
      const uid = row.dataset.uid;
      const lat = parseFloat(row.dataset.lat);
      const lng = parseFloat(row.dataset.lng);
      if (!lat || !lng) { toast("⚠ Bu shoferning GPS koordinatasi yo'q"); return; }
      if (adminMap) {
        adminMap.setView([lat, lng], 16);
        if (driverMarkers[uid]) driverMarkers[uid].openPopup();
        $("adminMap").scrollIntoView({ behavior: "smooth" });
      }
    };
  });
}

/* ═══════════════════════════════════════
   DRIVER PAGE — AVTO GPS (tugma bosilmaydi)
═══════════════════════════════════════ */
function initDriverPage() {
  const name = currentUser.firstName + " " + currentUser.lastName;
  $("driverLabel").textContent = name;
  // Avatar harfi
  const av = $("drvAvatar");
  if (av) av.textContent = (currentUser.firstName?.[0] || "S").toUpperCase();

  // Xarita
  driverMap = L.map("driverMap", { zoomControl: false }).setView([41.2995, 69.2401], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OSM"
  }).addTo(driverMap);
  L.control.zoom({ position: "bottomright" }).addTo(driverMap);

  // Avto GPS — hech qanday tugma bosilmaydi
  startAutoDriverGPS();

  fetchDriverOrders();
  setInterval(fetchDriverOrders, 12000);
}

/* ── Avto GPS: kirganida o'zi yoqiladi ── */
function startAutoDriverGPS() {
  if (!navigator.geolocation) {
    setDriverGPSStatus("error", "GPS qo'llab-quvvatlanmaydi", "Qurilmangizda GPS yo'q");
    return;
  }

  setDriverGPSStatus("loading", "Aniqlanmoqda...", "GPS signal qidirilmoqda");

  const onSuccess = pos => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;

    // Joriy koordinatlarni saqlash
    driverCurrentLat = lat;
    driverCurrentLng = lng;

    // Overlay ni yashir
    const overlay = $("drvMapOverlay");
    if (overlay) overlay.classList.add("hidden");

    // Status yangilash
    setDriverGPSStatus("online",
      "GPS Faol — Online",
      `Aniqlik: ~${Math.round(accuracy)} m`
    );

    // Koordinatlar
    const coords = $("drvCoords");
    if (coords) coords.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    // Xaritada shofer markeri — avtomatik zoom faqat birinchi marta
    const isFirst = !driverMarker;
    const icon = L.divIcon({
      className: "",
      html: `<div class="drv-map-marker">
        <div class="drv-marker-pulse"></div>
        <div class="drv-marker-icon">🚗</div>
      </div>`,
      iconSize: [52, 52], iconAnchor: [26, 26],
    });
    if (!driverMarker) {
      driverMarker = L.marker([lat, lng], { icon })
        .addTo(driverMap)
        .bindPopup(`<b>${currentUser.firstName} ${currentUser.lastName}</b><br>📞 ${currentUser.phone || ""}`)
        .openPopup();
      // Birinchi marta — barcha markerlar ko'rinadigan qilib zoom
      setTimeout(() => fitMapToAll(), 800);
    } else {
      driverMarker.setLatLng([lat, lng]);
    }

    // Buyurtma chiziqlarini yangilash (shofer harakatlanib ketganda)
    updateOrderMapLines();

    // Backendga yuborish
    fetch(API + "/admin-users/" + currentUser.uid + "/location", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + _token },
      body: JSON.stringify({ lat, lng })
    }).catch(() => {});
  };

  const onError = err => {
    if (err.code === 1) {
      // Ruxsat berilmadi
      setDriverGPSStatus("error", "GPS ruxsat berilmadi", "Brauzer sozlamalaridan ruxsat bering");
    } else if (err.code === 2) {
      setDriverGPSStatus("error", "GPS signal yo'q", "Ochiq joyga chiqing");
    } else {
      setDriverGPSStatus("warn", "GPS ulanmoqda...", "Qayta urinilmoqda");
      // 5 soniyadan keyin qayta urinish
      setTimeout(startAutoDriverGPS, 5000);
    }
  };

  // Avval tez bir marta olamiz
  navigator.geolocation.getCurrentPosition(onSuccess, onError, {
    enableHighAccuracy: true, timeout: 10000, maximumAge: 0
  });

  // Keyin doimiy kuzatamiz
  if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
  gpsWatchId = navigator.geolocation.watchPosition(onSuccess, onError, {
    enableHighAccuracy: true, maximumAge: 5000, timeout: 15000
  });
}

function setDriverGPSStatus(state, title, sub) {
  const dot    = $("gpsDot");
  const label  = $("gpsLabel");
  const pill   = $("drvGpsPill");
  const banner = $("drvStatusBanner");
  const icon   = $("drvStatusIcon");
  const stitle = $("drvStatusTitle");
  const ssub   = $("drvStatusSub");

  // Dot va label (header)
  if (dot) {
    dot.className = "drv-gps-dot";
    if (state === "online") dot.classList.add("on");
    if (state === "error")  dot.classList.add("err");
    if (state === "warn")   dot.classList.add("warn");
    if (state === "loading") dot.classList.add("loading");
  }
  if (label) label.textContent = title;

  // Pill rang
  if (pill) {
    pill.className = "drv-gps-pill";
    if (state === "online")  pill.classList.add("online");
    if (state === "error")   pill.classList.add("error");
    if (state === "warn")    pill.classList.add("warn");
  }

  // Banner
  if (banner) {
    banner.className = "drv-status-banner";
    if (state === "online")  banner.classList.add("online");
    if (state === "error")   banner.classList.add("error");
    if (state === "warn")    banner.classList.add("warn");
  }
  if (icon)   icon.textContent  = state === "online" ? "📍" : state === "error" ? "⚠️" : state === "warn" ? "🔄" : "📡";
  if (stitle) stitle.textContent = title;
  if (ssub)   ssub.textContent   = sub;
}

// Eski tugma funksiyalari (mos kelishi uchun saqlab qolamiz)
function startGPS() { startAutoDriverGPS(); }
function stopGPS()  {
  if (gpsWatchId) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
  setDriverGPSStatus("error", "GPS O'chirildi", "Qayta ulanish uchun sahifani yangilang");
}

/* ── Xaritada shofer + barcha mijozlar ko'rinadigan qilib fit ── */
function fitMapToAll() {
  if (!driverMap) return;
  const bounds = [];
  if (driverCurrentLat) bounds.push([driverCurrentLat, driverCurrentLng]);
  Object.values(orderClientMarkers).forEach(l => {
    if (l?.marker) bounds.push(l.marker.getLatLng());
  });
  if (bounds.length > 1)      driverMap.fitBounds(bounds, { padding: [60, 60] });
  else if (bounds.length === 1) driverMap.setView(bounds[0], 15);
}

// Shoferning joriy koordinatlari (GPS dan yangilanadi)
let driverCurrentLat = null;
let driverCurrentLng = null;

// Buyurtma → mijoz marker (xaritada)
let orderClientMarkers = {}; // orderId: { marker, polyline, label }

async function fetchDriverOrders() {
  const list  = $("driverOrdersList");
  const empty = $("driverOrdersEmpty");
  const cnt   = $("drvOrdersCount");
  try {
    const orders = await apiGet("/orders/driver/" + currentUser.uid);
    if (cnt) cnt.textContent = orders.length;
    if (!orders.length) {
      list.innerHTML = "";
      empty.classList.remove("hidden");
      clearOrderMapLayers();
      return;
    }
    empty.classList.add("hidden");

    list.innerHTML = orders.map(o => {
      const u     = o.user || {};
      const short = (o.orderId||"").slice(-6).toUpperCase();
      const hasLoc = u.lat && u.lng;
      // Masofa hisoblash (agar shofer GPS faol bo'lsa)
      let distHtml = "";
      if (hasLoc && driverCurrentLat && driverCurrentLng) {
        const km = calcDistance(driverCurrentLat, driverCurrentLng, u.lat, u.lng);
        distHtml = `<div class="drv-oc-dist">
          <span class="drv-dist-badge">📏 ${km < 1 ? Math.round(km*1000)+" m" : km.toFixed(1)+" km"} uzoqlikda</span>
        </div>`;
      } else if (hasLoc) {
        distHtml = `<div class="drv-oc-dist">
          <span class="drv-dist-badge muted">📍 Joylashuv mavjud</span>
        </div>`;
      }

      return `
        <div class="drv-order-card" data-oid="${esc(o.orderId)}">
          <div class="drv-oc-head">
            <div class="drv-oc-id">#${esc(short)}</div>
            <div class="drv-oc-price">${fmt(o.total||0)}</div>
          </div>
          <div class="drv-oc-client">
            <div class="drv-oc-av">${(u.firstName?.[0]||"?").toUpperCase()}</div>
            <div style="flex:1">
              <div class="drv-oc-name">${esc((u.firstName||"")+" "+(u.lastName||""))}</div>
              <div class="drv-oc-phone">📞 ${esc(u.phone||"—")}</div>
            </div>
          </div>
          <div class="drv-oc-addr">📍 ${esc((u.region||"")+", "+(u.district||""))}</div>
          ${distHtml}
          ${hasLoc ? `
          <button class="drv-btn-map" data-map="${esc(o.orderId)}"
            data-lat="${u.lat}" data-lng="${u.lng}"
            data-name="${esc((u.firstName||"")+" "+(u.lastName||""))}">
            🗺 Xaritada ko'rish
          </button>` : ""}
          <div class="drv-oc-btns">
            <button class="drv-btn-sec" data-action="view" data-oid="${esc(o.orderId)}">📋 Chek</button>
            <button class="drv-btn-pri" data-action="done" data-oid="${esc(o.orderId)}">✅ Yetkazib berdim</button>
          </div>
        </div>`;
    }).join("");

    // Xaritaga mijoz markerlarini qo'yish
    orders.forEach(o => showClientOnMap(o));

    // Tugmalar
    list.querySelectorAll("[data-action]").forEach(btn => {
      btn.onclick = async () => {
        const oid = btn.dataset.oid;
        if (btn.dataset.action === "view") {
          const o = orders.find(x => x.orderId === oid);
          if (o) { $("receiptBox").innerHTML = buildReceiptHTML(o); $("receiptModal").classList.remove("hidden"); }
        }
        if (btn.dataset.action === "done") {
          if (!confirm("Buyurtmani yetkazganingizni tasdiqlaysizmi?")) return;
          try {
            btn.textContent = "⏳..."; btn.disabled = true;
            await apiPut("/orders/" + oid + "/delivered", {});
            toast("✅ Yetkazildi! Arxivga o'tdi.");
            // Xaritadan o'chirish
            removeOrderMapLayer(oid);
            fetchDriverOrders();
          } catch (err) {
            toast("❌ " + err.message);
            btn.textContent = "✅ Yetkazib berdim"; btn.disabled = false;
          }
        }
      };
    });

    // Xaritada ko'rish tugmasi
    list.querySelectorAll("[data-map]").forEach(btn => {
      btn.onclick = () => {
        const lat  = parseFloat(btn.dataset.lat);
        const lng  = parseFloat(btn.dataset.lng);
        const oid  = btn.dataset.map;
        const name = btn.dataset.name;
        if (!driverMap) return;
        // Ikkalasini ham ko'rinadigan qilib zoom
        const bounds = [];
        if (driverCurrentLat) bounds.push([driverCurrentLat, driverCurrentLng]);
        bounds.push([lat, lng]);
        if (bounds.length > 1) {
          driverMap.fitBounds(bounds, { padding: [60, 60] });
        } else {
          driverMap.setView([lat, lng], 15);
        }
        // Xarita tepasiga scroll
        $("driverMap").scrollIntoView({ behavior: "smooth", block: "start" });
        // Popup ochish
        orderClientMarkers[oid]?.marker?.openPopup();
      };
    });

  } catch (err) {
    list.innerHTML = `<div class="drv-empty"><div class="drv-empty-icon">❌</div><div>${err.message}</div></div>`;
  }
}

/* ── Xaritada mijoz markeri + shofer–mijoz chizig'i ── */
function showClientOnMap(order) {
  if (!driverMap) return;
  const u = order.user || {};
  if (!u.lat || !u.lng) return;
  const oid = order.orderId;

  // Eski layerni tozalash
  removeOrderMapLayer(oid);

  // Mijoz markeri
  const clientIcon = L.divIcon({
    className: "",
    html: `<div class="drv-client-marker">
      <div class="drv-client-pulse"></div>
      <div class="drv-client-icon">${(u.firstName?.[0]||"?").toUpperCase()}</div>
    </div>`,
    iconSize: [44, 44], iconAnchor: [22, 22]
  });

  const marker = L.marker([u.lat, u.lng], { icon: clientIcon })
    .addTo(driverMap)
    .bindPopup(`
      <div style="min-width:150px;font-family:'DM Sans',sans-serif">
        <b style="font-size:14px">${esc((u.firstName||"")+" "+(u.lastName||""))}</b><br>
        📞 ${esc(u.phone||"—")}<br>
        📍 ${esc((u.region||"")+", "+(u.district||""))}
      </div>
    `);

  // Shofer → mijoz chizig'i (GPS faol bo'lsa)
  let polyline = null;
  let distLabel = null;

  if (driverCurrentLat && driverCurrentLng) {
    const km = calcDistance(driverCurrentLat, driverCurrentLng, u.lat, u.lng);
    const distText = km < 1 ? Math.round(km*1000)+" m" : km.toFixed(1)+" km";

    polyline = L.polyline(
      [[driverCurrentLat, driverCurrentLng], [u.lat, u.lng]],
      { color: "#3b82f6", weight: 3, dashArray: "8 6", opacity: .85 }
    ).addTo(driverMap);

    // O'rta nuqtada masofa labeli
    const midLat = (driverCurrentLat + u.lat) / 2;
    const midLng = (driverCurrentLng + u.lng) / 2;
    distLabel = L.marker([midLat, midLng], {
      icon: L.divIcon({
        className: "",
        html: `<div class="drv-dist-map-label">${distText}</div>`,
        iconSize: [80, 28], iconAnchor: [40, 14]
      })
    }).addTo(driverMap);
  }

  orderClientMarkers[oid] = { marker, polyline, distLabel, userUid: order.userUid };
}

/* ── Shofer yoki mijoz harakatlananda chiziq + masofa yangilanadi ── */
function updateOrderMapLines() {
  if (!driverCurrentLat || !driverCurrentLng) return;
  Object.entries(orderClientMarkers).forEach(([oid, layers]) => {
    if (!layers?.marker) return;
    const clientLatLng = layers.marker.getLatLng();
    rebuildLine(oid, layers, clientLatLng.lat, clientLatLng.lng);
  });
}

/* Mijoz joylashuvi yangilanganda shu buyurtma chizig'ini qayta qur */
function updateClientLineByUid(uid, lat, lng) {
  Object.entries(orderClientMarkers).forEach(([oid, layers]) => {
    if (!layers || layers.userUid !== uid) return;
    // Marker ni yangi joylashuvga siljit
    layers.marker.setLatLng([lat, lng]);
    rebuildLine(oid, layers, lat, lng);
  });
}

function rebuildLine(oid, layers, clientLat, clientLng) {
  const { marker, distLabel } = layers;
  const km = calcDistance(driverCurrentLat, driverCurrentLng, clientLat, clientLng);
  const distText = km < 1 ? Math.round(km*1000)+" m" : km.toFixed(1)+" km";

  // Chiziq
  if (layers.polyline) {
    layers.polyline.setLatLngs([[driverCurrentLat, driverCurrentLng], [clientLat, clientLng]]);
  } else {
    const p = L.polyline(
      [[driverCurrentLat, driverCurrentLng], [clientLat, clientLng]],
      { color: "#3b82f6", weight: 3, dashArray: "8 6", opacity: .85 }
    ).addTo(driverMap);
    orderClientMarkers[oid] = { ...layers, polyline: p };
  }

  // Masofa labeli (o'rta nuqta)
  const midLat = (driverCurrentLat + clientLat) / 2;
  const midLng = (driverCurrentLng + clientLng) / 2;
  if (distLabel) {
    distLabel.setLatLng([midLat, midLng]);
    const el = distLabel.getElement();
    if (el) {
      const lbl = el.querySelector(".drv-dist-map-label");
      if (lbl) lbl.textContent = distText;
    }
  }

  // Karta badge yangilash
  const card = document.querySelector(`.drv-order-card[data-oid="${oid}"]`);
  if (card) {
    const badge = card.querySelector(".drv-dist-badge");
    if (badge) badge.textContent = `📏 ${distText} uzoqlikda`;
  }
}

function removeOrderMapLayer(oid) {
  const layers = orderClientMarkers[oid];
  if (!layers) return;
  if (layers.marker)    driverMap?.removeLayer(layers.marker);
  if (layers.polyline)  driverMap?.removeLayer(layers.polyline);
  if (layers.distLabel) driverMap?.removeLayer(layers.distLabel);
  delete orderClientMarkers[oid];
}

function clearOrderMapLayers() {
  Object.keys(orderClientMarkers).forEach(removeOrderMapLayer);
}
