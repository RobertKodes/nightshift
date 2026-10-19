// Runs before the app, as a classic script: fills in the few newer features the app and its
// libraries use (iOS and macOS Safari before 15.4, Chrome before 92), and shows a clear message
// instead of a blank page if the app cannot start on this browser at all.
(function () {
  function at(n) {
    n = Math.trunc(n) || 0;
    if (n < 0) n += this.length;
    return n < 0 || n >= this.length ? undefined : this[n];
  }
  var lists = [Array, String];
  ["Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array"].forEach(function (k) { if (window[k]) lists.push(window[k]); });
  lists.forEach(function (C) { if (!C.prototype.at) Object.defineProperty(C.prototype, "at", { value: at, writable: true, configurable: true }); });
  if (!Object.hasOwn) Object.defineProperty(Object, "hasOwn", { value: function (o, k) { return Object.prototype.hasOwnProperty.call(Object(o), k); }, writable: true, configurable: true });
  if (window.crypto && crypto.getRandomValues && !crypto.randomUUID) {
    crypto.randomUUID = function () {
      var b = crypto.getRandomValues(new Uint8Array(16)), h = [];
      b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
      for (var i = 0; i < 16; i++) h.push((b[i] + 256).toString(16).slice(1));
      return h.slice(0, 4).join("") + "-" + h.slice(4, 6).join("") + "-" + h.slice(6, 8).join("") + "-" + h.slice(8, 10).join("") + "-" + h.slice(10).join("");
    };
  }
  if (!String.prototype.replaceAll) String.prototype.replaceAll = function (a, b) { return a instanceof RegExp ? this.replace(a, b) : this.split(a).join(b); };

  // If nothing has rendered after a while, say so plainly with what to try.
  function fallback() {
    var root = document.getElementById("root");
    if (!root || root.childNodes.length || document.getElementById("ns-compat")) return;
    var d = document.createElement("div");
    d.id = "ns-compat";
    d.setAttribute("style", "max-width:520px;margin:18vh auto;padding:0 20px;font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#f2efff;text-align:center");
    d.innerHTML = "<h1 style='font-size:26px;margin:0 0 12px'>NIGHTSHIFT could not start here</h1>" +
      "<p style='color:#a59fc4'>This browser is too old or blocked a script the site needs. Update it, or open the site in a current Chrome, Safari, Firefox, Edge or Brave. In a wallet app, update the app.</p>" +
      "<p><a href='' style='color:#9a8bff'>Try again</a></p>";
    document.body.style.background = "#03020a";
    document.body.appendChild(d);
  }
  window.addEventListener("load", function () { setTimeout(fallback, 8000); });
})();
