/**
 * Tournament Tester — Google Sheets backend.
 *
 * Paste this whole file into Extensions → Apps Script of your Google Sheet,
 * set ADMIN_KEY in Project Settings → Script properties, then deploy as a web app
 * (Execute as: Me, Who has access: Anyone). Full steps: docs/google-sheets-setup.md
 *
 * Reading is public (anyone with your site link can view brackets).
 * Writing needs the admin key.
 *
 * Every tab is plain rows, so you can read and fix data by hand. In the Results
 * tab, the `winner` column accepts p1 / p2 / draw, or simply the winner's name.
 */

var TABLES = {
  Players: ['id', 'name'],
  Tournaments: ['id', 'name', 'game', 'format', 'options', 'scoring', 'createdAt', 'updatedAt', 'version'],
  Entrants: ['tournamentId', 'seed', 'playerId', 'name'],
  Results: ['tournamentId', 'matchId', 'p1Name', 'p2Name', 'winner', 'score1', 'score2', 'forfeit', 'at', 'p1Id', 'p2Id', 'games'],
  Log: ['tournamentId', 'time', 'summary', 'undone', 'id', 'changes', 'restore'],
};

var CELL_LIMIT = 45000; // Google Sheets allows 50,000 characters per cell

// ------------------------------------------------------------------ entry points

function doGet(e) {
  return handle(function () {
    var action = (e && e.parameter && e.parameter.action) || 'all';
    if (action === 'all') return readAll();
    if (action === 'get') return { tournament: readTournament(e.parameter.id) };
    throw new Error('Unknown action: ' + action);
  });
}

function doPost(e) {
  return handle(function () {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var adminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
    if (!adminKey) throw new Error('ADMIN_KEY is not set. In Apps Script: Project Settings → Script properties.');
    var isAdmin = body.key === adminKey;
    if (body.action === 'check') return { admin: isAdmin };
    if (!isAdmin) throw new Error('Wrong admin key');

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (body.action === 'save') return { tournament: saveTournament(body.tournament, body.players || []) };
      if (body.action === 'delete') return deleteTournament(body.id);
      if (body.action === 'renamePlayer') return renamePlayer(body.id, body.name);
      throw new Error('Unknown action: ' + body.action);
    } finally {
      lock.releaseLock();
    }
  });
}

function handle(fn) {
  var out;
  try {
    out = fn();
  } catch (err) {
    out = { error: err && err.message ? err.message : String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------------ reads

function readAll() {
  var data = loadTables();
  var tournaments = data.Tournaments.map(function (t) {
    return assemble(t, data);
  });
  return { tournaments: tournaments, players: data.Players.map(toPlayer) };
}

function readTournament(id) {
  var data = loadTables();
  var t = data.Tournaments.filter(function (r) {
    return r.id === id;
  })[0];
  return t ? assemble(t, data) : null;
}

function toPlayer(r) {
  return { id: r.id, name: r.name };
}

function assemble(t, data) {
  var mine = function (r) {
    return r.tournamentId === t.id;
  };
  var entrants = data.Entrants.filter(mine)
    .sort(function (a, b) {
      return num(a.seed) - num(b.seed);
    })
    .map(function (e) {
      return { id: e.playerId, name: e.name };
    });

  var results = {};
  data.Results.filter(mine).forEach(function (r) {
    var res = {
      winner: parseWinner(r),
      p1: r.p1Id,
      p2: r.p2Id,
    };
    if (r.score1 !== '') res.score1 = num(r.score1);
    if (r.score2 !== '') res.score2 = num(r.score2);
    if (truthy(r.forfeit)) res.forfeit = true;
    if (r.games) res.games = json(r.games, undefined);
    if (r.at) res.at = r.at;
    results[r.matchId] = res;
  });

  var log = data.Log.filter(mine).map(function (l) {
    var entry = { id: l.id, time: l.time, summary: l.summary, changes: json(l.changes, []) };
    if (truthy(l.undone)) entry.undone = true;
    if (l.restore) entry.restore = json(l.restore, undefined);
    return entry;
  });

  return {
    id: t.id,
    name: t.name,
    game: t.game,
    format: t.format,
    options: json(t.options, {}),
    scoring: json(t.scoring, {}),
    entrants: entrants,
    results: results,
    log: log,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    version: num(t.version),
  };
}

/** Accept p1 / p2 / draw, or a player's name typed by hand. */
function parseWinner(r) {
  var w = String(r.winner).trim();
  var lower = w.toLowerCase();
  if (lower === 'p1' || lower === 'p2' || lower === 'draw') return lower;
  if (lower === String(r.p1Name).trim().toLowerCase()) return 'p1';
  if (lower === String(r.p2Name).trim().toLowerCase()) return 'p2';
  return 'p1';
}

// ------------------------------------------------------------------ writes

function saveTournament(doc, players) {
  if (!doc || !doc.id) throw new Error('Missing tournament');
  var data = loadTables();
  var existing = data.Tournaments.filter(function (r) {
    return r.id === doc.id;
  })[0];
  if (existing && num(existing.version) !== num(doc.version)) return conflict();

  var now = new Date().toISOString();
  var saved = JSON.parse(JSON.stringify(doc));
  saved.version = num(doc.version) + 1;
  saved.updatedAt = now;
  if (!saved.createdAt) saved.createdAt = now;

  // players: upsert
  var byId = {};
  data.Players.forEach(function (p) {
    byId[p.id] = p;
  });
  (players || []).forEach(function (p) {
    byId[p.id] = { id: p.id, name: p.name };
  });
  saved.entrants.forEach(function (e) {
    if (!byId[e.id]) byId[e.id] = { id: e.id, name: e.name };
  });
  var names = {};
  Object.keys(byId).forEach(function (id) {
    names[id] = byId[id].name;
  });

  var others = function (r) {
    return r.tournamentId !== doc.id;
  };
  var tRow = {
    id: saved.id,
    name: saved.name,
    game: saved.game,
    format: saved.format,
    options: JSON.stringify(saved.options || {}),
    scoring: JSON.stringify(saved.scoring || {}),
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
    version: saved.version,
  };
  var tournaments = data.Tournaments.filter(function (r) {
    return r.id !== doc.id;
  });
  tournaments.push(tRow);

  var entrants = data.Entrants.filter(others).concat(
    saved.entrants.map(function (e, i) {
      return { tournamentId: doc.id, seed: i + 1, playerId: e.id, name: names[e.id] || e.name };
    }),
  );

  var results = data.Results.filter(others).concat(
    Object.keys(saved.results).map(function (matchId) {
      var r = saved.results[matchId];
      return {
        tournamentId: doc.id,
        matchId: matchId,
        p1Name: names[r.p1] || r.p1,
        p2Name: names[r.p2] || r.p2,
        winner: r.winner,
        score1: r.score1 === undefined ? '' : r.score1,
        score2: r.score2 === undefined ? '' : r.score2,
        forfeit: r.forfeit ? 'yes' : '',
        at: r.at || '',
        p1Id: r.p1,
        p2Id: r.p2,
        games: r.games ? JSON.stringify(r.games) : '',
      };
    }),
  );

  var log = data.Log.filter(others).concat(
    (saved.log || []).map(function (l) {
      var restore = l.restore ? JSON.stringify(l.restore) : '';
      if (restore.length > CELL_LIMIT) restore = ''; // too big for one cell: that edit just can't be undone
      var changes = JSON.stringify(l.changes || []);
      if (changes.length > CELL_LIMIT) changes = '[]';
      return {
        tournamentId: doc.id,
        time: l.time,
        summary: l.summary,
        undone: l.undone ? 'yes' : '',
        id: l.id,
        changes: changes,
        restore: restore,
      };
    }),
  );

  writeTable('Players', Object.keys(byId).map(function (id) {
    return byId[id];
  }));
  writeTable('Tournaments', tournaments);
  writeTable('Entrants', entrants);
  writeTable('Results', results);
  writeTable('Log', log);
  return saved;
}

function deleteTournament(id) {
  var data = loadTables();
  var others = function (r) {
    return r.tournamentId !== id;
  };
  writeTable('Tournaments', data.Tournaments.filter(function (r) {
    return r.id !== id;
  }));
  writeTable('Entrants', data.Entrants.filter(others));
  writeTable('Results', data.Results.filter(others));
  writeTable('Log', data.Log.filter(others));
  return { ok: true };
}

function renamePlayer(id, name) {
  if (!name) throw new Error('Name is empty');
  var data = loadTables();
  var found = false;
  data.Players.forEach(function (p) {
    if (p.id === id) {
      p.name = name;
      found = true;
    }
  });
  if (!found) data.Players.push({ id: id, name: name });
  data.Entrants.forEach(function (e) {
    if (e.playerId === id) e.name = name;
  });
  data.Results.forEach(function (r) {
    if (r.p1Id === id) r.p1Name = name;
    if (r.p2Id === id) r.p2Name = name;
  });
  writeTable('Players', data.Players);
  writeTable('Entrants', data.Entrants);
  writeTable('Results', data.Results);
  return { ok: true };
}

function conflict() {
  throw new Error('conflict');
}

// ------------------------------------------------------------------ sheet helpers

function loadTables() {
  var out = {};
  Object.keys(TABLES).forEach(function (name) {
    out[name] = readTable(name);
  });
  return out;
}

function sheetFor(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  var headers = TABLES[name];
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Rows as objects keyed by the header row. Columns can be reordered by hand. */
function readTable(name) {
  var sheet = sheetFor(name);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) {
    return String(h).trim();
  });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.every(function (v) { return v === '' || v === null; })) continue;
    var obj = {};
    headers.forEach(function (h, j) {
      var v = row[j];
      var s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? '' : String(v);
      obj[h] = /^'[=+\-@]/.test(s) ? s.slice(1) : s; // undo safe()
    });
    rows.push(obj);
  }
  return rows;
}

function writeTable(name, rows) {
  var sheet = sheetFor(name);
  var headers = TABLES[name];
  // Keep any extra columns the user added, in their order.
  var current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String).filter(String);
  headers.forEach(function (h) {
    if (current.indexOf(h) < 0) current.push(h);
  });
  sheet.getRange(1, 1, 1, current.length).setValues([current]).setFontWeight('bold');

  var last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, Math.max(sheet.getLastColumn(), current.length)).clearContent();
  if (!rows.length) return;
  var values = rows.map(function (r) {
    return current.map(function (h) {
      return safe(r[h]);
    });
  });
  var range = sheet.getRange(2, 1, values.length, current.length);
  range.setNumberFormat('@'); // store as plain text: "007" stays "007", dates stay ISO text
  range.setValues(values);
}

/** Stop names like "=SUM(...)" from becoming formulas. */
function safe(v) {
  if (v === undefined || v === null) return '';
  var s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function num(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function truthy(v) {
  var s = String(v).trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1' || s === 'x';
}

function json(s, fallback) {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch (e) {
    return fallback;
  }
}
