function dbAll(db, query, params = []) {
  const stmt = db.prepare(query);
  if (params.length) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function dbGet(db, query, params = []) {
  const stmt = db.prepare(query);
  if (params.length) stmt.bind(params);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

function dbRun(db, query, params = []) {
  db.run(query, params);
}

function dbExec(db, query) {
  return db.exec(query);
}

module.exports = { dbAll, dbGet, dbRun, dbExec };
