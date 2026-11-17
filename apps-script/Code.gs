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
 *   - accounts (optional, Accounts tab): a username and password linked to one player. Logging in
 *     gives a device that player's PINs and the organizer keys of the tournaments they made, so
 *     everything above works on any device. Passwords are stored salted and hashed with a secret
 *     (ACCOUNT_SECRET script property, made by the script the first time it's needed).
 *
 * Every tab is plain rows, so you can read and fix data by hand. In the Results
 * tab, the `winner` column accepts p1 / p2 / draw, or simply the winner's name.
 */

var TABLES = {
  Players: ['id', 'name'],
  Tournaments: [
    'id', 'name', 'game', 'format', 'options', 'scoring', 'createdAt', 'updatedAt', 'version', 'signup', 'orgKeyHash',
    'code', 'maxPlayers', 'checkIn',
  ],
  Entrants: ['tournamentId', 'seed', 'playerId', 'name', 'pin', 'checkedIn'],
  Results: [
    'tournamentId', 'matchId', 'p1Name', 'p2Name', 'winner', 'score1', 'score2', 'forfeit', 'at', 'p1Id', 'p2Id', 'games',
    'status', 'reportedBy',
  ],
  Log: ['tournamentId', 'time', 'summary', 'undone', 'id', 'changes', 'restore'],
  // People who signed up after the player limit was reached, in order (oldest first).
  Waitlist: ['tournamentId', 'playerId', 'name', 'pin', 'at', 'checkedIn'],
  // Player accounts. Delete a row to delete an account (the player and their results stay).
  Accounts: ['id', 'username', 'playerId', 'passHash', 'salt', 'createdAt', 'orgKeys', 'fails', 'lockedUntil'],
};

var CELL_LIMIT = 45000; // Google Sheets allows 50,000 characters per cell

// ------------------------------------------------------------------ entry points

function doGet(e) {
  return handle(function () {
    var action = (e && e.parameter && e.parameter.action) || 'all';
    if (action === 'all') return readAll();
    if (action === 'get') return { tournament: readTournament(e.parameter.id) };
    if (action === 'code') return findByCode(e.parameter.code);
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
      if (body.action === 'signup') return signUp(body.id, body.name, body.token);
      if (body.action === 'report') return report(body.id, body.matchId, body.pin, body.result, body.matchNo);
      if (body.action === 'pins') return { pins: pinsFor(body.id, body, isAdmin) };
      if (body.action === 'checkin') return checkIn(body, isAdmin);
      if (body.action === 'drop') return dropOut(body.id, body.pin);
      if (body.action === 'confirm') return confirmResult(body.id, body.matchId, body.pin, body.ok !== false, body.matchNo);
      if (body.action === 'register') return register(body);
      if (body.action === 'login') return logIn(body.username, body.password);
      if (body.action === 'me') return aboutMe(body.token, body.orgKeys);
      if (body.action === 'password') return changePassword(body.token, body.password, body.newPassword);
      if (body.action === 'rename') return renameSelf(body.token, body.name);
      if (body.action === 'resetPassword') {
        if (!isAdmin) throw new Error('Only the site admin can reset passwords');
        return resetPassword(body.playerId);
      }
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
  ensureCodes(data);
  var tournaments = data.Tournaments.map(function (t) {
    return assemble(t, data);
  });
  var hasAccount = {};
  data.Accounts.forEach(function (a) {
    hasAccount[a.playerId] = true;
  });
  var players = data.Players.map(function (p) {
    var out = toPlayer(p);
    if (hasAccount[p.id]) out.account = true;
    return out;
  });
  return { tournaments: tournaments, players: players };
}

function readTournament(id) {
  var data = loadTables();
  ensureCodes(data);
  var t = data.Tournaments.filter(function (r) {
    return r.id === id;
  })[0];
  return t ? assemble(t, data) : null;
}

// ------------------------------------------------------------------ join codes

/** Short codes people type at the door. No look-alikes: no 0/O, no 1/I. */
var CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode(rows) {
  var used = {};
  rows.forEach(function (r) {
    if (r.code) used[String(r.code).toUpperCase()] = true;
  });
  for (var tries = 0; tries < 1000; tries++) {
    var code = '';
    for (var i = 0; i < 6; i++) code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
    if (!used[code]) return code;
  }
  throw new Error('Could not make a join code');
}

function cleanCode(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Tournaments made before join codes existed get one the first time they are read. */
function ensureCodes(data) {
  var missing = data.Tournaments.filter(function (t) {
    return !t.code;
  });
  if (!missing.length) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var fresh = readTable('Tournaments'); // someone may have saved since we read
    fresh.forEach(function (t) {
      if (!t.code) t.code = newCode(fresh);
    });
    writeTable('Tournaments', fresh);
    data.Tournaments = fresh;
  } finally {
    lock.releaseLock();
  }
}

/** Public: which tournament has this join code. */
function findByCode(raw) {
  var code = cleanCode(raw);
  if (!code) throw new Error('Type a code');
  var data = loadTables();
  ensureCodes(data);
  var t = data.Tournaments.filter(function (r) {
    return cleanCode(r.code) === code;
  })[0];
  if (!t) throw new Error('No tournament has the code ' + code);
  return { id: t.id, name: t.name };
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
  // Waitlisted people are NOT entrants: they are not in the bracket until the organizer moves them up.
  var waitlist = waitlistOf(t.id, data).map(function (w) {
    return { id: w.playerId, name: w.name };
  });
  // Who tapped "I'm here" (entrants and waitlisted people), by player id.
  var checkedIn = data.Entrants.filter(mine)
    .concat(waitlistOf(t.id, data))
    .filter(function (e) {
      return !!e.checkedIn;
    })
    .map(function (e) {
      return e.playerId;
    });

  var results = {};
  data.Results.filter(mine).forEach(function (r) {
    results[r.matchId] = toResult(r);
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
    code: t.code || '',
    maxPlayers: num(t.maxPlayers),
    waitlist: waitlist,
    checkIn: truthy(t.checkIn),
    checkedIn: checkedIn,
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

/** A Results row as the app's result object. */
function toResult(r) {
  var res = {
    winner: parseWinner(r),
    p1: r.p1Id,
    p2: r.p2Id,
  };
  if (r.score1 !== '' && r.score1 !== undefined) res.score1 = num(r.score1);
  if (r.score2 !== '' && r.score2 !== undefined) res.score2 = num(r.score2);
  if (truthy(r.forfeit)) res.forfeit = true;
  if (r.games) res.games = json(r.games, undefined);
  if (r.at) res.at = r.at;
  // Reported by a player: 'reported' until the opponent confirms or disputes it. Empty = entered by the organizer.
  if (r.status === 'reported' || r.status === 'confirmed' || r.status === 'disputed') res.status = r.status;
  if (r.reportedBy) res.reportedBy = r.reportedBy;
  return res;
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
  var code = existing && existing.code ? existing.code : newCode(data.Tournaments);

  var now = new Date().toISOString();
  var saved = JSON.parse(JSON.stringify(doc));
  saved.code = code;
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
    code: code,
    maxPlayers: num(saved.maxPlayers) > 0 ? Math.round(num(saved.maxPlayers)) : '',
    checkIn: saved.checkIn ? 'yes' : '',
  };
  var tournaments = data.Tournaments.filter(function (r) {
    return r.id !== doc.id;
  });
  tournaments.push(tRow);

  // keep each player's PIN (and check-in) across saves; new entrants get a PIN
  var oldPins = {};
  var arrived = {};
  data.Entrants.filter(function (r) {
    return r.tournamentId === doc.id;
  }).forEach(function (r) {
    if (r.pin) oldPins[r.playerId] = r.pin;
    if (r.checkedIn) arrived[r.playerId] = r.checkedIn;
  });
  var usedPins = Object.keys(oldPins).map(function (k) {
    return oldPins[k];
  });
  // Someone moved up from the waitlist keeps the PIN they got when they signed up.
  var inBracket = {};
  saved.entrants.forEach(function (e) {
    inBracket[e.id] = true;
  });
  var waitlist = data.Waitlist.filter(function (w) {
    if (w.tournamentId !== doc.id) return true;
    if (w.pin) usedPins.push(w.pin);
    if (!inBracket[w.playerId]) return true;
    if (w.pin && !oldPins[w.playerId]) oldPins[w.playerId] = w.pin;
    if (w.checkedIn && !arrived[w.playerId]) arrived[w.playerId] = w.checkedIn;
    return false;
  });
  var entrants = data.Entrants.filter(others).concat(
    saved.entrants.map(function (e, i) {
      var pin = oldPins[e.id] || newPin(usedPins);
      usedPins.push(pin);
      return {
        tournamentId: doc.id,
        seed: i + 1,
        playerId: e.id,
        name: names[e.id] || e.name,
        pin: pin,
        checkedIn: arrived[e.id] || '',
      };
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
        status: r.status || '',
        reportedBy: r.reportedBy || '',
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
  writeTable('Waitlist', waitlist);
  // Made while logged in: the account keeps the organizer key, so every device it logs in on can edit it.
  if (!existing && body.token && body.orgKey) {
    var owner = accountFromToken(body.token, data);
    if (owner) {
      var keys = json(owner.orgKeys, {});
      keys[doc.id] = String(body.orgKey);
      owner.orgKeys = JSON.stringify(keys);
      writeTable('Accounts', data.Accounts);
    }
  }
  // Send back what is stored now (code, waitlist, ...), exactly as a reload would see it.
  return assemble(tRow, { Entrants: entrants, Results: results, Log: log, Waitlist: waitlist });
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
  writeTable('Waitlist', data.Waitlist.filter(others));
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
  data.Waitlist.forEach(function (w) {
    if (w.playerId === id) w.name = name;
  });
  data.Results.forEach(function (r) {
    if (r.p1Id === id) r.p1Name = name;
    if (r.p2Id === id) r.p2Name = name;
  });
  writeTable('Players', data.Players);
  writeTable('Entrants', data.Entrants);
  writeTable('Waitlist', data.Waitlist);
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

/** A cleaned-up player name, or an error. */
function cleanName(raw) {
  var name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error('Type your name');
  if (name.length > 60) throw new Error('That name is too long');
  return name;
}

/**
 * A player adds themselves while sign-up is open and nothing has been played:
 * by name, or (with an account token) as the account's player.
 */
function signUp(id, rawName, token) {
  var data = loadTables();
  var account = null;
  var name;
  if (token) {
    account = accountFromToken(token, data);
    if (!account) throw new Error(LOGGED_OUT);
    var own = findById(data.Players, account.playerId);
    name = own ? String(own.name) : '';
    if (!name) throw new Error('Your account has no player. Ask the site admin.');
  } else {
    name = cleanName(rawName);
  }
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
  var waiting = waitlistOf(id, data);
  var everyone = mine.concat(waiting);
  var lower = name.toLowerCase();
  var player = account
    ? findById(data.Players, account.playerId)
    : data.Players.filter(function (p) {
        return String(p.name).trim().toLowerCase() === lower;
      })[0];
  if (!account && player && accountOf(player.id, data)) {
    throw new Error(player.name + ' has an account. Log in to join as ' + player.name + ', or use another name.');
  }
  var taken = everyone.some(function (e) {
    return String(e.name).trim().toLowerCase() === lower || (player && e.playerId === player.id);
  });
  if (taken) throw new Error(account ? "You're already signed up" : 'Someone called "' + name + '" is already signed up');
  if (!player) {
    player = { id: newId(), name: name };
    data.Players.push(player);
  }
  var pin = newPin(
    everyone.map(function (e) {
      return e.pin;
    }),
  );
  // Full (or people are already waiting, who go first): join the waitlist instead of the bracket.
  var cap = num(t.maxPlayers);
  var waitlisted = cap > 0 && (mine.length >= cap || waiting.length > 0);
  if (waitlisted) {
    data.Waitlist.push({ tournamentId: id, playerId: player.id, name: player.name, pin: pin, at: new Date().toISOString() });
    data.Log.push(logRow(id, player.name + ' joined the waitlist'));
  } else {
    var seed = mine.reduce(function (m, e) {
      return Math.max(m, num(e.seed));
    }, 0);
    data.Entrants.push({ tournamentId: id, seed: seed + 1, playerId: player.id, name: player.name, pin: pin });
    data.Log.push(logRow(id, player.name + ' signed up'));
  }
  bump(t);
  writeTable('Players', data.Players);
  writeTable('Tournaments', data.Tournaments);
  if (waitlisted) writeTable('Waitlist', data.Waitlist);
  else writeTable('Entrants', data.Entrants);
  writeTable('Log', data.Log);
  return { playerId: player.id, pin: pin, waitlisted: waitlisted, tournament: assemble(t, data) };
}

/** The entrant (or, with `waitlistToo`, waitlisted person) with this PIN, or null. */
function byPin(id, rawPin, data, waitlistToo) {
  var pin = String(rawPin || '').trim();
  if (!/^\d{6}$/.test(pin)) return null;
  var rows = data.Entrants.filter(function (e) {
    return e.tournamentId === id;
  });
  if (waitlistToo) rows = rows.concat(waitlistOf(id, data));
  return (
    rows.filter(function (e) {
      return String(e.pin) === pin;
    })[0] || null
  );
}

/**
 * "I'm here": a player (with their PIN) or the organizer (by player id) marks someone as
 * arrived, or not, before the first result. It doesn't change the bracket, so the version
 * stays the same (an organizer busy editing isn't interrupted); only updatedAt moves.
 */
function checkIn(body, isAdmin) {
  var data = loadTables();
  var t = findTournament(data.Tournaments, body.id);
  if (!t) throw new Error('Tournament not found');
  var organizer = isAdmin || isOrganizer(body, t);
  var started = data.Results.some(function (r) {
    return r.tournamentId === body.id;
  });
  if (started) throw new Error('This tournament has already started');
  var who;
  if (body.pin) {
    if (!truthy(t.checkIn) && !organizer) throw new Error("Check-in isn't open for this tournament");
    who = byPin(body.id, body.pin, data, true);
    if (!who) throw new Error('Wrong PIN');
  } else {
    if (!organizer) throw new Error(NOT_ORGANIZER);
    who = data.Entrants.concat(data.Waitlist).filter(function (e) {
      return e.tournamentId === body.id && e.playerId === body.playerId;
    })[0];
    if (!who) throw new Error('That player is not in this tournament');
  }
  who.checkedIn = body.here === false ? '' : new Date().toISOString();
  t.updatedAt = new Date().toISOString();
  writeTable('Tournaments', data.Tournaments);
  writeTable('Entrants', data.Entrants);
  writeTable('Waitlist', data.Waitlist);
  return { playerId: who.playerId, tournament: assemble(t, data) };
}

/** A tournament's entrants in seed order (seed k = position k, as the bracket engine counts). */
function seedOrder(id, data) {
  return data.Entrants.filter(function (e) {
    return e.tournamentId === id;
  }).sort(function (a, b) {
    return num(a.seed) - num(b.seed);
  });
}

/** Seeds (1-based) of players who dropped out, from the options column. */
function droppedSeeds(t) {
  var d = json(t.options, {}).dropped;
  return Array.isArray(d) ? d : [];
}

/**
 * A player drops out with their PIN, once the tournament has started. They keep their results;
 * the app stops pairing them (options.dropped, by seed) and their remaining matches are walkovers.
 * Logged with the previous setup, so the organizer can undo it from the Log tab.
 */
function dropOut(id, rawPin) {
  var data = loadTables();
  var t = findTournament(data.Tournaments, id);
  if (!t) throw new Error('Tournament not found');
  var me = byPin(id, rawPin, data, false);
  if (!me) throw new Error('Wrong PIN');
  var started = data.Results.some(function (r) {
    return r.tournamentId === id;
  });
  if (!started) throw new Error("The tournament hasn't started yet: ask the organizer to take you off the list");
  var seed = seedOrder(id, data).indexOf(me) + 1;
  var dropped = droppedSeeds(t).slice();
  if (dropped.indexOf(seed) >= 0) throw new Error('You have already dropped out');

  var before = assemble(t, data);
  var restore = JSON.stringify({
    name: before.name, game: before.game, format: before.format, options: before.options,
    scoring: before.scoring, entrants: before.entrants, results: before.results,
  });
  dropped.push(seed);
  dropped.sort(function (a, b) {
    return a - b;
  });
  var options = json(t.options, {});
  options.dropped = dropped;
  t.options = JSON.stringify(options);
  var row = logRow(id, me.name + ' dropped out');
  row.restore = restore.length > CELL_LIMIT ? '' : restore;
  data.Log.push(row);
  bump(t);
  writeTable('Tournaments', data.Tournaments);
  writeTable('Log', data.Log);
  return { playerId: me.playerId, tournament: assemble(t, data) };
}

/** A tournament's waitlist, oldest first. */
function waitlistOf(id, data) {
  return (data.Waitlist || [])
    .map(function (w, i) {
      return { w: w, i: i };
    })
    .filter(function (x) {
      return x.w.tournamentId === id;
    })
    .sort(function (a, b) {
      return String(a.w.at).localeCompare(String(b.w.at)) || a.i - b.i;
    })
    .map(function (x) {
      return x.w;
    });
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
  var order = seedOrder(id, data);
  var out = droppedSeeds(t);
  [result.p1, result.p2].forEach(function (pid) {
    if (out.indexOf(order.indexOf(byId[pid]) + 1) >= 0) throw new Error(byId[pid].name + ' has dropped out of this tournament');
  });
  // Draws only in points stages, never in a knockout (incl. finals, whose ids start with "F-").
  var draws = ['round_robin', 'swiss', 'groups'].indexOf(t.format) >= 0 && String(matchId).indexOf('F-') !== 0;
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
  // the opponent confirms or disputes it (see confirmResult)
  clean.status = 'reported';
  clean.reportedBy = me.playerId;
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
    status: clean.status,
    reportedBy: clean.reportedBy,
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

/**
 * The opponent of whoever reported a result confirms it (ok) or disputes it, with their PIN.
 * Disputed results are flagged for the organizer, who settles them by saving the right result.
 */
function confirmResult(id, matchId, rawPin, ok, matchNo) {
  var data = loadTables();
  var t = findTournament(data.Tournaments, id);
  if (!t) throw new Error('Tournament not found');
  var me = byPin(id, rawPin, data, false);
  if (!me) throw new Error('Wrong PIN');
  var row = data.Results.filter(function (r) {
    return r.tournamentId === id && r.matchId === matchId;
  })[0];
  if (!row) throw new Error('This match has no result to confirm');
  if (row.p1Id !== me.playerId && row.p2Id !== me.playerId) throw new Error('You can only confirm your own matches');
  if (row.status !== 'reported') {
    throw new Error(row.status === 'disputed' ? 'This result is disputed: the organizer will settle it' : 'This result is already settled');
  }
  if (row.reportedBy === me.playerId) throw new Error('Your opponent has to confirm the result you reported');

  var before = toResult(row);
  row.status = ok ? 'confirmed' : 'disputed';
  var label = Number(matchNo) > 0 ? 'Match ' + Math.round(Number(matchNo)) + ': ' : '';
  var summary = label + me.name + (ok ? ' confirmed the result' : ' disputed the result: the organizer needs to settle it');
  data.Log.push(logRow(id, summary, [{ matchId: matchId, before: before, after: toResult(row) }]));
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
  waitlistOf(id, data).forEach(function (w) {
    if (w.pin) out[w.playerId] = w.pin;
  });
  if (changed) writeTable('Entrants', data.Entrants);
  return out;
}

// ------------------------------------------------------------------ accounts

/*
 * An account is a username + password linked to one player (Players tab). It doesn't add new
 * rights: logging in hands the device that player's PINs and the organizer keys of tournaments
 * the account made (or opened with a helper link while logged in), and the app uses those as
 * before. Tokens are "accountId.signature": no session table, and changing the password (new
 * salt) logs out every other device.
 */

var LOGGED_OUT = 'Your login has expired. Please log in again.';
var MAX_FAILS = 5; // wrong passwords in a row before the account is locked for a while
var LOCK_MINUTES = 10;

function accountSecret() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('ACCOUNT_SECRET');
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('ACCOUNT_SECRET', secret);
  }
  return secret;
}

function hmac(value) {
  var bytes = Utilities.computeHmacSha256Signature(value, accountSecret(), Utilities.Charset.UTF_8);
  return bytes
    .map(function (b) {
      var h = (b < 0 ? b + 256 : b).toString(16);
      return h.length === 1 ? '0' + h : h;
    })
    .join('');
}

function passwordHash(salt, password) {
  return hmac('password:' + salt + ':' + password);
}

function tokenFor(a) {
  return a.id + '.' + hmac('session:' + a.id + ':' + a.salt).slice(0, 40);
}

/** The Accounts row this token belongs to, or null. */
function accountFromToken(token, data) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  var a = findById(data.Accounts, parts[0]);
  return a && tokenFor(a) === String(token) ? a : null;
}

function findById(rows, id) {
  return (
    rows.filter(function (r) {
      return r.id === id;
    })[0] || null
  );
}

function accountOf(playerId, data) {
  return (
    data.Accounts.filter(function (a) {
      return a.playerId === playerId;
    })[0] || null
  );
}

function cleanUsername(raw) {
  var u = String(raw || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,24}$/.test(u)) {
    throw new Error('Usernames are 3 to 24 letters, numbers, dots, dashes or underscores');
  }
  return u;
}

function checkPassword(p) {
  p = String(p || '');
  if (p.length < 6) throw new Error('Use at least 6 characters for the password');
  if (p.length > 100) throw new Error('That password is too long');
  return p;
}

function newSalt() {
  return Utilities.getUuid().replace(/-/g, '');
}

/** What the app may know about an account (never the hash or salt). */
function accountInfo(a, data) {
  var p = findById(data.Players, a.playerId);
  return { id: a.id, username: a.username, playerId: a.playerId, name: p ? p.name : a.username };
}

/** The player this PIN belongs to in a tournament (by id or join code), or null. */
function playerByPin(claim, data) {
  if (!claim || !claim.pin) return null;
  var t = claim.id
    ? findTournament(data.Tournaments, claim.id)
    : data.Tournaments.filter(function (r) {
        return cleanCode(r.code) === cleanCode(claim.code) && !!cleanCode(claim.code);
      })[0];
  if (!t) return null;
  var row = byPin(t.id, claim.pin, data, true);
  return row ? row.playerId : null;
}

/**
 * Create an account. The display name becomes a player. If a player with that name already
 * played here, the account takes them over only with proof: a PIN they had in one of their
 * tournaments (sent by the app from this device, or typed with that tournament's join code).
 */
function register(body) {
  var data = loadTables();
  var username = cleanUsername(body.username);
  var password = checkPassword(body.password);
  var name = cleanName(body.name);
  var taken = data.Accounts.some(function (a) {
    return String(a.username).toLowerCase() === username;
  });
  if (taken) throw new Error('The username ' + username + ' is taken');

  var lower = name.toLowerCase();
  var sameName = data.Players.filter(function (p) {
    return String(p.name).trim().toLowerCase() === lower;
  })[0];
  var proven = {};
  (Array.isArray(body.claims) ? body.claims : []).slice(0, 200).forEach(function (c) {
    var pid = playerByPin(c, data);
    if (pid) proven[pid] = true;
  });
  var player = null;
  if (body.claim && body.claim.pin) {
    // "I played here before": link the player behind this join code + PIN
    var pid = playerByPin(body.claim, data);
    if (!pid) throw new Error('That join code and PIN don\'t match anyone');
    player = findById(data.Players, pid);
    if (!player) throw new Error('That join code and PIN don\'t match anyone');
    if (sameName && sameName.id !== player.id) throw new Error('Another player is already called ' + name + '. Pick a different name.');
  } else if (sameName) {
    if (!proven[sameName.id]) {
      throw new Error(
        'A player called ' + name + ' has played here before. If that\'s you, add the join code and your PIN ' +
          'from one of their tournaments. If not, pick a different name.',
      );
    }
    player = sameName;
  }
  if (player && accountOf(player.id, data)) throw new Error(player.name + ' already has an account. Log in instead.');

  var renamed = false;
  if (!player) {
    player = { id: newId(), name: name };
    data.Players.push(player);
    writeTable('Players', data.Players);
  } else if (player.name !== name) {
    renamed = true;
  }
  var salt = newSalt();
  var a = {
    id: newId(),
    username: username,
    playerId: player.id,
    passHash: passwordHash(salt, password),
    salt: salt,
    createdAt: new Date().toISOString(),
    orgKeys: '',
    fails: '',
    lockedUntil: '',
  };
  data.Accounts.push(a);
  writeTable('Accounts', data.Accounts);
  if (renamed) renamePlayer(player.id, name);
  return { token: tokenFor(a), account: accountInfo(a, loadTables()) };
}

function logIn(rawUsername, password) {
  var data = loadTables();
  var username = String(rawUsername || '').trim().toLowerCase();
  var a = data.Accounts.filter(function (r) {
    return String(r.username).toLowerCase() === username;
  })[0];
  if (!a) throw new Error('Wrong username or password');
  var now = Date.now();
  if (a.lockedUntil && new Date(a.lockedUntil).getTime() > now) {
    var mins = Math.ceil((new Date(a.lockedUntil).getTime() - now) / 60000);
    throw new Error('Too many wrong passwords. Try again in ' + mins + ' minute' + (mins === 1 ? '' : 's') + '.');
  }
  if (passwordHash(a.salt, String(password || '')) !== a.passHash) {
    var fails = num(a.fails) + 1;
    a.fails = fails >= MAX_FAILS ? '' : fails;
    a.lockedUntil = fails >= MAX_FAILS ? new Date(now + LOCK_MINUTES * 60000).toISOString() : '';
    writeTable('Accounts', data.Accounts);
    throw new Error('Wrong username or password');
  }
  if (a.fails || a.lockedUntil) {
    a.fails = '';
    a.lockedUntil = '';
    writeTable('Accounts', data.Accounts);
  }
  return { token: tokenFor(a), account: accountInfo(a, data) };
}

/**
 * Everything a logged-in device needs: the account, this player's PINs (by tournament) and the
 * account's organizer keys. Organizer keys the device already has (`orgKeys`, checked against
 * each tournament's hash) are added to the account, so other devices get them too.
 */
function aboutMe(token, deviceKeys) {
  var data = loadTables();
  var a = accountFromToken(token, data);
  if (!a) throw new Error(LOGGED_OUT);
  var keys = json(a.orgKeys, {});
  var before = JSON.stringify(keys);
  Object.keys(deviceKeys || {})
    .slice(0, 500)
    .forEach(function (id) {
      var t = findTournament(data.Tournaments, id);
      if (t && t.orgKeyHash && sha256(String(deviceKeys[id])) === t.orgKeyHash) keys[id] = String(deviceKeys[id]);
    });
  // forget keys of deleted tournaments, and keys that no longer match (organizer key changed by hand)
  Object.keys(keys).forEach(function (id) {
    var t = findTournament(data.Tournaments, id);
    if (!t || sha256(keys[id]) !== t.orgKeyHash) delete keys[id];
  });
  var after = JSON.stringify(keys);
  if (after !== before && after.length <= CELL_LIMIT) {
    a.orgKeys = after;
    writeTable('Accounts', data.Accounts);
  }
  var pins = {};
  data.Entrants.concat(data.Waitlist).forEach(function (e) {
    if (e.playerId === a.playerId && e.pin) pins[e.tournamentId] = { playerId: e.playerId, pin: String(e.pin) };
  });
  return { account: accountInfo(a, data), pins: pins, orgKeys: keys };
}

function changePassword(token, oldPassword, newPassword) {
  var data = loadTables();
  var a = accountFromToken(token, data);
  if (!a) throw new Error(LOGGED_OUT);
  if (passwordHash(a.salt, String(oldPassword || '')) !== a.passHash) throw new Error('Your current password is wrong');
  var p = checkPassword(newPassword);
  a.salt = newSalt(); // also logs out every other device
  a.passHash = passwordHash(a.salt, p);
  writeTable('Accounts', data.Accounts);
  return { token: tokenFor(a), account: accountInfo(a, data) };
}

/** Change your own display name (renames the player everywhere, like the admin's Rename). */
function renameSelf(token, rawName) {
  var data = loadTables();
  var a = accountFromToken(token, data);
  if (!a) throw new Error(LOGGED_OUT);
  var name = cleanName(rawName);
  var lower = name.toLowerCase();
  var clash = data.Players.some(function (p) {
    return p.id !== a.playerId && String(p.name).trim().toLowerCase() === lower;
  });
  if (clash) throw new Error('Another player is already called ' + name);
  renamePlayer(a.playerId, name);
  return { account: accountInfo(a, loadTables()) };
}

/** Site admin: give an account a new random password (people have no email here to reset it). */
function resetPassword(playerId) {
  var data = loadTables();
  var a = accountOf(playerId, data);
  if (!a) throw new Error('That player has no account');
  var password = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  a.salt = newSalt();
  a.passHash = passwordHash(a.salt, password);
  a.fails = '';
  a.lockedUntil = '';
  writeTable('Accounts', data.Accounts);
  return { username: a.username, password: password };
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
