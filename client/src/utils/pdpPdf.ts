// client/src/utils/pdpPdf.ts
// PDP → PDF for HR. Builds a print-styled HTML document of one plan, loads
// it into a hidden iframe and opens the browser's print dialog, where
// "Save as PDF" produces the file. Printing (rather than a JS PDF library)
// keeps Cyrillic text rendering correctly with no extra fonts or deps.
import { format } from 'date-fns';
import type { PdpPlan } from '../types';

const GOAL_STATUS: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', done: 'Done' };
const TASK_STATUS: Record<string, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Multi-line user text: escape, keep line breaks.
const para = (s: string | null | undefined) => (s?.trim() ? esc(s.trim()).replace(/\n/g, '<br>') : '<span class="muted">—</span>');

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return format(new Date(dateStr.length > 10 ? dateStr : dateStr + 'T00:00:00'), 'dd MMM yyyy');
  } catch {
    return dateStr;
  }
}

const stars = (n: number | null) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '—');

function buildHtml(plan: PdpPlan, agentName: string, managerName: string, exportedBy: string): string {
  const goalById = new Map(plan.goals.map((g) => [g.id, g.goal]));
  const goalsDone = plan.goals.filter((g) => g.status === 'done').length;
  const items = plan.tasks.reduce((n, t) => n + 1 + (t.subtasks ?? []).length, 0);
  const itemsDone = plan.tasks.reduce(
    (n, t) => n + (t.completed ? 1 : 0) + (t.subtasks ?? []).filter((s) => s.done).length, 0,
  );

  const goalsRows = plan.goals.map((g, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td><strong>${esc(g.goal)}</strong>
        ${g.assignedByName ? `<div class="tag">Assigned by ${esc(g.assignedByName)}</div>` : ''}</td>
      <td>${para(g.specificActions)}</td>
      <td>${para(g.actionsTaken)}</td>
      <td>${fmt(g.targetDate)}</td>
      <td>${GOAL_STATUS[g.status] ?? esc(g.status)}</td>
      <td class="c">${g.progressPct}%</td>
      <td class="stars">${stars(g.adminRating)}</td>
    </tr>`).join('');

  const tasksRows = plan.tasks.map((t, i) => {
    const subs = (t.subtasks ?? []).map((s) => `<li class="${s.done ? 'done' : ''}">${s.done ? '☑' : '☐'} ${esc(s.text)}</li>`).join('');
    const comments = t.comments.map((c) =>
      `<div class="comment"><span class="muted">${esc(c.authorName)}, ${fmt(c.createdAt.slice(0, 10))}:</span> ${para(c.text)}</div>`).join('');
    return `
    <tr>
      <td class="num">${i + 1}</td>
      <td><strong>${t.completed ? '☑' : '☐'} ${esc(t.task)}</strong>
        ${t.assignedByName ? `<div class="tag">Assigned by ${esc(t.assignedByName)}</div>` : ''}
        ${subs ? `<ul class="subs">${subs}</ul>` : ''}
        ${comments ? `<div class="comments">${comments}</div>` : ''}</td>
      <td>${t.goalId ? esc(goalById.get(t.goalId) ?? '—') : '<span class="muted">—</span>'}</td>
      <td>${TASK_STATUS[t.status] ?? esc(t.status)}</td>
      <td class="stars">${stars(t.adminGrade)}</td>
    </tr>`;
  }).join('');

  // Feedback: agent self-review (once submitted) + manager review (once
  // published — drafts never go to HR) + answers to the retired questions.
  const fb = plan.feedback;
  const selfHtml = fb?.submittedAt ? `
    <p class="muted">Submitted ${fmt(fb.submittedAt.slice(0, 10))}</p>
    <table class="kv">
      <tr><th>Personal reflection — what did you achieve this period?</th><td>${para(fb.achievements)}</td></tr>
      <tr><th>What would you like to focus on in the next period?</th><td>${para(fb.nextFocus)}</td></tr>
    </table>` : '<p class="muted">Not submitted.</p>';
  const managerHtml = fb?.managerPublishedAt ? `
    <p class="muted">${fb.managerName ? `By ${esc(fb.managerName)}, ` : ''}published ${fmt(fb.managerPublishedAt.slice(0, 10))}</p>
    <table class="kv">
      <tr><th>Manager rating</th><td class="stars">${stars(fb.managerRating)}</td></tr>
      <tr><th>Manager comment</th><td>${para(fb.managerComment)}</td></tr>
    </table>` : '<p class="muted">Not published.</p>';
  const earlierHtml = fb && (fb.mentorRating != null || fb.mostHelpful || fb.improvements) ? `
    <h3>Earlier answers</h3>
    <table class="kv">
      <tr><th>Overall mentor experience</th><td class="stars">${stars(fb.mentorRating)}</td></tr>
      <tr><th>What was most helpful</th><td>${para(fb.mostHelpful)}</td></tr>
      <tr><th>What could be improved</th><td>${para(fb.improvements)}</td></tr>
    </table>` : '';
  const feedbackHtml = `
    <h2>Self-review</h2>${selfHtml}
    <h2>Manager review</h2>${managerHtml}
    ${earlierHtml}`;

  const title = `PDP — ${agentName} — ${format(new Date(), 'yyyy-MM-dd')}`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #0E0E0E; font-size: 11px; line-height: 1.45; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #A1F96E; }
  h3 { font-size: 12px; margin: 16px 0 6px; color: #374151; }
  .muted { color: #6b7280; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px 28px; margin: 12px 0 4px; }
  .meta div span { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  .meta div strong { font-size: 12px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { text-align: left; vertical-align: top; padding: 6px 7px; border-bottom: 1px solid #e5e7eb; }
  thead th { font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; border-bottom: 1px solid #9ca3af; }
  .num { width: 22px; color: #9ca3af; }
  .c { text-align: center; }
  .stars { white-space: nowrap; color: #b45309; letter-spacing: 1px; }
  .sub { margin-top: 3px; color: #374151; }
  .tag { margin-top: 3px; font-size: 9px; color: #6b7280; }
  ul.subs { list-style: none; margin: 5px 0 0; padding: 0 0 0 4px; }
  ul.subs li { margin: 2px 0; color: #374151; }
  ul.subs li.done { color: #9ca3af; text-decoration: line-through; }
  .comments { margin-top: 6px; padding-left: 8px; border-left: 2px solid #e5e7eb; }
  .comment { margin: 2px 0; color: #374151; }
  table.kv th { width: 32%; font-weight: 600; color: #374151; }
  .footer { margin-top: 26px; font-size: 9px; color: #9ca3af; }
</style></head>
<body>
  <h1>Personal Development Plan</h1>
  <div class="muted">${esc(agentName)}</div>
  <div class="meta">
    <div><span>Agent</span><strong>${esc(agentName)}</strong></div>
    <div><span>Manager</span><strong>${esc(managerName)}</strong></div>
    <div><span>Period</span><strong>${fmt(plan.periodStart)} — ${fmt(plan.periodEnd)}</strong></div>
    <div><span>Status</span><strong>${plan.status === 'completed' ? 'Completed' : 'In progress'}</strong></div>
    <div><span>Goals done</span><strong>${goalsDone}/${plan.goals.length}</strong></div>
    <div><span>Tasks completed</span><strong>${itemsDone}/${items}</strong></div>
  </div>

  <h2>Goals</h2>
  ${plan.goals.length ? `<table>
    <thead><tr><th></th><th>Goal</th><th>Expected actions</th><th>Actions taken</th><th>Target date</th><th>Status</th><th class="c">Progress</th><th>Rating</th></tr></thead>
    <tbody>${goalsRows}</tbody></table>` : '<p class="muted">No goals.</p>'}

  <h2>Tasks</h2>
  ${plan.tasks.length ? `<table>
    <thead><tr><th></th><th>Task, subtasks &amp; comments</th><th>Related goal</th><th>Status</th><th>Grade</th></tr></thead>
    <tbody>${tasksRows}</tbody></table>` : '<p class="muted">No tasks.</p>'}

  ${feedbackHtml}

  <div class="footer">Exported from CareSpace by ${esc(exportedBy)} on ${format(new Date(), 'dd MMM yyyy, HH:mm')}</div>
</body></html>`;
}

export function exportPdpPdf(plan: PdpPlan, agentName: string, managerName: string, exportedBy: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(buildHtml(plan, agentName, managerName, exportedBy));
  doc.close();

  const win = iframe.contentWindow!;
  // Chrome/Edge name the saved PDF after the top document's title, so borrow it while printing.
  const prevTitle = document.title;
  document.title = doc.title;
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    document.title = prevTitle;
    setTimeout(() => iframe.remove(), 500);
  };
  win.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(() => {
    win.focus();
    win.print();
    // Fallback in case a browser never fires afterprint.
    setTimeout(cleanup, 60_000);
  }, 100);
}
