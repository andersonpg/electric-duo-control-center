document.addEventListener("DOMContentLoaded", function () {
  var form = document.getElementById("loginForm");
  var btn = document.getElementById("loginBtn");
  var err = document.getElementById("loginError");
  if (!form) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    err.textContent = "";
    btn.disabled = true;
    btn.textContent = "Signing in…";
    fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: document.getElementById("username").value,
        password: document.getElementById("password").value
      })
    }).then(function (res) {
      if (!res.ok) throw new Error("bad_credentials");
      window.location.href = "/";
    }).catch(function () {
      err.textContent = "Incorrect username or password.";
      btn.disabled = false;
      btn.textContent = "Sign in";
    });
  });
});
