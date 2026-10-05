const projectColumns = {
  id: 'TEXT PRIMARY KEY',
  topic: 'TEXT NOT NULL',
  slug: 'TEXT NOT NULL',
  folder_number: 'INTEGER NOT NULL',
  folder: 'TEXT NOT NULL',
  number_generation: 'INTEGER NOT NULL DEFAULT 0',
  status: 'TEXT NOT NULL',
  binding_identity: 'TEXT NOT NULL',
  repository_full_name: 'TEXT NOT NULL',
  base_branch: 'TEXT NOT NULL',
  jules_session_name: 'TEXT',
  jules_session_url: 'TEXT',
  pr_url: 'TEXT',
  pr_status: 'TEXT',
  error: 'TEXT',
  created_at: 'TEXT NOT NULL',
  updated_at: 'TEXT NOT NULL',
  prompt_text: 'TEXT',
  jules_state: 'TEXT',
  jules_polled_at: 'TEXT',
  activity_error: 'TEXT',
  orchestrator_instructions: 'TEXT'
};

const createProjects = (table, ifNotExists = false) => `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${table} (
  ${Object.entries(projectColumns).map(([name, type]) => `${name} ${type}`).join(',\n  ')},
  UNIQUE(number_generation,folder_number), UNIQUE(number_generation,folder)
);`;

export function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function initializeStoreSchema(db) {
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS prompt_presets (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, template TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS binding (
      id TEXT PRIMARY KEY, github_owner TEXT NOT NULL, github_repo TEXT NOT NULL,
      github_full_name TEXT NOT NULL, github_repository_id TEXT NOT NULL,
      base_branch TEXT NOT NULL, jules_source_id TEXT NOT NULL,
      verified_jules_access INTEGER NOT NULL, verified_github_access INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS remote_folders (name TEXT PRIMARY KEY, number INTEGER NOT NULL);
    ${createProjects('projects', true)}
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

  const existing = new Set(db.prepare('PRAGMA table_info(projects)').all().map(column => column.name));
  const additions = ['binding_identity', 'repository_full_name', 'base_branch', 'pr_status', 'prompt_text', 'jules_state', 'jules_polled_at', 'activity_error', 'orchestrator_instructions'].filter(name => !existing.has(name));
  if (!additions.length && existing.has('number_generation')) return;
  transaction(db, () => {
    for (const name of additions) {
      const type = projectColumns[name];
      db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${type}${type.includes('NOT NULL') ? " DEFAULT ''" : ''}`);
    }
    if (!existing.has('number_generation')) {
      // Rebuild old unique constraints while carrying every supported project field forward.
      const fields = Object.keys(projectColumns).filter(name => name !== 'number_generation').join(',');
      db.exec(`
        ${createProjects('projects_next')}
        INSERT INTO projects_next (${fields}) SELECT ${fields} FROM projects;
        DROP TABLE projects;
        ALTER TABLE projects_next RENAME TO projects;
      `);
    }
  });
}
