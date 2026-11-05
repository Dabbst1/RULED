/* Public pages (landing, calculators, privacy): if this browser is logged in to Monerem,
   replace "Log in" with the member's name so they can see they're still signed in.
   Reads the login the app page saved on this same site; nothing is sent anywhere. */
(function () {
  function show() {
    try {
      var raw = localStorage.getItem("sb-qytsgfjyiybxucxtbcne-auth-token"); if (!raw) return;
      var t = JSON.parse(raw), s = t && t.currentSession ? t.currentSession : t;
      if (!s || !(s.access_token || s.refresh_token)) return;
      if (s.expires_at && s.expires_at * 1000 < Date.now() && !s.refresh_token) return;
      var u = s.user || {}, m = u.user_metadata || {}, email = u.email || "";
      var name = (m.full_name || m.name || "").trim() || email.split("@")[0] || "My account";
      var first = name.split(/\s+/)[0];
      var a = document.getElementById("navLogin"); if (!a) return;
      a.href = "app.html#home";
      a.className = (a.className ? a.className + " " : "") + "navme";
      a.title = "Logged in" + (email ? " as " + email : "") + ". Open my budget";
      a.setAttribute("aria-label", "Logged in as " + name + ". Open my budget");
      a.textContent = "";
      var dot = document.createElement("span"); dot.className = "navme-av"; dot.textContent = first.charAt(0).toUpperCase();
      var nm = document.createElement("span"); nm.className = "navme-nm"; nm.textContent = first;
      a.appendChild(dot); a.appendChild(nm);
      // the hero's sign-up button becomes a shortcut back in
      var cta = document.getElementById("heroCta"); if (cta) { cta.textContent = "Open my budget"; cta.href = "app.html#home"; }
      if (!document.getElementById("navmeCss")) {
        var st = document.createElement("style"); st.id = "navmeCss";
        st.textContent = ".nav-links a.navme{display:inline-flex;align-items:center;gap:8px;text-decoration:none;padding:5px 14px 5px 5px;border:2px solid var(--ink,#0B1F4D);border-radius:999px;background:#fff;font-weight:600;line-height:1.2;white-space:nowrap}" +
          ".nav-links a.navme:hover{text-decoration:none;background:var(--hl,#CFE0FF)}" +
          ".navme-av{width:28px;height:28px;border-radius:50%;background:var(--blue,#1D4ED8);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;position:relative}" +
          ".navme-av::after{content:'';position:absolute;right:-1px;bottom:-1px;width:9px;height:9px;border-radius:50%;background:#16A34A;border:2px solid #fff}" +
          ".navme-nm{max-width:9em;overflow:hidden;text-overflow:ellipsis}";
        document.head.appendChild(st);
      }
    } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show); else show();
})();
