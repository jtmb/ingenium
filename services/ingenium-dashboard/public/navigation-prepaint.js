(function () {
  try {
    var compact = window.localStorage.getItem("ingenium-nav-compact") === "true";
    document.documentElement.setAttribute("data-nav-compact", String(compact));
  } catch (_error) {
    document.documentElement.setAttribute("data-nav-compact", "false");
  }
}());
