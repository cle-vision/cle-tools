/* ------------------------------------------------------------------
   Shared storage for the job-post editor: Firebase (Firestore + Auth)
   - Everyone sees the same postings; a save is shown to others at once
   - Sign-in: the admin gate's password signs in to one shared
     Firebase account (adminEmail in firebase-config.js)
   - First run: copies postings.json (+ this browser's earlier edits)
     into Firestore once
   - If firebase-config.js is not filled in, this file does nothing and
     shim.js keeps the old "save in this browser" behaviour
   ------------------------------------------------------------------ */
(function () {
  var C = window.CLE_FIREBASE;
  var key = C && C.config && C.config.apiKey;
  if (!key || /붙여|YOUR|xxx/i.test(key)) { console.info("[채용공고] Firebase 설정이 비어 있어서 이 브라우저 저장 모드로 동작해요."); return; }
  if (!window.firebase) { console.error("[채용공고] Firebase SDK를 불러오지 못했어요. 인터넷 연결이나 회사 방화벽을 확인해 주세요."); return; }

  firebase.initializeApp(C.config);
  var auth = firebase.auth();
  var db = firebase.firestore();
  var EMAIL = String(C.adminEmail || "").trim();
  var SESSION = firebase.auth.Auth.Persistence.SESSION; // 탭을 닫으면 다시 비밀번호를 물어봐요 (기존과 동일)

  var signedIn = new Promise(function (res) { auth.onAuthStateChanged(function (u) { if (u) res(u); }); });
  var firstCheck = new Promise(function (res) { var off = auth.onAuthStateChanged(function (u) { off(); res(!!u); }); });

  window.CLE_AUTH = {
    isSignedIn: function () { return firstCheck; },
    signIn: function (pw) {
      return auth.setPersistence(SESSION).then(function () { return auth.signInWithEmailAndPassword(EMAIL, pw); });
    },
    signOut: function () { return auth.signOut().then(function () { location.reload(); }); }
  };

  /* ---------- first run: move postings.json (+ this browser's edits) into Firestore ---------- */
  function localCopy() { try { var r = localStorage.getItem("cle-jobpost-store-v1"); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  function repoCopy() { return fetch("postings.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }); }
  function seedIfEmpty() {
    var meta = db.doc("meta/seed");
    return meta.get().then(function (m) {
      if (m.exists) return;
      return db.collection("postings").limit(1).get().then(function (s) {
        if (!s.empty) return meta.set({ at: Date.now(), count: 0 });
        return repoCopy().then(function (repo) {
          var loc = localCopy();
          var all = (loc && loc.postings) ? Object.assign({}, loc.postings) : {};
          Object.keys(repo || {}).forEach(function (id) {
            var mine = all[id], r = repo[id];
            if (!mine || (r.updatedAt || 0) > (mine.updatedAt || 0)) all[id] = r;
          });
          var b = db.batch(), n = 0;
          Object.keys(all).forEach(function (id) {
            var p = all[id]; if (!p || !p.data) return;
            b.set(db.doc("postings/" + id), { name: p.name || id, group: p.group || "기타", data: p.data, updatedAt: p.updatedAt || Date.now(), updatedBy: null });
            n++;
          });
          b.set(meta, { at: Date.now(), count: n });
          return b.commit().then(function () { notice("공고 " + n + "개를 공유 저장소로 옮겼어요. 이제 저장하면 모두에게 바로 반영돼요."); });
        });
      });
    }).catch(function (e) {
      console.error("[채용공고] Firestore 오류:", e);
      if (e && e.code === "permission-denied") notice("저장소 접근이 거부됐어요. Firestore 보안 규칙의 이메일과 firebase-config.js의 adminEmail이 같은지 확인해 주세요.", 9000);
      else notice("공유 저장소에 연결하지 못했어요. (" + ((e && e.code) || "오류") + ")", 7000);
    });
  }
  var ready = signedIn.then(seedIfEmpty).then(function () { return db; });

  /* ---------- runtime surface the editor expects (same as the Claude artifact) ---------- */
  var tab = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); // 이 탭의 저장인지 구분
  var user = {
    id: function () { return Promise.resolve(tab); },
    can: function () { return Promise.resolve(true); },
    profiles: function () { return Promise.resolve({}); }
  };
  function saveFile(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  var downloads = { save: function (o) { saveFile(o.filename, o.data instanceof Blob ? o.data : new Blob([o.data])); return Promise.resolve(); } };
  window.claude = {
    use: function (n) {
      if (n === "db") return ready;
      if (n === "user") return Promise.resolve(user);
      if (n === "downloads") return Promise.resolve(downloads);
      return Promise.resolve(null);
    }
  };

  /* ---------- small box under the posting list: backup + sign out ---------- */
  function notice(msg, ms) {
    var t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 3500);
  }
  function backup() {
    db.collection("postings").get().then(function (s) {
      var out = {};
      s.docs.forEach(function (d) { var v = d.data(); out[d.id] = { name: v.name, group: v.group, updatedAt: v.updatedAt || 0, data: v.data }; });
      var day = new Date().toISOString().slice(0, 10);
      saveFile("postings-backup-" + day + ".json", new Blob([JSON.stringify(out, null, 1)], { type: "application/json" }));
    }).catch(function () { notice("백업 파일을 만들지 못했어요."); });
  }
  document.addEventListener("DOMContentLoaded", function () {
    var list = document.querySelector(".list"); if (!list) return;
    var box = document.createElement("div"); box.className = "data-tools";
    box.innerHTML = '<p>공고는 <b>회사 공유 저장소(Firebase)</b>에 저장돼요. 저장하면 다른 사람 화면에도 바로 반영돼요.</p>' +
      '<div class="dt-btns"><button type="button" class="btn sm" id="dtBackup">백업 내려받기</button>' +
      '<button type="button" class="btn sm ghost" id="dtLogout">로그아웃</button></div>';
    list.appendChild(box);
    document.getElementById("dtBackup").onclick = backup;
    document.getElementById("dtLogout").onclick = function () { window.CLE_AUTH.signOut(); };
  });
})();
