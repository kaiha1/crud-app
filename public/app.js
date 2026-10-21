const $ = selector => document.querySelector(selector);
const labels = { todo: 'To do', doing: 'In progress', done: 'Completed' };
let user, tasks = [], filter = 'all', mode = 'login', editingId = null, deletingId = null, toastTimer;
async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Taskroom' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) showAuth();
    throw new Error(data.error || 'Unable to complete this request.');
  }
  return data;
}
function errorAt(selector, message = '') { const el = $(selector); el.textContent = message; el.hidden = !message; }
function notify(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 3500); }
function showAuth() {
  setMode('login');
  user = null; tasks = []; $('#workspace').hidden = true; $('#account').hidden = true; $('#auth-view').hidden = false; $('#header-note').hidden = false; $('#loading').hidden = true;
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  $('#password').value = '';
}
async function showWorkspace(nextUser) {
  user = nextUser; tasks = []; filter = 'all'; $('#search').value = '';
  $('#user-name').textContent = user.name; $('#workspace').hidden = false; $('#account').hidden = false; $('#auth-view').hidden = true; $('#header-note').hidden = true; $('#loading').hidden = true;
  $('#auth-form').reset(); render(); await loadTasks();
}
function setMode(nextMode) {
  mode = nextMode; const signup = mode === 'signup';
  $('#name-field').hidden = !signup; $('#name').required = signup;
  $('#password').minLength = signup ? 8 : 1; $('#password').autocomplete = signup ? 'new-password' : 'current-password';
  $('#password-help').hidden = !signup;
  $('#auth-title').textContent = signup ? 'A fresh start.' : 'Welcome back.';
  $('#auth-subtitle').textContent = signup ? 'Create your account. Make room for progress.' : 'Your next small step starts here.';
  $('#auth-submit').textContent = signup ? 'Create account →' : 'Log in →';
  for (const tab of ['login', 'signup']) { $(`#${tab}-tab`).classList.toggle('active', tab === mode); $(`#${tab}-tab`).setAttribute('aria-pressed', tab === mode); }
  errorAt('#auth-error');
}
$('#login-tab').onclick = () => setMode('login');
$('#signup-tab').onclick = () => setMode('signup');
$('#show-password').onclick = () => { const show = $('#password').type === 'password'; $('#password').type = show ? 'text' : 'password'; $('#show-password').textContent = show ? 'Hide' : 'Show'; $('#show-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password'); };
$('#auth-form').onsubmit = async event => {
  event.preventDefault(); errorAt('#auth-error'); const button = $('#auth-submit'); button.disabled = true;
  try { const data = await api(`/auth/${mode}`, { method: 'POST', body: { name: $('#name').value, email: $('#email').value, password: $('#password').value } }); await showWorkspace(data.user); }
  catch (error) { errorAt('#auth-error', error.message === 'Failed to fetch' ? 'Connection lost. Please try again.' : error.message); }
  finally { button.disabled = false; }
};
$('#logout').onclick = async () => {
  $('#logout').disabled = true;
  try { await api('/auth/logout', { method: 'POST' }); showAuth(); }
  catch { notify('Could not log out. Please try again.'); }
  finally { $('#logout').disabled = false; }
};
async function loadTasks() {
  errorAt('#tasks-error'); $('#retry').hidden = true;
  try { tasks = (await api('/tasks')).tasks; render(); }
  catch (error) { errorAt('#tasks-error', error.message); $('#retry').hidden = false; }
}
$('#retry').onclick = loadTasks;
function element(tag, className, content) { const el = document.createElement(tag); if (className) el.className = className; if (content !== undefined) el.textContent = content; return el; }
function render() {
  $('#total-count').textContent = tasks.length; $('#doing-count').textContent = tasks.filter(t => t.status === 'doing').length; $('#done-count').textContent = tasks.filter(t => t.status === 'done').length; $('#task-count').textContent = tasks.length;
  for (const button of document.querySelectorAll('[data-filter]')) { button.classList.toggle('active', button.dataset.filter === filter); button.setAttribute('aria-pressed', button.dataset.filter === filter); }
  const search = $('#search').value.trim().toLowerCase();
  const visible = tasks.filter(t => (filter === 'all' || t.status === filter) && `${t.title} ${t.description}`.toLowerCase().includes(search));
  const list = $('#task-list'); list.replaceChildren();
  for (const task of visible) {
    const card = element('article', 'task-card');
    const check = element('button', `task-check ${task.status === 'done' ? 'completed' : ''}`, task.status === 'done' ? '✓' : '');
    check.setAttribute('aria-label', `${task.status === 'done' ? 'Mark as to do' : 'Mark completed'}: ${task.title}`);
    check.onclick = async () => { check.disabled = true; try { const { task: updated } = await api(`/tasks/${task.id}`, { method: 'PUT', body: { ...task, status: task.status === 'done' ? 'todo' : 'done' } }); tasks = tasks.map(t => t.id === task.id ? updated : t); render(); notify('Task updated.'); } catch (error) { notify(error.message); check.disabled = false; } };
    const content = element('div', 'task-content'); content.append(element('h3', '', task.title));
    if (task.description) content.append(element('p', '', task.description));
    const meta = element('div', 'task-meta'); meta.append(element('span', `badge ${task.status}`, labels[task.status]), element('span', 'task-date', `Created ${new Date(task.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`)); content.append(meta);
    const actions = element('div', 'task-actions'); const edit = element('button', 'icon-button edit-button', 'Edit'); edit.setAttribute('aria-label', `Edit ${task.title}`); edit.onclick = () => openTask(task);
    const remove = element('button', 'icon-button', '×'); remove.setAttribute('aria-label', `Delete ${task.title}`); remove.onclick = () => { deletingId = task.id; $('#delete-name').textContent = `“${task.title}”`; errorAt('#delete-error'); $('#delete-dialog').showModal(); $('#cancel-delete').focus(); };
    actions.append(edit, remove); card.append(check, content, actions); list.append(card);
  }
  $('#empty').hidden = visible.length > 0;
  const untouched = !tasks.length && !search && filter === 'all';
  $('#empty-title').textContent = untouched ? 'A fresh page. A clear mind.' : 'No tasks here yet.';
  $('#empty-copy').textContent = untouched ? 'Add your first task and make room for progress.' : 'Try another search or filter, or add a new task.';
  $('#empty-add').textContent = untouched ? 'Create your first task →' : 'Create a task →';
}
$('#search').oninput = render;
for (const button of document.querySelectorAll('[data-filter]')) button.onclick = () => { filter = button.dataset.filter; render(); };
function openTask(task) {
  editingId = task?.id ?? null; $('#task-form').reset(); errorAt('#task-error');
  $('#dialog-title').textContent = task ? 'A little adjustment.' : 'Make a little plan.';
  $('#save-task').textContent = task ? 'Save changes' : 'Create task';
  $('#task-title').value = task?.title || ''; $('#task-description').value = task?.description || ''; $('#task-status').value = task?.status || 'todo';
  $('#task-dialog').showModal(); $('#task-title').focus();
}
$('#new-task').onclick = $('#empty-add').onclick = () => openTask();
$('#cancel-task').onclick = $('#close-dialog').onclick = () => $('#task-dialog').close();
$('#task-form').onsubmit = async event => {
  event.preventDefault(); errorAt('#task-error');
  const title = $('#task-title').value.trim(); if (!title) { errorAt('#task-error', 'Please add a task title.'); return; }
  $('#save-task').disabled = true;
  try {
    const { task } = await api(editingId ? `/tasks/${editingId}` : '/tasks', { method: editingId ? 'PUT' : 'POST', body: { title, description: $('#task-description').value, status: $('#task-status').value } });
    tasks = editingId ? tasks.map(t => t.id === editingId ? task : t) : [task, ...tasks];
    filter = 'all'; $('#search').value = ''; render(); $('#task-dialog').close(); notify(editingId ? 'Changes saved.' : 'Task created. One step closer.');
  } catch (error) { errorAt('#task-error', error.message); }
  finally { $('#save-task').disabled = false; }
};
$('#cancel-delete').onclick = () => $('#delete-dialog').close();
$('#confirm-delete').onclick = async () => {
  $('#confirm-delete').disabled = true; errorAt('#delete-error');
  try { await api(`/tasks/${deletingId}`, { method: 'DELETE' }); tasks = tasks.filter(t => t.id !== deletingId); render(); $('#delete-dialog').close(); notify('Task deleted.'); }
  catch (error) { errorAt('#delete-error', error.message); }
  finally { $('#confirm-delete').disabled = false; }
};
try { await showWorkspace((await api('/auth/me')).user); }
catch { showAuth(); }
