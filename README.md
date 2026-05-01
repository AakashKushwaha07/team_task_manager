# Team Task Manager

A full-stack team task management web app for planning projects, assigning work, tracking task progress, and managing users with role-based access control.

## Live Demo

Live app: https://teamtaskmanager-production-304e.up.railway.app

## Features

- User authentication with signup, login, logout, and token-based sessions
- Admin and member roles
- Dashboard with task, project, team, and overdue metrics
- Project management with members and task counts
- Task creation, assignment, priority, due dates, status updates, and deletion
- Member access rules for viewing assigned or project-related work
- JSON-file persistence using `data/db.json`
- REST API built with Node.js built-in modules
- Static frontend served from the same Node server

## Tech Stack

- Node.js
- Vanilla JavaScript
- HTML
- CSS
- JSON file database
- Railway for deployment

## Run Locally

Clone the project, open the folder, and run:

```bash
npm start
```

Open the URL printed in the terminal. By default this is:

```text
http://localhost:3000
```

If port `3000` is already in use, the app automatically tries the next available port up to `3010`.

To choose a port manually in PowerShell:

```powershell
$env:PORT=3001; npm start
```

## Demo Accounts

Demo accounts are created automatically when `data/db.json` does not exist.

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@example.com` | `Admin@123` |
| Member | `member@example.com` | `Member@123` |

## Role Rules

- Admins can create projects, add team members, create tasks, assign tasks, update any task, and delete tasks.
- Members can view their accessible projects and tasks.
- Members can update task status only.

## API Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/api/auth/signup` | Create a new user |
| `POST` | `/api/auth/login` | Login and receive a session token |
| `POST` | `/api/auth/logout` | Logout current session |
| `GET` | `/api/me` | Get current user |
| `GET` | `/api/users` | List users visible to the current user |
| `GET` | `/api/projects` | List accessible projects |
| `POST` | `/api/projects` | Create a project, admin only |
| `PUT` | `/api/projects/:id` | Update a project, admin only |
| `GET` | `/api/tasks` | List accessible tasks |
| `POST` | `/api/tasks` | Create a task, admin only |
| `PATCH` | `/api/tasks/:id` | Update task details or status |
| `DELETE` | `/api/tasks/:id` | Delete a task, admin only |
| `GET` | `/api/dashboard` | Get dashboard statistics |

## Project Structure

```text
team_task_manager/
  data/
    db.json
  public/
    app.js
    index.html
    styles.css
  package.json
  server.js
  README.md
```

## Environment Variables

| Variable | Description |
| --- | --- |
| `PORT` | Server port. Railway usually sets this automatically. |
| `DB_PATH` | Optional custom path for the JSON database file. |

## Railway Deployment

1. Push this project to GitHub.
2. Create a Railway project from the repository.
3. Railway runs `npm start`.
4. Railway provides the `PORT` environment variable automatically.

The app uses only Node.js built-in modules, so no package installation beyond Node itself is required.
