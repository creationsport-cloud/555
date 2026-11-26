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
const PIN = "123456";
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MENU: Record<string, { name: string; price: number }> = {
  padthai: { name: "ผัดไทยกุ้งสด", price: 89 },
  basil: { name: "ข้าวกะเพราไก่", price: 69 },
  friedrice: { name: "ข้าวผัดหมู", price: 65 },
  tomyum: { name: "ต้มยำกุ้ง", price: 120 },
  roll: { name: "ปอเปี๊ยะทอด", price: 55 },
  tea: { name: "ชาไทยเย็น", price: 35 },
  water: { name: "น้ำเปล่า", price: 15 },
  icecream: { name: "ไอศกรีมกะทิ", price: 45 },
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const origin = req.headers.get("origin");
  if (origin && origin !== "https://creationsport-cloud.github.io") {
    return json({ error: "Origin not allowed" }, 403);
  }

  let body: { pin?: unknown; action?: unknown; id?: unknown; status?: unknown; items?: unknown };
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const action = body.action;
  const ip = requestIp(req);
  const { url, secretKey } = getAdminConfig();

  // Customers place orders without a PIN. Prices and names are checked on the server.
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
    const items: { name: string; price: number; qty: number }[] = [];
    for (const raw of body.items) {
      if (!raw || typeof raw !== "object") return json({ error: "รายการอาหารไม่ถูกต้อง" }, 400);
      const item = raw as { id?: unknown; qty?: unknown };
      if (typeof item.id !== "string" || !MENU[item.id] ||
          typeof item.qty !== "number" || !Number.isInteger(item.qty) ||
          item.qty < 1 || item.qty > 50) {
        return json({ error: "รายการอาหารไม่ถูกต้อง" }, 400);
      }
      const food = MENU[item.id];
      items.push({ name: food.name, price: food.price, qty: item.qty });
    }
    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    try {
      const response = await fetch(url + "/rest/v1/orders?select=order_number", {
        method: "POST",
        headers: {
          apikey: secretKey,
          Authorization: "Bearer " + secretKey,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ id: crypto.randomUUID(), items, total }),
      });
      const text = await response.text();
      if (!response.ok) return json({ error: "บันทึกออร์เดอร์ไม่สำเร็จ" }, 502);
      const created = JSON.parse(text || "[]");
      return json({ order_number: created[0]?.order_number });
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
  if (body.pin !== PIN) {
    attempt.count++;
    if (attempt.count >= MAX_ATTEMPTS) attempt.lockedUntil = now + WINDOW_MS;
    return json({ error: "PIN ไม่ถูกต้อง" }, 401);
  }
  attempt.count = 0;
  attempt.lockedUntil = 0;

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
    endpoint = url + "/rest/v1/orders?id=eq." + encodeURIComponent(body.id) + "&select=*";
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
      headers: {
        apikey: secretKey,
        Authorization: "Bearer " + secretKey,
        "Content-Type": "application/json",
        Prefer: prefer,
      },
      body: payload,
    });
    const text = await response.text();
    if (!response.ok) return json({ error: "ทำรายการไม่สำเร็จ" }, 502);
    return json(action === "list" || action === "status" ? JSON.parse(text || "[]") : { ok: true });
  } catch {
    return json({ error: "เชื่อมต่อฐานข้อมูลไม่สำเร็จ" }, 502);
  }
});