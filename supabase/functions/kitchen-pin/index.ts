import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "https://creationsport-cloud.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Vary": "Origin",
};
const failedPins = new Map<string, { count: number; started: number; lockedUntil: number }>();
const orderRates = new Map<string, { count: number; started: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ORDER_ADD_ONS = {
  fried_egg: { name: "ไข่ดาว", price: 10 },
  omelet: { name: "ไข่เจียว", price: 10 },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function requestIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
function getAdminConfig() {
  const url = Deno.env.get("SUPABASE_URL");
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  const secretKey = keys ? JSON.parse(keys)["default"] : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !secretKey) throw new Error("ระบบฐานข้อมูลยังตั้งค่าไม่ครบ");
  return { url, secretKey };
}
function adminHeaders(secretKey: string, extra: Record<string, string> = {}) {
  return { apikey: secretKey, Authorization: "Bearer " + secretKey, ...extra };
}
function normalizeOrderNote(value: unknown): string | null {
  if (value === undefined) return "";
  if (typeof value !== "string") return null;
  const note = value.trim();
  return Array.from(note).length <= 500 ? note : null;
}
function normalizeOrderAddOns(value: unknown): { name: string; price: number; qty: number }[] | null {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const counts = value as Record<string, unknown>;
  if (Object.keys(counts).some(key => !Object.prototype.hasOwnProperty.call(ORDER_ADD_ONS, key))) return null;
  const extras: { name: string; price: number; qty: number }[] = [];
  for (const [key, addOn] of Object.entries(ORDER_ADD_ONS)) {
    const qty = counts[key] ?? 0;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0 || qty > 50) return null;
    if (qty > 0) extras.push({ ...addOn, qty });
  }
  return extras;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const origin = req.headers.get("origin");
  if (origin && origin !== "https://creationsport-cloud.github.io") {
    return json({ error: "Origin not allowed" }, 403);
  }

  let body: {
    pin?: unknown; action?: unknown; id?: unknown; status?: unknown; items?: unknown; fulfillmentType?: unknown; note?: unknown;
    name?: unknown; description?: unknown; price?: unknown; category?: unknown; active?: unknown;
    imageBase64?: unknown; imageMime?: unknown;
  };
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const action = body.action;
  const ip = requestIp(req);
  const { url, secretKey } = getAdminConfig();

  if (action === "menu-list") {
    try {
      const response = await fetch(url + "/rest/v1/menu_items?select=id,name,description,price,category,icon,image_url&active=eq.true&order=created_at.asc", {
        headers: adminHeaders(secretKey),
      });
      if (!response.ok) return json({ error: "โหลดเมนูไม่สำเร็จ" }, 502);
      return json(await response.json());
    } catch {
      return json({ error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ" }, 502);
    }
  }

  // Customers can order without a PIN. The menu table is the source of truth for prices.
  if (action === "place-order") {
    const now = Date.now();
    let rate = orderRates.get(ip);
    if (!rate || now - rate.started > 60_000) {
      rate = { count: 0, started: now };
      orderRates.set(ip, rate);
    }
    if (rate.count >= 20) return json({ error: "ส่งออร์เดอร์ถี่เกินไป กรุณารอสักครู่" }, 429);
    rate.count++;
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) {
      return json({ error: "รายการอาหารไม่ถูกต้อง" }, 400);
    }
    if (body.fulfillmentType !== "dine_in" && body.fulfillmentType !== "takeaway") {
      return json({ error: "กรุณาเลือกทานที่ร้านหรือกลับบ้าน" }, 400);
    }
    const note = normalizeOrderNote(body.note);
    if (note === null) return json({ error: "หมายเหตุต้องมีความยาวไม่เกิน 500 ตัวอักษร" }, 400);
    const requested = body.items as { id?: unknown; qty?: unknown; extras?: unknown }[];
    const ids: string[] = [];
    for (const item of requested) {
      if (!item || typeof item.id !== "string" || !/^[a-z0-9-]{1,80}$/i.test(item.id) ||
          typeof item.qty !== "number" || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 50) {
        return json({ error: "รายการอาหารไม่ถูกต้อง" }, 400);
      }
      if (normalizeOrderAddOns(item.extras) === null) return json({ error: "จำนวนไข่เพิ่มไม่ถูกต้อง" }, 400);
      ids.push(item.id);
    }
    if (new Set(ids).size !== ids.length) return json({ error: "รายการอาหารซ้ำกัน" }, 400);
    try {
      const query = new URLSearchParams({
        select: "id,name,price",
        active: "eq.true",
        id: "in.(" + ids.join(",") + ")",
      });
      const menuResponse = await fetch(url + "/rest/v1/menu_items?" + query.toString(), {
        headers: adminHeaders(secretKey),
      });
      if (!menuResponse.ok) return json({ error: "ตรวจสอบเมนูไม่สำเร็จ" }, 502);
      const menu = await menuResponse.json() as { id: string; name: string; price: string | number }[];
      if (menu.length !== ids.length) return json({ error: "มีเมนูที่ปิดขายหรือไม่มีอยู่แล้ว กรุณาเลือกใหม่" }, 400);
      const byId = new Map(menu.map(item => [item.id, item]));
      const items = requested.map(item => {
        const food = byId.get(item.id as string)!;
        return { name: food.name, price: Number(food.price), qty: item.qty as number, extras: normalizeOrderAddOns(item.extras)! };
      });
      const total = items.reduce((sum, item) => sum + item.price * item.qty + item.extras.reduce((extraSum, extra) => extraSum + extra.price * extra.qty, 0), 0);
      const response = await fetch(url + "/rest/v1/orders?select=order_number,total,created_at", {
        method: "POST",
        headers: adminHeaders(secretKey, { "Content-Type": "application/json", Prefer: "return=representation" }),
        body: JSON.stringify({ id: crypto.randomUUID(), items, total, payment_status: "pending", fulfillment_type: body.fulfillmentType, note }),
      });
      if (!response.ok) return json({ error: "บันทึกออร์เดอร์ไม่สำเร็จ" }, 502);
      const created = await response.json() as { order_number: string; total: number; created_at: string }[];
      return json({ order_number: created[0]?.order_number, total: Number(created[0]?.total), created_at: created[0]?.created_at });
    } catch {
      return json({ error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ" }, 502);
    }
  }

  const now = Date.now();
  let attempt = failedPins.get(ip);
  if (!attempt || now - attempt.started > WINDOW_MS) {
    attempt = { count: 0, started: now, lockedUntil: 0 };
    failedPins.set(ip, attempt);
  }
  if (attempt.lockedUntil > now) return json({ error: "ลอง PIN ผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่" }, 429);
  if (body.pin !== "123456") {
    attempt.count++;
    if (attempt.count >= MAX_ATTEMPTS) attempt.lockedUntil = now + WINDOW_MS;
    return json({ error: "PIN ไม่ถูกต้อง" }, 401);
  }
  attempt.count = 0;
  attempt.lockedUntil = 0;

  if (action === "menu-admin-list") {
    try {
      const response = await fetch(url + "/rest/v1/menu_items?select=id,name,description,price,category,icon,image_url,active&order=created_at.asc", {
        headers: adminHeaders(secretKey),
      });
      if (!response.ok) return json({ error: "โหลดเมนูไม่สำเร็จ" }, 502);
      return json(await response.json());
    } catch { return json({ error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ" }, 502); }
  }

  if (action === "menu-update") {
    const id = typeof body.id === "string" ? body.id : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const price = typeof body.price === "number" ? body.price : Number(body.price);
    if (!/^[0-9a-f-]{36}$/i.test(id) || name.length < 1 || name.length > 80 ||
        description.length > 240 || category.length < 1 || category.length > 40 ||
        !Number.isFinite(price) || price <= 0 || price > 100000 ||
        typeof body.active !== "boolean") return json({ error: "กรุณาตรวจสอบข้อมูลเมนู" }, 400);
    const patch: Record<string, unknown> = { name, description, category, price, active: body.active };
    if (body.imageBase64 !== undefined || body.imageMime !== undefined) {
      const mime = body.imageMime;
      const base64 = body.imageBase64;
      const types: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
      if (typeof mime !== "string" || !types[mime] || typeof base64 !== "string" || base64.length > 2_800_000) {
        return json({ error: "รูปภาพไม่ถูกต้อง" }, 400);
      }
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0)); }
      catch { return json({ error: "อ่านรูปภาพไม่สำเร็จ" }, 400); }
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return json({ error: "รูปภาพต้องมีขนาดไม่เกิน 2 MB" }, 413);
      const valid = mime === "image/jpeg"
        ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : mime === "image/png"
          ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
          : bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
            bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
      if (!valid) return json({ error: "รูปภาพไม่ตรงกับชนิดไฟล์ที่เลือก" }, 400);
      const filename = crypto.randomUUID() + "." + types[mime];
      try {
        const upload = await fetch(url + "/storage/v1/object/menu-photos/" + filename, {
          method: "POST", headers: adminHeaders(secretKey, { "Content-Type": mime, "x-upsert": "false" }), body: bytes,
        });
        if (!upload.ok) return json({ error: "อัปโหลดรูปไม่สำเร็จ" }, 502);
        patch.image_url = url + "/storage/v1/object/public/menu-photos/" + filename;
      } catch { return json({ error: "เชื่อมต่อ Storage ไม่สำเร็จ" }, 502); }
    }
    try {
      const response = await fetch(url + "/rest/v1/menu_items?id=eq." + encodeURIComponent(id) + "&select=id,name,description,price,category,icon,image_url,active", {
        method: "PATCH",
        headers: adminHeaders(secretKey, { "Content-Type": "application/json", Prefer: "return=representation" }),
        body: JSON.stringify(patch),
      });
      if (!response.ok) return json({ error: "บันทึกการแก้ไขเมนูไม่สำเร็จ" }, 502);
      const rows = await response.json() as unknown[];
      if (!rows.length) return json({ error: "ไม่พบเมนูนี้" }, 404);
      return json(rows[0]);
    } catch { return json({ error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ" }, 502); }
  }


  if (action === "menu-save") {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const category = typeof body.category === "string" ? body.category.trim() : "";
    const price = typeof body.price === "number" ? body.price : Number(body.price);
    const mime = body.imageMime;
    const base64 = body.imageBase64;
    const types: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    if (name.length < 1 || name.length > 80 || description.length > 240 ||
        category.length < 1 || category.length > 40 || !Number.isFinite(price) ||
        price <= 0 || price > 100000 || typeof mime !== "string" || !types[mime] ||
        typeof base64 !== "string" || base64.length > 2_800_000) {
      return json({ error: "กรุณาตรวจสอบชื่อ รายละเอียด ราคา หมวดหมู่ และรูปภาพ" }, 400);
    }
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0)); }
    catch { return json({ error: "รูปภาพอ่านไม่สำเร็จ" }, 400); }
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return json({ error: "รูปภาพต้องมีขนาดไม่เกิน 2 MB" }, 413);
    const validImage = mime === "image/jpeg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mime === "image/png"
        ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        : bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
          bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    if (!validImage) return json({ error: "รูปภาพไม่ตรงกับชนิดไฟล์ที่เลือก" }, 400);

    const filename = crypto.randomUUID() + "." + types[mime as string];
    try {
      const upload = await fetch(url + "/storage/v1/object/menu-photos/" + filename, {
        method: "POST",
        headers: adminHeaders(secretKey, { "Content-Type": mime as string, "x-upsert": "false" }),
        body: bytes,
      });
      if (!upload.ok) return json({ error: "อัปโหลดรูปไม่สำเร็จ" }, 502);
      const imageUrl = url + "/storage/v1/object/public/menu-photos/" + filename;
      const response = await fetch(url + "/rest/v1/menu_items?select=id,name,description,price,category,icon,image_url", {
        method: "POST",
        headers: adminHeaders(secretKey, { "Content-Type": "application/json", Prefer: "return=representation" }),
        body: JSON.stringify({
          id: crypto.randomUUID(), name, description, price, category,
          icon: "🍽️", image_url: imageUrl, active: true,
        }),
      });
      if (!response.ok) {
        await fetch(url + "/storage/v1/object/menu-photos/" + filename, { method: "DELETE", headers: adminHeaders(secretKey) });
        return json({ error: "บันทึกเมนูไม่สำเร็จ" }, 502);
      }
      const rows = await response.json();
      return json(rows[0]);
    } catch {
      return json({ error: "เชื่อมต่อ Storage ไม่สำเร็จ" }, 502);
    }
  }

  if (action === "payment-confirm") {
    if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) return json({ error: "ข้อมูลออร์เดอร์ไม่ถูกต้อง" }, 400);
    try {
      const response = await fetch(url + "/rest/v1/orders?id=eq." + encodeURIComponent(body.id) + "&payment_status=eq.pending&select=id,payment_status", {
        method: "PATCH",
        headers: adminHeaders(secretKey, { "Content-Type": "application/json", Prefer: "return=representation" }),
        body: JSON.stringify({ payment_status: "paid" }),
      });
      if (!response.ok) return json({ error: "บันทึกสถานะการชำระเงินไม่สำเร็จ" }, 502);
      const rows = await response.json() as unknown[];
      if (!rows.length) return json({ error: "ไม่พบออร์เดอร์ที่รอชำระเงิน" }, 404);
      return json({ ok: true });
    } catch { return json({ error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ" }, 502); }
  }

  let endpoint = url + "/rest/v1/orders?select=*&order=created_at.desc";
  let method = "GET";
  let payload: string | undefined;
  let prefer = "return=representation";
  if (action === "status") {
    const statuses = ["accepted", "preparing", "ready"];
    if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id) ||
        typeof body.status !== "string" || !statuses.includes(body.status)) {
      return json({ error: "ข้อมูลสถานะไม่ถูกต้อง" }, 400);
    }
    endpoint = url + "/rest/v1/orders?id=eq." + encodeURIComponent(body.id) + "&payment_status=eq.paid&select=*";
    method = "PATCH";
    payload = JSON.stringify({ status: body.status });
  } else if (action === "clear") {
    endpoint = url + "/rest/v1/orders?status=eq.ready";
    method = "DELETE";
    prefer = "return=minimal";
  } else if (action !== "list") {
    return json({ error: "ไม่รู้จักคำสั่งนี้" }, 400);
  }

  try {
    const response = await fetch(endpoint, {
      method,
      headers: adminHeaders(secretKey, { "Content-Type": "application/json", Prefer: prefer }),
      body: payload,
    });
    const text = await response.text();
    if (!response.ok) return json({ error: "ทำรายการไม่สำเร็จ" }, 502);
    if (action === "status" && !JSON.parse(text || "[]").length) return json({ error: "ยืนยันการชำระเงินก่อนเริ่มทำอาหาร" }, 409);
    return json(action === "list" || action === "status" ? JSON.parse(text || "[]") : { ok: true });
  } catch {
    return json({ error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ" }, 502);
  }
});

