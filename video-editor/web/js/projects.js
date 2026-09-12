/* Project browser — talks to /api/projects */

const grid = document.getElementById('projGrid');
const empty = document.getElementById('projEmpty');

const fmtDuration = (s = 0) => {
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${mm}:${String(ss).padStart(2, '0')}`;
};

function card(project) {
  const node = document.createElement('article');
  node.className = 'proj-card';

  const thumb = document.createElement('div');
  thumb.className = 'proj-thumb';
  if (project.poster) thumb.style.backgroundImage = `url(${project.poster})`;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = `${fmtDuration(project.duration)} · ${project.width}×${project.height}`;
  thumb.append(badge);

  const body = document.createElement('div');
  body.className = 'proj-body';
  const title = document.createElement('strong');
  title.textContent = project.name || 'Untitled project';
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = `${project.clips} clips · ${project.media} media · saved ${new Date(project.updatedAt).toLocaleString()}`;
  body.append(title, meta);

  const actions = document.createElement('div');
  actions.className = 'proj-actions';

  const open = document.createElement('a');
  open.className = 'btn btn-primary btn-sm';
  open.textContent = 'Open in editor';
  open.href = `/editor?project=${encodeURIComponent(project.id)}`;

  const del = document.createElement('button');
  del.className = 'btn btn-sm btn-danger';
  del.textContent = 'Delete';
  del.addEventListener('click', async () => {
    if (!confirm(`Delete “${project.name}” and its uploaded media?`)) return;
    await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
    load();
  });

  actions.append(open, del);
  node.append(thumb, body, actions);
  return node;
}

async function load() {
  grid.innerHTML = '';
  try {
    const res = await fetch('/api/projects');
    const data = await res.json();
    const projects = data.projects || [];
    empty.hidden = projects.length > 0;
    for (const project of projects) grid.append(card(project));
  } catch (err) {
    empty.hidden = false;
    empty.querySelector('h3').textContent = 'Could not reach the server';
    empty.querySelector('p').textContent = String(err.message || err);
  }
}

document.getElementById('btnRefresh').addEventListener('click', load);
load();
