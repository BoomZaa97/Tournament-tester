/**
 * Tournament Tester — Google Sheets backend.
 *
 * Paste this whole file into Extensions → Apps Script of your Google Sheet,
 * set ADMIN_KEY in Project Settings → Script properties, then deploy as a web app
 * (Execute as: Me, Who has access: Anyone). Full steps: docs/google-sheets-setup.md
 *
 * Reading is public (anyone with your site link can view brackets).
 * Who can write:
 *   - the site admin (ADMIN_KEY): everything;
 *   - a tournament's organizer: anyone can create a tournament; their browser makes a
 *     random organizer key and only its SHA-256 hash is stored (orgKeyHash). Helpers get
 *     the same key through a helper link;
 *   - players: sign up while sign-up is open, and report their own unplayed matches
 *     with their 6-digit PIN (Entrants.pin, never sent to viewers).
 *
 * Every tab is plain rows, so you can read and fix data by hand. In the Results
 * tab, the `winner` column accepts p1 / p2 / draw, or simply the winner's name.
 */

var TABLES = {
  Players: ['id', 'name'],
  Tournaments: ['id', 'name', 'game', 'format', 'options', 'scoring', 'createdAt', 'updatedAt', 'version', 'signup', 'orgKeyHash'],
  Entrants: ['tournamentId', 'seed', 'playerId', 'name', 'pin'],
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
    var isAdmin = !!body.key && body.key === adminKey;
    if (body.action === 'check') {
      var row = body.id ? findTournament(readTable('Tournaments'), body.id) : null;
      return { admin: isAdmin, organizer: !!row && isOrganizer(body, row) };
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (body.action === 'save') return { tournament: saveTournament(body.tournament, body.players || [], body, isAdmin) };
      if (body.action === 'delete') return deleteTournament(body.id, body, isAdmin);
      if (body.action === 'renamePlayer') {
        if (!isAdmin) throw new Error('Only the site admin can rename players');
        return renamePlayer(body.id, body.name);
      }
      if (body.action === 'signup') return signUp(body.id, body.name);
      if (body.action === 'report') return report(body.id, body.matchId, body.pin, body.result, body.matchNo);
      if (body.action === 'pins') return { pins: pinsFor(body.id, body, isAdmin) };
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
    signup: truthy(t.signup),
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

function saveTournament(doc, players, body, isAdmin) {
  if (!doc || !doc.id) throw new Error('Missing tournament');
  var data = loadTables();
  var existing = findTournament(data.Tournaments, doc.id);
  if (existing) {
    if (!isAdmin && !isOrganizer(body, existing)) throw new Error(NOT_ORGANIZER);
  } else if (!isAdmin && String(body.orgKey || '').length < 16) {
    throw new Error('Missing organizer key');
  }
  if (existing && num(existing.version) !== num(doc.version)) return conflict();
  var orgKeyHash = existing && existing.orgKeyHash ? existing.orgKeyHash : body.orgKey ? sha256(String(body.orgKey)) : '';

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
    // the player list is shared by every tournament: only the site admin renames people
    if (isAdmin || !byId[p.id]) byId[p.id] = { id: p.id, name: p.name };
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
    signup: saved.signup ? 'yes' : '',
    orgKeyHash: orgKeyHash,
  };
  var tournaments = data.Tournaments.filter(function (r) {
    return r.id !== doc.id;
  });
  tournaments.push(tRow);

  // keep each player's PIN across saves; new entrants get one
  var oldPins = {};
  data.Entrants.filter(function (r) {
    return r.tournamentId === doc.id;
  }).forEach(function (r) {
    if (r.pin) oldPins[r.playerId] = r.pin;
  });
  var usedPins = Object.keys(oldPins).map(function (k) {
    return oldPins[k];
  });
  var entrants = data.Entrants.filter(others).concat(
    saved.entrants.map(function (e, i) {
      var pin = oldPins[e.id] || newPin(usedPins);
      usedPins.push(pin);
      return { tournamentId: doc.id, seed: i + 1, playerId: e.id, name: names[e.id] || e.name, pin: pin };
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

function deleteTournament(id, body, isAdmin) {
  var data = loadTables();
  var row = findTournament(data.Tournaments, id);
  if (row && !isAdmin && !isOrganizer(body, row)) throw new Error(NOT_ORGANIZER);
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

// ------------------------------------------------------------------ organizers and players

var NOT_ORGANIZER = 'Only the organizer of this tournament (or the site admin) can change it';

function findTournament(rows, id) {
  return rows.filter(function (r) {
    return r.id === id;
  })[0];
}

function isOrganizer(body, row) {
  return !!(row && row.orgKeyHash && body.orgKey && sha256(String(body.orgKey)) === row.orgKeyHash);
}

function sha256(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes
    .map(function (b) {
      var h = (b < 0 ? b + 256 : b).toString(16);
      return h.length === 1 ? '0' + h : h;
    })
    .join('');
}

function newPin(used) {
  for (var i = 0; i < 1000; i++) {
    var pin = String(100000 + Math.floor(Math.random() * 900000));
    if (used.indexOf(pin) < 0) return pin;
  }
  throw new Error('Could not make a PIN');
}

function newId() {
  return Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7);
}

function bump(t) {
  t.version = num(t.version) + 1;
  t.updatedAt = new Date().toISOString();
}

function logRow(id, summary, changes) {
  return {
    tournamentId: id,
    time: new Date().toISOString(),
    summary: summary,
    undone: '',
    id: newId(),
    changes: JSON.stringify(changes || []),
    restore: '',
  };
}

/** A player adds themselves while sign-up is open and nothing has been played. */
function signUp(id, rawName) {
  var name = String(rawName || '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('Type your name');
  if (name.length > 60) throw new Error('That name is too long');
  var data = loadTables();
  var t = findTournament(data.Tournaments, id);
  if (!t) throw new Error('Tournament not found');
  if (!truthy(t.signup)) throw new Error('Sign-up is closed for this tournament');
  var started = data.Results.some(function (r) {
    return r.tournamentId === id;
  });
  if (started) throw new Error('This tournament has already started');

  var mine = data.Entrants.filter(function (e) {
    return e.tournamentId === id;
  });
  var lower = name.toLowerCase();
  var player = data.Players.filter(function (p) {
    return String(p.name).trim().toLowerCase() === lower;
  })[0];
  var taken = mine.some(function (e) {
    return String(e.name).trim().toLowerCase() === lower || (player && e.playerId === player.id);
  });
  if (taken) throw new Error('Someone called "' + name + '" is already signed up');
  if (!player) {
    player = { id: newId(), name: name };
    data.Players.push(player);
  }
  var pin = newPin(
    mine.map(function (e) {
      return e.pin;
    }),
  );
  var seed = mine.reduce(function (m, e) {
    return Math.max(m, num(e.seed));
  }, 0);
  data.Entrants.push({ tournamentId: id, seed: seed + 1, playerId: player.id, name: player.name, pin: pin });
  data.Log.push(logRow(id, player.name + ' signed up'));
  bump(t);
  writeTable('Players', data.Players);
  writeTable('Tournaments', data.Tournaments);
  writeTable('Entrants', data.Entrants);
  writeTable('Log', data.Log);
  return { playerId: player.id, pin: pin, tournament: assemble(t, data) };
}

/**
 * A player reports the result of a match they are in that has no result yet.
 * The bracket engine isn't here, so the pairing itself isn't checked: if it's wrong,
 * the app shows the match as "needs checking" to the organizer.
 */
function report(id, matchId, rawPin, result, matchNo) {
  var data = loadTables();
  var t = findTournament(data.Tournaments, id);
  if (!t) throw new Error('Tournament not found');
  var pin = String(rawPin || '').trim();
  var mine = data.Entrants.filter(function (e) {
    return e.tournamentId === id;
  });
  var me = /^\d{6}$/.test(pin)
    ? mine.filter(function (e) {
        return String(e.pin) === pin;
      })[0]
    : null;
  if (!me) throw new Error('Wrong PIN');
  if (!result || (result.p1 !== me.playerId && result.p2 !== me.playerId)) {
    throw new Error('You can only report your own matches');
  }
  var byId = {};
  mine.forEach(function (e) {
    byId[e.playerId] = e;
  });
  if (!byId[result.p1] || !byId[result.p2] || result.p1 === result.p2) throw new Error('Those players are not in this match');
  var draws = t.format === 'round_robin' || t.format === 'swiss';
  if (['p1', 'p2'].indexOf(result.winner) < 0 && !(draws && result.winner === 'draw')) throw new Error('Pick a winner');
  if (!/^[A-Za-z0-9-]{1,20}$/.test(String(matchId))) throw new Error('Unknown match');
  var played = data.Results.some(function (r) {
    return r.tournamentId === id && r.matchId === matchId;
  });
  if (played) throw new Error('This match already has a result. Ask the organizer to change it.');

  var score = function (v) {
    var n = Number(v);
    return v === undefined || v === null || v === '' || !isFinite(n) ? undefined : Math.max(0, Math.round(n));
  };
  var clean = { winner: result.winner, p1: result.p1, p2: result.p2, at: new Date().toISOString() };
  var s1 = score(result.score1);
  var s2 = score(result.score2);
  if (s1 !== undefined || s2 !== undefined) {
    clean.score1 = s1 || 0;
    clean.score2 = s2 || 0;
  }
  var n1 = byId[result.p1].name;
  var n2 = byId[result.p2].name;
  data.Results.push({
    tournamentId: id,
    matchId: matchId,
    p1Name: n1,
    p2Name: n2,
    winner: clean.winner,
    score1: clean.score1 === undefined ? '' : clean.score1,
    score2: clean.score2 === undefined ? '' : clean.score2,
    forfeit: '',
    at: clean.at,
    p1Id: clean.p1,
    p2Id: clean.p2,
    games: '',
  });
  var label = Number(matchNo) > 0 ? 'Match ' + Math.round(Number(matchNo)) + ': ' : '';
  var middle = clean.score1 !== undefined ? ' ' + clean.score1 + '–' + clean.score2 + ' ' : ' vs ';
  var summary = label + n1 + middle + n2 + (clean.winner === 'draw' ? ' (draw)' : '') + ' (reported by ' + me.name + ')';
  data.Log.push(logRow(id, summary, [{ matchId: matchId, after: clean }]));
  bump(t);
  writeTable('Tournaments', data.Tournaments);
  writeTable('Results', data.Results);
  writeTable('Log', data.Log);
  return { tournament: assemble(t, data), playerId: me.playerId };
}

/** Every entrant's PIN, for the organizer to hand out. Fills in any that are missing. */
function pinsFor(id, body, isAdmin) {
  var data = loadTables();
  var t = findTournament(data.Tournaments, id);
  if (!t) throw new Error('Tournament not found');
  if (!isAdmin && !isOrganizer(body, t)) throw new Error(NOT_ORGANIZER);
  var mine = data.Entrants.filter(function (e) {
    return e.tournamentId === id;
  });
  var used = mine
    .map(function (e) {
      return e.pin;
    })
    .filter(String);
  var changed = false;
  var out = {};
  mine.forEach(function (e) {
    if (!e.pin) {
      e.pin = newPin(used);
      used.push(e.pin);
      changed = true;
    }
    out[e.playerId] = e.pin;
  });
  if (changed) writeTable('Entrants', data.Entrants);
  return out;
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
