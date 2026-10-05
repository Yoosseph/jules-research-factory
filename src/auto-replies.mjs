import { draftJulesReply } from './orchestrator.mjs';
import { recordPacket } from './flow.mjs';

const autonomousReply = 'Please continue without waiting for me. Make the reasonable choice that best satisfies the original research prompt and stays inside the assigned project folder. If a source, tool, or approach is unavailable, choose a viable alternative. Document the decision and its limits in the report, complete the requested deliverables, and create the pull request.';
const dateNow = () => new Date().toISOString();

export function createAutoReplies(store, { continuous, orchestratorSettings, modelClient }) {
  function claimReply(activityName, projectId) {
    const now = dateNow();
    return store.db.prepare("INSERT OR IGNORE INTO jules_auto_replies(activity_name,project_id,status,created_at,updated_at) VALUES (?,?,'sending',?,?)")
      .run(activityName, projectId, now, now).changes === 1;
  }

  async function autoReplyToFeedback(project, jules, activities) {
    if (store.get('autoReply') === '0' && !continuous()) return;
    const prefix = `${project.jules_session_name}/activities/`;
    const messages = activities.filter(item => typeof item.name === 'string' && item.name.startsWith(prefix) && !item.name.slice(prefix.length).includes('/') && (item.agentMessaged?.agentMessage || item.userMessaged?.userMessage))
      .sort((a, b) => String(a.createTime ?? '').localeCompare(String(b.createTime ?? '')) || a.name.localeCompare(b.name));
    const question = messages.findLast(item => item.agentMessaged?.agentMessage);
    if (!question || messages.at(-1) !== question) return;
    const count = store.db.prepare("SELECT COUNT(*) AS n FROM jules_auto_replies WHERE project_id=? AND status IN ('sending','sent') AND activity_name IN (SELECT name FROM jules_activities WHERE project_id=? AND kind='message' AND originator='agent')").get(project.id, project.id).n;
    if (count >= 3 && !continuous()) return;
    if (store.autoReplies(project.id).some(reply => reply.activity_name === question.name)) return;
    let reply = autonomousReply;
    let replyFrom = 'coordinator';
    const orchestrator = orchestratorSettings();
    if (orchestrator.brief && store.getSecret('orchestrator')) {
      try {
        reply = await draftJulesReply(modelClient(project.id), { brief: orchestrator.brief, topic: project.topic, instructions: project.orchestrator_instructions, question: question.agentMessaged.agentMessage });
        replyFrom = 'model';
      } catch (error) { store.log('orchestrator_reply_error', error.message, project.id); }
    }
    if (!claimReply(question.name, project.id)) return;
    try {
      recordPacket(store, { projectId: project.id, from: replyFrom, to: 'jules', kind: 'reply', title: 'Sending an automatic reply', content: reply });
      await jules.sendMessage(project.jules_session_name, reply);
      store.db.prepare("UPDATE jules_auto_replies SET status='sent',updated_at=? WHERE activity_name=?").run(dateNow(), question.name);
      store.log('auto_feedback_sent', `Answered a Jules question for ${project.folder} using the autonomous research policy`, project.id);
      recordPacket(store, { projectId: project.id, from: 'jules', to: 'coordinator', kind: 'response', title: 'Reply accepted by Jules', content: 'The message was accepted. Waiting for the next Jules update.' });
    } catch (error) {
      // A timed-out request may have reached Jules. Never send the same reply twice automatically.
      store.db.prepare("UPDATE jules_auto_replies SET status='uncertain',error=?,updated_at=? WHERE activity_name=?").run(error.message, dateNow(), question.name);
      store.log('auto_feedback_error', error.message, project.id);
      recordPacket(store, { projectId: project.id, from: 'jules', to: 'coordinator', kind: 'error', title: 'Reply delivery uncertain', content: error.message });
    }
  }

  async function autoApprovePlan(project, jules, activities) {
    if (store.get('autoReply') === '0' && !continuous()) return;
    const prefix = `${project.jules_session_name}/activities/`;
    const plan = activities.filter(item => typeof item.name === 'string' && item.name.startsWith(prefix) && item.planGenerated?.plan)
      .sort((a, b) => String(a.createTime ?? '').localeCompare(String(b.createTime ?? '')) || a.name.localeCompare(b.name)).at(-1);
    if (!plan) return;
    const count = store.db.prepare("SELECT COUNT(*) AS n FROM jules_auto_replies WHERE project_id=? AND status IN ('sending','sent') AND activity_name IN (SELECT name FROM jules_activities WHERE project_id=? AND kind='plan' AND summary='Plan generated')").get(project.id, project.id).n;
    if (count >= 3 && !continuous()) return;
    if (!claimReply(plan.name, project.id)) return;
    try {
      await jules.approvePlan(project.jules_session_name);
      recordPacket(store, { projectId: project.id, from: 'coordinator', to: 'jules', kind: 'approval', title: 'Plan approved automatically', content: 'Research Facility approved the generated plan.' });
      store.db.prepare("UPDATE jules_auto_replies SET status='sent',updated_at=? WHERE activity_name=?").run(dateNow(), plan.name);
      store.log('auto_plan_approved', `Approved Jules plan for ${project.folder}`, project.id);
    } catch (error) {
      store.db.prepare("UPDATE jules_auto_replies SET status='uncertain',error=?,updated_at=? WHERE activity_name=?").run(error.message, dateNow(), plan.name);
      store.log('auto_plan_error', error.message, project.id);
    }
  }

  return { autoReplyToFeedback, autoApprovePlan };
}
