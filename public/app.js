const state = {
  token: localStorage.getItem("ttm_token") || "",
  user: JSON.parse(localStorage.getItem("ttm_user") || "null"),
  users: [],
  projects: [],
  tasks: [],
  stats: null,
  route: "dashboard"
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  authView: $("#authView"),
  appView: $("#appView"),
  loginTab: $("#loginTab"),
  signupTab: $("#signupTab"),
  loginForm: $("#loginForm"),
  signupForm: $("#signupForm"),
  authMessage: $("#authMessage"),
  logoutBtn: $("#logoutBtn"),
  roleLabel: $("#roleLabel"),
  welcomeTitle: $("#welcomeTitle"),
  userChip: $("#userChip"),
  alertBox: $("#alertBox"),
  statsGrid: $("#statsGrid"),
  kanban: $("#kanban"),
  projectFilter: $("#projectFilter"),
  projectForm: $("#projectForm"),
  projectList: $("#projectList"),
  taskForm: $("#taskForm"),
  taskList: $("#taskList"),
  teamList: $("#teamList")
};

function setMessage(message = "", type = "error") {
  els.alertBox.classList.toggle("hidden", !message);
  els.alertBox.textContent = message;
  els.alertBox.style.color = type === "success" ? "var(--success)" : "var(--danger)";
}

function setAuthMessage(message = "") {
  els.authMessage.textContent = message;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(data.details) ? ` ${data.details.join(" ")}` : "";
    throw new Error(`${data.error || "Request failed."}${detail}`);
  }
  return data;
}

function formData(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const multi = form.querySelectorAll("select[multiple]");
  multi.forEach((select) => {
    data[select.name] = Array.from(select.selectedOptions).map((option) => option.value);
  });
  return data;
}

function saveSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("ttm_token", token);
  localStorage.setItem("ttm_user", JSON.stringify(user));
}

function clearSession() {
  state.token = "";
  state.user = null;
  localStorage.removeItem("ttm_token");
  localStorage.removeItem("ttm_user");
}

function showAuth() {
  els.authView.classList.remove("hidden");
  els.appView.classList.add("hidden");
}

function showApp() {
  els.authView.classList.add("hidden");
  els.appView.classList.remove("hidden");
  renderShell();
}

function isAdmin() {
  return state.user?.role === "admin";
}

function renderShell() {
  els.roleLabel.textContent = `${state.user.role} access`;
  els.welcomeTitle.textContent = `Welcome, ${state.user.name}`;
  els.userChip.textContent = `${state.user.name} - ${state.user.email}`;
  $$(".admin-only").forEach((node) => node.classList.toggle("hidden", !isAdmin()));
}

function setRoute(route) {
  state.route = route;
  $$(".nav-link").forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${route}`));
  ["dashboard", "projects", "tasks", "team"].forEach((name) => {
    $(`#${name}Section`).classList.toggle("hidden", name !== route);
  });
}

async function refresh() {
  const [usersData, projectsData, tasksData, dashboardData] = await Promise.all([
    api("/api/users"),
    api("/api/projects"),
    api("/api/tasks"),
    api("/api/dashboard")
  ]);
  state.users = usersData.users;
  state.projects = projectsData.projects;
  state.tasks = tasksData.tasks;
  state.stats = dashboardData.stats;
  renderAll();
}

function renderAll() {
  renderShell();
  renderStats();
  renderProjectOptions();
  renderKanban();
  renderProjects();
  renderTasks();
  renderTeam();
}

function renderStats() {
  const items = [
    ["Total tasks", state.stats.totalTasks],
    ["In progress", state.stats.inProgress],
    ["Done", state.stats.done],
    ["Overdue", state.stats.overdue],
    ["Projects", state.stats.projects],
    ["Team members", state.stats.teamMembers]
  ];
  els.statsGrid.innerHTML = items
    .map(([label, value]) => `<article class="stat-card"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");
}

function renderProjectOptions() {
  const projectOptions = state.projects.map((project) => `<option value="${project.id}">${escapeHtml(project.name)}</option>`).join("");
  els.projectFilter.innerHTML = `<option value="all">All projects</option>${projectOptions}`;
  els.taskForm.projectId.innerHTML = `<option value="">Select project</option>${projectOptions}`;
  els.taskForm.assigneeId.innerHTML = `<option value="">Select assignee</option>${state.users
    .map((user) => `<option value="${user.id}">${escapeHtml(user.name)} (${user.role})</option>`)
    .join("")}`;
  els.projectForm.memberIds.innerHTML = state.users
    .map((user) => `<option value="${user.id}">${escapeHtml(user.name)} (${user.role})</option>`)
    .join("");
}

function statusLabel(status) {
  return {
    todo: "To do",
    in_progress: "In progress",
    done: "Done"
  }[status];
}

function nextStatus(status) {
  return {
    todo: "in_progress",
    in_progress: "done",
    done: "todo"
  }[status];
}

function isOverdue(task) {
  if (!task.dueDate || task.status === "done") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${task.dueDate}T00:00:00`) < today;
}

function taskCard(task) {
  const next = nextStatus(task.status);
  return `
    <article class="task-card">
      <h5>${escapeHtml(task.title)}</h5>
      <p>${escapeHtml(task.description || "No description")}</p>
      <div class="meta-row">
        <span class="pill ${task.priority}">${task.priority}</span>
        <span class="pill">${escapeHtml(task.assigneeName)}</span>
        <span class="pill">${escapeHtml(task.projectName)}</span>
        ${task.dueDate ? `<span class="pill ${isOverdue(task) ? "overdue" : ""}">Due ${task.dueDate}</span>` : ""}
      </div>
      <div class="actions">
        <button class="status-btn" type="button" data-action="status" data-id="${task.id}" data-status="${next}">
          Move to ${statusLabel(next)}
        </button>
        ${isAdmin() ? `<button class="danger-btn" type="button" data-action="delete" data-id="${task.id}">Delete</button>` : ""}
      </div>
    </article>
  `;
}

function renderKanban() {
  const selected = els.projectFilter.value || "all";
  const tasks = selected === "all" ? state.tasks : state.tasks.filter((task) => task.projectId === selected);
  els.kanban.innerHTML = ["todo", "in_progress", "done"]
    .map((status) => {
      const cards = tasks.filter((task) => task.status === status).map(taskCard).join("");
      return `<section class="column"><h4>${statusLabel(status)}</h4>${cards || "<p>No tasks here.</p>"}</section>`;
    })
    .join("");
}

function renderProjects() {
  els.projectList.innerHTML = state.projects
    .map((project) => `
      <article class="item-card">
        <h4>${escapeHtml(project.name)}</h4>
        <p>${escapeHtml(project.description || "No description")}</p>
        <div class="meta-row">
          <span class="pill">${project.taskCount} tasks</span>
          <span class="pill">${project.members.length} members</span>
        </div>
        <p>${project.members.map((member) => escapeHtml(member.name)).join(", ")}</p>
      </article>
    `)
    .join("") || "<p>No projects found.</p>";
}

function renderTasks() {
  els.taskList.innerHTML = state.tasks.map(taskCard).join("") || "<p>No tasks found.</p>";
}

function renderTeam() {
  els.teamList.innerHTML = state.users
    .map((user) => `
      <article class="item-card">
        <h4>${escapeHtml(user.name)}</h4>
        <p>${escapeHtml(user.email)}</p>
        <span class="pill">${user.role}</span>
      </article>
    `)
    .join("") || "<p>No team members found.</p>";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function boot() {
  if (!state.token) {
    showAuth();
    return;
  }
  try {
    const data = await api("/api/me");
    state.user = data.user;
    showApp();
    await refresh();
  } catch {
    clearSession();
    showAuth();
  }
}

els.loginTab.addEventListener("click", () => {
  els.loginTab.classList.add("active");
  els.signupTab.classList.remove("active");
  els.loginForm.classList.remove("hidden");
  els.signupForm.classList.add("hidden");
  setAuthMessage();
});

els.signupTab.addEventListener("click", () => {
  els.signupTab.classList.add("active");
  els.loginTab.classList.remove("active");
  els.signupForm.classList.remove("hidden");
  els.loginForm.classList.add("hidden");
  setAuthMessage();
});

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthMessage();
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(formData(els.loginForm))
    });
    saveSession(data.token, data.user);
    showApp();
    await refresh();
  } catch (error) {
    setAuthMessage(error.message);
  }
});

els.signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthMessage();
  try {
    await api("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(formData(els.signupForm))
    });
    setAuthMessage("Account created. You can log in now.");
    els.loginTab.click();
    els.loginForm.email.value = els.signupForm.email.value;
    els.loginForm.password.value = "";
    els.signupForm.reset();
  } catch (error) {
    setAuthMessage(error.message);
  }
});

els.logoutBtn.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
  } catch {
    // Logging out locally is still valid if the network request has already failed.
  }
  clearSession();
  showAuth();
});

window.addEventListener("hashchange", () => {
  const route = location.hash.replace("#", "") || "dashboard";
  setRoute(route);
});

els.projectFilter.addEventListener("change", renderKanban);

els.projectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage();
  try {
    await api("/api/projects", {
      method: "POST",
      body: JSON.stringify(formData(els.projectForm))
    });
    els.projectForm.reset();
    await refresh();
    setMessage("Project created.", "success");
  } catch (error) {
    setMessage(error.message);
  }
});

els.taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage();
  try {
    await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify(formData(els.taskForm))
    });
    els.taskForm.reset();
    await refresh();
    setMessage("Task created.", "success");
  } catch (error) {
    setMessage(error.message);
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id, status } = button.dataset;
  setMessage();
  try {
    if (action === "status") {
      await api(`/api/tasks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
    }
    if (action === "delete") {
      await api(`/api/tasks/${id}`, { method: "DELETE", body: "{}" });
    }
    await refresh();
  } catch (error) {
    setMessage(error.message);
  }
});

setRoute(location.hash.replace("#", "") || "dashboard");
boot();
