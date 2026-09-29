import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';
import { join } from 'node:path';

export function openStore(directory = '.data') {
  mkdirSync(directory, { recursive: true });
  const secretPath = join(directory, 'secret.key');
  let key;
  try { key = readFileSync(secretPath); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    key = randomBytes(32);
    writeFileSync(secretPath, key, { flag: 'wx', mode: 0o600 });
  }
  if (key.length !== 32) throw new Error('Local encryption key is invalid. Restore the original .data/secret.key.');
  const db = new DatabaseSync(join(directory, 'researchforge.sqlite'));
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS binding (
      id TEXT PRIMARY KEY, github_owner TEXT NOT NULL, github_repo TEXT NOT NULL,
      github_full_name TEXT NOT NULL, github_repository_id TEXT NOT NULL,
      base_branch TEXT NOT NULL, jules_source_id TEXT NOT NULL,
      verified_jules_access INTEGER NOT NULL, verified_github_access INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS remote_folders (name TEXT PRIMARY KEY, number INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, topic TEXT NOT NULL, slug TEXT NOT NULL,
      folder_number INTEGER NOT NULL UNIQUE, folder TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL, binding_identity TEXT NOT NULL, repository_full_name TEXT NOT NULL,
      base_branch TEXT NOT NULL, jules_session_name TEXT, jules_session_url TEXT,
      pr_url TEXT, pr_status TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT,
      kind TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jules_activities (
      name TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      kind TEXT NOT NULL, originator TEXT NOT NULL,
      summary TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jules_activities_project_time ON jules_activities(project_id,created_at);
    CREATE TABLE IF NOT EXISTS jules_auto_replies (
      activity_name TEXT PRIMARY KEY, project_id TEXT NOT NULL,
      status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jules_auto_replies_project_time ON jules_auto_replies(project_id,created_at);
  `);
  const projectColumns = new Set(db.prepare('PRAGMA table_info(projects)').all().map(column => column.name));
  if (!projectColumns.has('binding_identity')) db.exec("ALTER TABLE projects ADD COLUMN binding_identity TEXT NOT NULL DEFAULT ''");
  if (!projectColumns.has('repository_full_name')) db.exec("ALTER TABLE projects ADD COLUMN repository_full_name TEXT NOT NULL DEFAULT ''");
  if (!projectColumns.has('base_branch')) db.exec("ALTER TABLE projects ADD COLUMN base_branch TEXT NOT NULL DEFAULT ''");
  if (!projectColumns.has('pr_status')) db.exec('ALTER TABLE projects ADD COLUMN pr_status TEXT');
  if (!projectColumns.has('prompt_text')) db.exec('ALTER TABLE projects ADD COLUMN prompt_text TEXT');
  if (!projectColumns.has('jules_state')) db.exec('ALTER TABLE projects ADD COLUMN jules_state TEXT');
  if (!projectColumns.has('jules_polled_at')) db.exec('ALTER TABLE projects ADD COLUMN jules_polled_at TEXT');
  if (!projectColumns.has('activity_error')) db.exec('ALTER TABLE projects ADD COLUMN activity_error TEXT');

  const set = (name, value) => db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(name, String(value));
  const get = name => db.prepare('SELECT value FROM settings WHERE key=?').get(name)?.value;
  const encrypt = plaintext => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
  };
  const decrypt = ciphertext => {
    const bytes = Buffer.from(ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  };
  const setSecret = (name, value) => set(`secret:${name}`, encrypt(value));
  const getSecret = name => {
    const value = get(`secret:${name}`);
    return value ? decrypt(value) : undefined;
  };
  const binding = () => db.prepare('SELECT * FROM binding LIMIT 1').get();
  const saveBinding = value => {
    const now = new Date().toISOString();
    const existing = binding();
    db.prepare(`INSERT INTO binding(id,github_owner,github_repo,github_full_name,github_repository_id,base_branch,jules_source_id,verified_jules_access,verified_github_access,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET github_owner=excluded.github_owner,github_repo=excluded.github_repo,
      github_full_name=excluded.github_full_name,github_repository_id=excluded.github_repository_id,base_branch=excluded.base_branch,
      jules_source_id=excluded.jules_source_id,verified_jules_access=excluded.verified_jules_access,
      verified_github_access=excluded.verified_github_access,updated_at=excluded.updated_at`).run(
      existing?.id ?? randomUUID(), value.owner, value.repo, value.fullName, String(value.githubId), value.branch,
      value.sourceName, 1, 1, existing?.created_at ?? now, now);
  };
  const log = (kind, message, projectId = null) => db.prepare('INSERT INTO events(project_id,kind,message,created_at) VALUES (?,?,?,?)').run(projectId, kind, message, new Date().toISOString());
  const projects = () => db.prepare('SELECT * FROM projects ORDER BY folder_number DESC').all();
  const project = id => db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  const activities = projectId => db.prepare('SELECT * FROM jules_activities WHERE project_id=? ORDER BY created_at DESC,name DESC').all(projectId);
  const latestActivity = projectId => db.prepare('SELECT * FROM jules_activities WHERE project_id=? ORDER BY created_at DESC,name DESC LIMIT 1').get(projectId);
  const autoReplies = projectId => db.prepare('SELECT * FROM jules_auto_replies WHERE project_id=? ORDER BY created_at DESC LIMIT 5').all(projectId);
  const remoteFolders = () => db.prepare('SELECT * FROM remote_folders ORDER BY number,name').all();
  const replaceRemoteFolders = folders => {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM remote_folders').run();
      const insert = db.prepare('INSERT INTO remote_folders(name,number) VALUES (?,?)');
      for (const folder of folders) insert.run(folder.name, folder.number);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const reserve = topics => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const maxRemote = db.prepare('SELECT COALESCE(MAX(number),0) AS n FROM remote_folders').get().n;
      const maxLocal = db.prepare('SELECT COALESCE(MAX(folder_number),0) AS n FROM projects').get().n;
      let next = Math.max(maxRemote, maxLocal) + 1;
      const insert = db.prepare('INSERT INTO projects(id,topic,slug,folder_number,folder,status,binding_identity,repository_full_name,base_branch,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      const currentBinding = binding();
      if (!currentBinding) throw new Error('No repository binding');
      const identity = `${currentBinding.github_repository_id}|${currentBinding.jules_source_id}|${currentBinding.base_branch}`;
      const result = [];
      for (const topic of topics) {
        const slug = topic.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'Research-Project';
        const id = randomUUID(), number = next++, folder = `${number}-${slug}`;
        const now = new Date().toISOString();
        insert.run(id, topic, slug, number, folder, 'reserved', identity, currentBinding.github_full_name, currentBinding.base_branch, now, now);
        result.push(project(id));
      }
      db.exec('COMMIT');
      return result;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const removeReservation = id => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const reserved = project(id);
      if (!reserved || reserved.status !== 'reserved' || reserved.jules_session_name) throw new Error('Only unlaunched reservations can be removed.');
      const removed = db.prepare("DELETE FROM projects WHERE id=? AND status='reserved' AND jules_session_name IS NULL").run(id);
      if (removed.changes !== 1) throw new Error('The reservation changed. Refresh and try again.');
      db.prepare('DELETE FROM events WHERE project_id=?').run(id);
      db.prepare('DELETE FROM jules_activities WHERE project_id=?').run(id);
      db.prepare('DELETE FROM jules_auto_replies WHERE project_id=?').run(id);
      log('reservation_removed', `Removed reservation ${reserved.folder}`);
      db.exec('COMMIT');
      return reserved;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  return { db, set, get, setSecret, getSecret, binding, saveBinding, log, projects, project, activities, latestActivity, autoReplies, remoteFolders, replaceRemoteFolders, reserve, removeReservation };
}
