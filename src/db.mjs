import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { initializeStoreSchema, transaction } from './store-schema.mjs';
import { bindingIdentity } from './core.mjs';

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
  try { initializeStoreSchema(db); }
  catch (error) { db.close(); throw error; }

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
  const projects = () => db.prepare('SELECT * FROM projects ORDER BY number_generation DESC,folder_number DESC').all();
  const project = id => db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  const activities = projectId => db.prepare('SELECT * FROM jules_activities WHERE project_id=? ORDER BY created_at DESC,name DESC').all(projectId);
  const latestActivity = projectId => db.prepare('SELECT * FROM jules_activities WHERE project_id=? ORDER BY created_at DESC,name DESC LIMIT 1').get(projectId);
  const autoReplies = projectId => db.prepare('SELECT * FROM jules_auto_replies WHERE project_id=? ORDER BY created_at DESC LIMIT 5').all(projectId);
  const remoteFolders = () => db.prepare('SELECT * FROM remote_folders ORDER BY number,name').all();
  const currentGeneration = () => Number(get('project_number_generation') ?? 0);
  const nextProjectNumber = () => {
    const manual = get('next_project_number');
    if (manual !== undefined) {
      const occupied = new Set([
        ...db.prepare('SELECT number FROM remote_folders').all().map(item => item.number),
        ...db.prepare('SELECT folder_number FROM projects WHERE number_generation=?').all(currentGeneration()).map(item => item.folder_number)
      ]);
      let next = Number(manual);
      while (occupied.has(next)) next++;
      return next;
    }
    return Math.max(
      Number(get('last_project_number') ?? 0),
      db.prepare('SELECT COALESCE(MAX(number),0) AS n FROM remote_folders').get().n,
      db.prepare('SELECT COALESCE(MAX(folder_number),0) AS n FROM projects').get().n
    ) + 1;
  };
  const setNextProjectNumber = value => {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > 1000000) throw new Error('Enter a next project number from 1 to 1,000,000.');
    return transaction(db, () => {
      const pending = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE status IN ('reserved','queued','launching','running')").get().n;
      if (pending) throw new Error('Clear reserved projects and finish or stop active tasks before changing the project number.');
      set('project_number_generation', currentGeneration() + 1);
      set('next_project_number', number);
      log('project_number_changed', `Started a new numbering series at ${number}`);
      return nextProjectNumber();
    });
  };
  const replaceRemoteFolders = folders => {
    return transaction(db, () => {
      db.prepare('DELETE FROM remote_folders').run();
      const insert = db.prepare('INSERT INTO remote_folders(name,number) VALUES (?,?)');
      for (const folder of folders) insert.run(folder.name, folder.number);
    });
  };
  const reserve = (topics, instructions = null) => {
    return transaction(db, () => {
      let next = nextProjectNumber();
      const generation = currentGeneration();
      const occupied = new Set(db.prepare('SELECT number FROM remote_folders').all().map(item => item.number));
      const insert = db.prepare('INSERT INTO projects(id,topic,slug,folder_number,folder,number_generation,status,binding_identity,repository_full_name,base_branch,created_at,updated_at,orchestrator_instructions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
      const currentBinding = binding();
      if (!currentBinding) throw new Error('No repository binding');
      const identity = bindingIdentity(currentBinding);
      const result = [];
      for (const topic of topics) {
        while (occupied.has(next)) next++;
        const slug = topic.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'Research-Project';
        const id = randomUUID(), number = next++, folder = `${number}-${slug}`;
        const now = new Date().toISOString();
        insert.run(id, topic, slug, number, folder, generation, 'reserved', identity, currentBinding.github_full_name, currentBinding.base_branch, now, now, instructions);
        occupied.add(number);
        result.push(project(id));
      }
      if (get('next_project_number') !== undefined) set('next_project_number', next);
      return result;
    });
  };
  const removeReservation = id => {
    return transaction(db, () => {
      const reserved = project(id);
      if (!reserved || reserved.status !== 'reserved' || reserved.jules_session_name) throw new Error('Only unlaunched reservations can be removed.');
      const removed = db.prepare("DELETE FROM projects WHERE id=? AND status='reserved' AND jules_session_name IS NULL").run(id);
      if (removed.changes !== 1) throw new Error('The reservation changed. Refresh and try again.');
      db.prepare('DELETE FROM events WHERE project_id=?').run(id);
      db.prepare('DELETE FROM jules_activities WHERE project_id=?').run(id);
      db.prepare('DELETE FROM jules_auto_replies WHERE project_id=?').run(id);
      log('reservation_removed', `Removed reservation ${reserved.folder}`);
      return reserved;
    });
  };
  const clearProjects = category => {
    const statuses = {
      finished: ['pr_validated', 'completed', 'completed_no_pr'],
      reserved: ['reserved'],
      failed: ['failed', 'blocked', 'pr_rejected'],
      stopped: ['stopped']
    }[category];
    if (!statuses) throw new Error('Choose a valid project category to clear.');
    return transaction(db, () => {
      const marks = statuses.map(() => '?').join(',');
      const condition = `status IN (${marks})${category === 'reserved' ? ' AND jules_session_name IS NULL' : ''}`;
      const selected = db.prepare(`SELECT id,folder_number FROM projects WHERE ${condition}`).all(...statuses);
      if (selected.length) {
        if (get('next_project_number') === undefined) {
          const highest = Math.max(Number(get('last_project_number') ?? 0), ...selected.map(item => item.folder_number));
          set('last_project_number', highest);
        }
        const removeRelated = ['events', 'jules_activities', 'jules_auto_replies'].map(table => db.prepare(`DELETE FROM ${table} WHERE project_id=?`));
        if (db.prepare("SELECT name FROM sqlite_master WHERE name='agent_packets'").get()) removeRelated.push(db.prepare('DELETE FROM agent_packets WHERE project_id=?'));
        const removeProject = db.prepare('DELETE FROM projects WHERE id=?');
        for (const item of selected) {
          for (const remove of removeRelated) remove.run(item.id);
          removeProject.run(item.id);
        }
        log('projects_cleared', `Cleared ${selected.length} ${category} local project${selected.length === 1 ? '' : 's'}`);
      }
      return selected.length;
    });
  };
  return { db, set, get, setSecret, getSecret, binding, saveBinding, log, projects, project, activities, latestActivity, autoReplies, remoteFolders, nextProjectNumber, setNextProjectNumber, replaceRemoteFolders, reserve, removeReservation, clearProjects };
}
