/* ==========================================================
   SOF SHOP — admin.js  (Firebase Realtime Database)
   ✅ Admin login — localStorage token
   ✅ Mahsulotlar — CRUD (Firebase)
   ✅ Buyurtmalar — ko'rish, yo'lga yuborish, yetkazildi
   ✅ Reklamalar  — tanlash va saqlash
   ✅ Foydalanuvchilar — ko'rish
   ✅ Shofer sahifasi
   ✅ Realtime — Firebase onValue
========================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, set, get, update, remove, onValue, off
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAsonVeiQP_7jR3ddhKIy_PZIcIgGDDDDE",
  authDomain: "website-5c84e.firebaseapp.com",
  projectId: "website-5c84e",
  storageBucket: "website-5c84e.firebasestorage.app",
  messagingSenderId: "1013844992498",
  appId: "1:1013844992498:web:db44fb7502a6cde4020b6b",
  measurementId: "G-N2ZC5N61QH",
  databaseURL: "https://website-5c84e-default-rtdb.asia-southeast1.firebasedatabase.app"
};

const fbApp = initializeApp(firebaseConfig, "admin-app");
const db    = getDatabase(fbApp);
const dbRef = path => ref(db, path);

/* ═══════════════════════════════════════
   UTILS
═══════════════════════════════════════ */
const $       = id => document.getElementById(id);
const esc     = s  => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const fmt     = n  => (Number(n) || 0).toLocaleString("uz-UZ") + " so'm";
const nowMs   = ()  => Date.now();
const safeNum = x  => Number(x || 0) || 0;

function toast(msg, dur = 2600) {
  const t = $("toastEl");
  if (!t) return;
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

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function dbGet(path) {
  const snap = await get(dbRef(path));
  return snap.exists() ? snap.val() : null;
}

function calcDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/* ═══════════════════════════════════════
   STATE
═══════════════════════════════════════ */
let currentUser    = null;
let selectedImgs   = [];
let editProdId     = null;
let assignOid      = null;
let allProducts    = [];
let adsSelected    = new Set();
let prodUnsub      = null;
let ordersUnsub    = null;
let gpsWatchId     = null;

const CATS = {
  "🛏️ Mebellar":          ["🛏️ Yotoqxona","🛋️ Mexmonxona","🛋️ Yumshoq","🍽️ Stol-stul","🍴 Oshxona","👶 Bolalar","💼 Ofis","🚪 Shkaflar"],
  "🎨 Aksesuarlar":       ["🪞 Oynalar","🖼️ Kartinalar"],
  "📺 Maishiy texnikalar":["❄️ Muzlatkich","🧼 Kir yuvish","🔥 Gaz plita","🌀 Konditsioner","🧹 Chok mashin","🔌 Boshqa"],
  "🏃 Sport":             ["🏃 Yugurish","🚴 Velo","💆 Massaj"],
  "📱 Telefonlar":        ["📱 Samsung","📱 Redmi","📱 Honor"]
};

/* ═══════════════════════════════════════
   AUTH — oddiy username/parol (Firebase Auth kerak emas)
   Admin ma'lumotlari Firebase da saqlanadi: adminUsers/uid
═══════════════════════════════════════ */
function switchTab(tab) {
  $("atLogin").classList.toggle("active", tab === "login");
  $("atReg").classList.toggle("active",   tab === "reg");
  $("loginForm").classList.toggle("hidden", tab !== "login");
  $("regForm").classList.toggle("hidden",   tab !== "reg");
  $("authMsg").classList.add("hidden");
}

$("atLogin").addEventListener("click", () => switchTab("login"));
$("atReg").addEventListener("click",   () => switchTab("reg"));

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
    // Telefon bo'yicha admin topish
    const allAdmins = await dbGet("adminUsers") || {};
    const entry = Object.entries(allAdmins).find(([uid, u]) => u.phone === phone);
    if (!entry) throw new Error("Foydalanuvchi topilmadi");
    const [uid, user] = entry;
    if (user.password !== pass) throw new Error("Parol noto'g'ri");
    loginSuccess({ ...user, uid });
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
    // Telefon band emasligini tekshirish
    const allAdmins = await dbGet("adminUsers") || {};
    const exists = Object.values(allAdmins).find(u => u.phone === phone);
    if (exists) throw new Error("Bu telefon allaqachon ro'yxatdan o'tgan");
    const uid = genId();
    const user = { uid, firstName, lastName, phone, password: pass, role, createdAt: nowMs() };
    await set(dbRef(`adminUsers/${uid}`), user);
    loginSuccess(user);
  } catch (err) { showMsg($("authMsg"), err.message); }
});

function loginSuccess(user) {
  currentUser = user;
  localStorage.setItem("sofAdminUser", JSON.stringify(user));
  startApp();
}

function doLogout() {
  if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
  if (prodUnsub)   { prodUnsub();   prodUnsub = null; }
  if (ordersUnsub) { ordersUnsub(); ordersUnsub = null; }
  localStorage.removeItem("sofAdminUser");
  currentUser = null;
  location.reload();
}

window.addEventListener("DOMContentLoaded", () => {
  const saved = localStorage.getItem("sofAdminUser");
  if (saved) {
    try { currentUser = JSON.parse(saved); startApp(); }
    catch { doLogout(); }
  }
});

$("adminLogout").addEventListener("click",  doLogout);
$("driverLogout").addEventListener("click", doLogout);

/* ═══════════════════════════════════════
   START APP
═══════════════════════════════════════ */
function startApp() {
  $("authPage").classList.add("hidden");
  if (currentUser.role === "driver") {
    $("driverPage").classList.remove("hidden");
    initDriverPage();
  } else {
    $("adminPage").classList.remove("hidden");
    initAdminPage();
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
      const titles = { products: "Mahsulotlar", orders: "Buyurtmalar", ads: "Reklamalar", users: "Foydalanuvchilar", drivers: "Shoferlar" };
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
  loadSection("products");
}

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("sbOverlay").classList.remove("show");
}

function loadSection(name) {
  document.querySelectorAll(".dsec").forEach(s => s.classList.add("hidden"));
  $("sec-" + name)?.classList.remove("hidden");
  ({ products: loadProductsSection, orders: loadOrdersSection, ads: loadAdsSection, users: loadUsersSection, drivers: loadDriversSection })[name]?.();
}

/* ══════════ PRODUCTS ══════════ */
function loadProductsSection() {
  document.querySelectorAll("[data-ptab]").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll("[data-ptab]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".ptab").forEach(p => p.classList.add("hidden"));
      $("ptab-" + btn.dataset.ptab).classList.remove("hidden");
      if (btn.dataset.ptab === "list") startProdListener();
    };
  });
  initProdForm();
  startProdListener();
}

function startProdListener() {
  if (prodUnsub) { prodUnsub(); prodUnsub = null; }
  const r  = dbRef("products");
  const fn = snap => {
    const val = snap.val() || {};
    allProducts = Object.entries(val).map(([id, p]) => ({ id, ...p }));
    renderProdList(allProducts);
  };
  onValue(r, fn);
  prodUnsub = () => off(r, "value", fn);
}

function initProdForm() {
  $("pCat").innerHTML = Object.keys(CATS).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const fillSub = () => {
    $("pSub").innerHTML = (CATS[$("pCat").value] || []).map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
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

  // prodSearch - always reads current allProducts
  $("prodSearch").addEventListener("input",   () => {
    const q = $("prodSearch").value.toLowerCase().trim();
    if (!q) { renderProdList(allProducts); return; }
    renderProdList(allProducts.filter(p =>
      (p.name || "").toLowerCase().includes(q) ||
      (p.code || "").toLowerCase().includes(q)
    ));
  });
}

function addImages(files) {
  files.forEach(f => {
    if (!f.type.startsWith("image/")) { toast("Faqat rasm (jpg, png, webp, gif)"); return; }
    if (selectedImgs.length >= 10)    { toast("Maksimal 10 ta rasm"); return; }
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

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = () => rej(new Error("Fayl o'qilmadi"));
    r.readAsDataURL(file);
  });
}

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
      await update(dbRef(`products/${editProdId}`), { ...payload, updatedAt: nowMs() });
      toast("✅ Yangilandi");
    } else {
      const newId = genId();
      await set(dbRef(`products/${newId}`), { ...payload, id: newId, createdAt: nowMs(), soldCount: 0 });
      toast("✅ Saqlandi");
    }

    resetProdForm();
    showMsg(msg, "Muvaffaqiyatli saqlandi!", "success");
    document.querySelectorAll("[data-ptab]").forEach(b => b.classList.toggle("active", b.dataset.ptab === "list"));
    document.querySelectorAll(".ptab").forEach(p => p.classList.add("hidden"));
    $("ptab-list").classList.remove("hidden");
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

function renderProdList(products) {
  const c = $("prodList");
  if (!products.length) { c.innerHTML = `<div class="empty-box">Mahsulot topilmadi</div>`; return; }
  c.innerHTML = products.map(p => {
    const img   = p.images?.[0] || "";
    const stock = p.stock != null ? Number(p.stock) : null;
    const disc  = safeNum(p.discountPercent);
    const fPrice = disc > 0 ? Math.round(safeNum(p.price) * (100 - disc) / 100) : safeNum(p.price);
    const stockHtml = stock != null
      ? `<div class="prod-meta" style="${stock<=0?"color:#e11d2e;font-weight:600":"color:#15803d"}">📦 Qoldi: ${stock} · Sotildi: ${Number(p.soldCount||0)}</div>`
      : "";
    return `
      <div class="prod-row" data-pid="${esc(p.id)}">
        <div class="prod-thumb">${img ? `<img src="${img}" alt=""/>` : ""}</div>
        <div class="prod-info">
          <div class="prod-name">${esc(p.name || "—")}</div>
          <div class="prod-meta">${esc(p.code)} · ${fmt(fPrice)}</div>
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
  $("pDesc").value   = p.desc || "";
  if ($("pStock")) $("pStock").value = p.stock != null ? p.stock : 0;

  const disc  = safeNum(p.discountPercent);
  const isNew = safeNum(p.newUntil) > nowMs();
  $("pType").value    = disc > 0 ? "discount" : isNew ? "new" : "normal";
  $("pDiscount").value = disc;
  $("discFi").classList.toggle("hidden", $("pType").value === "new");
  $("newFi").classList.toggle("hidden",  $("pType").value !== "new");

  const prev = $("imgPreview");
  const existing = p.images || [];
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
      await update(dbRef(`products/${editProdId}`), { images: imgs });
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
  try { await remove(dbRef(`products/${id}`)); toast("🗑 O'chirildi"); }
  catch (err) { toast("❌ " + err.message); }
}

async function restockProd(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  const amount = prompt(`"${p.name}"\nHozirda: ${p.stock || 0} dona\n\nYangi zaxira soni:`);
  if (!amount || isNaN(+amount) || +amount < 0) return;
  try {
    await update(dbRef(`products/${id}`), { stock: +amount });
    toast(`✅ Zaxira yangilandi: ${amount} ta`);
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
  startOrdersListener();
}

function startOrdersListener() {
  if (ordersUnsub) { ordersUnsub(); ordersUnsub = null; }
  const r  = dbRef("orders");
  const fn = snap => {
    const val = snap.val() || {};
    const all = Object.entries(val).map(([id, o]) => ({ orderId: id, ...o }));
    renderNewOrders(all.filter(o => !o.status?.onWay && !o.status?.delivered));
    renderDelivery(all.filter(o => o.status?.onWay && !o.status?.delivered));
    renderArchive(all.filter(o => o.status?.delivered));
  };
  onValue(r, fn);
  ordersUnsub = () => off(r, "value", fn);
}

function renderNewOrders(list) {
  $("newOrdersList").innerHTML = list.length
    ? list.map(o => orderCardHTML(o, "new")).join("")
    : `<div class="empty-box">Yangi buyurtma yo'q</div>`;
  bindOrderBtns($("newOrdersList"), list);
}

function renderDelivery(list) {
  $("deliveryList").innerHTML = list.length
    ? list.map(o => orderCardHTML(o, "delivery")).join("")
    : `<div class="empty-box">Yo'lda buyurtma yo'q</div>`;
  bindOrderBtns($("deliveryList"), list);
}

function renderArchive(list) {
  $("archiveList").innerHTML = list.length
    ? list.map(o => orderCardHTML(o, "done")).join("")
    : `<div class="empty-box">Arxiv bo'sh</div>`;
  bindOrderBtns($("archiveList"), list);
}

function orderCardHTML(o, type) {
  const u = o.user || {};
  const cls = { new: "new", delivery: "delivery", done: "done" };
  const lbl = { new: "🆕 Yangi", delivery: "🚗 Yo'lda", done: "✅ Yetkazildi" };
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
        💰 <b>${fmt(o.total||0)}</b>
      </div>
      <div class="o-foot">
        <button class="abtn secondary sm" data-action="view"   data-oid="${esc(o.orderId)}">📋 Chekni ko'rish</button>
        ${type === "new"      ? `<button class="abtn primary sm" data-action="assign"  data-oid="${esc(o.orderId)}">🚗 Yo'lga yuborish</button>` : ""}
        ${type === "delivery" ? `<button class="abtn primary sm" data-action="deliver" data-oid="${esc(o.orderId)}">✅ Yetkazildi</button>` : ""}
      </div>
    </div>`;
}

function bindOrderBtns(container, list) {
  container.querySelectorAll("[data-action]").forEach(btn => {
    const oid = btn.dataset.oid;
    if (btn.dataset.action === "view") {
      btn.onclick = () => { const o = list.find(x => x.orderId === oid); if (o) openReceipt(o); };
    }
    if (btn.dataset.action === "assign") {
      btn.onclick = () => openAssign(oid);
    }
    if (btn.dataset.action === "onway") {
      btn.onclick = async () => { await update(dbRef(`orders/${oid}/status`), { onWay: true }); toast("🚗 Yo'lga yuborildi ✅"); };
    }
    if (btn.dataset.action === "deliver") {
      btn.onclick = async () => { await update(dbRef(`orders/${oid}/status`), { delivered: true }); toast("✅ Yetkazildi!"); };
    }
  });
}

/* ── Shofer tanlash modal ── */
async function openAssign(oid) {
  assignOid = oid;
  const msg = document.getElementById("assignMsg");
  if (msg) msg.classList.add("hidden");
  document.getElementById("assignList").innerHTML = '<div class="empty-box">Yuklanmoqda...</div>';
  document.getElementById("assignModal").classList.remove("hidden");
  try {
    const val     = await dbGet("adminUsers") || {};
    const drivers = Object.values(val).filter(u => u.role === "driver");
    if (!drivers.length) {
      document.getElementById("assignList").innerHTML = '<div class="empty-box">Shofer topilmadi. Avval shofer ro\'yxatdan o\'tsin.</div>';
      return;
    }
    document.getElementById("assignList").innerHTML = drivers.map(d => `
      <div class="assign-row" data-did="${esc(d.uid)}" data-dname="${esc(d.firstName + ' ' + d.lastName)}">
        <div class="assign-dot"></div>
        <div>
          <div class="assign-name">${esc(d.firstName)} ${esc(d.lastName)}</div>
          <div class="assign-phone">${esc(d.phone)}</div>
        </div>
      </div>`).join("");
    document.getElementById("assignList").querySelectorAll(".assign-row").forEach(row => {
      row.onclick = () => {
        document.getElementById("assignList").querySelectorAll(".assign-row").forEach(r => r.classList.remove("sel"));
        row.classList.add("sel");
      };
    });
  } catch (err) {
    document.getElementById("assignList").innerHTML = `<div class="empty-box">❌ ${err.message}</div>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const assignCloseBtn   = document.getElementById("assignClose");
  const assignConfirmBtn = document.getElementById("assignConfirm");
  if (assignCloseBtn)   assignCloseBtn.addEventListener("click",   () => document.getElementById("assignModal").classList.add("hidden"));
  if (assignConfirmBtn) assignConfirmBtn.addEventListener("click", async () => {
    const row = document.getElementById("assignList").querySelector(".assign-row.sel");
    if (!row) { showMsg(document.getElementById("assignMsg"), "Shofer tanlang"); return; }
    const driverId   = row.dataset.did;
    const driverName = row.dataset.dname;
    try {
      await update(dbRef(`orders/${assignOid}`), { assignedDriver: driverId, driverName });
      await update(dbRef(`orders/${assignOid}/status`), { onWay: true });
      toast("✅ Shoferga yuborildi: " + driverName);
      document.getElementById("assignModal").classList.add("hidden");
    } catch (err) { showMsg(document.getElementById("assignMsg"), err.message); }
  });
});

function openReceipt(o) {
  const u     = o.user || {};
  const items = (o.items || []).map(i => `
    <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f0f0f0">
      <span>${esc(i.name || "")} × ${safeNum(i.qty)}</span>
      <b>${fmt(safeNum(i.price) * safeNum(i.qty))}</b>
    </div>`).join("");
  $("receiptBox").innerHTML = `
    <b style="font-size:16px">Buyurtma #${esc((o.orderId||"").slice(-6).toUpperCase())}</b>
    <div style="color:var(--muted);font-size:12px;margin-bottom:10px">${new Date(o.createdAt||0).toLocaleString("uz-UZ")}</div>
    <b>Mijoz:</b> ${esc((u.firstName||"")+" "+(u.lastName||""))}<br>
    <b>Tel:</b> ${esc(u.phone||"—")}<br>
    <b>Manzil:</b> ${esc((u.region||"")+", "+(u.district||""))}<br>
    <hr style="margin:10px 0;border:none;border-top:1px solid #eee"/>
    ${items}
    <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:16px">
      <b>Jami:</b> <b style="color:var(--accent)">${fmt(o.total||0)}</b>
    </div>`;
  $("receiptModal").classList.remove("hidden");
}
$("receiptClose").addEventListener("click", () => $("receiptModal").classList.add("hidden"));

/* ══════════ ADS ══════════ */
async function loadAdsSection() {
  adsSelected.clear();
  try {
    const [prodsSnap, adsSnap] = await Promise.all([get(dbRef("products")), get(dbRef("ads"))]);
    allProducts = prodsSnap.exists() ? Object.entries(prodsSnap.val()).map(([id, p]) => ({ id, ...p })) : [];
    if (adsSnap.exists()) Object.values(adsSnap.val()).forEach(id => adsSelected.add(id));
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
      const obj = {};
      ids.forEach((id, i) => { obj[i] = id; });
      await set(dbRef("ads"), obj);
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
          <div class="ads-name">${esc(p.name || "—")}</div>
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

/* ══════════ USERS ══════════ */
async function loadUsersSection() {
  try {
    const val = await dbGet("users") || {};
    const users = Object.values(val);
    renderUsersList(users);
    $("statTotal").textContent = users.length;
  } catch (err) { $("usersList").innerHTML = `<div class="empty-box">❌ ${err.message}</div>`; }

  $("usersSearch").oninput = async () => {
    const q = $("usersSearch").value.toLowerCase();
    const val = await dbGet("users") || {};
    const users = Object.values(val).filter(u =>
      (u.firstName+" "+u.lastName).toLowerCase().includes(q) ||
      (u.phone || "").includes(q) || (u.email || "").toLowerCase().includes(q)
    );
    renderUsersList(users);
  };
}

function renderUsersList(users) {
  const c = $("usersList");
  if (!users.length) { c.innerHTML = `<div class="empty-box">Foydalanuvchi topilmadi</div>`; return; }
  c.innerHTML = users.map(u => `
    <div class="u-row">
      <div class="u-av">${(u.firstName?.[0] || "?").toUpperCase()}</div>
      <div class="u-info">
        <div class="u-name">${esc((u.firstName||"")+" "+(u.lastName||""))}</div>
        <div class="u-meta">${esc(u.phone||"—")} · ${esc(u.email||"—")}</div>
        <div class="u-meta">${esc((u.region||"")+", "+(u.district||""))}</div>
      </div>
      <div>
        <span class="u-badge">${esc(u.customerId||"")}</span>
        ${u.lat && u.lng ? `<a href="https://www.google.com/maps?q=${u.lat},${u.lng}" target="_blank" style="font-size:18px;text-decoration:none">📍</a>` : ""}
      </div>
    </div>`).join("");
}

/* ══════════ DRIVERS ══════════ */
async function loadDriversSection() {
  try {
    const val = await dbGet("adminUsers") || {};
    const drivers = Object.values(val).filter(u => u.role === "driver");
    renderDriversList(drivers);
  } catch (err) { $("driversList").innerHTML = `<div class="empty-box">❌ ${err.message}</div>`; }
}

function renderDriversList(drivers) {
  const c = $("driversList");
  if (!drivers.length) { c.innerHTML = `<div class="empty-box">Hali shofer yo'q</div>`; return; }
  c.innerHTML = drivers.map(d => `
    <div class="u-row">
      <div class="u-av" style="background:linear-gradient(135deg,#0284c7,#38bdf8)">🚗</div>
      <div class="u-info">
        <div class="u-name">${esc(d.firstName)} ${esc(d.lastName)}</div>
        <div class="u-meta">${esc(d.phone)}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px">
        <span class="u-badge driver">🚗 Shofer</span>
        ${d.lat ? `<span class="gps-badge">📍 GPS faol</span><a href="https://www.google.com/maps?q=${d.lat},${d.lng}" target="_blank" style="font-size:18px;text-decoration:none">🗺</a>` : `<span class="gps-badge off">GPS yo'q</span>`}
      </div>
    </div>`).join("");
}

/* ══════════ DRIVER PAGE ══════════ */
function initDriverPage() {
  $("driverLabel").textContent = currentUser.firstName + " " + currentUser.lastName;
  const av = $("drvAvatar");
  if (av) av.textContent = (currentUser.firstName?.[0] || "S").toUpperCase();

  startAutoDriverGPS();
  fetchDriverOrders();
  setInterval(fetchDriverOrders, 15000);
}

function startAutoDriverGPS() {
  if (!navigator.geolocation) return;
  const onSuccess = pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    update(dbRef(`adminUsers/${currentUser.uid}`), { lat, lng }).catch(() => {});
    const lbl = $("gpsLabel");
    if (lbl) lbl.textContent = `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  };
  navigator.geolocation.getCurrentPosition(onSuccess, () => {}, { enableHighAccuracy: true, timeout: 10000 });
  if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
  gpsWatchId = navigator.geolocation.watchPosition(onSuccess, () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
}

async function fetchDriverOrders() {
  const list  = $("driverOrdersList");
  const empty = $("driverOrdersEmpty");
  const cnt   = $("drvOrdersCount");
  try {
    const val    = await dbGet("orders") || {};
    const orders = Object.entries(val)
      .map(([id, o]) => ({ orderId: id, ...o }))
      .filter(o => o.status?.onWay && !o.status?.delivered);

    if (cnt) cnt.textContent = orders.length;
    if (!orders.length) {
      list.innerHTML = "";
      if (empty) empty.classList.remove("hidden");
      return;
    }
    if (empty) empty.classList.add("hidden");

    list.innerHTML = orders.map(o => {
      const u     = o.user || {};
      const short = (o.orderId || "").slice(-6).toUpperCase();
      return `
        <div class="drv-order-card" data-oid="${esc(o.orderId)}">
          <div class="drv-oc-head">
            <div class="drv-oc-id">#${esc(short)}</div>
            <div class="drv-oc-price">${fmt(o.total || 0)}</div>
          </div>
          <div class="drv-oc-client">
            <div class="drv-oc-av">${(u.firstName?.[0] || "?").toUpperCase()}</div>
            <div style="flex:1">
              <div class="drv-oc-name">${esc((u.firstName||"")+" "+(u.lastName||""))}</div>
              <div class="drv-oc-phone">📞 ${esc(u.phone || "—")}</div>
            </div>
          </div>
          <div class="drv-oc-addr">📍 ${esc((u.region||"")+", "+(u.district||""))}</div>
          ${u.lat && u.lng ? `<a href="https://www.google.com/maps?q=${u.lat},${u.lng}" target="_blank" class="drv-btn-map">🗺 Xaritada ko'rish</a>` : ""}
          <div class="drv-oc-btns">
            <button class="drv-btn-sec" data-action="view" data-oid="${esc(o.orderId)}">📋 Chek</button>
            <button class="drv-btn-pri" data-action="done" data-oid="${esc(o.orderId)}">✅ Yetkazib berdim</button>
          </div>
        </div>`;
    }).join("");

    list.querySelectorAll("[data-action]").forEach(btn => {
      btn.onclick = async () => {
        const oid = btn.dataset.oid;
        if (btn.dataset.action === "view") {
          const o = orders.find(x => x.orderId === oid);
          if (o) { $("receiptBox").innerHTML = buildReceiptHTML(o); $("receiptModal").classList.remove("hidden"); }
        }
        if (btn.dataset.action === "done") {
          if (!confirm("Buyurtmani yetkazganingizni tasdiqlaysizmi?")) return;
          btn.textContent = "⏳..."; btn.disabled = true;
          await update(dbRef(`orders/${oid}/status`), { delivered: true });
          toast("✅ Yetkazildi!");
          fetchDriverOrders();
        }
      };
    });
  } catch (err) {
    list.innerHTML = `<div class="drv-empty"><div class="drv-empty-icon">❌</div><div>${err.message}</div></div>`;
  }
}

function buildReceiptHTML(o) {
  const u     = o.user || {};
  const items = (o.items || []).map(i => `
    <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f0f0f0">
      <span>${esc(i.name || "")} × ${safeNum(i.qty)}</span>
      <b>${fmt(safeNum(i.price) * safeNum(i.qty))}</b>
    </div>`).join("");
  return `
    <b style="font-size:16px">Buyurtma #${esc((o.orderId||"").slice(-6).toUpperCase())}</b>
    <div style="color:#888;font-size:12px;margin-bottom:10px">${new Date(o.createdAt||0).toLocaleString("uz-UZ")}</div>
    <b>Mijoz:</b> ${esc((u.firstName||"")+" "+(u.lastName||""))}<br>
    <b>Tel:</b> ${esc(u.phone||"—")}<br>
    <b>Manzil:</b> ${esc((u.region||"")+", "+(u.district||""))}<br>
    <hr style="margin:10px 0;border:none;border-top:1px solid #eee"/>
    ${items}
    <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:16px">
      <b>Jami:</b> <b style="color:#e11d2e">${fmt(o.total||0)}</b>
    </div>`;
}
