const $ = (id) => document.getElementById(id);

const fieldDefs = {
  movement: [{k:"speed_mps", v:"6.5"}],
  aim_stats: [{k:"headshot_rate", v:"0.3"}, {k:"samples", v:"30"}],
  action: [{k:"actions_per_sec", v:"5"}],
  report: [{k:"reason", v:"QA manual review test"}],
};

function renderDyn(){
  const t = $("fType").value;
  $("dynFields").innerHTML = fieldDefs[t].map(f =>
    `<label>${f.k}<input data-k="${f.k}" value="${f.v}" /></label>`
  ).join("");
}
$("fType").addEventListener("change", renderDyn);
renderDyn();

async function refresh(){
  const s = await (await fetch("/api/stats")).json();
  $("statEvents").textContent = s.total_events;
  $("statDetections").textContent = s.total_detections;
  $("statRules").textContent = s.rules.length;
  const dets = await (await fetch("/api/detections")).json();
  $("feed").innerHTML = dets.length ? dets.map(d => `
    <div class="det ${d.severity}">
      <div class="r">${d.rule} · ${d.severity}</div>
      <div>${d.message}</div>
      <div class="muted">${d.player_id} · ${d.event_type} · ${new Date(d.ts*1000).toLocaleTimeString()}</div>
    </div>`).join("") : `<p class="muted">No detections yet.</p>`;
}

$("btnRefresh").onclick = refresh;
$("btnSimulate").onclick = async () => {
  await fetch("/api/simulate", {method:"POST"});
  refresh();
};
$("btnReset").onclick = async () => {
  await fetch("/api/reset", {method:"POST"});
  refresh();
};
$("btnSend").onclick = async () => {
  const payload = { player_id: $("fPlayer").value, type: $("fType").value };
  document.querySelectorAll("#dynFields input").forEach(i => {
    const v = i.value;
    payload[i.dataset.k] = isNaN(Number(v)) || v === "" ? v : Number(v);
  });
  const r = await fetch("/api/event", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload)});
  $("sendMsg").textContent = r.ok ? "Sent ✓" : "Error — player_id and type required";
  refresh();
};
refresh();
