import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const TODOS_FILE = join(DATA_DIR, "todos.json");

export type Todo = {
  id: string;
  text: string;
  done: boolean;
  agentId?: string;
  status?: "running" | "completed" | "failed";
  googleTaskId?: string;
};

function readTodos(): Todo[] {
  if (!existsSync(TODOS_FILE)) return [];
  return JSON.parse(readFileSync(TODOS_FILE, "utf-8"));
}

function writeTodos(todos: Todo[]): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TODOS_FILE, JSON.stringify(todos, null, 2));
}

export function listTodos(): Todo[] {
  return readTodos();
}

export function addTodo(text: string): Todo {
  const todos = readTodos();
  const todo: Todo = { id: randomUUID(), text, done: false };
  todos.push(todo);
  writeTodos(todos);
  return todo;
}

export function updateTodo(id: string, patch: Partial<Todo>): Todo | undefined {
  const todos = readTodos();
  const todo = todos.find((t) => t.id === id);
  if (!todo) return undefined;
  Object.assign(todo, patch);
  writeTodos(todos);
  return todo;
}

export function deleteTodo(id: string): void {
  writeTodos(readTodos().filter((t) => t.id !== id));
}

// Google Tasksから取り込む。同じgoogleTaskIdが既にあれば何もしない(再同期での重複防止)
export function addTodoFromGoogle(googleTaskId: string, text: string): Todo | null {
  const todos = readTodos();
  if (todos.some((t) => t.googleTaskId === googleTaskId)) return null;
  const todo: Todo = { id: randomUUID(), text, done: false, googleTaskId };
  todos.push(todo);
  writeTodos(todos);
  return todo;
}
