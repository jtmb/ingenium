(function () {
  try {
    var saved = window.localStorage.getItem("ingenium-nav-compact");
    var compact = saved === null ? window.location.pathname === "/chat" : saved === "true";
    document.documentElement.setAttribute("data-nav-compact", String(compact));
  } catch (_error) {
    document.documentElement.setAttribute("data-nav-compact", "false");
  }
}());
