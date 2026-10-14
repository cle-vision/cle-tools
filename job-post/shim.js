/* ------------------------------------------------------------------
   Standalone storage for the job-post editor (GitHub / Vercel version)
   - Loads the shared postings from ./postings.json (in the repo)
   - Saves edits in this browser (localStorage)
   - "데이터 내보내기" downloads postings.json to commit back to the repo
   ------------------------------------------------------------------ */
(function () {
  if (window.claude && window.claude.use) return; // running inside Claude: use the real runtime
  var STORE = "cle-jobpost-store-v1";
  var subs = [];
  var state = null; // { postings: {id: doc}, history: {id: doc} }
  var ready;

  function load() {
    try { var raw = localStorage.getItem(STORE); if (raw) return JSON.parse(raw); } catch (e) {}
    return null;
  }
  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); }
    catch (e) {
      // storage full: drop the oldest history and retry once
      var h = Object.entries(state.history).sort(function (a, b) { return a[1].savedAt - b[1].savedAt; });
      h.slice(0, Math.ceil(h.length / 2)).forEach(function (x) { delete state.history[x[0]]; });
      try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e2) {}
    }
  }
  function fromRepo() {
    return fetch("postings.json", { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (p) { return { postings: p || {}, history: {}, repoLoadedAt: Date.now() }; })
      .catch(function () { return { postings: {}, history: {}, repoLoadedAt: Date.now() }; });
  }
  // Use this browser's copy, but pick up any posting that is newer in the repo's postings.json
  ready = Promise.all([Promise.resolve(load()), fromRepo()]).then(function (r) {
    var local = r[0], repo = r[1];
    if (!local) { state = repo; persist(); return; }
    Object.entries(repo.postings).forEach(function (e) {
      var mine = local.postings[e[0]];
      if (!mine || (e[1].updatedAt || 0) > (mine.updatedAt || 0)) local.postings[e[0]] = e[1];
    });
    state = local; if (!state.history) state.history = {}; persist();
  });

  var clone = function (o) { return o == null ? o : JSON.parse(JSON.stringify(o)); };
  function coll(name) { if (!state[name]) state[name] = {}; return state[name]; }
  function notify() { setTimeout(function () { subs.forEach(function (f) { f(); }); }, 0); }
  function snap(id, v) { return { id: id, exists: !!v, data: function () { return clone(v); }, metadata: { hasPendingWrites: false, fromCache: false } }; }
  function docRef(path) {
    var parts = path.split("/"), c = parts[0], id = parts[1];
    return {
      id: id, path: path,
      get: function () { return ready.then(function () { return snap(id, coll(c)[id]); }); },
      set: function (v) { return ready.then(function () { coll(c)[id] = clone(v); if (c === "history") trimHistory(); persist(); notify(); }); },
      update: function (v) { return ready.then(function () { coll(c)[id] = Object.assign(coll(c)[id] || {}, clone(v)); persist(); notify(); }); },
      delete: function () { return ready.then(function () { delete coll(c)[id]; persist(); notify(); }); }
    };
  }
  function trimHistory() { // keep the newest 15 versions per posting
    var by = {};
    Object.entries(state.history).forEach(function (e) { (by[e[1].postingId] = by[e[1].postingId] || []).push(e); });
    Object.values(by).forEach(function (list) {
      list.sort(function (a, b) { return b[1].savedAt - a[1].savedAt; }).slice(15).forEach(function (e) { delete state.history[e[0]]; });
    });
  }
  function query(name, filters) {
    var q = {
      where: function (f, op, val) { return query(name, filters.concat([[f, val]])); },
      orderBy: function () { return q; }, limit: function () { return q; },
      get: function () {
        return ready.then(function () {
          var docs = Object.entries(coll(name)).filter(function (e) { return filters.every(function (f) { return e[1][f[0]] === f[1]; }); })
            .map(function (e) { return snap(e[0], e[1]); });
          return { docs: docs, size: docs.length, empty: !docs.length };
        });
      },
      onSnapshot: function (next) {
        var prev = {};
        var run = function () {
          q.get().then(function (s) {
            var cur = {}, ch = [];
            s.docs.forEach(function (d) { cur[d.id] = JSON.stringify(d.data()); if (!(d.id in prev)) ch.push({ type: "added", doc: d }); else if (prev[d.id] !== cur[d.id]) ch.push({ type: "modified", doc: d }); });
            Object.keys(prev).forEach(function (id) { if (!(id in cur)) ch.push({ type: "removed", doc: snap(id, null) }); });
            prev = cur;
            next(Object.assign({}, s, { docChanges: function () { return ch; } }));
          });
        };
        subs.push(run); run();
        return function () { subs = subs.filter(function (f) { return f !== run; }); };
      }
    };
    return q;
  }
  var db = {
    doc: docRef,
    collection: function (name) {
      var q = query(name, []);
      q.path = name;
      q.doc = function (id) { return docRef(name + "/" + (id || Math.random().toString(36).slice(2))); };
      q.add = function (v) { var id = "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); return docRef(name + "/" + id).set(v).then(function () { return docRef(name + "/" + id); }); };
      return q;
    }
  };
  function saveFile(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  var downloads = { save: function (o) { saveFile(o.filename, o.data instanceof Blob ? o.data : new Blob([o.data])); return Promise.resolve(); } };
  window.claude = { use: function (n) { return Promise.resolve(n === "db" ? db : n === "downloads" ? downloads : null); } };

  /* data tools: export / import / reset — shown under the posting list */
  function exportJSON() {
    var out = {};
    Object.entries(state.postings).forEach(function (e) { out[e[0]] = { name: e[1].name, group: e[1].group, updatedAt: e[1].updatedAt || 0, data: e[1].data }; });
    saveFile("postings.json", new Blob([JSON.stringify(out, null, 1)], { type: "application/json" }));
  }
  function importJSON(file) {
    var r = new FileReader();
    r.onload = function () {
      try { var p = JSON.parse(r.result); if (!p || typeof p !== "object") throw 0; state.postings = p; persist(); location.reload(); }
      catch (e) { alertBox("이 파일은 공고 데이터(postings.json)가 아니에요."); }
    };
    r.readAsText(file);
  }
  function alertBox(msg) { var t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3000); }
  document.addEventListener("DOMContentLoaded", function () {
    var list = document.querySelector(".list"); if (!list) return;
    var box = document.createElement("div"); box.className = "data-tools";
    box.innerHTML = '<p>수정한 공고는 <b>이 브라우저</b>에 저장돼요. 다른 사람과 공유하려면 내보낸 <code>postings.json</code>을 저장소에 올려 주세요.</p>' +
      '<div class="dt-btns"><button type="button" class="btn sm" id="dtExport">데이터 내보내기</button>' +
      '<label class="btn sm" for="dtImport">불러오기</label><input type="file" id="dtImport" accept="application/json,.json" hidden>' +
      '<button type="button" class="btn sm ghost" id="dtReset">저장소 기본값으로</button></div>';
    list.appendChild(box);
    document.getElementById("dtExport").onclick = exportJSON;
    document.getElementById("dtImport").onchange = function (e) { if (e.target.files[0]) importJSON(e.target.files[0]); };
    var armed = 0;
    document.getElementById("dtReset").onclick = function (e) {
      var b = e.currentTarget;
      if (Date.now() - armed > 4000) { armed = Date.now(); b.textContent = "한 번 더 누르면 초기화"; setTimeout(function () { b.textContent = "저장소 기본값으로"; }, 4000); return; }
      try { localStorage.removeItem(STORE); } catch (err) {}
      location.reload();
    };
  });
})();
