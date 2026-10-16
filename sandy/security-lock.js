// Shared Sandy customer-session inactivity protection.
// All customer-facing apps on this origin use the same last-activity clock.
const ACTIVITY_KEY = "sandy.idle.last-activity.v1";
const LOCK_KEY = "sandy.idle.locked-at.v1";
const MAX_IDLE_MS = 10 * 60 * 1000;

export function installSandyIdleLock(auth, { redirect = "../app/?locked=1" } = {}) {
  let locking = false;
  let lastWrite = 0;
  const hasIncomingSignIn = /(?:access_token|refresh_token|sandy_login|token_hash)=/.test(
    location.hash + "&" + location.search
  );
  function markActive(force = false) {
    if (locking) return;
    const now = Date.now();
    if (force || now - lastWrite >= 1500) {
      lastWrite = now;
      try { localStorage.setItem(ACTIVITY_KEY, String(now)); } catch {}
    }
  }
  // A newly deployed lock starts its clock now. Never reset an older clock
  // merely because a different page or browser tab was opened.
  if (!Number(localStorage.getItem(ACTIVITY_KEY)) || hasIncomingSignIn) markActive(true);

  async function lock() {
    if (locking) return true;
    locking = true;
    // Prevent a background tab from displaying cached private material while
    // its refresh session is being revoked.
    document.documentElement.style.visibility = "hidden";
    try { localStorage.setItem(LOCK_KEY, String(Date.now())); } catch {}
    try {
      const { error } = await auth.signOut();
      if (error) await auth.signOut({ scope: "local" });
    } catch {
      try { await auth.signOut({ scope: "local" }); } catch {}
    }
    location.replace(redirect);
    return true;
  }

  async function check() {
    if (locking) return true;
    const last = Number(localStorage.getItem(ACTIVITY_KEY)) || 0;
    if (!last || Date.now() - last < MAX_IDLE_MS) return false;
    const { data } = await auth.getSession();
    if (!data?.session) return false;
    return lock();
  }

  for (const eventName of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    window.addEventListener(eventName, () => markActive(), { passive: true, capture: true });
  }
  window.addEventListener("focus", () => { void check(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void check();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === LOCK_KEY && event.newValue && !locking) void lock();
  });
  window.setInterval(() => { void check(); }, 15000);
  return { check, markActive };
}
