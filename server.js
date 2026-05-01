const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_PORT = 3000;
const MAX_AUTO_PORT = 3010;
const PORT = Number(process.env.PORT) || DEFAULT_PORT;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "db.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const STATUSES = new Set(["todo", "in_progress", "done"]);
const PRIORITIES = new Set(["low", "medium", "high"]);

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function now() {
  return new Date().toISOString();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, originalHash] = stored.split(":");
  const candidateHash = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(originalHash, "hex"), candidateHash);
}

async function ensureDb() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_PATH)) return;

  const adminId = id("usr");
  const memberId = id("usr");
  const projectId = id("prj");
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const initial = {
    users: [
      {
        id: adminId,
        name: "Demo Admin",
        email: "admin@example.com",
        passwordHash: hashPassword("Admin@123"),
        role: "admin",
        createdAt: now()
      },
      {
        id: memberId,
        name: "Demo Member",
        email: "member@example.com",
        passwordHash: hashPassword("Member@123"),
        role: "member",
        createdAt: now()
      }
    ],
    projects: [
      {
        id: projectId,
        name: "Product Launch",
        description: "Coordinate design, API, QA, and deployment work for launch.",
        ownerId: adminId,
        memberIds: [adminId, memberId],
        createdAt: now()
      }
    ],
    tasks: [
      {
        id: id("tsk"),
        projectId,
        title: "Build task dashboard",
        description: "Create status cards and overdue summary.",
        assigneeId: memberId,
        status: "in_progress",
        priority: "high",
        dueDate: tomorrow.toISOString().slice(0, 10),
        createdBy: adminId,
        createdAt: now(),
        updatedAt: now()
      },
      {
        id: id("tsk"),
        projectId,
        title: "Write deployment notes",
        description: "Document Railway variables and start command.",
        assigneeId: adminId,
        status: "todo",
        priority: "medium",
        dueDate: yesterday.toISOString().slice(0, 10),
        createdBy: adminId,
        createdAt: now(),
        updatedAt: now()
      }
    ],
    sessions: []
  };

  await writeDb(initial);
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await fsp.readFile(DB_PATH, "utf8"));
}

async function writeDb(db) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.writeFile(DB_PATH, JSON.stringify(db, null, 2));
}

function send(res, status, data, headers = {}) {
  const body = data === null ? "" : JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(body);
}

function sendError(res, status, message, details) {
  send(res, status, { error: message, details });
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

function taskWithNames(db, task) {
  const assignee = db.users.find((user) => user.id === task.assigneeId);
  const project = db.projects.find((item) => item.id === task.projectId);
  return {
    ...task,
    assigneeName: assignee ? assignee.name : "Unassigned",
    projectName: project ? project.name : "Unknown project"
  };
}

function projectForUser(user, project) {
  return user.role === "admin" || project.memberIds.includes(user.id) || project.ownerId === user.id;
}

function canAccessTask(db, user, task) {
  const project = db.projects.find((item) => item.id === task.projectId);
  if (!project) return false;
  if (user.role === "admin") return true;
  return task.assigneeId === user.id || project.memberIds.includes(user.id);
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

async function authenticate(req, db) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const session = db.sessions.find((item) => item.token === token);
  if (!session) return null;
  const user = db.users.find((item) => item.id === session.userId);
  return user || null;
}

function requireAdmin(user, res) {
  if (user.role !== "admin") {
    sendError(res, 403, "Admin access is required.");
    return false;
  }
  return true;
}

function normalizeRole(role, fallback = "member") {
  return role === "admin" || role === "member" ? role : fallback;
}

function validateTaskPayload(body, db, isPatch = false) {
  const errors = [];
  if (!isPatch || body.title !== undefined) {
    if (!String(body.title || "").trim()) errors.push("Task title is required.");
  }
  if (!isPatch || body.projectId !== undefined) {
    if (!db.projects.some((project) => project.id === body.projectId)) errors.push("Valid project is required.");
  }
  if (!isPatch || body.assigneeId !== undefined) {
    if (!db.users.some((user) => user.id === body.assigneeId)) errors.push("Valid assignee is required.");
  }
  if (body.status !== undefined && !STATUSES.has(body.status)) errors.push("Status must be todo, in_progress, or done.");
  if (body.priority !== undefined && !PRIORITIES.has(body.priority)) errors.push("Priority must be low, medium, or high.");
  if (body.dueDate !== undefined && body.dueDate && Number.isNaN(Date.parse(`${body.dueDate}T00:00:00`))) {
    errors.push("Due date must be a valid date.");
  }
  return errors;
}

async function handleApi(req, res, pathname) {
  const db = await readDb();
  const method = req.method;
  const body = method === "GET" ? {} : await parseBody(req);

  if (method === "POST" && pathname === "/api/auth/signup") {
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const errors = [];

    if (name.length < 2) errors.push("Name must be at least 2 characters.");
    if (!validateEmail(email)) errors.push("A valid email is required.");
    if (password.length < 6) errors.push("Password must be at least 6 characters.");
    if (db.users.some((user) => user.email === email)) errors.push("Email already exists.");
    if (errors.length) return sendError(res, 422, "Signup validation failed.", errors);

    const role = db.users.length === 0 ? "admin" : normalizeRole(body.role);
    const user = {
      id: id("usr"),
      name,
      email,
      passwordHash: hashPassword(password),
      role,
      createdAt: now()
    };
    db.users.push(user);
    await writeDb(db);
    return send(res, 201, { user: sanitizeUser(user) });
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const user = db.users.find((item) => item.email === email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return sendError(res, 401, "Invalid email or password.");
    }
    const token = crypto.randomBytes(32).toString("hex");
    db.sessions.push({ token, userId: user.id, createdAt: now() });
    await writeDb(db);
    return send(res, 200, { token, user: sanitizeUser(user) });
  }

  const user = await authenticate(req, db);
  if (!user) return sendError(res, 401, "Authentication is required.");

  if (method === "POST" && pathname === "/api/auth/logout") {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    db.sessions = db.sessions.filter((session) => session.token !== token);
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/me") {
    return send(res, 200, { user: sanitizeUser(user) });
  }

  if (method === "GET" && pathname === "/api/users") {
    const users = user.role === "admin"
      ? db.users.map(sanitizeUser)
      : db.users.filter((item) => item.id === user.id).map(sanitizeUser);
    return send(res, 200, { users });
  }

  if (method === "GET" && pathname === "/api/projects") {
    const projects = db.projects
      .filter((project) => projectForUser(user, project))
      .map((project) => ({
        ...project,
        ownerName: db.users.find((item) => item.id === project.ownerId)?.name || "Unknown",
        members: project.memberIds.map((memberId) => sanitizeUser(db.users.find((item) => item.id === memberId))).filter(Boolean),
        taskCount: db.tasks.filter((task) => task.projectId === project.id).length
      }));
    return send(res, 200, { projects });
  }

  if (method === "POST" && pathname === "/api/projects") {
    if (!requireAdmin(user, res)) return;
    const name = String(body.name || "").trim();
    const description = String(body.description || "").trim();
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds : [];
    const validMembers = [...new Set([user.id, ...memberIds])].filter((memberId) => db.users.some((item) => item.id === memberId));
    if (name.length < 3) return sendError(res, 422, "Project name must be at least 3 characters.");

    const project = {
      id: id("prj"),
      name,
      description,
      ownerId: user.id,
      memberIds: validMembers,
      createdAt: now()
    };
    db.projects.push(project);
    await writeDb(db);
    return send(res, 201, { project });
  }

  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (projectMatch && method === "PUT") {
    if (!requireAdmin(user, res)) return;
    const project = db.projects.find((item) => item.id === projectMatch[1]);
    if (!project) return sendError(res, 404, "Project not found.");
    const name = String(body.name || project.name).trim();
    if (name.length < 3) return sendError(res, 422, "Project name must be at least 3 characters.");
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds : project.memberIds;
    project.name = name;
    project.description = String(body.description ?? project.description).trim();
    project.memberIds = [...new Set([project.ownerId, ...memberIds])].filter((memberId) => db.users.some((item) => item.id === memberId));
    await writeDb(db);
    return send(res, 200, { project });
  }

  if (method === "GET" && pathname === "/api/tasks") {
    const tasks = db.tasks
      .filter((task) => canAccessTask(db, user, task))
      .map((task) => taskWithNames(db, task));
    return send(res, 200, { tasks });
  }

  if (method === "POST" && pathname === "/api/tasks") {
    if (!requireAdmin(user, res)) return;
    const errors = validateTaskPayload(body, db);
    if (errors.length) return sendError(res, 422, "Task validation failed.", errors);
    const project = db.projects.find((item) => item.id === body.projectId);
    const assigneeId = body.assigneeId;
    if (!project.memberIds.includes(assigneeId)) {
      return sendError(res, 422, "Assignee must be a member of the selected project.");
    }
    const task = {
      id: id("tsk"),
      projectId: body.projectId,
      title: String(body.title).trim(),
      description: String(body.description || "").trim(),
      assigneeId,
      status: body.status || "todo",
      priority: body.priority || "medium",
      dueDate: body.dueDate || "",
      createdBy: user.id,
      createdAt: now(),
      updatedAt: now()
    };
    db.tasks.push(task);
    await writeDb(db);
    return send(res, 201, { task: taskWithNames(db, task) });
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch && method === "PATCH") {
    const task = db.tasks.find((item) => item.id === taskMatch[1]);
    if (!task) return sendError(res, 404, "Task not found.");
    if (!canAccessTask(db, user, task)) return sendError(res, 403, "You cannot access this task.");

    const changingMoreThanStatus = ["title", "description", "projectId", "assigneeId", "priority", "dueDate"].some((key) => body[key] !== undefined);
    if (user.role !== "admin" && changingMoreThanStatus) {
      return sendError(res, 403, "Members can update task status only.");
    }

    const errors = validateTaskPayload(body, db, true);
    if (errors.length) return sendError(res, 422, "Task validation failed.", errors);
    if (body.assigneeId !== undefined) {
      const projectId = body.projectId || task.projectId;
      const project = db.projects.find((item) => item.id === projectId);
      if (!project || !project.memberIds.includes(body.assigneeId)) {
        return sendError(res, 422, "Assignee must be a member of the selected project.");
      }
    }

    ["projectId", "assigneeId", "status", "priority", "dueDate"].forEach((key) => {
      if (body[key] !== undefined) task[key] = body[key];
    });
    if (body.title !== undefined) task.title = String(body.title).trim();
    if (body.description !== undefined) task.description = String(body.description).trim();
    task.updatedAt = now();
    await writeDb(db);
    return send(res, 200, { task: taskWithNames(db, task) });
  }

  if (taskMatch && method === "DELETE") {
    if (!requireAdmin(user, res)) return;
    const before = db.tasks.length;
    db.tasks = db.tasks.filter((item) => item.id !== taskMatch[1]);
    if (db.tasks.length === before) return sendError(res, 404, "Task not found.");
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/dashboard") {
    const visibleTasks = db.tasks.filter((task) => canAccessTask(db, user, task));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdue = visibleTasks.filter((task) => task.status !== "done" && task.dueDate && new Date(`${task.dueDate}T00:00:00`) < today);
    const stats = {
      totalTasks: visibleTasks.length,
      todo: visibleTasks.filter((task) => task.status === "todo").length,
      inProgress: visibleTasks.filter((task) => task.status === "in_progress").length,
      done: visibleTasks.filter((task) => task.status === "done").length,
      overdue: overdue.length,
      projects: db.projects.filter((project) => projectForUser(user, project)).length,
      teamMembers: user.role === "admin" ? db.users.length : 1
    };
    return send(res, 200, { stats });
  }

  return sendError(res, 404, "API route not found.");
}

async function serveStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error("Not a file");
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    const indexPath = path.join(PUBLIC_DIR, "index.html");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(indexPath).pipe(res);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    sendError(res, 500, error.message || "Server error.");
  }
});

ensureDb()
  .then(() => {
    startServer(PORT);
  })
  .catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });

function startServer(port) {
  const hasExplicitPort = Boolean(process.env.PORT);

  server.once("error", (error) => {
    if (error.code === "EADDRINUSE") {
      if (!hasExplicitPort && port < MAX_AUTO_PORT) {
        const nextPort = port + 1;
        console.warn(`Port ${port} is already in use. Trying ${nextPort}...`);
        startServer(nextPort);
        return;
      }

      console.error(`Port ${port} is already in use.`);
      console.error(`Close the process using port ${port}, or start with a different port:`);
      console.error(`  $env:PORT=3001; npm start`);
      process.exit(1);
    }

    console.error("Failed to start server:", error);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`Team Task Manager running on http://localhost:${port}`);
  });
}
