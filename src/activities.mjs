const clipped = (value, limit = 10000) => String(value ?? '').slice(0, limit);

export function summarizeActivity(activity) {
  const plan = activity.planGenerated?.plan;
  const progress = activity.progressUpdated;
  const message = activity.agentMessaged?.agentMessage ?? activity.userMessaged?.userMessage;
  const bash = activity.artifacts?.find(item => item.bashOutput)?.bashOutput;
  const change = activity.artifacts?.find(item => item.changeSet)?.changeSet?.gitPatch;
  let kind = 'update', summary = activity.description || 'Activity', detail = '';
  if (plan) {
    kind = 'plan'; summary = 'Plan generated';
    detail = (plan.steps ?? []).map((step, index) => `${(Number.isInteger(step.index) ? step.index : index) + 1}. ${step.title}${step.description ? ` — ${step.description}` : ''}`).join('\n');
  } else if (progress) {
    kind = 'progress'; summary = progress.title || 'Progress update'; detail = progress.description || '';
  } else if (activity.agentMessaged) {
    kind = 'message'; summary = 'Jules message'; detail = message || '';
  } else if (activity.userMessaged) {
    kind = 'message'; summary = 'User message'; detail = message || '';
  } else if (activity.sessionFailed) {
    kind = 'failed'; summary = 'Session failed'; detail = activity.sessionFailed.reason || '';
  } else if (activity.sessionCompleted) {
    kind = 'completed'; summary = 'Session completed';
  } else if (activity.planApproved) {
    kind = 'plan'; summary = 'Plan approved';
  } else if (bash) {
    kind = 'command'; summary = bash.command ? `Command: ${bash.command}` : 'Command output'; detail = bash.output || '';
  } else if (change) {
    kind = 'change'; summary = change.suggestedCommitMessage || 'Code changes'; detail = change.unidiffPatch || '';
  }
  return {
    name: activity.name,
    kind,
    originator: activity.originator || 'system',
    summary: clipped(summary, 500),
    detail: clipped(detail),
    createdAt: activity.createTime || new Date().toISOString()
  };
}

export function saveActivities(store, projectId, sessionName, activities) {
  const insert = store.db.prepare('INSERT OR IGNORE INTO jules_activities(name,project_id,kind,originator,summary,detail,created_at) VALUES (?,?,?,?,?,?,?)');
  const prefix = `${sessionName}/activities/`;
  for (const activity of activities) {
    if (typeof activity.name !== 'string' || !activity.name.startsWith(prefix) || !activity.name.slice(prefix.length) || activity.name.slice(prefix.length).includes('/')) continue;
    const item = summarizeActivity(activity);
    insert.run(item.name, projectId, item.kind, item.originator, item.summary, item.detail, item.createdAt);
  }
}
